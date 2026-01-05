import { mean, stdev, safeDiv } from '../feeds/features/math';

export function bbands(series: number[], period = 20, mult = 2) {
  const out = {
    mid: new Array(series.length).fill(NaN),
    upper: new Array(series.length).fill(NaN),
    lower: new Array(series.length).fill(NaN),
    width: new Array(series.length).fill(NaN), // (upper-lower)/mid
  };

  for (let i = period - 1; i < series.length; i++) {
    const win = series.slice(i - period + 1, i + 1);
    const m = mean(win);
    const sd = stdev(win);
    const u = m + mult * sd;
    const l = m - mult * sd;

    out.mid[i] = m;
    out.upper[i] = u;
    out.lower[i] = l;
    out.width[i] = safeDiv((u - l), m, 0);
  }

  return out;
}
