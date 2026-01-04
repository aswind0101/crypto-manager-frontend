import type { FeaturesSnapshot } from "../features/types";

export function gradeFromScore(score: number): "A" | "B" | "C" | "D" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function scoreCommon(f: FeaturesSnapshot) {
  let score = 50;
  const reasons: string[] = [];

  // DQ gate
  if (f.quality.dq_grade === "A") { score += 10; reasons.push("DQ A"); }
  else if (f.quality.dq_grade === "B") { score += 4; reasons.push("DQ B"); }
  else { score -= 25; reasons.push("DQ low"); }

  // Bias strength
  score += Math.round(f.bias.trend_strength * 20);
  if (f.bias.trend_strength >= 0.6) reasons.push("Strong bias");
  else if (f.bias.trend_strength <= 0.2) reasons.push("Weak bias");

  // Vol regime
  if (f.bias.vol_regime === "high") { score -= 6; reasons.push("High vol"); }
  if (f.bias.vol_regime === "low") { score += 3; reasons.push("Low vol"); }

  // Cross: consensus & dev_z
  if (typeof f.cross.consensus_score === "number") {
    if (f.cross.consensus_score >= 0.65) { score += 6; reasons.push("Cross consensus"); }
    if (f.cross.consensus_score <= 0.45) { score -= 6; reasons.push("Cross disagreement"); }
  }
  if (typeof f.cross.dev_z === "number") {
    if (Math.abs(f.cross.dev_z) >= 2.0) reasons.push("Deviation extreme (z)");
  }

  // Orderflow: imbalance + aggression
  const im = f.orderflow.imbalance.top200; // smoother
  if (Math.abs(im) >= 0.25) reasons.push("Book imbalance present");

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return { score, grade: gradeFromScore(score), reasons };
}
