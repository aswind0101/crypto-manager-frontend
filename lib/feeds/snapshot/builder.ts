// lib/feeds/snapshot/builder.ts

import type { Tf, Candle } from "../core/types";
import type { UnifiedSnapshot } from "./unifiedTypes";
import type { BybitFeedStore } from "../bybit/store";
import type { BinanceFeedStore } from "../binance/store";
import { scoreDataQuality } from "../quality/scoring";

const TFS: Tf[] = ["1m", "3m", "5m", "15m", "1h", "4h", "1D"];

// Liveness windows
const BYBIT_WS_DEAD_MS = 6000;
const BINANCE_WS_DEAD_MS = 6000;

// Bybit REST probe window (VPN gate)
const PROBE_DEAD_MS = 10000;
function tfMs(tf: string): number {
  switch (tf) {
    case "1m": return 60_000;
    case "3m": return 3 * 60_000;
    case "5m": return 5 * 60_000;
    case "15m": return 15 * 60_000;
    case "1h": return 60 * 60_000;
    case "4h": return 4 * 60 * 60_000;
    case "1D": return 24 * 60 * 60_000;
    default: return 0;
  }
}

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
function bestBidAsk(ob?: { bids: Array<[number, number]>; asks: Array<[number, number]> }) {
  if (!ob?.bids?.length || !ob?.asks?.length) return undefined;

  // robust: compute max bid and min ask (works even if arrays are not sorted)
  let bid = -Infinity;
  for (const [p] of ob.bids) if (p > bid) bid = p;

  let ask = Infinity;
  for (const [p] of ob.asks) if (p < ask) ask = p;

  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return undefined;
  if (ask < bid) return undefined; // crossed book guard

  return { bid, ask, mid: (bid + ask) / 2 };
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

  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;

  let num = 0,
    da = 0,
    db = 0;
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
  windowBars?: number; // default 120
  maxLagBars?: number; // default 3
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
    score: Math.max(0, Math.min(1, (best.c + 1) / 2)),
    window_bars: windowBars,
  };
}

// ---------------------------
// Bybit-only snapshot
// ---------------------------
export function buildUnifiedSnapshotFromBybit(args: {
  canon: string;
  clockSkewMs: number;
  bybit: BybitFeedStore;
}): UnifiedSnapshot {
  const now = Date.now();
  const st = args.bybit.state as any;

  const wsAlive =
    st.connected && st.lastHeartbeatTs > 0 && now - st.lastHeartbeatTs < BYBIT_WS_DEAD_MS;

  // ✅ Probe gate (VPN hard truth)
  const probeAlive = st.lastProbeOkTs > 0 && now - st.lastProbeOkTs < PROBE_DEAD_MS;

  const obTs = st.lastOrderbookTs || 0;
  const trTs = st.lastTradesTs || 0;
  const k1 = st.lastKlineTsByTf?.["1m"] || 0;
  const k5 = st.lastKlineTsByTf?.["5m"] || 0;

  const dataQuality = scoreDataQuality({
    now,
    wsAlive,
    probeAlive,
    bybitConnected: st.connected,
    orderbookStaleMs: obTs ? now - obTs : 999_999,
    tradesStaleMs: trTs ? now - trTs : 999_999,
    kline1mStaleMs: k1 ? now - k1 : 999_999,
    kline5mStaleMs: k5 ? now - k5 : 999_999,
  } as any);

  const timeframes = TFS.map((tf) => {
    const candlesRaw = st.klines?.[tf] as Candle[] | undefined;
    const hasCandles = Array.isArray(candlesRaw) && candlesRaw.length > 0;
    const candles = hasCandles ? candlesRaw : undefined;

    const tsLast = hasCandles ? candlesRaw![candlesRaw!.length - 1].ts : 0;
    const closeTs = tsLast ? tsLast + tfMs(tf) : 0;
    const staleMs = closeTs ? Math.max(0, now - closeTs) : 999_999;

    return {
      tf,
      candles: hasCandles ? { ohlcv: candlesRaw!, src: "bybit" as const, ts_last: tsLast } : undefined,

      // Binance candles will be attached in Bybit+Binance builder
      candles_binance: undefined,

      orderflow:
        tf === "1m"
          ? {
            orderbook: st.orderbook,
            trades: st.trades?.toArrayNewestFirst?.().slice(0, 1200) ?? [],
          }
          : undefined,

      diagnostics: { stale_ms: staleMs, partial: !hasCandles },
    };
  });

  const px = (() => {
    const ob = st.orderbook;
    const ba = bestBidAsk(ob);
    if (!ba) return undefined;
    return { ...ba, ts: ob.ts };
  })();

  return {
    canon: args.canon,
    ts_generated: now,
    clock_skew_ms: args.clockSkewMs,
    price: px,

    availability: {
      bybit: {
        ok: st.connected && wsAlive && probeAlive,
        notes: dataQuality.reasons?.length ? dataQuality.reasons : undefined,
      },
      binance: { ok: false, notes: ["Not enabled"] },
      okx: { ok: false, notes: ["Not enabled"] },
    },

    timeframes,
    data_quality: dataQuality,
  };
}

// ---------------------------
// ✅ Bybit + Binance snapshot (Task 2 + Task 3.1.1 attach candles_binance)
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
  const bst = args.binance.state as any;

  const binanceAlive =
    bst.connected && bst.lastHeartbeatTs > 0 && now - bst.lastHeartbeatTs < BINANCE_WS_DEAD_MS;

  snap.availability.binance = {
    ok: binanceAlive,
    notes: binanceAlive ? undefined : ["Binance WS heartbeat lost"],
  };

  // ✅ Attach Binance candles into each timeframe node
  for (const tfNode of snap.timeframes as any[]) {
    const tf = tfNode.tf as Tf;
    const bc = bst.klines?.[tf] as Candle[] | undefined;

    if (bc && bc.length) {
      const tsLast = bc[bc.length - 1].ts;
      tfNode.candles_binance = { ohlcv: bc, src: "binance" as const, ts_last: tsLast };
    } else {
      tfNode.candles_binance = undefined;
    }
  }

  // Cross-exchange: use 1m if available, else fallback 5m
  const by1m = (args.bybit.state as any).klines?.["1m"] as Candle[] | undefined;
  const bn1m = bst.klines?.["1m"] as Candle[] | undefined;

  const by5m = (args.bybit.state as any).klines?.["5m"] as Candle[] | undefined;
  const bn5m = bst.klines?.["5m"] as Candle[] | undefined;

  const dev =
    computeDeviationBps(by1m, bn1m) ??
    computeDeviationBps(by5m, bn5m);

  const ll = computeLeadLag({ bybit1m: by1m ?? by5m, binance1m: bn1m ?? bn5m });

  snap.cross_exchange = {
    deviation_bps: { bybit_binance: dev },
    lead_lag: ll,
  };

  // DataQuality: Binance chỉ là cross-check, trừ nhẹ nếu Binance chết
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
