export function ema(series: number[], period: number): number[] {
  const n = series.length;
  if (n === 0) return [];

  const out: number[] = new Array(n).fill(NaN);

  // Defensive: period <= 1 => identity
  if (period <= 1) {
    for (let i = 0; i < n; i++) out[i] = series[i];
    return out;
  }

  const k = 2 / (period + 1);

  // If not enough data to seed with SMA, keep output finite using the first value seed.
  // This preserves behavior for short series without injecting NaN into downstream indicators (e.g., MACD signal EMA).
  if (n < period) {
    out[0] = series[0];
    for (let i = 1; i < n; i++) {
      out[i] = series[i] * k + out[i - 1] * (1 - k);
    }
    return out;
  }

  // Seed with SMA over the first `period` samples
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i];
  const seed = sum / period;

  // Backfill early points with the seed to avoid NaN propagation and reduce seed bias
  for (let i = 0; i < period; i++) out[i] = seed;

  // Recursive EMA
  for (let i = period; i < n; i++) {
    out[i] = series[i] * k + out[i - 1] * (1 - k);
  }

  return out;
}
