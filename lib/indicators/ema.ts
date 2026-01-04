export function ema(series: number[], period: number): number[] {
  if (series.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(series.length);
  out[0] = series[0];
  for (let i = 1; i < series.length; i++) {
    out[i] = series[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}
