export function rsi(series: number[], period = 14): number[] {
  if (!Array.isArray(series) || series.length < period + 1) return [];

  const out: number[] = new Array(series.length).fill(NaN);

  let gain = 0;
  let loss = 0;

  // Seed with first period changes
  for (let i = 1; i <= period; i++) {
    const ch = series[i] - series[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }

  gain /= period;
  loss /= period;

  out[period] = rsiFromAvg(gain, loss);

  // Wilder smoothing
  for (let i = period + 1; i < series.length; i++) {
    const ch = series[i] - series[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;

    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;

    out[i] = rsiFromAvg(gain, loss);
  }

  return out;
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  // Correct edge cases:
  // - avgLoss == 0 and avgGain > 0 => RSI = 100
  // - avgGain == 0 and avgLoss > 0 => RSI = 0
  // - both == 0 => RSI = 50 (flat)
  if (!Number.isFinite(avgGain) || !Number.isFinite(avgLoss)) return NaN;

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  const v = 100 - 100 / (1 + rs);

  // guard numerical drift
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
