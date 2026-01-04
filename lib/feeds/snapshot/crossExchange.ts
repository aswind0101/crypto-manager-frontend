import type { Candle } from "../core/types";

function lastClose(candles?: Candle[]) {
  if (!candles || candles.length === 0) return null;
  return candles[candles.length - 1].c;
}

export function computeDeviationBps(bybit1m?: Candle[], binance1m?: Candle[]) {
  const b = lastClose(bybit1m);
  const n = lastClose(binance1m);
  if (b == null || n == null) return null;

  const mid = (b + n) / 2;
  if (mid === 0) return null;
  return ((b - n) / mid) * 10000; // bps
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

export function computeLeadLag(args: {
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
    // lag < 0 => Bybit leads (shift Binance forward)
    // lag > 0 => Binance leads
    let a = rb;
    let b = rn;

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
