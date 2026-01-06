// lib/feeds/features/cross/consensus.ts

import { clamp } from "../math";
import type { FeatureEngineInput } from "../types";

function clamp01(x: number) {
  return clamp(x, 0, 1);
}

/**
 * Smoothstep maps x from [edge0..edge1] into [0..1] with a smooth curve.
 * - <= edge0 => 0
 * - >= edge1 => 1
 */
function smoothstep(edge0: number, edge1: number, x: number) {
  if (!Number.isFinite(x)) return 1;
  if (edge1 === edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function consensusScore(args: {
  dev_bps?: number;
  lead_lag?: FeatureEngineInput["cross"] extends infer C
    ? C extends { lead_lag?: infer L }
      ? L
      : any
    : any;
}): number | undefined {
  const dev = args.dev_bps;

  // If we don't even have dev_bps, keep undefined (true missing input)
  if (!Number.isFinite(dev as number)) return undefined;

  const devAbs = Math.abs(dev as number);

  // Thresholds tuned for bps space
  const DEV_OK_BPS = 2;   // <= 2 bps is excellent
  const DEV_BAD_BPS = 12; // >= 12 bps is poor (cross-exchange disagreement)

  // devScore: 1 when dev small, 0 when dev large
  const devScore = clamp01(1 - smoothstep(DEV_OK_BPS, DEV_BAD_BPS, devAbs));

  // Optional lead/lag adjustment (your lead_lag is in bars + corr score)
  const ll = args.lead_lag;
  if (!ll) return devScore;

  const lagBarsAbs = Math.abs(ll.lag_bars ?? 0);
  const corr = Number.isFinite(ll.score as number) ? clamp01(ll.score as number) : 0;

  // We prefer low lag; allow small lag without nuking the score.
  const LAG_OK_BARS = 0;
  const LAG_BAD_BARS = 5;

  const lagScore = clamp01(1 - smoothstep(LAG_OK_BARS, LAG_BAD_BARS, lagBarsAbs));

  // Combine: lag contribution is meaningful only if correlation is meaningful.
  const leadLagComponent = clamp01(corr * lagScore);

  // Weighted blend: dev dominates (primary “agreement” signal)
  const W_DEV = 0.8;
  const W_LL = 0.2;

  return clamp01(W_DEV * devScore + W_LL * leadLagComponent);
}
