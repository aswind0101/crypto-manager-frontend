import type { FeaturesSnapshot, TrendDir } from "../features/types";

/**
 * Scoring philosophy (common market context):
 * - Reward: clean data, directional clarity, trend persistence, cross-exchange agreement, aligned orderflow.
 * - Penalize: low data quality, regime mismatch (too noisy / too dead), strong cross disagreement, strong counter-flow.
 * - Avoid double-count: each "theme" contributes within a capped band.
 * - Keep stable: clamp all contributions; ignore non-finite inputs.
 */

export function gradeFromScore(score: number): "A" | "B" | "C" | "D" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}
export function gradePlusFromScore(input: {
  scoreCommon: number;             // 0..100
  rrMin?: number;                  // e.g., 1.2..3.5
  conflictsMajor?: number;         // count
  dqGrade?: string;                // "A"|"B"|...
  biasComplete?: boolean;
  triggerTf?: string;
}): { grade_plus: "A+" | "A" | "B" | "C"; reasons: string[] } {
  const reasons: string[] = [];
  const rr = Number.isFinite(Number(input.rrMin)) ? Number(input.rrMin) : 0;
  const cm = Number.isFinite(Number(input.conflictsMajor)) ? Number(input.conflictsMajor) : 0;
  const dq = String(input.dqGrade ?? "");
  const biasComplete = input.biasComplete !== false;

  // Base from common score
  let g: "A+" | "A" | "B" | "C";
  if (input.scoreCommon >= 88) g = "A+";
  else if (input.scoreCommon >= 80) g = "A";
  else if (input.scoreCommon >= 68) g = "B";
  else g = "C";

  // DQ / bias completeness caps
  if (dq && dq !== "A" && dq !== "B") {
    g = "C";
    reasons.push(`dq=${dq} cap->C`);
  }
  if (!biasComplete && g === "A+") {
    g = "A";
    reasons.push("bias_incomplete cap A+->A");
  }

  // Conflicts cap
  if (cm >= 1 && g === "A+") {
    g = "A";
    reasons.push("major_conflict cap A+->A");
  } else if (cm >= 2 && (g === "A+" || g === "A")) {
    g = "B";
    reasons.push("major_conflicts cap->B");
  }

  // RR nudges
  if (rr > 0) {
    if (rr >= 2.2 && (g === "A" || g === "B")) {
      // good RR can bump one step, but never above A
      g = g === "B" ? "A" : "A";
      reasons.push(`rr=${rr.toFixed(2)} bump->A`);
    }
    if (rr < 1.35 && (g === "A+" || g === "A")) {
      g = "B";
      reasons.push(`rr=${rr.toFixed(2)} cap->B`);
    }
  }

  // Final sanity
  if (g === "A+") reasons.push("meets A+ threshold");
  if (g === "A") reasons.push("meets A threshold");
  if (g === "B") reasons.push("meets B threshold");
  if (g === "C") reasons.push("monitor-only");

  return { grade_plus: g, reasons };
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function n(x: unknown): number | undefined {
  return isFiniteNum(x) ? x : undefined;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function dirToSign(dir: TrendDir | undefined): -1 | 0 | 1 {
  if (dir === "bull") return 1;
  if (dir === "bear") return -1;
  return 0;
}

function pushReason(reasons: string[], s: string, cap = 14) {
  if (reasons.length >= cap) return;
  if (!reasons.includes(s)) reasons.push(s);
}

function scoreBand01(x: number, lo: number, hi: number) {
  // maps [lo..hi] -> [0..1] with clamping
  if (!Number.isFinite(x)) return 0;
  return clamp((x - lo) / (hi - lo), 0, 1);
}

type ThemeBreakdown = {
  dq: number;
  bias: number;
  trend: number;
  vol: number;
  cross: number;
  flow: number;
  ms: number;
  total: number;
};

export function scoreCommon(f: FeaturesSnapshot): {
  score: number;
  grade: "A" | "B" | "C" | "D";
  reasons: string[];
  breakdown: ThemeBreakdown;
} {
  const reasons: string[] = [];

  // Start from neutral baseline; themes add/subtract within bounded ranges.
  const breakdown: ThemeBreakdown = {
    dq: 0,
    bias: 0,
    trend: 0,
    vol: 0,
    cross: 0,
    flow: 0,
    ms: 0,
    total: 0,
  };

  // -------------------------
  // Theme 1) Data Quality (DQ)
  // -------------------------
  // This theme is intentionally strong because bad data poisons everything.
  // Range: [-35 .. +12]
  const dq = f.quality?.dq_grade;
  if (dq === "A") {
    breakdown.dq = 12;
    pushReason(reasons, "DQ A");
  } else if (dq === "B") {
    breakdown.dq = 6;
    pushReason(reasons, "DQ B");
  } else if (dq === "C") {
    breakdown.dq = -8;
    pushReason(reasons, "DQ C");
  } else {
    breakdown.dq = -35;
    pushReason(reasons, "DQ D");
  }

  // -------------------------
  // Theme 2) Directional Clarity (Bias)
  // -------------------------
  // Bias strength matters, but we cap it to avoid overpowering other evidence.
  // Range: [-10 .. +18]
  const ts = n(f.bias?.trend_strength);
  const dir = f.bias?.trend_dir as TrendDir | undefined;

  if (ts != null) {
    // Reward stronger clarity; slightly penalize ultra-weak bias.
    const pos = Math.round(scoreBand01(ts, 0.15, 0.75) * 18);
    breakdown.bias += pos;

    if (ts >= 0.62) pushReason(reasons, "Strong bias");
    else if (ts <= 0.20) {
      breakdown.bias -= 6;
      pushReason(reasons, "Weak bias");
    }
  } else {
    // Unknown strength -> small penalty (avoid false confidence)
    breakdown.bias -= 4;
    pushReason(reasons, "Bias strength n/a");
  }

  if (dir === "sideways") {
    // Sideways is not "bad", but common confidence should be lower.
    breakdown.bias -= 6;
    pushReason(reasons, "Bias sideways");
  } else if (dir === "bull") {
    pushReason(reasons, "Bias bull");
  } else if (dir === "bear") {
    pushReason(reasons, "Bias bear");
  }

  breakdown.bias = clamp(breakdown.bias, -10, 18);

  // -------------------------
  // Theme 3) Trend Persistence (ADX + EMA slope)
  // -------------------------
  // This theme supports trend-following setups without double-counting bias strength.
  // Range: [-8 .. +16]
  let trendPts = 0;

  const adx = n(f.bias?.adx14);
  if (adx != null) {
    // Below ~14 => weak/trashy; Above ~22 => trending.
    if (adx < 14) {
      trendPts -= 6;
      pushReason(reasons, "ADX weak");
    } else {
      const p = Math.round(scoreBand01(adx, 15, 28) * 10); // up to +10
      trendPts += p;
      if (adx >= 22) pushReason(reasons, "ADX trending");
    }
  } else {
    trendPts -= 2;
    pushReason(reasons, "ADX n/a");
  }

  const slope = n(f.bias?.ema200_slope_bps);
  if (slope != null) {
    const mag = Math.abs(slope);
    const p = Math.round(scoreBand01(mag, 1.5, 7.5) * 6); // up to +6
    trendPts += p;
    if (mag >= 4) pushReason(reasons, "EMA slope present");
  }

  breakdown.trend = clamp(trendPts, -8, 16);

  // -------------------------
  // Theme 4) Volatility Regime (ATR% + BB width)
  // -------------------------
  // Goal: avoid setups in regimes where stops/targets are unreliable (too dead or too wild).
  // Range: [-12 .. +10]
  // Note: your ATR% fields appear to be already in percent units.
  let volPts = 0;

  const vr = f.bias?.vol_regime;
  if (vr === "low") {
    // Low can be good for clean breakouts/pullbacks, but can also mean chop.
    volPts += 2;
    pushReason(reasons, "Low vol");
  } else if (vr === "high") {
    volPts -= 6;
    pushReason(reasons, "High vol");
  }

  const v = f.entry?.volatility;
  const atrps: number[] = [];
  const a15 = n(v?.atrp_15m); if (a15 != null) atrps.push(a15);
  const a1h = n(v?.atrp_1h);  if (a1h != null) atrps.push(a1h);
  const a4h = n(v?.atrp_4h);  if (a4h != null) atrps.push(a4h);

  if (atrps.length) {
    const maxAtrp = Math.max(...atrps);

    // Very high ATR% is hostile to tight RR; apply penalty.
    if (maxAtrp >= 1.8) {
      volPts -= 6;
      pushReason(reasons, "Very high ATR%");
    } else if (maxAtrp >= 1.2) {
      volPts -= 3;
      pushReason(reasons, "High ATR%");
    }

    // Very low ATR% can mean compression; not bad, but reduces conviction unless breakout logic exists.
    // We do not penalize hard; only small caution.
    if (maxAtrp <= 0.22) {
      volPts -= 2;
      pushReason(reasons, "Very low ATR%");
    }
  } else {
    volPts -= 2;
    pushReason(reasons, "ATR% n/a");
  }

  // BB width can corroborate regime; we keep it as a light modifier to avoid double-count with ATR.
  const bw15 = n(v?.bbWidth_15m);
  const bw1h = n(v?.bbWidth_1h);
  const bw4h = n(v?.bbWidth_4h);
  const bws = [bw15, bw1h, bw4h].filter((x): x is number => x != null);

  if (bws.length) {
    const maxBw = Math.max(...bws);
    // Heuristic bands; these should be stable across assets if bw is normalized by mean.
    if (maxBw >= 0.06) {
      volPts -= 2;
      pushReason(reasons, "Wide BB");
    } else if (maxBw <= 0.015) {
      volPts += 2;
      pushReason(reasons, "Tight BB");
    }
  }

  breakdown.vol = clamp(volPts, -12, 10);

  // -------------------------
  // Theme 5) Cross-exchange sanity (consensus + deviation)
  // -------------------------
  // Range: [-12 .. +12]
  let crossPts = 0;

  const cons = n(f.cross?.consensus_score);
  if (cons != null) {
    if (cons >= 0.72) {
      crossPts += 10;
      pushReason(reasons, "Cross consensus strong");
    } else if (cons >= 0.58) {
      crossPts += 6;
      pushReason(reasons, "Cross consensus");
    } else if (cons <= 0.42) {
      crossPts -= 10;
      pushReason(reasons, "Cross disagreement");
    } else if (cons <= 0.50) {
      crossPts -= 5;
      pushReason(reasons, "Cross weak");
    }
  } else {
    crossPts -= 2;
    pushReason(reasons, "Cross n/a");
  }

  const devZ = n(f.cross?.dev_z);
  if (devZ != null) {
    // Deviation itself isn't always bad; it can be opportunity.
    // We avoid scoring it heavily; only annotate extremes.
    if (Math.abs(devZ) >= 2.2) pushReason(reasons, "Deviation extreme (z)");
  }

  breakdown.cross = clamp(crossPts, -12, 12);

  // -------------------------
  // Theme 6) Orderflow confirmation (imbalance + aggression + delta)
  // -------------------------
  // Direction-aware vs bias direction.
  // Range: [-12 .. +12]
  let flowPts = 0;

  const biasSign = dirToSign(dir);
  const im200 = n(f.orderflow?.imbalance?.top200);
  const agg = n((f.orderflow as any)?.aggression_ratio);

  if (im200 != null && biasSign !== 0) {
    const aligned = Math.sign(im200) === biasSign;
    const mag = Math.abs(im200);
    if (mag >= 0.30) {
      flowPts += aligned ? 6 : -6;
      pushReason(reasons, aligned ? "Book imbalance aligned" : "Book imbalance contra");
    } else if (mag >= 0.18) {
      flowPts += aligned ? 3 : -3;
    }
  } else if (im200 != null) {
    // Sideways/unknown bias: imbalance still informative but lower weight.
    if (Math.abs(im200) >= 0.30) {
      flowPts += 2;
      pushReason(reasons, "Book imbalance present");
    }
  }

  if (agg != null && biasSign !== 0) {
    // aggression_ratio in [0..1]; >0.55 favors buys, <0.45 favors sells
    const buyBias = agg >= 0.55;
    const sellBias = agg <= 0.45;
    if (buyBias || sellBias) {
      const aligned = (buyBias && biasSign === 1) || (sellBias && biasSign === -1);
      flowPts += aligned ? 3 : -3;
      pushReason(reasons, aligned ? "Aggression aligned" : "Aggression contra");
    }
  }

  const d = f.orderflow?.delta;
  if (d) {
    const div = n(d.divergence_score);
    const abs = n(d.absorption_score);

    // Divergence is useful mostly when it aligns with bias turning or confirming.
    // We score lightly and only when strong.
    if (div != null && div >= 0.62) {
      // divergence_dir: bull/bear/none
      const dd = d.divergence_dir;
      if (dd === "bull") flowPts += (biasSign === 1 ? 3 : 1);
      if (dd === "bear") flowPts += (biasSign === -1 ? 3 : 1);
      pushReason(reasons, `Divergence ${dd}`);
    }

    // Absorption can indicate support/resistance; moderate weight.
    if (abs != null && abs >= 0.62) {
      const ad = d.absorption_dir;
      if (ad === "bull") flowPts += (biasSign === 1 ? 3 : 1);
      if (ad === "bear") flowPts += (biasSign === -1 ? 3 : 1);
      pushReason(reasons, `Absorption ${ad}`);
    }
  }

  breakdown.flow = clamp(flowPts, -12, 12);

  // -------------------------
  // Theme 7) Market structure (HTF context)
  // -------------------------
  // Soft influence only; engine already does setup-type checks.
  // Range: [-4 .. +6]
  let msPts = 0;

  const ms4h: any = (f.market_structure as any)?.["4h"];
  if (ms4h?.lastBOS) {
    msPts += 3;
    pushReason(reasons, "4h BOS present");
  }
  if (ms4h?.lastCHOCH) {
    // CHOCH can mean trend transition; do not overreward.
    msPts += 1;
    pushReason(reasons, "4h CHOCH present");
  }

  breakdown.ms = clamp(msPts, -4, 6);

  // -------------------------
  // Final score aggregation
  // -------------------------
  // Base 50 + sum of themes.
  let score = 50
    + breakdown.dq
    + breakdown.bias
    + breakdown.trend
    + breakdown.vol
    + breakdown.cross
    + breakdown.flow
    + breakdown.ms;

  score = clamp(score, 0, 100);

  // Grade: keep D as a strong block (engine uses it as a readiness gate)
  const grade = gradeFromScore(score);

  breakdown.total = score;

  // Keep reasons readable and not overly noisy.
  // Prefer high-signal reasons first by a gentle re-order.
  const order = [
    "DQ A", "DQ B", "DQ C", "DQ D",
    "Strong bias", "Weak bias", "Bias sideways", "Bias bull", "Bias bear",
    "ADX trending", "ADX weak", "EMA slope present",
    "Cross consensus strong", "Cross consensus", "Cross disagreement", "Cross weak", "Cross n/a",
    "High vol", "Low vol", "Very high ATR%", "High ATR%", "Very low ATR%", "Tight BB", "Wide BB",
    "Book imbalance aligned", "Book imbalance contra", "Book imbalance present",
    "Aggression aligned", "Aggression contra",
    "Deviation extreme (z)",
    "4h BOS present", "4h CHOCH present",
  ];
  reasons.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return { score, grade, reasons, breakdown };
}