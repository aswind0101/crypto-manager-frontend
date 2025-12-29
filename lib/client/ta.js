// lib/client/ta.js
export function ema(values, period) {
  const p = Number(period);
  if (!Array.isArray(values) || values.length < p || p <= 1) return null;

  // SMA seed
  let sma = 0;
  for (let i = 0; i < p; i++) sma += values[i];
  sma /= p;

  const k = 2 / (p + 1);
  let prev = sma;

  for (let i = p; i < values.length; i++) {
    const v = values[i];
    prev = v * k + prev * (1 - k);
  }
  return prev;
}

export function atr14(klines, period = 14) {
  const p = Number(period);
  if (!Array.isArray(klines) || klines.length < p + 1) return null;

  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const c = klines[i];
    const prev = klines[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  // Wilder smoothing seed with SMA of first p TR
  if (trs.length < p) return null;
  let atr = 0;
  for (let i = 0; i < p; i++) atr += trs[i];
  atr /= p;

  for (let i = p; i < trs.length; i++) {
    atr = (atr * (p - 1) + trs[i]) / p;
  }
  return atr;
}

export function lastCandle(klines) {
  if (!Array.isArray(klines) || klines.length === 0) return null;
  const c = klines[klines.length - 1];
  return { ts: c.startTime, o: c.open, h: c.high, l: c.low, c: c.close };
}
