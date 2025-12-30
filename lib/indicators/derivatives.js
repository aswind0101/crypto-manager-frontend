// lib/indicators/derivatives.js

export function fundingExtremeLabel(funding, hi = 0.0007, lo = -0.0007) {
  if (!Number.isFinite(funding)) return "unknown";
  if (funding >= hi) return "positive_extreme";
  if (funding <= lo) return "negative_extreme";
  return "normal";
}

export function oiTrendLabel(oiSeries) {
  // oiSeries: [{ts, oi}] asc
  const arr = Array.isArray(oiSeries) ? oiSeries.filter(x => Number.isFinite(x.oi)) : [];
  if (arr.length < 5) return "unknown";
  const a = arr[arr.length - 1].oi;
  const b = arr[Math.max(0, arr.length - 6)].oi;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return "unknown";
  const chg = (a - b) / b;
  if (chg > 0.05) return "rising_strong";
  if (chg > 0.01) return "rising";
  if (chg < -0.05) return "falling_strong";
  if (chg < -0.01) return "falling";
  return "flat";
}

export function basisPremium(mark, index) {
  if (!Number.isFinite(mark) || !Number.isFinite(index) || index === 0) return null;
  return (mark - index) / index; // premium ratio
}
