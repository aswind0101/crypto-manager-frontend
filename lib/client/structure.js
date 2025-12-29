// lib/client/structure.js
export function trendLabelFromEma(closeSeries, fastEma, slowEma) {
  if (!Array.isArray(closeSeries) || closeSeries.length < 10) return "UNKNOWN";
  const lastClose = closeSeries[closeSeries.length - 1];

  if (fastEma == null || slowEma == null) return "UNKNOWN";

  // Very simple rules:
  if (fastEma > slowEma && lastClose > fastEma) return "UP";
  if (fastEma < slowEma && lastClose < fastEma) return "DOWN";
  return "RANGE";
}
