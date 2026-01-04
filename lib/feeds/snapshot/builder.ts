// lib/feeds/snapshot/builder.ts

import type { Tf, Candle } from "../core/types";
import type { UnifiedSnapshot } from "./unifiedTypes";
import type { BybitFeedStore } from "../bybit/store";
import type { BinanceFeedStore } from "../binance/store";
import { scoreDataQuality } from "../quality/scoring";

// Timeframes
const TFS: Tf[] = ["1m", "3m", "5m", "15m", "1h", "4h", "1D"];

// Liveness windows
const BYBIT_WS_DEAD_MS = 6000;
const BINANCE_WS_DEAD_MS = 6000;
const PROBE_DEAD_MS = 10000;

// ---------------------------
// Helpers: Cross-Exchange
// ---------------------------
function lastClose(candles?: Candle[]) {
  if (!candles || candles.length === 0) return null;
  return candles[candles.length - 1].c;
}

function computeDeviationBps(bybit1m?: Candle[], binance1m?: Candle[]) {
  const b = lastClose(bybit1m);
  const n = lastClose(binance1m);
  if (b == null || n == null) return undefined;

  const mid = (b + n) / 2;
  if (mid === 0) return undefined;

  return ((b - n) / mid) * 10000;
}

function returns1m(candles: Candle[], windowBars: number): number[] {
  const xs = candles.slice(-windowBars - 1);
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const prev = xs[i - 1].c;
    const cur = xs[i].c;
    if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
  }
  return out;
}

function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return 0;

  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;

  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }

  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

function computeLeadLag(args: {
  bybit1m?: Candle[];
  binance1m?: Candle[];
  windowBars?: number;   // default 120
  maxLagBars?: number;   // default 3
}) {
  const windowBars = args.windowBars ?? 120;
  const maxLag = args.maxLagBars ?? 3;

  if (!args.bybit1m || !args.binance1m) {
    return { leader: "none" as const, lag_bars: 0, score: 0, window_bars: windowBars };
  }

  const rb = returns1m(args.bybit1m, windowBars);
  const rn = returns1m(args.binance1m, windowBars);

  if (rb.length < 30 || rn.length < 30) {
    return { leader: "none" as const, lag_bars: 0, score: 0, window_bars: windowBars };
  }

  let best = { lag: 0, c: -1 };

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let a = rb;
    let b = rn;

    // lag < 0 => Bybit leads
    // lag > 0 => Binance leads
    if (lag < 0) {
      const k = -lag;
      a = rb.slice(0, rb.length - k);
      b = rn.slice(k);
    } else if (lag > 0) {
      const k = lag;
      a = rb.slice(k);
      b = rn.slice(0, rn.length - k);
    }

    const c = corr(a, b);
    if (c > best.c) best = { lag, c };
  }

  let leader: "bybit" | "binance" | "none" = "none";
  if (best.c > 0.15) {
    if (best.lag < 0) leader = "bybit";
    else if (best.lag > 0) leader = "binance";
    else leader = "none";
  }

  return {
    leader,
    lag_bars: best.lag,
    score: Math.max(0, Math.min(1, (best.c + 1) / 2)), // normalize [-1..1] -> [0..1]
    window_bars: windowBars,
  };
}

// ---------------------------
// Bybit-only snapshot (Task 1 + probe + liveness)
// ---------------------------
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
    now - st.lastHeartbeatTs < BYBIT_WS_DEAD_MS;

  const probeAlive =
    (st as any).lastProbeOkTs > 0 &&
    now - (st as any).lastProbeOkTs < PROBE_DEAD_MS;

  const obTs = st.lastOrderbookTs || 0;
  const trTs = st.lastTradesTs || 0;
  const k1 = st.lastKlineTsByTf["1m"] || 0;
  const k5 = st.lastKlineTsByTf["5m"] || 0;

  const dataQuality = scoreDataQuality({
    now,
    wsAlive,
    probeAlive,
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

// ---------------------------
// Bybit + Binance snapshot (Task 2)
// ---------------------------
export function buildUnifiedSnapshotFromBybitBinance(args: {
  canon: string;
  clockSkewMs: number;
  bybit: BybitFeedStore;
  binance: BinanceFeedStore;
}): UnifiedSnapshot {
  const snap = buildUnifiedSnapshotFromBybit({
    canon: args.canon,
    clockSkewMs: args.clockSkewMs,
    bybit: args.bybit,
  });

  const now = Date.now();
  const bst = args.binance.state;

  const binanceAlive =
    bst.connected &&
    bst.lastHeartbeatTs > 0 &&
    now - bst.lastHeartbeatTs < BINANCE_WS_DEAD_MS;

  // availability.binance
  snap.availability.binance = {
    ok: binanceAlive,
    notes: binanceAlive ? undefined : ["Binance WS heartbeat lost"],
  };

  // Cross-exchange based on 1m candles close
  const bybit1m = args.bybit.state.klines["1m"];
  const binance1m = bst.klines["1m"];

  const dev = computeDeviationBps(bybit1m, binance1m);
  const ll = computeLeadLag({ bybit1m, binance1m, windowBars: 120, maxLagBars: 3 });

  // attach cross_exchange (type may or may not exist in unifiedTypes yet)
  (snap as any).cross_exchange = {
    deviation_bps: { bybit_binance: dev },
    lead_lag: ll,
  };

  // DataQuality adjustment: Binance is cross-check, trừ nhẹ nếu chết
  if (!binanceAlive) {
    const s0 = snap.data_quality.score;
    const s1 = Math.max(0, s0 - 10);

    snap.data_quality.score = s1;
    snap.data_quality.reasons = [
      ...(snap.data_quality.reasons || []),
      "Binance WS not alive (cross-exchange degraded)",
    ];

    snap.data_quality.grade =
      s1 >= 85 ? "A" :
      s1 >= 70 ? "B" :
      s1 >= 50 ? "C" : "D";
  }

  return snap;
}
