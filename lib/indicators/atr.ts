import { ema } from "./ema";

export function atr(high: number[], low: number[], close: number[], period = 14): number[] {
  const n = Math.min(high.length, low.length, close.length);
  if (n < 2) return [];

  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }

  // Wilder ATR: EMA-ish smoothing; EMA is acceptable and fast
  return ema(tr, period);
}
