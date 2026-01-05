import type { Candle, Trade, Orderbook, Tf } from "../core/types";
import { RingBuffer } from "../core/ringBuffer";
import { EventBus } from "../core/eventBus";
import {
  applyOrderbookDelta,
  materializeOrderbook,
  normBybitKlines,
  normBybitOrderbook,
  normBybitTrades,
} from "./normalize";

export type BybitStoreState = {
  connected: boolean;

  lastMsgTs: number;          // thời điểm client nhận message (ms)
  lastHeartbeatTs: number;    // liveness gate: ms, cập nhật mỗi khi nhận bất kỳ message nào
  lastProbeOkTs: number; // NEW: thời điểm probe REST OK gần nhất

  lastOrderbookTs: number;    // ts từ payload (ms)
  lastTradesTs: number;       // ts từ payload (ms)
  lastKlineTsByTf: Partial<Record<Tf, number>>;

  orderbook?: Orderbook;
  trades: RingBuffer<Trade>;
  klines: Partial<Record<Tf, Candle[]>>;
};

export type BybitStoreEvent =
  | { type: "ws_state"; connected: boolean }
  | { type: "orderbook" }
  | { type: "trades" }
  | { type: "kline"; tf: Tf };

export class BybitFeedStore {
  public events = new EventBus<BybitStoreEvent>();

  private depth = 200;
  private symbol = "ETHUSDT";

  // Local book maps for delta application
  private book = { bids: new Map<number, number>(), asks: new Map<number, number>() };

  public state: BybitStoreState = {
    connected: false,
    lastMsgTs: 0,
    lastHeartbeatTs: 0,
    lastProbeOkTs: 0,

    lastOrderbookTs: 0,
    lastTradesTs: 0,
    lastKlineTsByTf: {},

    trades: new RingBuffer<Trade>(4000),
    klines: {},
  };
  setSymbol(symbol: string, depth = 200) {
    this.symbol = symbol;
    this.depth = depth;

    // reset local state
    this.book = { bids: new Map(), asks: new Map() };
    this.state.orderbook = undefined;
    this.state.trades = new RingBuffer<Trade>(4000);
    this.state.klines = {};
    this.state.lastKlineTsByTf = {};

    this.state.connected = false;
    this.state.lastMsgTs = 0;
    this.state.lastHeartbeatTs = 0;
    this.state.lastProbeOkTs = 0;

    this.state.lastOrderbookTs = 0;
    this.state.lastTradesTs = 0;
  }

  onWsState(connected: boolean) {
    this.state.connected = connected;

    // Nếu bị đóng WS, lập tức coi heartbeat = 0 để builder nhận ra "dead"
    if (!connected) {
      this.state.lastHeartbeatTs = 0;
    }

    this.events.emit({ type: "ws_state", connected });
  }
  seedKlines(tf: Tf, candles: Candle[]) {
    if (!candles || candles.length === 0) return;

    // 1) Chuẩn hoá confirm cho dữ liệu seed:
    // - Tất cả candle trừ candle cuối: coi như đã đóng => confirm=true
    // - Candle cuối: giữ nguyên nếu có confirm, nếu không có thì để false (an toàn, tránh fake close)
    const sorted = [...candles].sort((a, b) => a.ts - b.ts);
    const normalized = sorted.map((c, i) => {
      const isLast = i === sorted.length - 1;

      // preserve if explicitly boolean; otherwise infer
      const hasBool = typeof (c as any).confirm === "boolean";
      const confirm = hasBool ? Boolean((c as any).confirm) : (isLast ? false : true);

      return { ...c, confirm };
    });

    // 2) Merge by timestamp, keep oldest-first, cap history
    const existing = this.state.klines[tf] || [];
    const map = new Map<number, Candle>();

    for (const c of existing) map.set(c.ts, c);
    for (const c of normalized) map.set(c.ts, c);

    const merged = Array.from(map.values())
      .sort((a, b) => a.ts - b.ts)
      .slice(-1200);

    this.state.klines[tf] = merged;
    this.state.lastKlineTsByTf[tf] = merged[merged.length - 1]?.ts || 0;

    // IMPORTANT: EventBus requires a typed event object
    this.events.emit({ type: "kline", tf });
  }

  onWsMessage(msg: any) {
    const now = Date.now();

    // Liveness gate: cứ nhận message là heartbeat cập nhật
    this.state.lastMsgTs = now;
    this.state.lastHeartbeatTs = now;

    const topic: string = msg?.topic || "";
    if (!topic) return;

    if (topic.startsWith("publicTrade.")) {
      const trades = normBybitTrades(msg);
      if (trades.length) {
        for (const t of trades) this.state.trades.push(t);
        this.state.lastTradesTs = trades[trades.length - 1].ts;
        this.events.emit({ type: "trades" });
      }
      return;
    }

    if (topic.startsWith("kline.")) {
      const parts = topic.split(".");
      const interval = parts[1];
      const tf = this.intervalToTf(interval);
      if (!tf) return;

      const kl = normBybitKlines(msg);
      if (!kl.length) return;

      // Lưu candles theo oldest-first (khuyến nghị cho indicator sau này)
      const existing = this.state.klines[tf] || [];
      const map = new Map<number, Candle>();
      for (const c of existing) map.set(c.ts, c);
      for (const c of kl) map.set(c.ts, c);

      const merged = Array.from(map.values())
        .sort((a, b) => a.ts - b.ts)
        .slice(-1200);

      this.state.klines[tf] = merged;
      this.state.lastKlineTsByTf[tf] = merged[merged.length - 1]?.ts || 0;

      this.events.emit({ type: "kline", tf });
      return;
    }

    if (topic.startsWith("orderbook.")) {
      const delta = normBybitOrderbook(msg);
      if (!delta) return;

      if (delta.snapshot) {
        this.book = { bids: new Map(), asks: new Map() };
      }

      applyOrderbookDelta(this.book, delta);
      const ob = materializeOrderbook(this.book, this.depth, delta.ts);

      this.state.orderbook = ob;
      this.state.lastOrderbookTs = ob.ts;

      this.events.emit({ type: "orderbook" });
      return;
    }
  }

  private intervalToTf(interval: string): Tf | null {
    switch (interval) {
      case "1": return "1m";
      case "3": return "3m";
      case "5": return "5m";
      case "15": return "15m";
      case "60": return "1h";
      case "240": return "4h";
      case "D": return "1D";
      default: return null;
    }
  }
  setProbeAlive(ok: boolean) {
    if (ok) {
      this.state.lastProbeOkTs = Date.now();
    }
    // emit để UI/snapshot update ngay
    this.events.emit({ type: "ws_state", connected: this.state.connected });
  }
}
