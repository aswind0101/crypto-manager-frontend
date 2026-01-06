import type { FeaturesSnapshot } from "../features/types";

export function gradeFromScore(score: number): "A" | "B" | "C" | "D" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreCommon(f: FeaturesSnapshot) {
  let score = 50;
  const reasons: string[] = [];

  // DQ gate
  if (f.quality.dq_grade === "A") { score += 10; reasons.push("DQ A"); }
  else if (f.quality.dq_grade === "B") { score += 4; reasons.push("DQ B"); }
  else { score -= 25; reasons.push("DQ low"); }

  // Bias strength (existing)
  score += Math.round(clamp(f.bias.trend_strength, 0, 1) * 20);
  if (f.bias.trend_strength >= 0.6) reasons.push("Strong bias");
  else if (f.bias.trend_strength <= 0.2) reasons.push("Weak bias");

  // ADX (NEW)
  if (typeof f.bias.adx14 === "number") {
    const adx = f.bias.adx14;
    const pts = Math.round(clamp((adx - 15) / 15, 0, 1) * 8); // up to +8
    score += pts;
    if (adx >= 22) reasons.push("ADX trending");
  }

  // EMA200 slope (NEW)
  if (typeof f.bias.ema200_slope_bps === "number") {
    const mag = Math.abs(f.bias.ema200_slope_bps);
    const pts = Math.round(clamp(mag / 8, 0, 1) * 5); // up to +5
    score += pts;
    if (mag >= 4) reasons.push("EMA slope present");
  }

  // Vol regime (existing) + multi-TF atr (NEW)
  if (f.bias.vol_regime === "high") { score -= 6; reasons.push("High vol"); }
  if (f.bias.vol_regime === "low") { score += 3; reasons.push("Low vol"); }

  const v = f.entry.volatility;
  const atrps: number[] = [];
  if (typeof v.atrp_15m === "number") atrps.push(v.atrp_15m);
  if (typeof v.atrp_1h === "number") atrps.push(v.atrp_1h);
  if (typeof v.atrp_4h === "number") atrps.push(v.atrp_4h);

  if (atrps.length) {
    const maxAtrp = Math.max(...atrps);
    if (maxAtrp > 1.6) { score -= 4; reasons.push("Very high ATR%"); }
  }

  // Cross: consensus & dev_z
  if (typeof f.cross.consensus_score === "number") {
    if (f.cross.consensus_score >= 0.65) { score += 6; reasons.push("Cross consensus"); }
    if (f.cross.consensus_score <= 0.45) { score -= 6; reasons.push("Cross disagreement"); }
  }
  if (typeof f.cross.dev_z === "number") {
    if (Math.abs(f.cross.dev_z) >= 2.0) reasons.push("Deviation extreme (z)");
  }

  // Orderbook imbalance
  const im = f.orderflow.imbalance.top200;
  if (Math.abs(im) >= 0.25) reasons.push("Book imbalance present");

  // Delta divergence/absorption (NEW)
  if (f.orderflow.delta) {
    const d = f.orderflow.delta;
    if (d.divergence_score >= 0.55) { score += 4; reasons.push(`Divergence ${d.divergence_dir}`); }
    if (d.absorption_score >= 0.55) { score += 4; reasons.push(`Absorption ${d.absorption_dir}`); }
  }

  // HTF Market Structure confirmation (NEW, soft influence)
  const ms4h = (f.market_structure as any)?.["4h"];
  if (ms4h?.lastBOS) reasons.push("4h BOS present");
  if (ms4h?.lastCHOCH) reasons.push("4h CHOCH present");

  score = clamp(score, 0, 100);
  return { score, grade: gradeFromScore(score), reasons };
}
