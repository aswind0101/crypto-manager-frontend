import { safeDiv } from '../feeds/features/math';

export function adx(high: number[], low: number[], close: number[], period = 14) {
  const n = Math.min(high.length, low.length, close.length);
  if (n < period + 2) return { adx: [], diPlus: [], diMinus: [] };

  const tr: number[] = new Array(n).fill(0);
  const dmPlus: number[] = new Array(n).fill(0);
  const dmMinus: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];

    dmPlus[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    dmMinus[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }

  // Wilder smoothing
  const atr: number[] = new Array(n).fill(NaN);
  const smP: number[] = new Array(n).fill(NaN);
  const smM: number[] = new Array(n).fill(NaN);

  let atr0 = 0, p0 = 0, m0 = 0;
  for (let i = 1; i <= period; i++) {
    atr0 += tr[i];
    p0 += dmPlus[i];
    m0 += dmMinus[i];
  }
  atr[period] = atr0;
  smP[period] = p0;
  smM[period] = m0;

  for (let i = period + 1; i < n; i++) {
    atr[i] = atr[i - 1] - safeDiv(atr[i - 1], period, 0) + tr[i];
    smP[i] = smP[i - 1] - safeDiv(smP[i - 1], period, 0) + dmPlus[i];
    smM[i] = smM[i - 1] - safeDiv(smM[i - 1], period, 0) + dmMinus[i];
  }

  const diPlus: number[] = new Array(n).fill(NaN);
  const diMinus: number[] = new Array(n).fill(NaN);
  const dx: number[] = new Array(n).fill(NaN);

  for (let i = period; i < n; i++) {
    const dip = 100 * safeDiv(smP[i], atr[i], 0);
    const dim = 100 * safeDiv(smM[i], atr[i], 0);
    diPlus[i] = dip;
    diMinus[i] = dim;
    dx[i] = 100 * safeDiv(Math.abs(dip - dim), (dip + dim), 0);
  }

  const adxArr: number[] = new Array(n).fill(NaN);
  let adx0 = 0;
  // ADX first value: average DX of next period values
  let cnt = 0;
  for (let i = period; i < n && cnt < period; i++, cnt++) adx0 += dx[i];
  if (cnt === period) adxArr[period * 2] = adx0 / period;

  for (let i = period * 2 + 1; i < n; i++) {
    adxArr[i] = ((adxArr[i - 1] * (period - 1)) + dx[i]) / period;
  }

  return { adx: adxArr, diPlus, diMinus };
}
