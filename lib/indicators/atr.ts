export function atr(high: number[], low: number[], close: number[], period = 14): number[] {
  const n = Math.min(high.length, low.length, close.length);
  // Need at least period+1 points to have TR[1..period] and produce first ATR at index = period
  if (n < period + 1) return [];

  // True Range (TR)
  // TR[0] is undefined because there is no prevClose
  const tr: number[] = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }

  // Wilder ATR (RMA/SMMA):
  // ATR[period] = average(TR[1..period])
  // ATR[i] = (ATR[i-1] * (period - 1) + TR[i]) / period
  const out: number[] = new Array(n).fill(NaN);

  let sum = 0;
  for (let i = 1; i <= period; i++) {
    const v = tr[i];
    if (Number.isFinite(v)) sum += v;
  }

  out[period] = sum / period;

  for (let i = period + 1; i < n; i++) {
    const prev = out[i - 1];
    const curTr = tr[i];

    if (!Number.isFinite(prev) || !Number.isFinite(curTr)) {
      out[i] = NaN;
      continue;
    }

    out[i] = ((prev * (period - 1)) + curTr) / period;
  }

  return out;
}
