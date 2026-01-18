import type { Candle } from "../core/types";
import type { FeaturesSnapshot } from "../features/types";
import type { UnifiedSnapshot } from "../snapshot/unifiedTypes";
import { computePivotLevels, nearestLevels } from "./levels";
import { scoreCommon, gradeFromScore, gradePlusFromScore } from "./scoring";
import type { SetupEngineOutput, TradeSetup, SetupSide } from "./types";

function now() { return Date.now(); }
const TOP_N_SETUPS = 3;

function uid(prefix: string) { return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }

// Stable IDs prevent UI flicker / status-cache misses when the same structural setup persists across ticks.
// We intentionally round price anchors to reduce churn from tiny float noise.
function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV-1a prime: 16777619
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function roundAnchor(x: number, dp = 2): number {
  const k = Math.pow(10, dp);
  return Math.round(x * k) / k;
}

function stableSetupId(args: {
  prefix: string;
  canon: string;
  type: TradeSetup["type"];
  side: SetupSide;
  bias_tf: TradeSetup["bias_tf"];
  entry_tf: TradeSetup["entry_tf"];
  trigger_tf: TradeSetup["trigger_tf"];
  anchor_price?: number;
}): string {
  const anchor =
    typeof args.anchor_price === "number" && Number.isFinite(args.anchor_price)
      ? roundAnchor(args.anchor_price, 2)
      : undefined;

  const raw = JSON.stringify({
    canon: args.canon,
    type: args.type,
    side: args.side,
    bias_tf: args.bias_tf,
    entry_tf: args.entry_tf,
    trigger_tf: args.trigger_tf,
    anchor,
  });

  return `${args.prefix}_${fnv1a32(raw)}`;
}


function lastClose(candles?: Candle[]) {
  if (!candles || !candles.length) return undefined;
  return candles[candles.length - 1].c;
}
function lastConfirmedClose(candles?: Candle[]) {
  if (!candles || !candles.length) return undefined;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i]?.confirm) return candles[i].c;
  }
  return undefined;
}

function confirmedOnly(candles?: Candle[]) {
  if (!candles || !candles.length) return [];
  return candles.filter((c) => Boolean((c as any)?.confirm));
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
function fmtNum(x: unknown, dp = 2, na = "n/a"): string {
  return isFiniteNum(x) ? x.toFixed(dp) : na;
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
    case "SCALP_RANGE_FADE":
      return 0.75;
    case "SCALP_LIQUIDITY_SNAPBACK":
      return 0.45;
    case "SCALP_MOMENTUM_PULLBACK":
      return 0.55;
    case "SCALP_1H_REACTION":
      return 0.65;
    default:
      return 0.60;
  }
}

function isScalpSetup(setup: TradeSetup): boolean {
  const t = String((setup as any)?.type ?? "");
  if (t.startsWith("SCALP_")) return true;
  const tags = (setup as any)?.tags;
  return Array.isArray(tags) && tags.includes("scalp");
}

function validateSetupInvariant(args: {
  setup: TradeSetup;
  px: number;
  atrp: number; // percent as fraction (0.007 = 0.7%)
}): InvariantResult {
  const { setup, px, atrp } = args;

  const scalp = isScalpSetup(setup);

  // Invariant profiles:
  // - Scalp: allow tighter stops / closer TPs / slightly wider zones to avoid over-rejecting valid 5m/15m ideas.
  // - Intraday/Swing: keep stricter constraints for tradeability.
  const INV = scalp
    ? {
      rrMin: 0.9,
      zoneKMin: 0.50,
      minRiskPxK: 0.00035,
      minRiskAtrK: 0.15,
      minRewardPxK: 0.00035,
      minRewardAtrK: 0.22,
      stopEdgeTolPxK: 0.00002,
      stopEdgeTolAtrK: 0.02,
    }
    : {
      rrMin: 1.2,
      zoneKMin: 0.00,
      minRiskPxK: 0.0006,
      minRiskAtrK: 0.25,
      minRewardPxK: 0.0008,
      minRewardAtrK: 0.35,
      stopEdgeTolPxK: 0.0,
      stopEdgeTolAtrK: 0.0,
    };

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
  const kBase = zoneKMultiplierByType(setup.type);
  const k = scalp ? Math.max(kBase, INV.zoneKMin) : kBase;
  const maxW = Math.max(px * 0.0001, atrAbs * k); // floor 1bp-equivalent-ish, but safe
  const w = hi - lo;
  if (w > maxW) {
    codes.push("INV_ZONE_TOO_WIDE");
    notes.push(
      `Zone width ${w.toFixed(6)} > max ${maxW.toFixed(6)} (k=${k}) [type=${String((setup as any)?.type ?? "")} scalp=${scalp}]`
    );

  }

  // Stop must be outside zone in the correct direction
  // For scalp we allow a tiny tolerance to avoid rejecting due to rounding/anchor drift.
  const stopEdgeTol = Math.max(px * INV.stopEdgeTolPxK, atrAbs * INV.stopEdgeTolAtrK);
  if (setup.side === "LONG") {
    // Accept stop slightly above zone.lo (within tolerance) to prevent false rejections from float rounding.
    if (!(st < (lo + stopEdgeTol))) {
      codes.push("INV_STOP_NOT_BELOW_ZONE");
      notes.push(`LONG stop must be below zone.lo (tol=${stopEdgeTol.toFixed(6)})`);
    }
  } else {
    // Accept stop slightly below zone.hi (within tolerance) to prevent false rejections from float rounding.
    if (!(st > (hi - stopEdgeTol))) {
      codes.push("INV_STOP_NOT_ABOVE_ZONE");
      notes.push(`SHORT stop must be above zone.hi (tol=${stopEdgeTol.toFixed(6)})`);
    }
  }

  // Stop distance bounds (noise vs absurd)
  const entryAnchor = (lo + hi) / 2;
  const risk = setup.side === "LONG" ? (entryAnchor - st) : (st - entryAnchor);
  const minRisk = Math.max(px * INV.minRiskPxK, atrAbs * INV.minRiskAtrK);
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
    const minReward = Math.max(px * INV.minRewardPxK, atrAbs * INV.minRewardAtrK);
    if (reward <= 0) {
      codes.push("INV_TP_WRONG_SIDE");
      notes.push("TP1 is on wrong side of entry");
    } else if (reward < minReward) {
      codes.push("INV_TP_TOO_CLOSE");
      notes.push(
        `Reward ${reward.toFixed(6)} < min ${minReward.toFixed(6)} [type=${String((setup as any)?.type ?? "")} scalp=${scalp}]`
      );
    }
  }

  // RR sanity (keep lightweight; exact RR policy can still be type-specific elsewhere)
  const rrFloor = INV.rrMin;
  if (isFiniteNum(setup.rr_min) && setup.rr_min < rrFloor) {
    codes.push("INV_RR_TOO_LOW");
    notes.push(
      `rr_min ${setup.rr_min.toFixed(2)} < ${rrFloor.toFixed(2)} [type=${String((setup as any)?.type ?? "")} scalp=${scalp}]`
    );

  }

  return codes.length ? { ok: false, codes, notes } : { ok: true };
}

function applyQualityGates(args: {
  setup: TradeSetup;
  f: FeaturesSnapshot;
  px: number;
  atrp: number;
}):
  | { ok: true; tagsAdd: string[]; reasonsAdd: string[] }
  | { ok: false; rejectCodes: string[]; rejectNotes: string[] } {
  const { setup, f, px, atrp } = args;

  // Conflicts are NOT gates (soft context only)
  const conflicts = detectConflicts(f, setup.side);
  const major = conflicts.filter((c) => c.severity === "MAJOR");
  const minor = conflicts.filter((c) => c.severity === "MINOR");

  // Final invariants (this is a true gate: invalid setup mechanics)
  const inv = validateSetupInvariant({ setup, px, atrp });
  if (inv.ok === false) {
    return {
      ok: false,
      rejectCodes: ["REJECT_INVARIANT", ...inv.codes],
      rejectNotes: inv.notes,
    };
  }

  const tagsAdd: string[] = [];
  const reasonsAdd: string[] = [];

  // Major conflicts -> caution + explicit reasons (but never kill)
  if (major.length > 0) {
    tagsAdd.push("caution");
    tagsAdd.push("conflict_major");
    // Keep reasons bounded to avoid UI overload
    reasonsAdd.push(...major.slice(0, 2).map((m) => `Major conflict: ${m.note}`));
  }

  // Minor conflicts -> annotate only
  if (minor.length > 0) {
    tagsAdd.push("conflict_minor");
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
function rankSetups(setups: TradeSetup[]): TradeSetup[] {
  const arr = Array.isArray(setups) ? setups.slice() : [];

  const statusRank = (s: TradeSetup): number => {
    const st = String((s as any)?.status ?? "");
    // Prefer actionable/near-actionable first
    if (st === "READY") return 5;
    if (st === "TRIGGERED") return 4;
    if (st === "FORMING") return 3;
    if (st === "INVALIDATED") return 1;
    if (st === "EXPIRED") return 0;
    return 2;
  };

  const num = (x: any, fallback = 0) => (typeof x === "number" && Number.isFinite(x) ? x : fallback);

  // Confidence score is 0..100 in your system.
  // rr_min is typically >= 1.2 for valid setups.
  arr.sort((a, b) => {
    const sr = statusRank(b) - statusRank(a);
    if (sr !== 0) return sr;

    const cs = num((b as any)?.confidence?.score) - num((a as any)?.confidence?.score);
    if (cs !== 0) return cs;

    const rr = num((b as any)?.rr_min) - num((a as any)?.rr_min);
    if (rr !== 0) return rr;

    // Tiebreak: prefer tighter zones (smaller width) if available
    const aw = num((a as any)?.entry?.zone?.hi) - num((a as any)?.entry?.zone?.lo);
    const bw = num((b as any)?.entry?.zone?.hi) - num((b as any)?.entry?.zone?.lo);
    if (Number.isFinite(aw) && Number.isFinite(bw) && aw !== bw) return aw - bw;

    // Stable fallback: id
    return String((a as any)?.id ?? "").localeCompare(String((b as any)?.id ?? ""));
  });

  return arr;
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
  return { ok: true, note: `div=${fmtNum(d.divergence_score, 2)} abs=${fmtNum(d.absorption_score, 2)}` };
}

function biasStrengthOk(f: FeaturesSnapshot) {
  const s = f.bias.trend_strength;
  const adx = f.bias.adx14;
  const slope = f.bias.ema200_slope_bps;

  const okStrength = typeof s !== "number" ? true : s >= 0.55;
  const okAdx = typeof adx !== "number" ? true : adx >= 18;
  const okSlope = typeof slope !== "number" ? true : Math.abs(slope) >= 1.0;

  return { ok: okStrength && okAdx && okSlope, note: `s=${fmtNum(s, 2)} adx=${fmtNum(adx, 0)} slope=${fmtNum(slope, 1)}bps` };
}

export function buildSetups(args: {
  snap: UnifiedSnapshot;
  features: FeaturesSnapshot;
}): SetupEngineOutput {
  const { snap, features: f } = args;
  const ts = now();

  const telemetry = {
    gate: "OK" as "OK" | "DQ_NOT_OK" | "NO_PRICE" | "GRADE_D",
    candidates: 0,
    accepted: 0,
    rejected: 0,
    rejectByCode: {} as Record<string, number>,
    rejectNotesSample: [] as string[],

    // readiness is populated only when candidates === 0 and gate === "OK"
    readiness: undefined as undefined | { state: "NO_SIGNAL"; items: Array<{ key: string; note: string }> },
  };

  // Readiness collector (pure telemetry; does not affect gating)
  const readinessItems: Array<{ key: string; note: string }> = [];
  const addReadiness = (key: string, note: string) => {
    const k = String(key || "").trim();
    const n = String(note || "").trim();
    if (!k || !n) return;
    // de-dup by (key + note) to avoid spam
    if (readinessItems.some((x) => x.key === k && x.note === n)) return;
    readinessItems.push({ key: k, note: n });
  };


  const bumpReject = (codes: string[], notes: string[]) => {
    for (const c of codes) {
      telemetry.rejectByCode[c] = (telemetry.rejectByCode[c] ?? 0) + 1;
    }
    // keep a tiny bounded sample for UI
    for (const n of notes) {
      if (telemetry.rejectNotesSample.length >= 12) break;
      telemetry.rejectNotesSample.push(n);
    }
  };

  const dq_ok = f.quality.dq_grade === "A" || f.quality.dq_grade === "B";
  if (!dq_ok) {
    telemetry.gate = "DQ_NOT_OK";
    return { ts, dq_ok: false, setups: [], preferred_id: undefined, telemetry };
  }


  // Bybit execution candles
  const tf15 = (snap.timeframes.find((x: any) => x.tf === "15m")?.candles?.ohlcv ?? []) as Candle[];
  const tf1h = (snap.timeframes.find((x: any) => x.tf === "1h")?.candles?.ohlcv ?? []) as Candle[];

  // Use confirmed candles for all structural calculations to avoid intrabar drift / repaint
  const tf15c = confirmedOnly(tf15);
  const tf1hc = confirmedOnly(tf1h);

  // Price anchor should be last CONFIRMED close (never the running candle close)
  const px = lastConfirmedClose(tf15c) ?? lastConfirmedClose(tf1hc) ?? 0;
  if (!px) {
    telemetry.gate = "NO_PRICE";
    return { ts, dq_ok: true, setups: [], preferred_id: undefined, telemetry };
  }

  // Levels (confirmed-only to avoid pivots repainting from the running candle)
  const lv15 = computePivotLevels(tf15c, 2, 10);
  const lv1h = computePivotLevels(tf1hc, 2, 10);
  const levels = [...lv15, ...lv1h].sort((a, b) => a.price - b.price);

  const { below, above } = nearestLevels(levels, px);
  const atrp = atrProxyFromFeatures(f);
  const common = scoreCommon(f);
  if (!below || !above) {
    addReadiness("levels", "Insufficient nearby pivot levels (need both below and above) to form zones/targets");
  }
  // Global market-quality gate: scoring is the single source of truth.
  // Grade D => do not publish any setup (engine must not produce monitor noise).
  if (common.grade === "D") {
    telemetry.gate = "GRADE_D";
    return { ts, dq_ok: true, setups: [], preferred_id: undefined, telemetry };
  }


  const setups: TradeSetup[] = [];
  const biasMeta = getBiasCompleteness(snap, f);
  const bias_incomplete = !biasMeta.complete;
  const biasSide = pickBiasSide(f);
  if (!biasSide) {
    addReadiness("trend_pullback", `Trend pullback skipped: bias side not available (trend_dir=${String(f.bias?.trend_dir ?? "n/a")})`);
  } else if (bias_incomplete) {
    addReadiness("trend_pullback", `Trend pullback skipped: HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`);
  }

  const tryAccept = (s: TradeSetup) => {
  telemetry.candidates += 1;

  // IMPORTANT: use scalp sizing for quality gates when setup is scalp
  const scalp = isScalpSetup(s);
  const atrpForGate = scalp ? atrpScalp : atrp;

  const g = applyQualityGates({ setup: s, f, px, atrp: atrpForGate });

  if (g.ok === false) {
    telemetry.rejected += 1;

    const codes = ("rejectCodes" in g && Array.isArray(g.rejectCodes)) ? g.rejectCodes : [];
    const notes = ("rejectNotes" in g && Array.isArray(g.rejectNotes)) ? g.rejectNotes : [];

    bumpReject(codes, notes);
    return false;
  }

  telemetry.accepted += 1;

  const tagsAdd = ("tagsAdd" in g && Array.isArray(g.tagsAdd)) ? g.tagsAdd : [];
  const reasonsAdd = ("reasonsAdd" in g && Array.isArray(g.reasonsAdd)) ? g.reasonsAdd : [];

  s.tags = Array.from(new Set([...(s.tags || []), ...tagsAdd]));
  s.confidence.reasons = Array.from(new Set([...(s.confidence.reasons || []), ...reasonsAdd]));

  // NEW: derive grade_plus (A+/A/B/C) centrally at accept-time (no need to touch each setup builder)
  // We compute conflicts here to avoid relying on fields that are not stored on the setup.
  const conflictsNow = detectConflicts(f, s.side);
  const conflictsMajor = conflictsNow.filter((c) => c.severity === "MAJOR").length;

  const gp = gradePlusFromScore({
    scoreCommon: isFiniteNum(s.confidence?.score) ? Number(s.confidence.score) : 0,
    rrMin: isFiniteNum((s as any)?.rr_min) ? Number((s as any).rr_min) : undefined,
    conflictsMajor,
    dqGrade: String((f as any)?.quality?.dq_grade ?? ""),
    biasComplete: !bias_incomplete,
    triggerTf: String((s as any)?.trigger_tf ?? ""),
  });

  // Attach to confidence (non-breaking; optional fields)
  (s.confidence as any).grade_plus = gp.grade_plus;
  (s.confidence as any).grade_plus_reasons = gp.reasons;

  setups.push(s);
  return true;
};



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
    const bs = biasStrengthOk(f);
    const ht = htfConfirm(f, biasSide);
    const dOk = deltaOk(f, biasSide);

    const imb200 = isFiniteNum(f.orderflow?.imbalance?.top200) ? f.orderflow.imbalance.top200 : undefined;
    const cons = isFiniteNum(f.cross?.consensus_score) ? f.cross.consensus_score : undefined;


    const checklist = [
      { key: "bias", ok: true, note: `Bias ${f.bias.trend_dir} (${f.bias.tf})` },
      { key: "bias_strength", ok: bs.ok, note: `Bias strength: ${bs.note}` },

      {
        key: "orderflow",
        ok: imb200 == null ? true : (biasSide === "LONG" ? (imb200 > -0.35) : (imb200 < 0.35)),
        note: imb200 == null ? "Imb200=n/a" : `Imb200=${fmtNum(imb200, 2)}`,
      },
      {
        key: "cross",
        ok: cons == null ? true : cons >= 0.5,
        note: cons == null ? "cons=n/a" : `cons=${fmtNum(cons, 2)}`,
      },
      { key: "delta", ok: dOk.ok, note: `Delta: ${dOk.note}` },
      { key: "htf_ms", ok: ht.ok, note: `HTF MS: ${ht.note}` },

    ];
    const rrNeed = (!bs.ok || !ht.ok || !dOk.ok) ? 1.8 : 1.5;
    const ready = rr1 >= rrNeed;

    // Setup-specific adjustments should be light; common.score already encodes most market-quality themes.
    let confScore = Math.min(100, common.score + (rr1 >= 2 ? 6 : 0) + 4);

    // Bias strength: mild penalty (trend theme already covers ADX/slope; this is a setup readiness nuance).
    if (!bs.ok) confScore = Math.max(0, confScore - 4);

    // HTF MS confirm: moderate penalty (scoring MS theme is soft; engine uses a stricter structural requirement).
    if (!ht.ok) confScore = Math.max(0, confScore - 5);

    // Strong opposite divergence is a real execution risk; keep meaningful penalty.
    if (!dOk.ok) confScore = Math.max(0, confScore - 7);


    const s: TradeSetup = {
      id: stableSetupId({
        prefix: "tpb",
        canon: snap.canon,
        type: "TREND_PULLBACK",
        side: biasSide,
        bias_tf: f.bias.tf,
        entry_tf: "5m",
        trigger_tf: "5m",
        anchor_price: ref,
      }),

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
        reasons: [
          ...common.reasons,
          "Trend pullback in bias direction",
          ...(!bs.ok ? [`Weakness: Bias strength (${bs.note})`] : []),
          ...(!ht.ok ? [`Weakness: HTF MS (${ht.note})`] : []),
          ...(!dOk.ok ? [`Weakness: Delta (${dOk.note})`] : []),
        ],
      },


      tags: ["intraday", "pullback", f.bias.trend_dir],
    };

    tryAccept(s);

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

    // Setup-specific adjustments should be light; do not re-penalize what scoring already captured.
    let confScore = Math.min(100, common.score + 7);

    // HTF confirm is structural; moderate penalty.
    if (!ht.ok) confScore = Math.max(0, confScore - 5);

    // Strong opposite divergence is a real execution risk; keep meaningful penalty.
    if (!dOk.ok) confScore = Math.max(0, confScore - 7);


    if (bias_incomplete) {
      confScore = Math.floor(confScore * 0.70);
      confScore = Math.min(confScore, 84);
    }

    const rrNeedBase = bias_incomplete ? 1.8 : 1.5;
    const rrNeed = (!ht.ok || !dOk.ok) ? (rrNeedBase + 0.2) : rrNeedBase;
    const ready = rr1 >= rrNeed;


    const s: TradeSetup = {
      id: stableSetupId({
        prefix: "brt",
        canon: snap.canon,
        type: "BREAKOUT",
        side: dir,
        bias_tf: f.bias.tf,
        entry_tf: "5m",
        trigger_tf: "5m",
        anchor_price: level,
      }),

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
            { key: "delta", ok: dOk.ok, note: `Delta: ${dOk.note}` },
            { key: "htf_ms", ok: ht.ok, note: `HTF MS: ${ht.note}` },
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
          ...(!ht.ok ? [`Weakness: HTF MS (${ht.note})`] : []),
          ...(!dOk.ok ? [`Weakness: Delta (${dOk.note})`] : []),
        ],
      },

      tags: ["intraday", "breakout", "bos", "retest"],
    };

    tryAccept(s);



    createdStructureBreakout = true;
  } else {
    if (!bos) {
      addReadiness("breakout_retest", "Breakout+Retest skipped: no 15m BOS available");
    } else if (typeof bos.level !== "number" || typeof bos.ts !== "number") {
      addReadiness("breakout_retest", "Breakout+Retest skipped: 15m BOS invalid (missing level/ts)");
    } else {
      const ageMin = Math.round((ts - Number(bos.ts)) / 60000);
      addReadiness("breakout_retest", `Breakout+Retest skipped: 15m BOS stale (age ${ageMin}m > 90m)`);
    }
  }
  /**
   * 2b) BREAKOUT (legacy: squeeze → expansion)
   * - Keep as fallback when structure BOS is not available/fresh.
   */
  if (!createdStructureBreakout) {
    // Need squeeze: BB width very low
    const width = f.entry.volatility.bbWidth_15m;
    const squeeze = typeof width === "number" ? width < 0.02 : false;
    if (!squeeze) {
      addReadiness("breakout_squeeze", `Breakout(squeeze) skipped: no squeeze (bbWidth15m=${fmtNum(width, 4)})`);
    }
    if (squeeze && (!below || !above)) {
      addReadiness("breakout_squeeze", "Breakout(squeeze) skipped: missing below/above levels for break selection");
    }
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

      const ready = rr1 >= (bias_incomplete ? 1.8 : 1.5);

      const s: TradeSetup = {
        id: stableSetupId({
          prefix: "brk",
          canon: snap.canon,
          type: "BREAKOUT",
          side: dir,
          bias_tf: f.bias.tf,
          entry_tf: "5m",
          trigger_tf: "5m",
          anchor_price: brk,
        }),

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
              { key: "squeeze", ok: true, note: `BBWidth15m=${fmtNum(width, 4)}` },
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

      tryAccept(s);


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
  if (!sweepPick) {
    addReadiness("lsr", "LSR skipped: no fresh sweep on 15m/1h within freshness windows");
  }
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
    if (!oppSwing || typeof oppSwing.price !== "number") {
      addReadiness("lsr", "LSR skipped: opposite swing target not available (need lastSwingHigh/Low)");
    }
    if (oppSwing && typeof oppSwing.price === "number") {
      const tp1 = oppSwing.price;

      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tp1, side);
      if (rr1 < LSR_RR_MIN) {
        addReadiness("lsr", `LSR skipped: RR ${rr1.toFixed(2)} < ${LSR_RR_MIN.toFixed(2)}`);
      }

      if (rr1 >= LSR_RR_MIN) {
        // READY only when current price is back in entry zone (using px close; intrabar mid is handled elsewhere)
        const ready = px >= zone.lo && px <= zone.hi;

        let confScore = Math.min(100, common.score + 5 + (rr1 >= 3.2 ? 3 : 0));

        const s: TradeSetup = {
          id: stableSetupId({
            prefix: "lsr",
            canon: snap.canon,
            type: "LIQUIDITY_SWEEP_REVERSAL",
            side,
            bias_tf: f.bias.tf,
            entry_tf: "15m",
            trigger_tf: "5m",
            anchor_price: level,
          }),


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

        tryAccept(s);


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
      if (!hasDisplacement) {
        addReadiness("failed_sweep_cont", "Failed-sweep continuation skipped: no displacement wick through BOS level in recent confirmed candles");
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
        const ready = rr1 >= rrNeed && (px >= zone.lo && px <= zone.hi);

        // Confidence: breakout + displacement premium; cap if HTF bias incomplete
        let confScore = Math.min(100, common.score + 8);
        if (bias_incomplete) {
          confScore = Math.floor(confScore * 0.75);
          confScore = Math.min(confScore, 84);
        }

        const s: TradeSetup = {
          id: stableSetupId({
            prefix: "fsc",
            canon: snap.canon,
            type: "FAILED_SWEEP_CONTINUATION",
            side: dir,
            bias_tf: f.bias.tf,
            entry_tf: "5m",
            trigger_tf: "5m",
            anchor_price: level,
          }),

          canon: snap.canon,
          type: "FAILED_SWEEP_CONTINUATION",
          side: dir,
          entry_tf: "5m",
          bias_tf: f.bias.tf,
          trigger_tf: "5m",

          status: rr1 >= rrNeed
            ? (ready ? "READY" : "FORMING")
            : "FORMING",

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

        tryAccept(s);

      }
    }
  } else {
    addReadiness("failed_sweep_cont", "Failed-sweep continuation skipped: no valid 15m BOS (missing level/ts)");
  }



  // 3) RANGE_MEAN_REVERT (bias sideways) — B+ policy: allowed even when HTF bias incomplete (with stricter RR)
  if (f.bias.trend_dir !== "sideways") {
    addReadiness("range_mr", `Range MR skipped: bias not sideways (trend_dir=${String(f.bias?.trend_dir ?? "n/a")})`);
  }
  if (f.bias.trend_dir === "sideways" && below && above) {
    // Edge proximity threshold: adapt to volatility so we don't miss valid range edges
    // in higher-ATR regimes, while still keeping a reasonable floor in low-ATR regimes.
    const edgeThresh = Math.max(0.0015, atrp * 0.35); // fraction of price (0.0015 = 0.15%)
    const nearSupport = Math.abs(px - below.price) / px < edgeThresh;
    const nearRes = Math.abs(px - above.price) / px < edgeThresh;

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
        id: stableSetupId({
          prefix: "mr",
          canon: snap.canon,
          type: "RANGE_MEAN_REVERT",
          side: dir,
          bias_tf: f.bias.tf,
          entry_tf: "15m",
          trigger_tf: "5m",
          anchor_price: ref,
        }),


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

      tryAccept(s);


    }
  }

  // ------------------------------------------------------------
  // 6) SCALP setups (5m / 15m / 1h)
  // Goal: higher win-rate while still producing enough trades.
  // - Short TTL (time-stop)
  // - Strong microstructure filters (regime + proximity)
  // - Close-confirm remains enforced by hook (applyCloseConfirm)
  // ------------------------------------------------------------

  const tf5 = (snap.timeframes.find((x: any) => x.tf === "5m")?.candles?.ohlcv ?? []) as Candle[];
  const tf5c = confirmedOnly(tf5);
  const last5 = tf5c[tf5c.length - 1];
  const px5 = lastConfirmedClose(tf5c) ?? px;

  // ATR% proxy for scalp sizing (prefer 15m ATR% if present; fallback to global proxy)
  const atrp15mPct = isFiniteNum((f as any)?.entry?.volatility?.atrp_15m) ? Number((f as any).entry.volatility.atrp_15m) / 100 : undefined;
  const atrpScalp = atrp15mPct && atrp15mPct > 0 ? atrp15mPct : atrp;

  // Small helper: bps proximity
  const distBps = (a: number, b: number) => ((a - b) / b) * 10000;
  const abs = (x: number) => Math.abs(x);

  // ---- 6.1 SCALP_RANGE_FADE (5m)
  // Use 5m market-structure swings as range edges.
  const ms5 = (f as any).market_structure?.["5m"];
  const swingHi5 = ms5?.lastSwingHigh;
  const swingLo5 = ms5?.lastSwingLow;
  if (isFiniteNum(px5) && px5 > 0 && swingHi5?.price && swingLo5?.price) {
    const hi = Number(swingHi5.price);
    const lo = Number(swingLo5.price);
    if (isFiniteNum(hi) && isFiniteNum(lo) && hi > lo) {
      const widthFrac = (hi - lo) / px5;
      const vr = String((f as any)?.bias?.vol_regime ?? "");
      const trendDir = String((f as any)?.bias?.trend_dir ?? "");

      // Range conditions: not in high-vol, and width is meaningful relative to ATR.
      const rangeOk = vr !== "high" && widthFrac >= (atrpScalp * 0.8);
      if (rangeOk) {
        // Proximity to an edge: within ~25% of range width OR within ~0.25*ATR.
        const dHi = abs(px5 - hi);
        const dLo = abs(px5 - lo);
        const nearEdge = Math.min(dHi, dLo) <= Math.max((hi - lo) * 0.25, px5 * atrpScalp * 0.25);

        // Choose which edge to fade.
        const side: SetupSide = dHi <= dLo ? "SHORT" : "LONG";
        const edge = side === "SHORT" ? hi : lo;

        // Entry zone around the edge (tight; win-rate focus).
        const w = Math.max(edge * 0.0007, edge * atrpScalp * 0.18); // max(7 bps, 0.18*ATR)
        const zone = side === "SHORT"
          ? { lo: edge - w * 0.55, hi: edge + w }
          : { lo: edge - w, hi: edge + w * 0.55 };

        // Stop just outside the edge with small buffer.
        const sl = side === "SHORT" ? (edge + w * 1.25) : (edge - w * 1.25);

        // Target: mid-range (high probability).
        const midRange = (hi + lo) / 2;
        const tp1 = midRange;
        const entryMid = (zone.lo + zone.hi) / 2;
        const rr1 = rr(entryMid, sl, tp1, side);

        // Timeliness: only publish READY when near edge (avoid early signals).
        const ready = nearEdge && rr1 >= 1.05;

        // Confidence adjustments for range fade (common scoring penalizes sideways; we compensate lightly).
        let confScore = common.score;
        if (trendDir === "sideways") confScore += 6;
        else confScore += 2;
        if (vr === "low") confScore += 3;
        if (vr === "high") confScore -= 6;
        if (!nearEdge) confScore -= 6;
        // RR too small is still risky even for fade.
        if (rr1 < 1.05) confScore -= 8;
        confScore = Math.max(0, Math.min(100, confScore));

        const s: TradeSetup = {
          id: stableSetupId({
            prefix: "sc_rf",
            canon: snap.canon,
            type: "SCALP_RANGE_FADE",
            side,
            bias_tf: f.bias.tf,
            entry_tf: "5m",
            trigger_tf: "5m",
            anchor_price: edge,
          }),

          canon: snap.canon,
          type: "SCALP_RANGE_FADE",
          side,
          entry_tf: "5m",
          bias_tf: f.bias.tf,
          trigger_tf: "5m",

          status: ready ? "READY" : "FORMING",
          created_ts: ts,
          // TTL: 2 candles 5m (+small buffer)
          expires_ts: ts + 1000 * 60 * 12,

          entry: {
            mode: "LIMIT",
            zone,
            trigger: {
              confirmed: false,
              checklist: [
                { key: "range", ok: true, note: "5m swing range fade" },
                { key: "range_hi", ok: true, note: `RangeHi @ ${hi.toFixed(2)} (5m)` },
                { key: "range_lo", ok: true, note: `RangeLo @ ${lo.toFixed(2)} (5m)` },
                { key: "vol", ok: vr !== "high", note: `vol_regime=${vr || "n/a"}` },
                { key: "proximity", ok: nearEdge, note: `dist_edge=${Math.min(dHi, dLo).toFixed(2)}` },
              ],
              summary: "Scalp range fade: wait touch zone + close-confirm re-entry",
            },
          },

          stop: { price: sl, basis: "STRUCTURE", note: "Outside range edge + buffer" },

          tp: [
            { price: tp1, size_pct: 100, basis: "LEVEL", note: "Mid-range" },
          ],

          rr_min: rr1,
          rr_est: rr1,

          confidence: {
            score: confScore,
            grade: gradeFromScore(confScore),
            reasons: [
              ...common.reasons,
              "Scalp range fade (5m) with mid-range target",
              ...(nearEdge ? [] : ["Not yet near range edge"]),
            ],
          },

          tags: ["scalp", "range", side === "LONG" ? "support" : "resistance"],
        };

        tryAccept(s);
      } else {
        addReadiness("scalp_range_fade", "Scalp range fade skipped: regime/width not suitable");
      }
    }
  }

  // ---- 6.2 SCALP_LIQUIDITY_SNAPBACK (5m)
  // Use last 5m sweep event (confirmed) for snapback reversal.
  if (last5 && ms5?.lastSweep) {
    const sw = ms5.lastSweep;
    const swLevel = Number(sw?.level);
    const swTs = Number(sw?.ts);
    const recentOk = isFiniteNum(swTs) && isFiniteNum(last5.ts)
      ? (last5.ts - swTs) <= 3 * 5 * 60 * 1000
      : true;

    if (isFiniteNum(swLevel) && swLevel > 0 && recentOk) {
      const side: SetupSide = String(sw.dir) === "UP" ? "SHORT" : "LONG";
      const zone = makeRetestZone(swLevel, atrpScalp, side);
      const entryMid = (zone.lo + zone.hi) / 2;

      const swHigh = isFiniteNum(sw?.high) ? Number(sw.high) : undefined;
      const swLow = isFiniteNum(sw?.low) ? Number(sw.low) : undefined;
      const w = Math.max(swLevel * 0.0007, swLevel * atrpScalp * 0.18);
      const sl = side === "LONG"
        ? (swLow != null ? (swLow - w * 0.6) : (swLevel - w * 1.25))
        : (swHigh != null ? (swHigh + w * 0.6) : (swLevel + w * 1.25));

      // Target: 1.2R (high probability, not greedy)
      const tp1 = side === "LONG" ? (entryMid + (entryMid - sl) * 1.2) : (entryMid - (sl - entryMid) * 1.2);
      const rr1 = rr(entryMid, sl, tp1, side);

      // Require proximity to level (timely)
      const nearLvl = abs(distBps(px5, swLevel)) <= 35;
      const ready = nearLvl && rr1 >= 1.05;

      // Confidence: reward reclaim-style setups when divergence isn't strongly opposing.
      let confScore = common.score + 4;
      if (!nearLvl) confScore -= 6;
      if (rr1 < 1.05) confScore -= 8;
      confScore = Math.max(0, Math.min(100, confScore));

      const s: TradeSetup = {
        id: stableSetupId({
          prefix: "sc_ls",
          canon: snap.canon,
          type: "SCALP_LIQUIDITY_SNAPBACK",
          side,
          bias_tf: f.bias.tf,
          entry_tf: "5m",
          trigger_tf: "5m",
          anchor_price: swLevel,
        }),

        canon: snap.canon,
        type: "SCALP_LIQUIDITY_SNAPBACK",
        side,
        entry_tf: "5m",
        bias_tf: f.bias.tf,
        trigger_tf: "5m",

        status: ready ? "READY" : "FORMING",
        created_ts: ts,
        // TTL: 2 candles 5m
        expires_ts: ts + 1000 * 60 * 10,

        entry: {
          mode: "LIMIT",
          zone,
          trigger: {
            confirmed: false,
            checklist: [
              { key: "sweep", ok: true, note: `Sweep @ ${swLevel.toFixed(2)} (5m)` },
              { key: "retest", ok: true, note: "Retest sweep level zone" },
              { key: "proximity", ok: nearLvl, note: `dist=${distBps(px5, swLevel).toFixed(1)}bps` },
            ],
            summary: "Scalp snapback: wait retest zone touch + close-confirm reclaim",
          },
        },

        stop: { price: sl, basis: "LIQUIDITY", note: "Beyond sweep wick + buffer" },

        tp: [
          { price: tp1, size_pct: 100, basis: "R_MULTIPLE", note: "1.2R" },
        ],

        rr_min: rr1,
        rr_est: rr1,

        confidence: {
          score: confScore,
          grade: gradeFromScore(confScore),
          reasons: [
            ...common.reasons,
            "Scalp liquidity snapback (5m) after confirmed sweep",
          ],
        },

        tags: ["scalp", "sweep", "snapback"],
      };

      tryAccept(s);
    } else {
      addReadiness("scalp_snapback", "Scalp snapback skipped: sweep not recent/valid");
    }
  }

  // ---- 6.3 SCALP_MOMENTUM_PULLBACK (5m)
  // Trend-following scalp using 15m structure + 5m pullback proximity.
  const ms15Trend = (f as any).market_structure?.["15m"];
  const trend15 = String(ms15Trend?.trend ?? "");
  if (ms15Trend && (trend15 === "BULL" || trend15 === "BEAR") && isFiniteNum(px5) && px5 > 0) {
    const side: SetupSide = trend15 === "BULL" ? "LONG" : "SHORT";
    const swing = side === "LONG" ? ms5?.lastSwingLow : ms5?.lastSwingHigh;
    const ref = isFiniteNum(swing?.price) ? Number(swing.price) : undefined;

    // Momentum confirmation from 5m RSI/MACD (if present)
    const rsi5 = isFiniteNum((f as any)?.entry?.momentum?.rsi14_5m) ? Number((f as any).entry.momentum.rsi14_5m) : undefined;
    const macd5 = isFiniteNum((f as any)?.entry?.momentum?.macdHist_5m) ? Number((f as any).entry.momentum.macdHist_5m) : undefined;
    const momOk = side === "LONG"
      ? ((rsi5 == null || rsi5 >= 48) && (macd5 == null || macd5 >= 0))
      : ((rsi5 == null || rsi5 <= 52) && (macd5 == null || macd5 <= 0));

    if (ref != null && ref > 0 && momOk) {
      // Require price to be in pullback vicinity of the reference swing.
      const pullbackNear = side === "LONG"
        ? (px5 <= ref * (1 + atrpScalp * 0.35))
        : (px5 >= ref * (1 - atrpScalp * 0.35));

      const zone = makeEntryZone(ref, atrpScalp, side);
      const w = Math.max(ref * 0.0007, ref * atrpScalp * 0.18);
      const sl = side === "LONG" ? (ref - w * 1.35) : (ref + w * 1.35);

      // Target: nearest pivot in trend direction (fallback to 1.25R)
      const tpLvl = side === "LONG" ? (above?.price ?? (px5 + px5 * atrpScalp * 0.9)) : (below?.price ?? (px5 - px5 * atrpScalp * 0.9));
      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tpLvl, side);

      const ready = pullbackNear && rr1 >= 1.12;

      let confScore = common.score + 3;
      if (!pullbackNear) confScore -= 6;
      if (!momOk) confScore -= 6;
      if (rr1 < 1.12) confScore -= 8;
      confScore = Math.max(0, Math.min(100, confScore));

      const s: TradeSetup = {
        id: stableSetupId({
          prefix: "sc_mp",
          canon: snap.canon,
          type: "SCALP_MOMENTUM_PULLBACK",
          side,
          bias_tf: f.bias.tf,
          entry_tf: "5m",
          trigger_tf: "5m",
          anchor_price: ref,
        }),

        canon: snap.canon,
        type: "SCALP_MOMENTUM_PULLBACK",
        side,
        entry_tf: "5m",
        bias_tf: f.bias.tf,
        trigger_tf: "5m",

        status: ready ? "READY" : "FORMING",
        created_ts: ts,
        // TTL: 3 candles 5m
        expires_ts: ts + 1000 * 60 * 15,

        entry: {
          mode: "LIMIT",
          zone,
          trigger: {
            confirmed: false,
            checklist: [
              { key: "trend", ok: true, note: `15m trend=${trend15}` },
              { key: "pullback", ok: pullbackNear, note: `ref @ ${ref.toFixed(2)} (5m swing)` },
              { key: "momentum", ok: momOk, note: `rsi5=${fmtNum(rsi5, 1)} macd5=${fmtNum(macd5, 4)}` },
            ],
            summary: "Scalp momentum pullback: wait zone touch + close-confirm reclaim",
          },
        },

        stop: { price: sl, basis: "STRUCTURE", note: "Beyond pullback swing + buffer" },

        tp: [
          { price: tpLvl, size_pct: 100, basis: "LEVEL", note: "Nearest pivot" },
        ],

        rr_min: rr1,
        rr_est: rr1,

        confidence: {
          score: confScore,
          grade: gradeFromScore(confScore),
          reasons: [
            ...common.reasons,
            "Scalp momentum pullback aligned with 15m structure trend",
          ],
        },

        tags: ["scalp", "trend", "pullback"],
      };

      tryAccept(s);
    } else {
      addReadiness("scalp_momentum_pullback", "Scalp momentum pullback skipped: missing swing ref or momentum not OK");
    }
  }

  // ---- 6.4 SCALP_1H_REACTION (15m trigger)
  // Reaction scalp at nearest 1h pivot level when price is already at/near the level.
  if (isFiniteNum(px5) && px5 > 0) {
    const nearBelowBps = below ? abs(distBps(px5, below.price)) : Infinity;
    const nearAboveBps = above ? abs(distBps(px5, above.price)) : Infinity;
    const pickSide: SetupSide | null = nearBelowBps <= 22 ? "LONG" : (nearAboveBps <= 22 ? "SHORT" : null);
    const lvl = pickSide === "LONG" ? below?.price : (pickSide === "SHORT" ? above?.price : undefined);
    if (pickSide && isFiniteNum(lvl) && lvl! > 0) {
      const level = Number(lvl);
      const w = Math.max(level * 0.0008, level * atrpScalp * 0.22);
      const zone = pickSide === "LONG" ? { lo: level - w, hi: level + w * 0.55 } : { lo: level - w * 0.55, hi: level + w };
      const sl = pickSide === "LONG" ? (level - w * 1.25) : (level + w * 1.25);
      const entryMid = (zone.lo + zone.hi) / 2;
      const tp1 = pickSide === "LONG" ? (entryMid + (entryMid - sl) * 1.15) : (entryMid - (sl - entryMid) * 1.15);
      const rr1 = rr(entryMid, sl, tp1, pickSide);

      const ready = rr1 >= 1.05;
      let confScore = common.score + 2;
      if (rr1 < 1.05) confScore -= 8;
      confScore = Math.max(0, Math.min(100, confScore));

      const s: TradeSetup = {
        id: stableSetupId({
          prefix: "sc_1h",
          canon: snap.canon,
          type: "SCALP_1H_REACTION",
          side: pickSide,
          bias_tf: f.bias.tf,
          entry_tf: "15m",
          trigger_tf: "15m",
          anchor_price: level,
        }),

        canon: snap.canon,
        type: "SCALP_1H_REACTION",
        side: pickSide,
        entry_tf: "15m",
        bias_tf: f.bias.tf,
        trigger_tf: "15m",

        status: ready ? "READY" : "FORMING",
        created_ts: ts,
        // TTL: 2 candles 15m
        expires_ts: ts + 1000 * 60 * 32,

        entry: {
          mode: "LIMIT",
          zone,
          trigger: {
            confirmed: false,
            checklist: [
              { key: "level", ok: true, note: `1h pivot @ ${level.toFixed(2)} (15m trigger)` },
              { key: "proximity", ok: true, note: `dist=${pickSide === "LONG" ? nearBelowBps.toFixed(1) : nearAboveBps.toFixed(1)}bps` },
            ],
            summary: "Scalp 1h reaction: wait zone touch + close-confirm rejection",
          },
        },

        stop: { price: sl, basis: "STRUCTURE", note: "Beyond 1h pivot + buffer" },

        tp: [
          { price: tp1, size_pct: 100, basis: "R_MULTIPLE", note: "1.15R" },
        ],

        rr_min: rr1,
        rr_est: rr1,

        confidence: {
          score: confScore,
          grade: gradeFromScore(confScore),
          reasons: [
            ...common.reasons,
            "Scalp reaction at nearby 1h pivot level",
          ],
        },

        tags: ["scalp", "reaction", "1h"],
      };

      tryAccept(s);
    }
  }

  // Publish only ONE primary setup per symbol (quality-first).
  // Priority: READY > confidence > rr_min. If none READY, we still publish the best FORMING as monitor.
  const ranked = rankSetups(setups);
  const top = ranked.slice(0, TOP_N_SETUPS);
  const primary = top[0];

  if (!primary) {
    // Only publish readiness when there were no candidates at all (true no-signal case)
    if (telemetry.gate === "OK" && telemetry.candidates === 0) {
      if (readinessItems.length === 0) {
        addReadiness("no_signal", "No candidate patterns matched the current market structure and regime");
      }
      telemetry.readiness = {
        state: "NO_SIGNAL",
        items: readinessItems.slice(0, 10), // bounded for UI
      };
    }

    return { ts, dq_ok: true, preferred_id: undefined, setups: [], telemetry };
  }

  return {
    ts,
    dq_ok: true,
    preferred_id: primary.id,
    setups: top,
    telemetry,
  };


}