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

function stripUnconfirmed(candles?: Candle[]) {
  if (!candles || candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  if (last && last.confirm === false) return candles.slice(0, -1);
  return candles;
}

function lastCommonClose(args: { bybit?: Candle[]; binance?: Candle[] }) {
  const by = stripUnconfirmed(args.bybit);
  const bn = stripUnconfirmed(args.binance);
  if (!by?.length || !bn?.length) return null;

  const bnMap = new Map<number, number>();
  for (const c of bn) {
    if (Number.isFinite(c.ts) && Number.isFinite(c.c)) bnMap.set(c.ts, c.c);
  }

  // Walk from latest bybit candle backwards to find the latest common timestamp
  for (let i = by.length - 1; i >= 0; i--) {
    const c1 = by[i];
    const c2 = bnMap.get(c1.ts);
    if (!Number.isFinite(c1.c) || !Number.isFinite(c2 as number)) continue;
    return { ts: c1.ts, bybitClose: c1.c, binanceClose: c2 as number };
  }

  return null;
}

function computeDeviationBps(bybit1m?: Candle[], binance1m?: Candle[]) {
  const x = lastCommonClose({ bybit: bybit1m, binance: binance1m });
  if (!x) return undefined;

  const mid = (x.bybitClose + x.binanceClose) / 2;
  if (mid === 0) return undefined;

  return ((x.bybitClose - x.binanceClose) / mid) * 10000;
}

// Build aligned return series by timestamp intersection
function alignedReturns(args: { bybit: Candle[]; binance: Candle[]; windowBars: number }): number[] {
  const by = stripUnconfirmed(args.bybit) ?? [];
  const bn = stripUnconfirmed(args.binance) ?? [];

  // Wider tail to ensure we can find enough intersections
  const byTail = by.slice(-args.windowBars * 3);
  const bnTail = bn.slice(-args.windowBars * 3);

  const bnMap = new Map<number, number>();
  for (const c of bnTail) {
    if (Number.isFinite(c.ts) && Number.isFinite(c.c)) bnMap.set(c.ts, c.c);
  }

  // Collect aligned closes (chronological) for common timestamps
  const closesBy: number[] = [];
  const closesBn: number[] = [];

  for (const c of byTail) {
    const p2 = bnMap.get(c.ts);
    if (!Number.isFinite(c.c) || !Number.isFinite(p2 as number)) continue;
    closesBy.push(c.c);
    closesBn.push(p2 as number);
  }

  // Keep only the last windowBars+1 closes to compute windowBars returns
  const need = args.windowBars + 1;
  const n = Math.min(closesBy.length, closesBn.length);
  if (n < 30) return [];

  const a = closesBy.slice(-need);
  const b = closesBn.slice(-need);

  const out: number[] = [];
  const m = Math.min(a.length, b.length);
  for (let i = 1; i < m; i++) {
    const prevA = a[i - 1];
    const curA = a[i];
    const prevB = b[i - 1];
    const curB = b[i];

    // Use average of venue returns to reduce single-venue micro-noise
    if (prevA > 0 && curA > 0 && prevB > 0 && curB > 0) {
      const ra = Math.log(curA / prevA);
      const rb = Math.log(curB / prevB);
      out.push((ra + rb) / 2);
    }
  }

  return out;
}

function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return 0;

  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;

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
  windowBars?: number; // default 120
  maxLagBars?: number; // default 3
}) {
  const windowBars = args.windowBars ?? 120;
  const maxLag = args.maxLagBars ?? 3;

  if (!args.bybit1m || !args.binance1m) {
    return { leader: "none" as const, lag_bars: 0, score: 0, window_bars: windowBars };
  }

  // Aligned return series (intersection by timestamp)
  const r = alignedReturns({ bybit: args.bybit1m, binance: args.binance1m, windowBars });
  if (r.length < 30) {
    return { leader: "none" as const, lag_bars: 0, score: 0, window_bars: windowBars };
  }

  // We only have one aligned series here (avg return). Lead/lag is inferred by comparing
  // venue-specific series, so rebuild two aligned series explicitly for lag test.
  const by = stripUnconfirmed(args.bybit1m) ?? [];
  const bn = stripUnconfirmed(args.binance1m) ?? [];

  const byTail = by.slice(-windowBars * 3);
  const bnTail = bn.slice(-windowBars * 3);

  const bnMap = new Map<number, number>();
  for (const c of bnTail) {
    if (Number.isFinite(c.ts) && Number.isFinite(c.c)) bnMap.set(c.ts, c.c);
  }

  const closesBy: number[] = [];
  const closesBn: number[] = [];

  for (const c of byTail) {
    const p2 = bnMap.get(c.ts);
    if (!Number.isFinite(c.c) || !Number.isFinite(p2 as number)) continue;
    closesBy.push(c.c);
    closesBn.push(p2 as number);
  }

  const need = windowBars + 1;
  const a = closesBy.slice(-need);
  const b = closesBn.slice(-need);

  const rb: number[] = [];
  const rn: number[] = [];
  const m = Math.min(a.length, b.length);

  for (let i = 1; i < m; i++) {
    const pA0 = a[i - 1], pA1 = a[i];
    const pB0 = b[i - 1], pB1 = b[i];
    if (pA0 > 0 && pA1 > 0) rb.push(Math.log(pA1 / pA0));
    if (pB0 > 0 && pB1 > 0) rn.push(Math.log(pB1 / pB0));
  }

  if (rb.length < 30 || rn.length < 30) {
    return { leader: "none" as const, lag_bars: 0, score: 0, window_bars: windowBars };
  }

  let best = { lag: 0, c: -1 };

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let aa = rb;
    let bb = rn;

    // lag < 0 => Bybit leads
    // lag > 0 => Binance leads
    if (lag < 0) {
      const k = -lag;
      aa = rb.slice(0, rb.length - k);
      bb = rn.slice(k);
    } else if (lag > 0) {
      const k = lag;
      aa = rb.slice(k);
      bb = rn.slice(0, rn.length - k);
    }

    const c = corr(aa, bb);
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