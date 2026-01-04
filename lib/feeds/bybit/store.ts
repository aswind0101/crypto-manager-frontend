import type { Candle, Trade, Orderbook, Tf } from "../core/types";
import { RingBuffer } from "../core/ringBuffer";
import { EventBus } from "../core/eventBus";
import { applyOrderbookDelta, materializeOrderbook, normBybitKlines, normBybitOrderbook, normBybitTrades } from "./normalize";

export type BybitStoreState = {
  connected: boolean;
  lastMsgTs: number;        // ms
  lastOrderbookTs: number;
  lastTradesTs: number;
  lastKlineTsByTf: Partial<Record<Tf, number>>;

  orderbook?: Orderbook;    // materialized top depth
  trades: RingBuffer<Trade>;
  klines: Partial<Record<Tf, Candle[]>>; // candles newest-first or oldest-first (chọn 1)
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
    this.state.lastMsgTs = 0;
    this.state.lastOrderbookTs = 0;
    this.state.lastTradesTs = 0;
  }

  onWsState(connected: boolean) {
    this.state.connected = connected;
    this.events.emit({ type: "ws_state", connected });
  }

  onWsMessage(msg: any) {
    this.state.lastMsgTs = Date.now();

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
      // Extract tf from topic: kline.<interval>.<symbol>
      const parts = topic.split(".");
      const interval = parts[1];
      const tf = this.intervalToTf(interval);
      if (!tf) return;

      const kl = normBybitKlines(msg);
      if (!kl.length) return;

      // Lưu candles theo oldest-first để dễ indicator (khuyến nghị)
      const existing = this.state.klines[tf] || [];
      // Merge theo ts
      const map = new Map<number, Candle>();
      for (const c of existing) map.set(c.ts, c);
      for (const c of kl) map.set(c.ts, c);
      const merged = Array.from(map.values()).sort((a, b) => a.ts - b.ts).slice(-1200); // giữ 1200 nến
      this.state.klines[tf] = merged;

      this.state.lastKlineTsByTf[tf] = merged[merged.length - 1]?.ts || 0;
      this.events.emit({ type: "kline", tf });
      return;
    }

    if (topic.startsWith("orderbook.")) {
      const delta = normBybitOrderbook(msg);
      if (!delta) return;

      if (delta.snapshot) {
        // snapshot: reset book
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
}
