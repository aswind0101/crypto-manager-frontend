import type { Candle, Trade, Tf } from "../core/types";
import { RingBuffer } from "../core/ringBuffer";
import { EventBus } from "../core/eventBus";
import { normBinanceAggTrade, normBinanceKline } from "./normalize";

export type BinanceStoreState = {
  connected: boolean;
  lastMsgTs: number;
  lastHeartbeatTs: number;

  lastTradesTs: number;
  lastKlineTsByTf: Partial<Record<Tf, number>>;

  trades: RingBuffer<Trade>;
  klines: Partial<Record<Tf, Candle[]>>;
};

export type BinanceStoreEvent =
  | { type: "ws_state"; connected: boolean }
  | { type: "trades" }
  | { type: "kline"; tf: Tf };

export class BinanceFeedStore {
  public events = new EventBus<BinanceStoreEvent>();

  public state: BinanceStoreState = {
    connected: false,
    lastMsgTs: 0,
    lastHeartbeatTs: 0,
    lastTradesTs: 0,
    lastKlineTsByTf: {},
    trades: new RingBuffer<Trade>(4000),
    klines: {},
  };

  setSymbol() {
    // Binance stream dùng symbolCanon lowercase trong ws subscribe,
    // store không cần giữ symbol.
    this.state.connected = false;
    this.state.lastMsgTs = 0;
    this.state.lastHeartbeatTs = 0;
    this.state.lastTradesTs = 0;
    this.state.lastKlineTsByTf = {};
    this.state.trades = new RingBuffer<Trade>(4000);
    this.state.klines = {};
  }

  onWsState(connected: boolean) {
    this.state.connected = connected;
    if (!connected) this.state.lastHeartbeatTs = 0;
    this.events.emit({ type: "ws_state", connected });
  }

  onWsMessage(msg: any) {
    const now = Date.now();
    this.state.lastMsgTs = now;
    this.state.lastHeartbeatTs = now;

    const t = normBinanceAggTrade(msg);
    if (t) {
      this.state.trades.push(t);
      this.state.lastTradesTs = t.ts;
      this.events.emit({ type: "trades" });
      return;
    }

    const kl = normBinanceKline(msg);
    if (kl) {
      const tf = binanceTfToTf(kl.tf);
      if (!tf) return;

      const existing = this.state.klines[tf] || [];
      const map = new Map<number, Candle>();
      for (const c of existing) map.set(c.ts, c);
      map.set(kl.candle.ts, kl.candle);

      const merged = Array.from(map.values())
        .sort((a, b) => a.ts - b.ts)
        .slice(-1200);

      this.state.klines[tf] = merged;
      this.state.lastKlineTsByTf[tf] = merged[merged.length - 1]?.ts || 0;
      this.events.emit({ type: "kline", tf });
    }
  }
}

function binanceTfToTf(binanceTf: string): Tf | null {
  switch (binanceTf) {
    case "1m": return "1m";
    case "3m": return "3m";
    case "5m": return "5m";
    case "15m": return "15m";
    case "1h": return "1h";
    case "4h": return "4h";
    case "1d": return "1D";
    default: return null;
  }
}
