import { safeDiv, clamp } from "../math";

export function aggressionRatio(trades: Array<{ q: number; side: "buy" | "sell" }>) {
  let buy = 0;
  let sell = 0;
  for (const t of trades) {
    if (t.side === "buy") buy += t.q;
    else sell += t.q;
  }
  const r = safeDiv(buy, buy + sell, 0.5);
  return clamp(r, 0, 1);
}
