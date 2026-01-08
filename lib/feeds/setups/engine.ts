import type { Candle } from "../core/types";
import type { FeaturesSnapshot } from "../features/types";
import type { UnifiedSnapshot } from "../snapshot/unifiedTypes";
import { computePivotLevels, nearestLevels } from "./levels";
import { scoreCommon, gradeFromScore } from "./scoring";
import type { SetupEngineOutput, TradeSetup, SetupSide } from "./types";

function now() { return Date.now(); }
function uid(prefix: string) { return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }

function lastClose(candles?: Candle[]) {
  if (!candles || !candles.length) return undefined;
  return candles[candles.length - 1].c;
}

function atrProxyFromFeatures(f: FeaturesSnapshot) {
  // atrp_* are in %
  const v = f.entry.volatility;
  const xs: number[] = [];
  if (typeof v.atrp_15m === "number") xs.push(v.atrp_15m / 100);
  if (typeof v.atrp_1h === "number") xs.push(v.atrp_1h / 100);
  if (typeof v.atrp_4h === "number") xs.push(v.atrp_4h / 100);
  if (!xs.length) return 0.007; // fallback 0.7%
  return Math.max(...xs); // conservative sizing
}


function makeEntryZone(price: number, atrp: number, side: SetupSide) {
  // Zone width ~ 0.35 * ATR% intraday
  const w = price * atrp * 0.35;
  if (side === "LONG") return { lo: price - w, hi: price + w * 0.15 };
  return { lo: price - w * 0.15, hi: price + w };
}

// Task 3.4b: retest zone around BOS level (wider than simple “testing level” bps band)
function makeRetestZone(level: number, atrp: number, side: SetupSide) {
  // floor in bps to avoid being too tight in low ATR regimes
  const w = Math.max(level * 0.0008, level * atrp * 0.25); // max(8 bps, 0.25*ATR)
  if (side === "LONG") return { lo: level - w, hi: level + w * 0.6 };   // allow slightly above
  return { lo: level - w * 0.6, hi: level + w };                         // allow slightly below
}

function rr(entry: number, stop: number, tp: number, side: SetupSide) {
  const risk = side === "LONG" ? (entry - stop) : (stop - entry);
  const reward = side === "LONG" ? (tp - entry) : (entry - tp);
  if (risk <= 0 || reward <= 0) return 0;
  return reward / risk;
}
const LSR_RR_MIN = 2.8;
function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function sideMatchesBiasDir(f: FeaturesSnapshot, side: SetupSide) {
  if (f.bias.trend_dir === "sideways") return true;
  if (side === "LONG" && f.bias.trend_dir === "bull") return true;
  if (side === "SHORT" && f.bias.trend_dir === "bear") return true;
  return false;
}

type ConflictSignal = {
  code: string;
  severity: "MAJOR" | "MINOR";
  note: string;
};

function detectConflicts(f: FeaturesSnapshot, side: SetupSide): ConflictSignal[] {
  const out: ConflictSignal[] = [];

  // 1) Bias conflict when bias is strong
  const biasStrength = isFiniteNum(f.bias.trend_strength) ? f.bias.trend_strength : undefined;
  if (biasStrength != null && biasStrength >= 0.6 && f.bias.trend_dir !== "sideways") {
    if (!sideMatchesBiasDir(f, side)) {
      out.push({
        code: "CONFLICT_STRONG_BIAS_OPPOSES_SIDE",
        severity: "MAJOR",
        note: `Strong bias (${biasStrength.toFixed(2)}) opposes ${side}`,
      });
    }
  }

  // 2) Strong opposite divergence = MAJOR (you already partly do this via deltaOk; we keep it centralized too)
  const d = f.orderflow?.delta as any;
  const divScore = isFiniteNum(d?.divergence_score) ? Number(d.divergence_score) : undefined;
  const divDir = typeof d?.divergence_dir === "string" ? String(d.divergence_dir) : undefined;
  if (divScore != null && divScore >= 0.65 && divDir) {
    if (side === "LONG" && divDir.toLowerCase() === "bear") {
      out.push({ code: "CONFLICT_STRONG_BEAR_DIVERGENCE", severity: "MAJOR", note: "Strong bear divergence" });
    }
    if (side === "SHORT" && divDir.toLowerCase() === "bull") {
      out.push({ code: "CONFLICT_STRONG_BULL_DIVERGENCE", severity: "MAJOR", note: "Strong bull divergence" });
    }
  }

  // 3) Absorption: strong opposite absorption = MAJOR
  const absScore = isFiniteNum(d?.absorption_score) ? Number(d.absorption_score) : undefined;
  const absDir = typeof d?.absorption_dir === "string" ? String(d.absorption_dir) : undefined;
  if (absScore != null && absScore >= 0.65 && absDir) {
    if (side === "LONG" && absDir.toLowerCase() === "bear") {
      out.push({ code: "CONFLICT_STRONG_BEAR_ABSORPTION", severity: "MAJOR", note: "Strong bear absorption" });
    }
    if (side === "SHORT" && absDir.toLowerCase() === "bull") {
      out.push({ code: "CONFLICT_STRONG_BULL_ABSORPTION", severity: "MAJOR", note: "Strong bull absorption" });
    }
  }

  // 4) Cross consensus disagreement: treat as MAJOR only when very low
  const cs = isFiniteNum(f.cross?.consensus_score) ? Number(f.cross.consensus_score) : undefined;
  if (cs != null && cs <= 0.35) {
    out.push({ code: "CONFLICT_LOW_CROSS_CONSENSUS", severity: "MAJOR", note: `Low cross consensus (${cs.toFixed(2)})` });
  } else if (cs != null && cs <= 0.5) {
    out.push({ code: "CONFLICT_WEAK_CROSS_CONSENSUS", severity: "MINOR", note: `Weak cross consensus (${cs.toFixed(2)})` });
  }

  return out;
}

type InvariantResult = { ok: true } | { ok: false; codes: string[]; notes: string[] };

function zoneKMultiplierByType(type: TradeSetup["type"]): number {
  switch (type) {
    case "BREAKOUT":
      return 0.35;
    case "FAILED_SWEEP_CONTINUATION":
      return 0.35;
    case "TREND_PULLBACK":
      return 0.60;
    case "RANGE_MEAN_REVERT":
      return 0.80;
    case "LIQUIDITY_SWEEP_REVERSAL":
      return 0.40;
    default:
      return 0.60;
  }
}

function validateSetupInvariant(args: {
  setup: TradeSetup;
  px: number;
  atrp: number; // percent as fraction (0.007 = 0.7%)
}): InvariantResult {
  const { setup, px, atrp } = args;

  const codes: string[] = [];
  const notes: string[] = [];

  const zone = setup.entry?.zone;
  const stop = setup.stop?.price;
  const tps = Array.isArray(setup.tp) ? setup.tp : [];

  if (!zone || !isFiniteNum(zone.lo) || !isFiniteNum(zone.hi) || zone.lo >= zone.hi) {
    codes.push("INV_BAD_ZONE");
    notes.push("Zone invalid (lo/hi)");
  }
  if (!isFiniteNum(stop)) {
    codes.push("INV_BAD_STOP");
    notes.push("Stop invalid");
  }
  if (!isFiniteNum(px) || px <= 0) {
    codes.push("INV_BAD_PX");
    notes.push("px invalid");
  }
  if (!isFiniteNum(atrp) || atrp <= 0) {
    codes.push("INV_BAD_ATRP");
    notes.push("atrp invalid");
  }

  if (codes.length) return { ok: false, codes, notes };

  const lo = Number(zone!.lo);
  const hi = Number(zone!.hi);
  const st = Number(stop);

  // Zone width ATR constraint
  const atrAbs = px * atrp;
  const k = zoneKMultiplierByType(setup.type);
  const maxW = Math.max(px * 0.0001, atrAbs * k); // floor 1bp-equivalent-ish, but safe
  const w = hi - lo;
  if (w > maxW) {
    codes.push("INV_ZONE_TOO_WIDE");
    notes.push(`Zone width ${w.toFixed(6)} > max ${maxW.toFixed(6)} (k=${k})`);
  }

  // Stop must be outside zone in the correct direction
  if (setup.side === "LONG") {
    if (!(st < lo)) {
      codes.push("INV_STOP_NOT_BELOW_ZONE");
      notes.push("LONG stop must be below zone.lo");
    }
  } else {
    if (!(st > hi)) {
      codes.push("INV_STOP_NOT_ABOVE_ZONE");
      notes.push("SHORT stop must be above zone.hi");
    }
  }

  // Stop distance bounds (noise vs absurd)
  const entryAnchor = (lo + hi) / 2;
  const risk = setup.side === "LONG" ? (entryAnchor - st) : (st - entryAnchor);
  const minRisk = Math.max(px * 0.0006, atrAbs * 0.25); // min(60 bps floor, 0.25*ATRabs) — conservative
  const maxRisk = atrAbs * 2.5; // intraday constraint; swing still acceptable because atrp uses max of 15m/1h/4h
  if (risk < minRisk) {
    codes.push("INV_STOP_TOO_TIGHT");
    notes.push(`Risk ${risk.toFixed(6)} < min ${minRisk.toFixed(6)}`);
  }
  if (risk > maxRisk) {
    codes.push("INV_STOP_TOO_FAR");
    notes.push(`Risk ${risk.toFixed(6)} > max ${maxRisk.toFixed(6)}`);
  }

  // TP sanity: must be finite and in correct direction; TP1 must offer meaningful reward
  if (tps.length === 0 || !isFiniteNum(tps[0]?.price)) {
    codes.push("INV_NO_TP");
    notes.push("No TP1");
  } else {
    const tp1 = Number(tps[0].price);
    const reward = setup.side === "LONG" ? (tp1 - entryAnchor) : (entryAnchor - tp1);
    const minReward = Math.max(px * 0.0008, atrAbs * 0.35); // avoid TP too close (fees/slippage)
    if (reward <= 0) {
      codes.push("INV_TP_WRONG_SIDE");
      notes.push("TP1 is on wrong side of entry");
    } else if (reward < minReward) {
      codes.push("INV_TP_TOO_CLOSE");
      notes.push(`Reward ${reward.toFixed(6)} < min ${minReward.toFixed(6)}`);
    }
  }

  // RR sanity (keep lightweight; exact RR policy can still be type-specific elsewhere)
  if (isFiniteNum(setup.rr_min) && setup.rr_min < 1.2) {
    codes.push("INV_RR_TOO_LOW");
    notes.push(`rr_min ${setup.rr_min.toFixed(2)} < 1.20`);
  }

  return codes.length ? { ok: false, codes, notes } : { ok: true };
}

function applyQualityGates(args: {
  setup: TradeSetup;
  f: FeaturesSnapshot;
  px: number;
  atrp: number;
}): { ok: true; tagsAdd: string[]; reasonsAdd: string[] } | { ok: false; rejectCodes: string[]; rejectNotes: string[] } {
  const { setup, f, px, atrp } = args;

  // Conflict kill-switch: kill if >=2 MAJOR conflicts
  const conflicts = detectConflicts(f, setup.side);
  const major = conflicts.filter((c) => c.severity === "MAJOR");
  if (major.length >= 2) {
    return {
      ok: false,
      rejectCodes: ["REJECT_CONFLICT_KILL", ...major.map((m) => m.code)],
      rejectNotes: major.map((m) => m.note),
    };
  }

  // Final invariants
  const inv = validateSetupInvariant({ setup, px, atrp });
  if (inv.ok === false) {
    return { ok: false, rejectCodes: ["REJECT_INVARIANT", ...inv.codes], rejectNotes: inv.notes };
  }

  // If we have 1 MAJOR conflict, keep but mark as cautious (monitor bias)
  const tagsAdd: string[] = [];
  const reasonsAdd: string[] = [];
  if (major.length === 1) {
    tagsAdd.push("caution");
    reasonsAdd.push(`Caution: ${major[0].note}`);
  }

  // Minor conflicts -> annotate only
  const minor = conflicts.filter((c) => c.severity === "MINOR");
  if (minor.length) {
    reasonsAdd.push(...minor.slice(0, 2).map((m) => `Weakness: ${m.note}`));
  }

  return { ok: true, tagsAdd, reasonsAdd };
}

function pickPrimarySetup(setups: TradeSetup[]): TradeSetup | undefined {
  if (!setups.length) return undefined;

  // Priority: READY first, then confidence score, then rr_min
  const scored = setups.slice().sort((a, b) => {
    const pa = a.status === "READY" ? 0 : 1;
    const pb = b.status === "READY" ? 0 : 1;
    if (pa !== pb) return pa - pb;

    const csA = isFiniteNum(a.confidence?.score) ? a.confidence.score : 0;
    const csB = isFiniteNum(b.confidence?.score) ? b.confidence.score : 0;
    if (csA !== csB) return csB - csA;

    const rrA = isFiniteNum(a.rr_min) ? a.rr_min : 0;
    const rrB = isFiniteNum(b.rr_min) ? b.rr_min : 0;
    return rrB - rrA;
  });

  return scored[0];
}

// Freshness window (ms): 6 candles
const LSR_FRESH_15M_MS = 6 * 15 * 60 * 1000;
const LSR_FRESH_1H_MS = 6 * 60 * 60 * 1000;

function pickBiasSide(f: FeaturesSnapshot): SetupSide | null {
  if (f.bias.trend_dir === "bull") return "LONG";
  if (f.bias.trend_dir === "bear") return "SHORT";
  return null;
}

function capGradeForBiasIncomplete(grade: ReturnType<typeof gradeFromScore>, bias_incomplete: boolean) {
  if (!bias_incomplete) return grade;
  return grade === "A" ? "B" : grade;
}

function getBiasCompleteness(snap: UnifiedSnapshot, f: FeaturesSnapshot) {
  const tf = (f.bias?.tf ?? "4h") as any;
  const tfCandles = (snap.timeframes.find((x: any) => x.tf === tf)?.candles?.ohlcv ?? []) as Candle[];
  // EMA200 requires ~200 candles; use a small buffer for stability.
  const need = 210;
  const complete = tfCandles.length >= need;
  return { tf: String(tf), count: tfCandles.length, need, complete };
}
function htfConfirm(f: FeaturesSnapshot, side: SetupSide) {
  const ms1h = (f as any).market_structure?.["1h"];
  const ms4h = (f as any).market_structure?.["4h"];

  const want = side === "LONG" ? "UP" : "DOWN";
  const block = side === "LONG" ? "DOWN" : "UP";

  const tfs: Array<{ tf: string; ms: any }> = [
    { tf: "1h", ms: ms1h },
    { tf: "4h", ms: ms4h },
  ].filter(x => x.ms);

  if (!tfs.length) return { ok: true, note: "HTF MS n/a" };

  // Any opposite CHOCH blocks
  for (const x of tfs) {
    const choch = x.ms?.lastCHOCH;
    if (choch?.dir === block) return { ok: false, note: `${x.tf} CHOCH ${choch.dir}` };
  }

  // Any BOS in desired direction confirms
  for (const x of tfs) {
    const bos = x.ms?.lastBOS;
    if (bos?.dir === want) return { ok: true, note: `${x.tf} BOS ${bos.dir}` };
  }

  return { ok: false, note: "No HTF BOS confirm" };
}

function deltaOk(f: FeaturesSnapshot, side: SetupSide) {
  const d = f.orderflow.delta;
  if (!d) return { ok: true, note: "delta n/a" };

  // If strong opposite divergence, treat as not ok
  if (d.divergence_score >= 0.65) {
    if (side === "LONG" && d.divergence_dir === "bear") return { ok: false, note: "bear divergence" };
    if (side === "SHORT" && d.divergence_dir === "bull") return { ok: false, note: "bull divergence" };
  }

  // Absorption supporting same direction is a plus; opposite is mild negative but not hard block
  return { ok: true, note: `div=${d.divergence_score.toFixed(2)} abs=${d.absorption_score.toFixed(2)}` };
}

function biasStrengthOk(f: FeaturesSnapshot) {
  const s = f.bias.trend_strength;
  const adx = f.bias.adx14;
  const slope = f.bias.ema200_slope_bps;

  const okStrength = typeof s !== "number" ? true : s >= 0.55;
  const okAdx = typeof adx !== "number" ? true : adx >= 18;
  const okSlope = typeof slope !== "number" ? true : Math.abs(slope) >= 1.0;

  return { ok: okStrength && okAdx && okSlope, note: `s=${s.toFixed(2)} adx=${adx ?? "n/a"} slope=${slope ?? "n/a"}` };
}

export function buildSetups(args: {
  snap: UnifiedSnapshot;
  features: FeaturesSnapshot;
}): SetupEngineOutput {
  const { snap, features: f } = args;
  const ts = now();

  const dq_ok = f.quality.dq_grade === "A" || f.quality.dq_grade === "B";
  if (!dq_ok) return { ts, dq_ok: false, setups: [], preferred_id: undefined };

  // Bybit execution candles
  const tf15 = (snap.timeframes.find((x: any) => x.tf === "15m")?.candles?.ohlcv ?? []) as Candle[];
  const tf1h = (snap.timeframes.find((x: any) => x.tf === "1h")?.candles?.ohlcv ?? []) as Candle[];
  const px = lastClose(tf15) ?? lastClose(tf1h) ?? 0;
  if (!px) return { ts, dq_ok: true, setups: [], preferred_id: undefined };

  // Levels
  const lv15 = computePivotLevels(tf15, 2, 10);
  const lv1h = computePivotLevels(tf1h, 2, 10);
  const levels = [...lv15, ...lv1h].sort((a, b) => a.price - b.price);

  const { below, above } = nearestLevels(levels, px);
  const atrp = atrProxyFromFeatures(f);
  const common = scoreCommon(f);

  const setups: TradeSetup[] = [];
  const biasMeta = getBiasCompleteness(snap, f);
  const bias_incomplete = !biasMeta.complete;
  const biasSide = pickBiasSide(f);

  // 1) TREND_PULLBACK (ưu tiên) — B+ policy: only when HTF bias is complete
  if (biasSide && !bias_incomplete) {
    const ref = biasSide === "LONG" ? (below?.price ?? px) : (above?.price ?? px);
    const zone = makeEntryZone(ref, atrp, biasSide);

    const slBuffer = px * atrp * 0.5;
    const sl = biasSide === "LONG"
      ? Math.min(zone.lo - slBuffer, (below?.price ?? zone.lo) - slBuffer)
      : Math.max(zone.hi + slBuffer, (above?.price ?? zone.hi) + slBuffer);

    const tp1 = biasSide === "LONG"
      ? (above?.price ?? (px + px * atrp * 1.2))
      : (below?.price ?? (px - px * atrp * 1.2));

    const entryMid = (zone.lo + zone.hi) / 2;
    const rr1 = rr(entryMid, sl, tp1, biasSide);

    const checklist = [
      { key: "bias", ok: true, note: `Bias ${f.bias.trend_dir} (${f.bias.tf})` },
      { key: "bias_strength", ok: biasStrengthOk(f).ok, note: `Bias strength: ${biasStrengthOk(f).note}` },

      {
        key: "orderflow",
        ok: biasSide === "LONG" ? (f.orderflow.imbalance.top200 > -0.35) : (f.orderflow.imbalance.top200 < 0.35),
        note: `Imb200=${f.orderflow.imbalance.top200.toFixed(2)}`,
      },
      {
        key: "cross",
        ok: typeof f.cross.consensus_score !== "number" ? true : f.cross.consensus_score >= 0.5,
        note: f.cross.consensus_score != null ? `cons=${f.cross.consensus_score.toFixed(2)}` : "n/a",
      },
      { key: "delta", ok: deltaOk(f, biasSide).ok, note: `Delta: ${deltaOk(f, biasSide).note}` },
      { key: "htf_ms", ok: htfConfirm(f, biasSide).ok, note: `HTF MS: ${htfConfirm(f, biasSide).note}` },

    ];

    const bs = biasStrengthOk(f);
    const ht = htfConfirm(f, biasSide);
    const dOk = deltaOk(f, biasSide);

    const rrNeed = (!bs.ok || !ht.ok || !dOk.ok) ? 1.8 : 1.5;
    const ready = rr1 >= rrNeed && common.grade !== "D";

    let confScore = Math.min(100, common.score + (rr1 >= 2 ? 6 : 0) + 4);
    if (!bs.ok) confScore = Math.max(0, confScore - 8);
    if (!ht.ok) confScore = Math.max(0, confScore - 10);
    if (!dOk.ok) confScore = Math.max(0, confScore - 6);

    const s: TradeSetup = {
      id: uid("tpb"),
      canon: snap.canon,
      type: "TREND_PULLBACK",
      side: biasSide,
      entry_tf: "5m",
      bias_tf: f.bias.tf,
      trigger_tf: "5m",

      status: ready ? "READY" : "FORMING",
      created_ts: ts,
      expires_ts: ts + 1000 * 60 * 90,

      entry: {
        mode: "LIMIT",
        zone,
        trigger: {
          confirmed: false, // Task 3.3
          checklist,
          summary: "Trend pullback: wait for entry zone touch + close-confirm reclaim",
        },
      },

      stop: { price: sl, basis: "STRUCTURE", note: "Below/above zone + buffer" },

      tp: [
        { price: tp1, size_pct: 70, basis: "LEVEL", note: "Nearest pivot target" },
        { price: biasSide === "LONG" ? (tp1 + px * atrp * 0.8) : (tp1 - px * atrp * 0.8), size_pct: 30, basis: "R_MULTIPLE", note: "Extension" },
      ],

      rr_min: rr1,
      rr_est: rr1 * 1.2,

      confidence: {
        score: confScore,
        grade: gradeFromScore(confScore),
        reasons: [...common.reasons, "Trend pullback in bias direction"],
      },

      tags: ["intraday", "pullback", f.bias.trend_dir],
    };

    const g = applyQualityGates({ setup: s, f, px, atrp });
    if (g.ok) {
      s.tags = Array.from(new Set([...(s.tags || []), ...g.tagsAdd]));
      s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...g.reasonsAdd]));
      setups.push(s);
    }

  }

  /**
   * 2) BREAKOUT + RETEST (Task 3.4b)
   * - Uses market structure: 15m lastBOS level
   * - Entry is a RETEST zone around BOS level
   * - Trigger remains close-confirm (handled in hook) and requires “touched retest zone + close beyond level”
   *
   * B+ policy:
   * - Allowed even when HTF EMA200 incomplete, but stricter RR + capped grade (A->B).
   */
  let createdStructureBreakout = false;
  const ms15 = (f as any).market_structure?.["15m"];
  const bos = ms15?.lastBOS;

  // Freshness window for BOS (in ms): 6 * 15m = 90m
  const BOS_FRESH_MS = 90 * 60 * 1000;

  if (bos && typeof bos.level === "number" && typeof bos.ts === "number" && (ts - bos.ts) <= BOS_FRESH_MS) {
    const dir: SetupSide = bos.dir === "UP" ? "LONG" : "SHORT";
    const level = bos.level;

    const zone = makeRetestZone(level, atrp, dir);

    // Stop: prefer swing opposite if available; otherwise below/above level with ATR buffer
    const buffer = level * Math.max(atrp * 0.9, 0.0012); // at least 12 bps, scaled by ATR
    let sl = dir === "LONG" ? (level - buffer) : (level + buffer);

    const swingH = ms15?.lastSwingHigh?.price;
    const swingL = ms15?.lastSwingLow?.price;

    if (dir === "LONG" && typeof swingL === "number" && swingL < level) {
      sl = Math.min(sl, swingL - buffer * 0.35);
    }
    if (dir === "SHORT" && typeof swingH === "number" && swingH > level) {
      sl = Math.max(sl, swingH + buffer * 0.35);
    }

    // TP: nearest pivot in breakout direction; fallback to ATR projection
    const tp1 =
      dir === "LONG"
        ? (above?.price ?? (level + level * atrp * 2.0))
        : (below?.price ?? (level - level * atrp * 2.0));

    const entryMid = (zone.lo + zone.hi) / 2;
    const rr1 = rr(entryMid, sl, tp1, dir);

    const ht = htfConfirm(f, dir);
    const dOk = deltaOk(f, dir);

    let confScore = Math.min(100, common.score + 7);
    if (!ht.ok) confScore = Math.max(0, confScore - 12);
    if (!dOk.ok) confScore = Math.max(0, confScore - 6);

    if (bias_incomplete) {
      confScore = Math.floor(confScore * 0.70);
      confScore = Math.min(confScore, 84);
    }

    const rrNeedBase = bias_incomplete ? 1.8 : 1.5;
    const rrNeed = (!ht.ok || !dOk.ok) ? (rrNeedBase + 0.2) : rrNeedBase;
    const ready = rr1 >= rrNeed && common.grade !== "D";


    const s: TradeSetup = {
      id: uid("brt"),
      canon: snap.canon,
      type: "BREAKOUT",
      side: dir,
      entry_tf: "5m",
      bias_tf: f.bias.tf,
      trigger_tf: "5m",

      status: ready ? "READY" : "FORMING",
      created_ts: ts,
      expires_ts: ts + 1000 * 60 * 60,

      entry: {
        mode: "LIMIT",
        zone,
        trigger: {
          confirmed: false, // Task 3.3 (in hook)
          checklist: [
            {
              key: "bias",
              ok: !bias_incomplete,
              note: bias_incomplete
                ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                : `Bias ${f.bias.trend_dir} (${f.bias.tf})`,
            },
            { key: "bos", ok: true, note: `BOS ${bos.dir} @ ${level.toFixed(2)} (15m)` },
            { key: "delta", ok: deltaOk(f, dir).ok, note: `Delta: ${deltaOk(f, dir).note}` },
            { key: "htf_ms", ok: htfConfirm(f, dir).ok, note: `HTF MS: ${htfConfirm(f, dir).note}` },
            { key: "level", ok: true, note: `Break ${dir === "LONG" ? "R" : "S"} @ ${level.toFixed(2)}` },
            { key: "retest", ok: false, note: `Wait retest zone [${zone.lo.toFixed(2)}–${zone.hi.toFixed(2)}]` },
          ],
          summary: "Breakout+Retest: wait for price to retest BOS level, then 5m close-confirm beyond level",
        },
      },

      stop: { price: sl, basis: "STRUCTURE", note: "Below/above BOS level (prefer swing) + buffer" },

      tp: [
        { price: tp1, size_pct: 60, basis: "LEVEL", note: "Nearest pivot target" },
        { price: dir === "LONG" ? (tp1 + level * atrp * 1.0) : (tp1 - level * atrp * 1.0), size_pct: 40, basis: "R_MULTIPLE", note: "Continuation" },
      ],

      rr_min: rr1,
      rr_est: rr1 * 1.20,

      confidence: {
        score: confScore,
        grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
        reasons: [
          ...common.reasons,
          "BOS detected (15m)",
          "Retest-based breakout plan",
          ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : []),
        ],
      },

      tags: ["intraday", "breakout", "bos", "retest"],
    };

    const g = applyQualityGates({ setup: s, f, px, atrp });
    if (g.ok) {
      s.tags = Array.from(new Set([...(s.tags || []), ...g.tagsAdd]));
      s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...g.reasonsAdd]));
      setups.push(s);
    }


    createdStructureBreakout = true;
  }

  /**
   * 2b) BREAKOUT (legacy: squeeze → expansion)
   * - Keep as fallback when structure BOS is not available/fresh.
   */
  if (!createdStructureBreakout) {
    // Need squeeze: BB width very low
    const width = f.entry.volatility.bbWidth_15m;
    const squeeze = typeof width === "number" ? width < 0.02 : false;

    if (squeeze && below && above) {
      // pick direction: bias if present else mean cross
      let dir: SetupSide = "LONG";
      if (biasSide) dir = biasSide;
      else dir = (f.cross.dev_bps != null && f.cross.dev_bps > 0) ? "SHORT" : "LONG";

      const brk = dir === "LONG" ? above.price : below.price;
      const zone = makeEntryZone(brk, atrp, dir);

      const sl = dir === "LONG"
        ? (brk - px * atrp * 1.1)
        : (brk + px * atrp * 1.1);

      const tp1 = dir === "LONG"
        ? (brk + px * atrp * 1.8)
        : (brk - px * atrp * 1.8);

      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tp1, dir);

      let confScore = Math.min(100, common.score + 3);
      if (bias_incomplete) {
        confScore = Math.floor(confScore * 0.70);
        confScore = Math.min(confScore, 84);
      }

      const ready = rr1 >= (bias_incomplete ? 1.8 : 1.5) && common.grade !== "D";

      const s: TradeSetup = {
        id: uid("brk"),
        canon: snap.canon,
        type: "BREAKOUT",
        side: dir,
        entry_tf: "5m",
        bias_tf: f.bias.tf,
        trigger_tf: "5m",

        status: ready ? "READY" : "FORMING",
        created_ts: ts,
        expires_ts: ts + 1000 * 60 * 60,

        entry: {
          mode: "MARKET",
          zone,
          trigger: {
            confirmed: false, // Task 3.3
            checklist: [
              {
                key: "bias",
                ok: !bias_incomplete,
                note: bias_incomplete
                  ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                  : `Bias ${f.bias.trend_dir} (${f.bias.tf})`,
              },
              { key: "squeeze", ok: true, note: `BBWidth15m=${width!.toFixed(4)}` },
              { key: "level", ok: true, note: `Break ${dir === "LONG" ? "R" : "S"} @ ${brk.toFixed(2)}` },
            ],
            summary: "Breakout: wait for 5m close beyond level + follow-through",
          },
        },

        stop: { price: sl, basis: "ATR", note: "Breakout ATR stop" },

        tp: [
          { price: tp1, size_pct: 60, basis: "R_MULTIPLE", note: "Expansion target" },
          { price: dir === "LONG" ? (tp1 + px * atrp * 1.0) : (tp1 - px * atrp * 1.0), size_pct: 40, basis: "R_MULTIPLE", note: "Continuation" },
        ],

        rr_min: rr1,
        rr_est: rr1 * 1.25,

        confidence: {
          score: confScore,
          grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
          reasons: [...common.reasons, "Breakout from squeeze", ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : [])],
        },

        tags: ["intraday", "breakout", "squeeze"],
      };

      const g = applyQualityGates({ setup: s, f, px, atrp });
      if (g.ok) {
        s.tags = Array.from(new Set([...(s.tags || []), ...g.tagsAdd]));
        s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...g.reasonsAdd]));
        setups.push(s);
      }

    }
  }
  /**
   * 2c) LIQUIDITY_SWEEP_REVERSAL (Task 3.4c)
   * - New archetype (does NOT override RANGE_MEAN_REVERT)
   * - FORMING when sweep is fresh
   * - READY only when price returns into entry zone (zone around swept level)
   * - TRIGGERED remains close-confirm only (handled by Trigger Engine)
   */
  const ms1h = (f as any).market_structure?.["1h"];
  const sweep15 = ms15?.lastSweep;
  const sweep1h = ms1h?.lastSweep;

  // choose freshest sweep source (prefer 15m if both valid)
  const sweepPick = (() => {
    const ok15 =
      sweep15 && typeof sweep15.ts === "number" &&
      (ts - sweep15.ts) <= LSR_FRESH_15M_MS;

    const ok1h =
      sweep1h && typeof sweep1h.ts === "number" &&
      (ts - sweep1h.ts) <= LSR_FRESH_1H_MS;

    if (ok15) return { ms: ms15, sweep: sweep15 };
    if (ok1h) return { ms: ms1h, sweep: sweep1h };
    return null;
  })();

  if (sweepPick) {
    const { ms: msSrc, sweep } = sweepPick;

    const side: SetupSide = sweep.dir === "DOWN" ? "LONG" : "SHORT";
    const level = sweep.level; // reclaimed level (swept swing)
    const zone = makeRetestZone(level, atrp, side);

    // SL outside sweep wick
    const wick = side === "LONG" ? sweep.low : sweep.high;
    const slBuffer = Math.max(px * 0.0006, px * atrp * 0.15); // floor bps + ATR component
    const sl = side === "LONG" ? (wick - slBuffer) : (wick + slBuffer);

    // TP at opposite swing if available
    const oppSwing = side === "LONG" ? msSrc?.lastSwingHigh : msSrc?.lastSwingLow;
    if (oppSwing && typeof oppSwing.price === "number") {
      const tp1 = oppSwing.price;

      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tp1, side);

      if (rr1 >= LSR_RR_MIN) {
        // READY only when current price is back in entry zone (using px close; intrabar mid is handled elsewhere)
        const ready = px >= zone.lo && px <= zone.hi;

        let confScore = Math.min(100, common.score + 5 + (rr1 >= 3.2 ? 3 : 0));

        const s: TradeSetup = {
          id: uid("lsr"),
          canon: snap.canon,
          type: "LIQUIDITY_SWEEP_REVERSAL",
          side,
          entry_tf: "15m",
          bias_tf: f.bias.tf,
          trigger_tf: "5m",

          status: ready ? "READY" : "FORMING",
          created_ts: ts,
          expires_ts: ts + 1000 * 60 * 120, // 2h (consistent with MR horizon)

          entry: {
            mode: "LIMIT",
            zone,
            trigger: {
              confirmed: false, // Task 3.3
              checklist: [
                { key: "sweep", ok: true, note: `${sweep.dir} @ ${sweep.level.toFixed(2)}` },
                { key: "retest", ok: ready, note: ready ? "Price in entry zone" : "Waiting retest into zone" },
                { key: "close_confirm", ok: false, note: "Trigger on candle close only" },
              ],
              summary: "Liquidity sweep reversal: wait retest then close-confirm reclaim",
            },
          },

          stop: { price: sl, basis: "LIQUIDITY", note: "Outside sweep wick" },

          tp: [
            { price: tp1, size_pct: 100, basis: "LEVEL", note: "Opposite swing liquidity" },
          ],

          rr_min: LSR_RR_MIN,
          rr_est: rr1,

          confidence: {
            score: confScore,
            grade: gradeFromScore(confScore),
            reasons: [
              ...common.reasons,
              `Sweep ${sweep.dir} (${String(msSrc?.tf ?? "n/a")})`,
              `Level ${sweep.level.toFixed(2)} → TP ${tp1.toFixed(2)}`,
            ],
          },

          tags: ["intraday", "lsr", "sweep_reversal"],
        };

        const g = applyQualityGates({ setup: s, f, px, atrp });
        if (g.ok) {
          s.tags = Array.from(new Set([...(s.tags || []), ...g.tagsAdd]));
          s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...g.reasonsAdd]));
          setups.push(s);
        }

      }
    }
  }
  /**
 * 2d) FAILED_SWEEP_CONTINUATION (Task 3.4d)
 * Idea:
 * - Fresh BOS on 15m
 * - BOS candle cluster shows "stop-run displacement" (wick through level + close holds beyond)
 * - Plan is continuation via retest of BOS level (close-confirm handled by Trigger Engine)
 */
  if (ms15?.lastBOS && typeof ms15.lastBOS.level === "number" && typeof ms15.lastBOS.ts === "number") {
    const bos = ms15.lastBOS;

    // Freshness window for BOS (reuse same as breakout structure)
    const BOS_FRESH_MS = 90 * 60 * 1000;
    if ((ts - bos.ts) <= BOS_FRESH_MS) {
      const dir: SetupSide = bos.dir === "UP" ? "LONG" : "SHORT";
      const level = bos.level;

      // Look at a small confirmed window around BOS to detect displacement wick through the level
      const recent = tf15.filter(c => c.confirm).slice(-10);

      const wickBuf = Math.max(level * 0.0008, level * atrp * 0.20); // floor + ATR component
      let wickExtreme: number | null = null;
      let hasDisplacement = false;

      for (const c of recent) {
        if (dir === "LONG") {
          // Sweep below the level (down-wick) then reclaim above the level -> liquidity grab + continuation
          if (c.l < level - wickBuf && c.c > level) {
            hasDisplacement = true;
            wickExtreme = Math.min(wickExtreme ?? Infinity, c.l);
          }
        } else {
          // Sweep above the level (up-wick) then reject back below the level -> liquidity grab + continuation
          if (c.h > level + wickBuf && c.c < level) {
            hasDisplacement = true;
            wickExtreme = Math.max(wickExtreme ?? -Infinity, c.h);
          }
        }
      }

      if (hasDisplacement && wickExtreme != null) {
        const zone = makeRetestZone(level, atrp, dir);

        // SL outside sweep wick (must be beyond wick in the adverse direction)
        const slBuffer = Math.max(level * 0.0008, level * atrp * 0.35);
        const sl =
          dir === "LONG"
            ? (wickExtreme - slBuffer)
            : (wickExtreme + slBuffer);


        // TP: use nearest pivot in continuation direction (same philosophy as breakout structure)
        const tp1 =
          dir === "LONG"
            ? (above?.price ?? (level + level * atrp * 2.0))
            : (below?.price ?? (level - level * atrp * 2.0));

        const entryMid = (zone.lo + zone.hi) / 2;
        const rr1 = rr(entryMid, sl, tp1, dir);

        // Continuation should have decent RR, but not as strict as LSR
        const rrNeed = bias_incomplete ? 2.1 : 2.0;
        const ready = rr1 >= rrNeed && common.grade !== "D" && (px >= zone.lo && px <= zone.hi);

        // Confidence: breakout + displacement premium; cap if HTF bias incomplete
        let confScore = Math.min(100, common.score + 8);
        if (bias_incomplete) {
          confScore = Math.floor(confScore * 0.75);
          confScore = Math.min(confScore, 84);
        }

        const s: TradeSetup = {
          id: uid("fsc"),
          canon: snap.canon,
          type: "FAILED_SWEEP_CONTINUATION",
          side: dir,
          entry_tf: "5m",
          bias_tf: f.bias.tf,
          trigger_tf: "5m",

          status: (rr1 >= rrNeed && common.grade !== "D") ? (ready ? "READY" : "FORMING") : "FORMING",
          created_ts: ts,
          expires_ts: ts + 1000 * 60 * 60,

          entry: {
            mode: "LIMIT",
            zone,
            trigger: {
              confirmed: false,
              checklist: [
                {
                  key: "bias",
                  ok: !bias_incomplete,
                  note: bias_incomplete
                    ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                    : `Bias ${f.bias.trend_dir} (${f.bias.tf})`,
                },
                { key: "bos", ok: true, note: `BOS ${bos.dir} @ ${level.toFixed(2)} (15m)` },
                { key: "displacement", ok: true, note: `Wick through level (buf ${wickBuf.toFixed(2)})` },
                { key: "retest", ok: ready, note: ready ? "Price in retest zone" : `Wait retest [${zone.lo.toFixed(2)}–${zone.hi.toFixed(2)}]` },
                { key: "close_confirm", ok: false, note: "Trigger on candle close only" },
              ],
              summary: "Failed sweep → continuation: BOS with displacement wick; wait retest then close-confirm continuation",
            },
          },

          stop: { price: sl, basis: "LIQUIDITY", note: "Outside displacement wick" },

          tp: [
            { price: tp1, size_pct: 70, basis: "LEVEL", note: "Nearest pivot continuation" },
            { price: dir === "LONG" ? (tp1 + level * atrp * 1.0) : (tp1 - level * atrp * 1.0), size_pct: 30, basis: "R_MULTIPLE", note: "Extension" },
          ],

          rr_min: rr1,
          rr_est: rr1 * 1.15,

          confidence: {
            score: confScore,
            grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
            reasons: [
              ...common.reasons,
              "Failed sweep continuation (displacement wick + BOS acceptance)",
              `BOS ${bos.dir} @ ${level.toFixed(2)}`,
              ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : []),
            ],
          },

          tags: ["intraday", "failed_sweep", "continuation", "bos", "retest"],
        };

        const g = applyQualityGates({ setup: s, f, px, atrp });
        if (g.ok) {
          s.tags = Array.from(new Set([...(s.tags || []), ...g.tagsAdd]));
          s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...g.reasonsAdd]));
          setups.push(s);
        }

      }
    }
  }
  // 3) RANGE_MEAN_REVERT (bias sideways) — B+ policy: allowed even when HTF bias incomplete (with stricter RR)
  if (f.bias.trend_dir === "sideways" && below && above) {
    const nearSupport = Math.abs(px - below.price) / px < 0.002;
    const nearRes = Math.abs(px - above.price) / px < 0.002;

    if (nearSupport || nearRes) {
      const dir: SetupSide = nearSupport ? "LONG" : "SHORT";
      const ref = nearSupport ? below.price : above.price;

      const zone = makeEntryZone(ref, atrp, dir);
      const sl = dir === "LONG" ? (ref - px * atrp * 0.9) : (ref + px * atrp * 0.9);

      const midRange = (below.price + above.price) / 2;
      const tp1 = midRange;

      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tp1, dir);

      let confScore = Math.min(100, common.score + 2);

      if (bias_incomplete) {
        confScore = Math.floor(confScore * 0.65);
        confScore = Math.min(confScore, 82);
      }

      const s: TradeSetup = {
        id: uid("mr"),
        canon: snap.canon,
        type: "RANGE_MEAN_REVERT",
        side: dir,
        entry_tf: "15m",
        bias_tf: f.bias.tf,
        trigger_tf: "5m",

        status: rr1 >= (bias_incomplete ? 1.6 : 1.3) ? "READY" : "FORMING",
        created_ts: ts,
        expires_ts: ts + 1000 * 60 * 120,

        entry: {
          mode: "LIMIT",
          zone,
          trigger: {
            confirmed: false, // Task 3.3
            checklist: [
              {
                key: "bias",
                ok: !bias_incomplete,
                note: bias_incomplete
                  ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                  : "Bias sideways",
              },
              { key: "range", ok: true, note: "Bias sideways" },
              { key: "edge", ok: true, note: nearSupport ? "Near support" : "Near resistance" },
            ],
            summary: "Range MR: fade edges, target mid-range",
          },
        },

        stop: { price: sl, basis: "STRUCTURE", note: "Beyond edge + ATR buffer" },

        tp: [
          { price: tp1, size_pct: 70, basis: "LEVEL", note: "Mid-range" },
          { price: dir === "LONG" ? above.price : below.price, size_pct: 30, basis: "LEVEL", note: "Opposite edge (optional)" },
        ],

        rr_min: rr1,
        rr_est: rr1 * 1.15,

        confidence: {
          score: confScore,
          grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
          reasons: [...common.reasons, "Mean reversion in range", ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : [])],
        },

        tags: ["intraday", "range", nearSupport ? "support" : "resistance"],
      };

      const g = applyQualityGates({ setup: s, f, px, atrp });
      if (g.ok) {
        s.tags = Array.from(new Set([...(s.tags || []), ...g.tagsAdd]));
        s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...g.reasonsAdd]));
        setups.push(s);
      }

    }
  }

  // Publish only ONE primary setup per symbol (quality-first).
  // Priority: READY > confidence > rr_min. If none READY, we still publish the best FORMING as monitor.
  const primary = pickPrimarySetup(setups);

  if (!primary) {
    return { ts, dq_ok: true, preferred_id: undefined, setups: [] };
  }

  return {
    ts,
    dq_ok: true,
    preferred_id: primary.id,
    setups: [primary],
  };

}