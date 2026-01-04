// lib/feeds/snapshot/builder.ts

import type { Tf } from "../core/types";
import type { UnifiedSnapshot } from "./unifiedTypes";
import type { BybitFeedStore } from "../bybit/store";
import { scoreDataQuality } from "../quality/scoring";

const TFS: Tf[] = ["1m", "3m", "5m", "15m", "1h", "4h", "1D"];

// Nếu không nhận được bất kỳ message nào trong 6s => coi như WS dead
const WS_DEAD_MS = 6000;
const PROBE_DEAD_MS = 10000; // 10s: probe OK trong 10s gần nhất mới coi là alive

export function buildUnifiedSnapshotFromBybit(args: {
  canon: string;
  clockSkewMs: number;
  bybit: BybitFeedStore;
}): UnifiedSnapshot {
  const now = Date.now();
  const st = args.bybit.state;

  const wsAlive =
    st.connected &&
    st.lastHeartbeatTs > 0 &&
    now - st.lastHeartbeatTs < WS_DEAD_MS;
  const probeAlive =
    st.lastProbeOkTs > 0 &&
    now - st.lastProbeOkTs < PROBE_DEAD_MS;

  const obTs = st.lastOrderbookTs || 0;
  const trTs = st.lastTradesTs || 0;
  const k1 = st.lastKlineTsByTf["1m"] || 0;
  const k5 = st.lastKlineTsByTf["5m"] || 0;

  const dataQuality = scoreDataQuality({
    now,
    wsAlive,
    probeAlive, // NEW
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
        ? { ohlcv: candles, src: "bybit" as const, ts_last: tsLast }
        : undefined,

      orderflow:
        tf === "1m"
          ? {
            orderbook: st.orderbook,
            trades: st.trades.toArrayNewestFirst().slice(0, 1200),
          }
          : undefined,

      diagnostics: { stale_ms: staleMs, partial: !candles },
    };
  });

  return {
    canon: args.canon,
    ts_generated: now,
    clock_skew_ms: args.clockSkewMs,

    availability: {
      bybit: {
        ok: st.connected && wsAlive && probeAlive,
        notes: dataQuality.reasons.length ? dataQuality.reasons : undefined,
      },
      binance: { ok: false, notes: ["Not enabled (Task 2)"] },
      okx: { ok: false, notes: ["Not enabled (Task 2)"] },
    },

    timeframes,
    data_quality: dataQuality,
  };
}
