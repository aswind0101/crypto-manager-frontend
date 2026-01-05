import { safeDiv } from '../feeds/features/math';

export function rsi(series: number[], period = 14): number[] {
  if (series.length < period + 1) return [];

  const out: number[] = new Array(series.length).fill(NaN);

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const ch = series[i] - series[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }

  gain /= period;
  loss /= period;

  out[period] = 100 - (100 / (1 + safeDiv(gain, loss, 0)));

  for (let i = period + 1; i < series.length; i++) {
    const ch = series[i] - series[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;

    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;

    const rs = safeDiv(gain, loss, 0);
    out[i] = 100 - (100 / (1 + rs));
  }

  return out;
}
