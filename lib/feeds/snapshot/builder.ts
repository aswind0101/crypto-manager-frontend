// lib/feeds/snapshot/builder.ts

import type { Tf } from "../core/types";
import type { UnifiedSnapshot } from "./unifiedTypes";
import type { BybitFeedStore } from "../bybit/store";
import { scoreDataQuality } from "../quality/scoring";

const TFS: Tf[] = ["1m", "3m", "5m", "15m", "1h", "4h", "1D"];

export function buildUnifiedSnapshotFromBybit(args: {
  canon: string;
  clockSkewMs: number;
  bybit: BybitFeedStore;
}): UnifiedSnapshot {
  const now = Date.now();
  const st = args.bybit.state;

  const obTs = st.lastOrderbookTs || 0;
  const trTs = st.lastTradesTs || 0;
  const k1 = st.lastKlineTsByTf["1m"] || 0;
  const k5 = st.lastKlineTsByTf["5m"] || 0;

  const dataQuality = scoreDataQuality({
    now,
    bybitConnected: st.connected,
    orderbookStaleMs: obTs ? now - obTs : 999_999,
    tradesStaleMs: trTs ? now - trTs : 999_999,
    kline1mStaleMs: k1 ? now - k1 : 999_999,
    kline5mStaleMs: k5 ? now - k5 : 999_999,
  });

  const timeframes = TFS.map((tf) => {
    const candles = st.klines[tf];
    const tsLast = candles?.length ? candles[candles.length - 1].ts : 0;
    const staleMs = tsLast ? now - tsLast : 999_999;

    return {
      tf,
      candles: candles
        ? {
            ohlcv: candles,
            src: "bybit" as const,
            ts_last: tsLast,
          }
        : undefined,

      orderflow:
        tf === "1m"
          ? {
              orderbook: st.orderbook,
              trades: st.trades.toArrayNewestFirst().slice(0, 1200),
            }
          : undefined,

      diagnostics: {
        stale_ms: staleMs,
        partial: !candles,
      },
    };
  });

  return {
    canon: args.canon,
    ts_generated: now,
    clock_skew_ms: args.clockSkewMs,

    availability: {
      bybit: { ok: st.connected },
      binance: { ok: false, notes: ["Not enabled (Task 2)"] },
      okx: { ok: false, notes: ["Not enabled (Task 2)"] },
    },

    timeframes,
    data_quality: dataQuality,
  };
}
