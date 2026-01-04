import type { Candle } from "../core/types";

export type KeyLevel = { price: number; kind: "R" | "S"; strength: number };

export function computePivotLevels(candles: Candle[], lookback = 2, maxLevels = 12): KeyLevel[] {
  if (!candles || candles.length < 50) return [];

  const pivots: Array<{ price: number; kind: "R" | "S" }> = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i].h;
    const l = candles[i].l;

    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= h || candles[i + j].h >= h) isHigh = false;
      if (candles[i - j].l <= l || candles[i + j].l <= l) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) pivots.push({ price: h, kind: "R" });
    if (isLow) pivots.push({ price: l, kind: "S" });
  }

  // Cluster gần nhau theo % để tăng strength
  const eps = 0.0012; // 12 bps ~ intraday reasonable (tune later)
  const clusters: Array<{ p: number; kind: "R" | "S"; n: number }> = [];

  for (const pv of pivots) {
    let found = false;
    for (const c of clusters) {
      const mid = (c.p + pv.price) / 2;
      if (Math.abs(pv.price - c.p) / mid < eps && c.kind === pv.kind) {
        c.p = (c.p * c.n + pv.price) / (c.n + 1);
        c.n += 1;
        found = true;
        break;
      }
    }
    if (!found) clusters.push({ p: pv.price, kind: pv.kind, n: 1 });
  }

  const out = clusters
    .sort((a, b) => b.n - a.n)
    .slice(0, maxLevels)
    .map((c) => ({ price: c.p, kind: c.kind, strength: c.n }));

  // Sort theo giá để dễ tìm level gần nhất
  out.sort((a, b) => a.price - b.price);
  return out;
}

export function nearestLevels(levels: KeyLevel[], price: number) {
  let below: KeyLevel | undefined;
  let above: KeyLevel | undefined;

  for (const lv of levels) {
    if (lv.price <= price) below = lv;
    if (lv.price > price) { above = lv; break; }
  }
  return { below, above };
}
