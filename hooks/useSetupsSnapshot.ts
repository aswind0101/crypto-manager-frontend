import { useMemo, useRef } from "react";
import { useFeaturesSnapshot } from "./useFeaturesSnapshot";
import { buildSetups } from "../lib/feeds/setups/engine";
import { gradeFromScore } from "../lib/feeds/setups/scoring";
import type { ExecutionDecision, SetupTelemetry, DecisionNarrative, DecisionCode } from "../lib/feeds/setups/types";
export type ExecutionGlobal = {
  state: "ENABLED" | "BLOCKED";
  reasons: string[];
};

export type FeedStatus = {
  evaluated: boolean;
  candidatesEvaluated: number | null;
  published: number;
  rejected: number | null;
  rejectionByCode: Record<string, number> | null;
  rejectNotesSample: string[] | null;
  gate: string | null;
  readiness: { state: string; items: Array<{ key: string; note: string }> } | null;
  lastEvaluationTs: number;
};

export type UseSetupsSnapshotResult = {
  snap: any;
  features: any;
  setups: any;
  executionGlobal: ExecutionGlobal | null;
  feedStatus: FeedStatus | null;
};



type Candle = {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  confirm: boolean;
};
type SetupStatus = "FORMING" | "READY" | "TRIGGERED" | "INVALIDATED" | "EXPIRED";
type StatusTf = "5m" | "15m" | "1h" | "4h";


/**
 * Status timeframe policy (used ONLY for stabilizing FORMING/READY transitions):
 * - Scalp setups (type starts with "SCALP_") must NOT be stabilized on 1h/4h,
 *   otherwise the UI can freeze READY/FORMING for up to an hour.
 *   For scalps we stabilize on the setup's fast timeframe:
 *     - Prefer entry_tf if available ("5m" or "15m")
 *     - Else prefer trigger_tf
 *     - Else fallback to "15m" (or "5m" if only that exists)
 * - Non-scalp:
 *     - If bias_tf is 4h => swing status_tf = 4h
 *     - Else => intraday status_tf = 1h
 */
function inferStatusTf(setup: any, snap?: any): StatusTf {
  const type = String(setup?.type ?? "").toUpperCase();

  // Scalp setups stabilize on fast TFs.
  if (type.startsWith("SCALP_")) {
    const entryTf = String(setup?.entry_tf ?? "").trim();
    const triggerTf = String(setup?.trigger_tf ?? "").trim();

    const tfs: string[] = Array.isArray(snap?.timeframes)
      ? snap.timeframes.map((x: any) => String(x?.tf ?? "")).filter((x: string) => x)
      : [];
    const tfSet = new Set<string>(tfs);

    const isFast = (tf: string) => tf === "5m" || tf === "15m";

    if (isFast(entryTf) && (!snap || tfSet.has(entryTf))) return entryTf as StatusTf;
    if (isFast(triggerTf) && (!snap || tfSet.has(triggerTf))) return triggerTf as StatusTf;

    // Fallbacks preserve legacy preference when available in snapshot.
    if (!snap) return "15m";
    if (tfSet.has("15m")) return "15m";
    if (tfSet.has("5m")) return "5m";
    // If neither is available, fall back to intraday 1h to avoid undefined.
    return "1h";
  }

  // Default (non-scalp): 4h swing, else 1h intraday.
  const biasTf = String(setup?.bias_tf ?? "").toLowerCase().trim();
  if (biasTf === "4h") return "4h";
  return "1h";
}


function computeMidFromSnap(snap: any): number {
  const m = Number(snap?.price?.mid);
  if (Number.isFinite(m)) return m;
  const bid = Number(snap?.price?.bid);
  const ask = Number(snap?.price?.ask);
  if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
  return NaN;
}

/**
 * Hard invalidation (intrabar):
 * - LONG: mid <= stop => INVALIDATED
 * - SHORT: mid >= stop => INVALIDATED
 */
function applyHardInvalidationIntrabar(out: any, snap: any): any {
  if (!out || !Array.isArray(out.setups) || !snap) return out;

  const mid = computeMidFromSnap(snap);
  if (!Number.isFinite(mid)) return out;

  const updated = out.setups.map((s: any) => {
    if (!s) return s;

    const status = String(s?.status ?? "") as SetupStatus | string;
    if (status === "INVALIDATED" || status === "EXPIRED") return s;

    const stopPx = s?.stop?.price;
    if (typeof stopPx !== "number" || !Number.isFinite(stopPx)) return s;

    if (s.side === "LONG" && mid <= stopPx) return { ...s, status: "INVALIDATED" };
    if (s.side === "SHORT" && mid >= stopPx) return { ...s, status: "INVALIDATED" };

    return s;
  });

  return { ...out, setups: updated };
}

/**
 * Stabilize status changes (FORMING <-> READY) so they only change
 * when a new CONFIRMED candle of status_tf arrives.
 *
 * Notes:
 * - TRIGGERED is allowed to change based on applyCloseConfirm() (trigger_tf close-confirm).
 * - INVALIDATED/EXPIRED always apply immediately (invalidated also intrabar via applyHardInvalidationIntrabar).
 */
function stabilizeStatusByConfirmedBar(
  out: any,
  snap: any,
  cache: Map<string, { status: SetupStatus; barTs: number }>,
): any {
  if (!out || !Array.isArray(out.setups) || !snap) return out;

  const last5m = lastConfirmedCandle(getTimeframeCandles(snap, "5m"));
  const last15m = lastConfirmedCandle(getTimeframeCandles(snap, "15m"));
  const last1h = lastConfirmedCandle(getTimeframeCandles(snap, "1h"));
  const last4h = lastConfirmedCandle(getTimeframeCandles(snap, "4h"));

  const barTsByTf: Record<StatusTf, number> = {
    "5m": Number.isFinite(last5m?.ts as number) ? (last5m!.ts as number) : 0,
    "15m": Number.isFinite(last15m?.ts as number) ? (last15m!.ts as number) : 0,
    "1h": Number.isFinite(last1h?.ts as number) ? (last1h!.ts as number) : 0,
    "4h": Number.isFinite(last4h?.ts as number) ? (last4h!.ts as number) : 0,
  };


  const updated = out.setups.map((s: any) => {
    if (!s) return s;

    const key = String(s?.canon ?? s?.id ?? "");
    if (!key) return s;

    const statusTf = inferStatusTf(s, snap);
    const barTs = barTsByTf[statusTf];

    const incoming = String(s?.status ?? "") as SetupStatus | string;

    // Always keep hard terminal statuses
    if (incoming === "INVALIDATED" || incoming === "EXPIRED") {
      cache.set(key, { status: incoming as SetupStatus, barTs });
      return { ...s, status_tf: statusTf };
    }

    // Allow TRIGGERED to update immediately (it is a trigger layer outcome)
    if (incoming === "TRIGGERED") {
      cache.set(key, { status: "TRIGGERED", barTs });
      return { ...s, status_tf: statusTf };
    }

    // Only stabilize FORMING/READY transitions
    if (incoming !== "FORMING" && incoming !== "READY") {
      // unknown status -> pass through, but still tag status_tf
      return { ...s, status_tf: statusTf };
    }

    const prev = cache.get(key);

    // First time seeing this setup => accept
    if (!prev) {
      cache.set(key, { status: incoming as SetupStatus, barTs });
      return { ...s, status_tf: statusTf };
    }

    // If status_tf bar hasn't advanced, freeze FORMING/READY to previous value
    if (prev.barTs === barTs) {
      cache.set(key, { status: prev.status, barTs }); // refresh
      return { ...s, status: prev.status, status_tf: statusTf };
    }

    // New confirmed bar => accept new status
    cache.set(key, { status: incoming as SetupStatus, barTs });
    return { ...s, status_tf: statusTf };
  });

  return { ...out, setups: updated };
}

function getTimeframeCandles(snap: any, tf: string): Candle[] {
  const node = snap?.timeframes?.find((x: any) => String(x?.tf) === tf);
  const arr = node?.candles?.ohlcv;
  return Array.isArray(arr) ? (arr as Candle[]) : [];
}

function pickTriggerTf(snap: any): string {
  const tfs = new Set<string>((snap?.timeframes ?? []).map((x: any) => String(x?.tf ?? "")));
  if (tfs.has("5m")) return "5m";
  if (tfs.has("15m")) return "15m";
  return "";
}
function tfToMs(tf?: string): number | undefined {
  if (!tf) return;
  const m = tf.trim().toLowerCase().match(/^(\d+)(m|h|d)$/);
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return;
  if (m[2] === "m") return n * 60_000;
  if (m[2] === "h") return n * 60 * 60_000;
  if (m[2] === "d") return n * 24 * 60 * 60_000;
}
function formatRemainingMMSS(totalSeconds?: number): string | undefined {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds)) return;
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/**
 * Select the close-confirm timeframe for a specific setup.
 *
 * IMPORTANT:
 * - The engine publishes per-setup `trigger_tf`.
 * - The trigger evaluation MUST respect that, otherwise a setup defined to
 *   trigger on 15m could incorrectly trigger on 5m (or vice versa).
 */
function pickTriggerTfForSetup(snap: any, setup: any): string {
  const wanted = String(setup?.trigger_tf ?? "").trim();
  const tfs = new Set<string>((snap?.timeframes ?? []).map((x: any) => String(x?.tf ?? "")));

  // 1) Strict: use the setup-defined trigger_tf if present in snapshot.
  if (wanted && tfs.has(wanted)) return wanted;

  // 2) Fallback: some setups may want to trigger on entry_tf if trigger_tf is missing.
  const entryTf = String(setup?.entry_tf ?? "").trim();
  if (entryTf && tfs.has(entryTf)) return entryTf;

  // 3) Last resort: preserve legacy behavior (prefer 5m then 15m).
  return pickTriggerTf(snap);
}
function pickTriggerTfForSetupRuntime(
  snap: any,
  setup: any,
  lastByTf: Record<string, Candle | undefined>,
  nowMs: number
): { tf?: string; stale: boolean; staleReason?: string } {
  const tfs: string[] = Array.isArray(snap?.timeframes)
    ? snap.timeframes.map((x: any) => String(x?.tf ?? "")).filter((x: string) => x)
    : [];
  const tfSet = new Set<string>(tfs);

  const tfToMinutes = (tf?: string): number | undefined => {
    if (!tf) return undefined;
    const m = tf.trim().toLowerCase().match(/^(\d+)(m|h|d)$/);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    if (m[2] === "m") return n;
    if (m[2] === "h") return n * 60;
    if (m[2] === "d") return n * 60 * 24;
    return undefined;
  };

  const isFresh = (tf: string) => {
    const last = lastByTf[tf];
    if (!last || typeof last.ts !== "number") return { ok: false as const, reason: "no_confirmed_candle" };
    const mins = tfToMinutes(tf);
    if (mins == null) return { ok: true as const };
    // allow up to ~2 bars + 10s grace before declaring stale
    const allowMs = mins * 60_000 * 2 + 10_000;
    const ageMs = nowMs - last.ts;
    if (ageMs <= allowMs) return { ok: true as const };
    return { ok: false as const, reason: `stale_last_confirmed ageMs=${Math.round(ageMs)} allowMs=${allowMs}` };
  };

  const wanted = String(setup?.trigger_tf ?? "").trim();
  const entryTf = String(setup?.entry_tf ?? "").trim();
  const legacy = pickTriggerTf(snap);

  const candidates = [wanted, entryTf, legacy].filter((tf) => tf && tfSet.has(tf));

  for (const tf of candidates) {
    const chk = isFresh(tf);
    if (chk.ok) return { tf, stale: false };
  }

  // If none are fresh, return strict selection + stale flag
  const strict = pickTriggerTfForSetup(snap, setup);
  return { tf: strict, stale: true, staleReason: "no_fresh_tf" };
}

function lastConfirmedCandle(candles: Candle[]): Candle | undefined {
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (c && c.confirm) return c;
  }
  return undefined;
}

function upsertChecklist(
  list: Array<{ key: string; ok: boolean; note?: string }>,
  item: { key: string; ok: boolean; note?: string }
) {
  // Keep the same array/object references when nothing meaningfully changed.
  // This prevents UI churn when note contains volatile values (mid, ts, etc.).
  const src = Array.isArray(list) ? list : [];
  const idx = src.findIndex((x) => x?.key === item.key);

  // New item
  if (idx < 0) return [...src, item];

  const prev = src[idx];
  if (!prev) {
    const out = [...src];
    out[idx] = item;
    return out;
  }

  // If ok didn't change, preserve previous note unless the new note is intentionally different.
  // Also preserve the previous object reference when fully unchanged.
  const nextOk = item.ok;
  const prevOk = prev.ok;

  // Prefer stable note to avoid continuous updates when ok is unchanged.
  const nextNote =
    prevOk === nextOk
      ? (prev.note ?? item.note) // keep old note if present
      : item.note;               // ok changed => allow note change

  const prevNote = prev.note;

  const okUnchanged = prevOk === nextOk;
  const noteUnchanged = (prevNote ?? "") === (nextNote ?? "");

  // Nothing changed => return original list for referential stability
  if (okUnchanged && noteUnchanged) return src;

  // Something changed => copy minimal
  const out = [...src];
  out[idx] = noteUnchanged ? { ...prev, ok: nextOk } : { ...prev, ok: nextOk, note: nextNote };
  return out;
}


function parseBreakLevelFromChecklist(setup: any): number | undefined {
  const items = setup?.entry?.trigger?.checklist;
  if (!Array.isArray(items)) return undefined;

  const parseFromNote = (noteRaw: unknown): number | undefined => {
    const note = String(noteRaw ?? "");
    // engine note format: "... @ 1234.56"
    const m = note.match(/@\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!m) return undefined;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : undefined;
  };

  // 1) Prefer explicit "level" key (engine: { key: "level", note: `Break ... @ ${level}` })
  for (const it of items) {
    if (String(it?.key ?? "") !== "level") continue;
    const v = parseFromNote(it?.note);
    if (v != null) return v;
  }

  // 2) Fallback to "bos" key (engine: { key: "bos", note: `BOS ... @ ${level} (15m)` })
  for (const it of items) {
    if (String(it?.key ?? "") !== "bos") continue;
    const v = parseFromNote(it?.note);
    if (v != null) return v;
  }

  // 3) Last resort: scan all notes (kept for backward compatibility)
  for (const it of items) {
    const v = parseFromNote(it?.note);
    if (v != null) return v;
  }

  return undefined;
}

function parseLevelFromChecklistKey(setup: any, key: string): number | undefined {
  const items = setup?.entry?.trigger?.checklist;
  if (!Array.isArray(items)) return undefined;

  for (const it of items) {
    if (String(it?.key ?? "") !== key) continue;
    const note = String(it?.note ?? "");
    const m = note.match(/@\s*([0-9]+(?:\.[0-9]+)?)/);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

function candleTouchesZone(c: Candle, z?: { lo: number; hi: number }): boolean {
  if (!c || !z || typeof z.lo !== "number" || typeof z.hi !== "number") return false;
  // overlap between candle range and zone
  return c.l <= z.hi && c.h >= z.lo;
}
// ---- Stable touch helpers (prevents oscillation when zone shifts slightly due to float/rounding) ----
function normalizeZone(z: { lo: number; hi: number }) {
  const lo = Number(z.lo);
  const hi = Number(z.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  // Round to reduce float jitter; 6 decimals is safe for crypto prices
  return { lo: Number(a.toFixed(6)), hi: Number(b.toFixed(6)) };
}

function midInZoneStable(
  mid: number,
  zone: { lo: number; hi: number },
  wasTouched: boolean,
  hysteresisBps: number = 2, // 2 bps hysteresis prevents flip-flop near edges
) {
  if (!Number.isFinite(mid) || mid <= 0) return false;
  const z = normalizeZone(zone);
  if (!z) return false;

  if (!wasTouched) {
    // Strict when not touched yet
    return mid >= z.lo && mid <= z.hi;
  }

  // When already touched, apply hysteresis band to avoid rapid toggling
  const buf = (mid * hysteresisBps) / 10000;
  return mid >= z.lo - buf && mid <= z.hi + buf;
}

function getEffectiveTouchZone(setup: any, trg: any) {
  const locked = (trg as any)?._touch_zone;
  const z0 = setup?.entry?.zone;
  const z =
    locked && typeof locked.lo === "number" && typeof locked.hi === "number"
      ? locked
      : (z0 && typeof z0.lo === "number" && typeof z0.hi === "number" ? z0 : undefined);

  return z ? normalizeZone(z) : undefined;
}
// ---- Tier monotonicity helpers ----
// We enforce a simple monotonic order so that tier cannot downgrade due to transient conditions.
// APPROACHING < TOUCHED < CONFIRMED
function normalizeTier(t: unknown): "APPROACHING" | "TOUCHED" | "CONFIRMED" {
  const s = String(t ?? "").toUpperCase();
  if (s === "CONFIRMED") return "CONFIRMED";
  if (s === "TOUCHED") return "TOUCHED";
  return "APPROACHING";
}

function maxTier(a: unknown, b: unknown, confirmedFlag?: boolean): "APPROACHING" | "TOUCHED" | "CONFIRMED" {
  if (confirmedFlag) return "CONFIRMED";
  const ta = normalizeTier(a);
  const tb = normalizeTier(b);
  if (ta === "CONFIRMED" || tb === "CONFIRMED") return "CONFIRMED";
  if (ta === "TOUCHED" || tb === "TOUCHED") return "TOUCHED";
  return "APPROACHING";
}

function mergeTier(
  prevTier: unknown,
  candidateTier: unknown,
  confirmedFlag?: boolean
): "APPROACHING" | "TOUCHED" | "CONFIRMED" {
  return maxTier(prevTier, candidateTier, confirmedFlag);
}

function candleCloseStrengthPct(c: Candle, side: "LONG" | "SHORT") {
  const range = Math.max(1e-9, c.h - c.l);
  if (side === "LONG") return (c.c - c.l) / range; // 1.0 close at high
  return (c.h - c.c) / range; // 1.0 close at low
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function getChecklistOk(setup: any, key: string): boolean {
  const items = setup?.entry?.trigger?.checklist;
  if (!Array.isArray(items)) return false;
  const it = items.find((x: any) => x?.key === key);
  return Boolean(it?.ok);
}

function bpsDistanceToZone(mid: number, zone?: { lo: number; hi: number }) {
  if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number" || mid <= 0) return 9999;
  if (mid >= zone.lo && mid <= zone.hi) return 0;
  const d = Math.min(Math.abs(mid - zone.lo), Math.abs(mid - zone.hi));
  return (d / mid) * 10000;
}

function bpsDistanceToLevel(mid: number, level?: number) {
  if (!Number.isFinite(mid) || !Number.isFinite(level) || mid <= 0 || (level as number) <= 0) return 9999;
  return (Math.abs(mid - (level as number)) / (level as number)) * 10000;
}

/**
 * Task 5.2 — Priority Score
 * - IMPORTANT: This function sorts setups for display.
 * - We keep preferred_id for backward compatibility, but UI should ignore it.
 */
function applyPriorityScore(out: any, snap: any, features: any): any {
  if (!out || !Array.isArray(out.setups)) return out;

  const mid = snap?.price?.mid;
  const now = Date.now();

  const dqGrade = String(features?.quality?.dq_grade ?? "");
  const dqBoost = dqGrade === "A" ? 8 : dqGrade === "B" ? 4 : -25;

  const withScore = out.setups.map((s: any) => {
    if (!s) return s;

    const conf = Number(s?.confidence?.score ?? 0);
    const status = String(s?.status ?? "");

    // Distance score (dominant)
    let distBps = 9999;
    if (Number.isFinite(mid)) {
      if (s.type === "BREAKOUT") {
        // If breakout has explicit retest zone, use it; else fallback to break level parsed from checklist.
        const z = s?.entry?.zone;
        if (z && typeof z.lo === "number" && typeof z.hi === "number") {
          distBps = bpsDistanceToZone(mid, z);
        } else {
          const brk = parseBreakLevelFromChecklist(s);
          distBps = bpsDistanceToLevel(mid, brk);
        }
      } else {
        distBps = bpsDistanceToZone(mid, s?.entry?.zone);
      }
    }

    const distScore = clamp(55 - distBps * 2.0, 0, 55);

    const statusScore = status === "READY" ? 18 : status === "FORMING" ? 8 : 0;

    const preOk = getChecklistOk(s, "pre_trigger");
    const preScore = preOk ? 15 : 0;

    let expiryPenalty = 0;
    if (typeof s.expires_ts === "number") {
      const minsLeft = (s.expires_ts - now) / 60000;
      if (minsLeft <= 0) expiryPenalty = 30;
      else if (minsLeft < 10) expiryPenalty = 18;
      else if (minsLeft < 20) expiryPenalty = 10;
    }

    const confScore = clamp(conf * 0.2, 0, 20);

    let score = distScore + statusScore + preScore + dqBoost + confScore - expiryPenalty;
    score = clamp(Math.round(score), 0, 100);

    const reasons: string[] = [];
    if (Number.isFinite(mid)) reasons.push(`dist=${distBps.toFixed(1)}bps`);
    else reasons.push("no-mid");
    if (preOk) reasons.push("pre_trigger");
    if (dqBoost < 0) reasons.push(`dq=${dqGrade}`);
    if (expiryPenalty > 0) reasons.push("near-expiry");

    return {
      ...s,
      priority_score: score,
      priority_reasons: reasons.slice(0, 4),
    };
  });

  const sorted = [...withScore].sort((a: any, b: any) => {
    const pa = Number(a?.priority_score ?? 0);
    const pb = Number(b?.priority_score ?? 0);
    if (pb !== pa) return pb - pa;

    const ca = Number(a?.confidence?.score ?? 0);
    const cb = Number(b?.confidence?.score ?? 0);
    return cb - ca;
  });

  // Keep a value for compatibility, but DO NOT use it to auto-select in UI.
  const preferredCompat = sorted.find((s: any) => s?.status === "READY")?.id ?? sorted[0]?.id;

  return {
    ...out,
    preferred_id: preferredCompat,
    setups: sorted,
  };
}

/**
 * 3.3b PRE-TRIGGER (intrabar) using snap.price.mid (orderbook-derived)
 * - Does NOT change status to TRIGGERED.
 */
function applyPreTrigger(out: any, snap: any): any {
  if (!out || !Array.isArray(out.setups) || !snap?.price?.mid) return out;

  const mid = snap.price.mid as number;
  // Use a single timestamp per evaluation cycle to avoid churn from multiple Date.now() calls
  // and to make touched_ts stable within the same snapshot processing pass.
  const tnow = Date.now();


  const updated = out.setups.map((s: any) => {
    if (!s || s.status !== "READY") return s;

    const trg = s.entry?.trigger;
    if (!trg) return s;

    let checklist = Array.isArray(trg.checklist) ? trg.checklist : [];
    let summary = String(trg.summary ?? "");

    if (s.type === "BREAKOUT") {
      const z = s?.entry?.zone;
      const brk = parseBreakLevelFromChecklist(s);

      // If we have a retest zone, use in-zone as “retest ok”
      if (z && typeof z.lo === "number" && typeof z.hi === "number") {
        const wasTouched = String((trg as any)?.tier ?? "") === "TOUCHED";
        const zEff = getEffectiveTouchZone(s, trg) ?? normalizeZone(z)!;
        const inZone = midInZoneStable(mid, zEff, wasTouched || Boolean((trg as any)?._touch_zone));

        checklist = upsertChecklist(checklist, {
          key: "retest",
          ok: inZone,
          note:
            `mid=${mid.toFixed(2)} | zone=[${zEff.lo.toFixed(2)}, ${zEff.hi.toFixed(2)}]` +
            (brk ? ` | lvl=${brk.toFixed(2)}` : ""),
        });

        checklist = upsertChecklist(checklist, {
          key: "pre_trigger",
          ok: inZone,
          note: `mid=${mid.toFixed(2)} | zone=[${zEff.lo.toFixed(2)}, ${zEff.hi.toFixed(2)}]`,
        });

        if (inZone) summary = "PRE-TRIGGER: price is retesting BOS level (await close-confirm breakout)";

        const prevTier = String((trg as any)?.tier ?? "");
        const candTier = inZone ? "TOUCHED" : (prevTier || "APPROACHING");
        const nextTier = mergeTier(prevTier, candTier, (trg as any)?.confirmed === true);

        return {
          ...s,
          entry: {
            ...s.entry,
            trigger: {
              ...trg,
              checklist,
              summary,
              tier: nextTier,
              touched_ts: inZone ? (Number((trg as any)?.touched_ts) || tnow) : (trg as any)?.touched_ts,
              _touch_zone: (trg as any)?._touch_zone ?? (inZone ? zEff : undefined),
            },
          },
        };

      }

      // Legacy fallback (no zone): “testing level” tight band
      if (!brk) return s;

      const distBps = ((mid - brk) / brk) * 10000;
      const ok = s.side === "LONG" ? distBps >= -5 : distBps <= 5;

      checklist = upsertChecklist(checklist, {
        key: "pre_trigger",
        ok,
        note: `mid=${mid.toFixed(2)} | brk=${brk.toFixed(2)} | dist=${distBps.toFixed(1)}bps`,
      });

      if (ok) summary = "PRE-TRIGGER: price is testing breakout level (await close-confirm)";

      const prevTier = String((trg as any)?.tier ?? "");
      const candTier = ok ? "TOUCHED" : (prevTier || "APPROACHING");
      const nextTier = mergeTier(prevTier, candTier, (trg as any)?.confirmed === true);

      return {
        ...s,
        entry: {
          ...s.entry,
          trigger: {
            ...trg,
            checklist,
            summary,
            tier: nextTier,
            touched_ts: ok ? (Number((trg as any)?.touched_ts) || tnow) : (trg as any)?.touched_ts,
          },
        },
      };

    }
    if (
      s.type === "LIQUIDITY_SWEEP_REVERSAL" ||
      s.type === "FAILED_SWEEP_CONTINUATION" ||
      s.type === "SCALP_LIQUIDITY_SNAPBACK"
    ) {
      const zone = s?.entry?.zone;
      if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number") return s;
      const wasTouched = String((trg as any)?.tier ?? "") === "TOUCHED";
      const zEff = getEffectiveTouchZone(s, trg) ?? normalizeZone(zone)!;
      const inZone = midInZoneStable(mid, zEff, wasTouched || Boolean((trg as any)?._touch_zone));

      // Keep checklist keys aligned with engine (retest + close_confirm)
      checklist = upsertChecklist(checklist, {
        key: "retest",
        ok: inZone,
        note: `mid=${mid.toFixed(2)} | zone=[${zEff.lo.toFixed(2)}, ${zEff.hi.toFixed(2)}]`,
      });

      checklist = upsertChecklist(checklist, {
        key: "pre_trigger",
        ok: inZone,
        note: `mid=${mid.toFixed(2)} | zone=[${zEff.lo.toFixed(2)}, ${zEff.hi.toFixed(2)}]`,
      });

      if (inZone) summary = "PRE-TRIGGER: price is in retest zone (await close-confirm)";

      const prevTier = String((trg as any)?.tier ?? "");
      const candTier = inZone ? "TOUCHED" : (prevTier || "APPROACHING");
      const nextTier = mergeTier(prevTier, candTier, (trg as any)?.confirmed === true);


      return {
        ...s,
        entry: {
          ...s.entry,
          trigger: {
            ...trg,
            checklist,
            summary,
            tier: nextTier,
            touched_ts: inZone ? (Number((trg as any)?.touched_ts) || tnow) : (trg as any)?.touched_ts,
            _touch_zone: (trg as any)?._touch_zone ?? (inZone ? zEff : undefined),
          },
        },
      };
    }

    if (
      s.type === "RANGE_MEAN_REVERT" ||
      s.type === "TREND_PULLBACK" ||
      s.type === "SCALP_RANGE_FADE" ||
      s.type === "SCALP_MOMENTUM_PULLBACK" ||
      s.type === "SCALP_1H_REACTION"
    ) {
      const zone = s?.entry?.zone;
      if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number") return s;
      const wasTouched = String((trg as any)?.tier ?? "") === "TOUCHED";
      const zEff = getEffectiveTouchZone(s, trg) ?? normalizeZone(zone)!;
      const inZone = midInZoneStable(mid, zEff, wasTouched || Boolean((trg as any)?._touch_zone));

      checklist = upsertChecklist(checklist, {
        key: "pre_trigger",
        ok: inZone,
        note: `mid=${mid.toFixed(2)} | zone=[${zEff.lo.toFixed(2)}, ${zEff.hi.toFixed(2)}]`,
      });

      if (inZone) summary = "PRE-TRIGGER: price is inside entry zone (await close-confirm)";
      const prevTier = String((trg as any)?.tier ?? "");
      const candTier = inZone ? "TOUCHED" : (prevTier || "APPROACHING");
      const nextTier = mergeTier(prevTier, candTier, (trg as any)?.confirmed === true);

      return {
        ...s,
        entry: {
          ...s.entry,
          trigger: {
            ...trg,
            checklist,
            summary,
            tier: nextTier,
            touched_ts: inZone ? (Number((trg as any)?.touched_ts) || tnow) : (trg as any)?.touched_ts,
            _touch_zone: (trg as any)?._touch_zone ?? (inZone ? zEff : undefined),
          },
        },
      };

    }

    return {
      ...s,
      entry: {
        ...s.entry,
        trigger: {
          ...trg,
          checklist,
          summary,
        },
      },
    };
  });

  return { ...out, setups: updated };
}

/**
 * 3.3a CLOSE-CONFIRM trigger evaluation
 */
function hydrateCloseConfirmRuntime(out: any, cache: Map<string, any>): any {
  if (!out || !Array.isArray(out.setups)) return out;

  const setups = out.setups.map((s: any) => {
    const key = String(s?.canon ?? s?.id ?? "");
    if (!key) return s;

    // Only hydrate when READY and not confirmed
    if (s?.status !== "READY") return s;

    const trg0 = s?.entry?.trigger;
    if (!trg0 || typeof trg0 !== "object") return s;
    if ((trg0 as any).confirmed === true) return s;

    // If runtime already present, do not override
    const hasBase = typeof (trg0 as any)._cc_base_ts === "number" && Number.isFinite((trg0 as any)._cc_base_ts);
    if (hasBase) return s;

    const cached = cache.get(key);
    if (!cached) return s;

    const trg = { ...(trg0 as any) };
    if (typeof cached.baseTs === "number" && Number.isFinite(cached.baseTs)) trg._cc_base_ts = cached.baseTs;
    if (typeof cached.nextCloseTs === "number" && Number.isFinite(cached.nextCloseTs)) trg._cc_next_close_ts = cached.nextCloseTs;
    if (typeof cached.tf === "string" && cached.tf) trg._cc_tf = cached.tf;

    return { ...s, entry: { ...s.entry, trigger: trg } };
  });

  return { ...out, setups };
}

function persistCloseConfirmRuntime(out: any, cache: Map<string, any>, nowTs: number): void {
  if (!out || !Array.isArray(out.setups)) return;

  // Update cache per setup
  for (const s of out.setups) {
    const key = String(s?.canon ?? s?.id ?? "");
    if (!key) continue;

    const trg = s?.entry?.trigger;
    const confirmed = (trg as any)?.confirmed === true;

    // Keep cache only while READY and not confirmed
    if (s?.status === "READY" && !confirmed && trg && typeof trg === "object") {
      const baseTs = (trg as any)._cc_base_ts;
      const nextCloseTs = (trg as any)._cc_next_close_ts;
      const tf = (trg as any)._cc_tf;

      cache.set(key, {
        baseTs: (typeof baseTs === "number" && Number.isFinite(baseTs)) ? baseTs : undefined,
        nextCloseTs: (typeof nextCloseTs === "number" && Number.isFinite(nextCloseTs)) ? nextCloseTs : undefined,
        tf: (typeof tf === "string" && tf) ? tf : undefined,
        lastSeenTs: nowTs,
      });
    } else {
      cache.delete(key);
    }
  }

  // Prune old keys (avoid unbounded growth)
  // Keep last 30 minutes of entries.
  const cutoff = nowTs - 30 * 60 * 1000;
  for (const [k, v] of cache.entries()) {
    if (!v || typeof v.lastSeenTs !== "number" || v.lastSeenTs < cutoff) cache.delete(k);
  }
}

function applyCloseConfirm(out: any, snap: any): any {
  if (!out || !Array.isArray(out.setups) || !snap) return out;

  // Precompute last confirmed candle per timeframe once per evaluation.
  // This allows per-setup trigger_tf evaluation without repeatedly scanning arrays.
  const lastByTf: Record<string, Candle | undefined> = {};
  const tfs: string[] = Array.isArray(snap?.timeframes)
    ? snap.timeframes.map((x: any) => String(x?.tf ?? "")).filter((x: string) => x)
    : [];

  for (const tf of tfs) {
    const candles = getTimeframeCandles(snap, tf);
    const last = lastConfirmedCandle(candles);
    if (last) lastByTf[tf] = last;
  }

  const tnow = Date.now();

  const updated = out.setups.map((s: any) => {
    if (!s) return s;

    // Per-setup trigger timeframe selection (MUST respect engine trigger_tf).
    const tfSel = pickTriggerTfForSetupRuntime(snap, s, lastByTf, tnow);
    const tf = tfSel.tf;
    const last = tf ? lastByTf[tf] : undefined;


    // ---------- Expiry ----------
    if (typeof s.expires_ts === "number" && tnow > s.expires_ts) {
      return { ...s, status: "EXPIRED" };
    }

    // ---------- Ensure trigger object + checklist ----------
    const trg0 = s?.entry?.trigger ?? { confirmed: false, checklist: [], summary: "" };

    /**
     * IMPORTANT:
     * Reset close-confirm baseline when setup is NOT READY.
     * Otherwise a stale _cc_base_ts from a previous READY cycle can cause false early "close_confirm" pass.
     */
    let trg = trg0 as any;

    // IMPORTANT:
    // Reset runtime-only fields when setup is NOT READY to prevent stale state carry-over
    // across READY cycles (prevents false close_confirm and touch oscillation due to zone rebuilds).
    if (s.status !== "READY") {
      const hasRuntime =
        typeof (trg as any)?._cc_base_ts === "number" ||
        typeof (trg as any)?._cc_next_close_ts === "number" ||
        typeof (trg as any)?._cc_tf === "string" ||
        ((trg as any)?._touch_zone && typeof (trg as any)?._touch_zone === "object");

      if (hasRuntime) {
        trg = { ...(trg as any) };
        delete (trg as any)._cc_base_ts;
        delete (trg as any)._cc_next_close_ts;
        delete (trg as any)._cc_tf;
        delete (trg as any)._touch_zone;
      }
    }

    const checklist0 = Array.isArray((trg as any)?.checklist) ? (trg as any).checklist : [];
    // Use one checklist variable for the entire function scope (prevents TS "cannot find name checklist")
    let checklistNow = checklist0;

    /**
     * close_confirm policy (fully deterministic, no guessing):
     * - When a setup is READY and not confirmed, we require one NEW confirmed candle close
     *   on the setup's trigger timeframe (setup.trigger_tf).
     * - We store a baseline candle timestamp the first time we see READY (per setup) and then wait
     *   for a newer confirmed candle.
     *
     * Stored in: entry.trigger._cc_base_ts (internal runtime field; TS allows extra fields).
     */
    const baseTs: number | undefined =
      typeof (trg as any)?._cc_base_ts === "number" && Number.isFinite((trg as any)._cc_base_ts)
        ? (trg as any)._cc_base_ts
        : undefined;


    // HARD FIX: if trigger TF candles are stale, do NOT set/keep baseline and do NOT "wait next close" forever.
    if (s.status === "READY" && (trg as any)?.confirmed !== true && tfSel.stale) {
      // remove any previously stored baseline to prevent sticky lock
      const trgNext = { ...(trg as any) };
      delete trgNext._cc_base_ts;
      delete trgNext._cc_next_close_ts;
      delete trgNext._cc_tf;
      if (trgNext.tier !== "CONFIRMED") trgNext.tier = String(trgNext.tier ?? "") || "APPROACHING";

      checklistNow = upsertChecklist(checklistNow, {
        key: "tf_candles_stale",
        ok: false,
        note: `Trigger TF candles stale (tf=${tf ?? "unknown"}; ${tfSel.staleReason ?? "no reason"})`,
      });

      checklistNow = upsertChecklist(checklistNow, {
        key: "close_confirm",
        ok: false,
        note: `Blocked: trigger TF candles stale (tf=${tf ?? "unknown"})`,
      });

      return {
        ...s,
        entry: { ...s.entry, trigger: { ...trgNext, checklist: checklistNow } },
      };
    }
    // If we don't even have confirmed candles for that tf, we must block on close_confirm,
    // but ONLY when the setup is READY and not yet confirmed.
    if (s.status === "READY" && trg?.confirmed !== true && !last) {
      checklistNow = upsertChecklist(checklistNow, {
        key: "close_confirm",
        ok: false,
        note: `Missing confirmed candle for tf=${tf || "(none)"}`,
      });

      return {
        ...s,
        entry: {
          ...s.entry,
          trigger: { ...trg, checklist: checklistNow },
        },
      };
    }
    // From here, last exists (confirmed candle) when tf is valid.
    const lastTs = last?.ts;

    // When setup first becomes READY, set baseline and require the NEXT confirmed candle.
    // This prevents triggering off a candle that closed before the setup was READY..
    if (s.status === "READY" && trg?.confirmed !== true && baseTs == null) {
      const tfMs = tfToMs(tf);

      let nextCloseTs: number | undefined =
        typeof lastTs === "number" && typeof tfMs === "number"
          ? lastTs + tfMs
          : undefined;

      // IMPORTANT FIX: ensure nextCloseTs is strictly in the future
      if (typeof nextCloseTs === "number") {
        while (nextCloseTs <= tnow) {
          nextCloseTs += tfMs!;
        }
      }

      const remainingSec =
        typeof nextCloseTs === "number"
          ? Math.max(0, Math.ceil((nextCloseTs - tnow) / 1000))
          : undefined;
      const remainingMMSS = formatRemainingMMSS(remainingSec);

      checklistNow = upsertChecklist(checklistNow, {
        key: "close_confirm",
        ok: false,
        note: `Waiting next ${tf} close at ${nextCloseTs ? new Date(nextCloseTs).toLocaleTimeString() : "?"
          } (${remainingMMSS ?? "countdown unavailable"} remaining)`,
      });

      return {
        ...s,
        entry: {
          ...s.entry,
          trigger: {
            ...trg,
            checklist: checklistNow,
            _cc_base_ts: lastTs,
            _cc_next_close_ts: typeof nextCloseTs === "number" ? nextCloseTs : undefined,
            _cc_tf: (tf === "5m" || tf === "15m") ? tf : undefined,
            tier: String((trg as any)?.tier ?? "") || "APPROACHING",
          },
        },
      };
    }


    // If baseline exists, require a NEW candle close (ts advanced).
    let closeOk = true;
    if (s.status === "READY" && trg?.confirmed !== true && baseTs != null) {
      closeOk = typeof lastTs === "number" && lastTs > baseTs;
    }
    let nextCloseTs2: number | undefined = undefined;
    if (s.status === "READY" && trg?.confirmed !== true && closeOk === false) {
      const tfMs = tfToMs(tf);
      if (typeof lastTs === "number" && typeof tfMs === "number") {
        nextCloseTs2 = lastTs + tfMs;
        while (nextCloseTs2 <= tnow) nextCloseTs2 += tfMs;
      }
    }
    // Upsert close_confirm checklist so ExecutionDecision can gate WAIT_CLOSE.
    checklistNow = upsertChecklist(checklistNow, {
      key: "close_confirm",
      ok: closeOk,
      note: closeOk
        ? `New confirmed candle close ts=${lastTs} > base=${baseTs} (tf=${tf})`
        : `Waiting next confirmed close (last ts=${lastTs}, base=${baseTs}, tf=${tf})`,
    });

    // If we are READY and still waiting for a new close, do not proceed to trigger/invalidate-on-close.
    if (s.status === "READY" && trg?.confirmed !== true && closeOk === false) {
      return {
        ...s,
        entry: {
          ...s.entry,
          trigger: {
            ...trg,
            checklist: checklistNow,
            _cc_next_close_ts: typeof nextCloseTs2 === "number" ? nextCloseTs2 : (trg as any)?._cc_next_close_ts,
            _cc_tf: (tf === "5m" || tf === "15m") ? tf : (trg as any)?._cc_tf,
            tier: String((trg as any)?.tier ?? "") || "APPROACHING",
          },
        },
      };
    }

    // ---------- Hard invalidation by stop on close-confirm candle ----------
    const stopPx = s?.stop?.price;
    if (typeof stopPx === "number" && last) {
      if (s.side === "LONG" && last.c <= stopPx) {
        return {
          ...s,
          status: "INVALIDATED",
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }
      if (s.side === "SHORT" && last.c >= stopPx) {
        return {
          ...s,
          status: "INVALIDATED",
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }
    }

    // ---------- Trigger (close-confirm) ----------
    // Helper: transition to TRIGGERED with consistent bookkeeping.
    const markTriggered = (setupX: any) => {
      const trgX = setupX?.entry?.trigger ?? trg;
      const checklistX0 = Array.isArray(trgX?.checklist) ? trgX.checklist : checklistNow;

      const checklistX = upsertChecklist(checklistX0, {
        key: "close_confirm",
        ok: true,
        note: `Triggered on close-confirm (${tf}) @ ts=${lastTs}`,
      });

      return {
        ...setupX,
        status: "TRIGGERED",
        entry: {
          ...setupX.entry,
          trigger: {
            ...trgX,
            confirmed: true,
            checklist: checklistX,
            _cc_base_ts: lastTs, // advance baseline
            _cc_next_close_ts: undefined,
            _cc_tf: (tf === "5m" || tf === "15m") ? tf : (trgX as any)?._cc_tf,
            tier: "CONFIRMED",
            confirmed_ts: typeof lastTs === "number" ? lastTs : Date.now(),
          },
        },
      };
    };

    // BREAKOUT trigger logic (existing behavior, but now strictly per-setup tf and close-confirm gated)
    if (s.status === "READY" && s.type === "BREAKOUT" && trg?.confirmed !== true && last) {
      const brk = parseBreakLevelFromChecklist(s);
      if (!brk) {
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      const strength = candleCloseStrengthPct(last, s.side);

      // If breakout has a retest zone, require “touch retest + close beyond level”
      const z0 = s?.entry?.zone;
      const z = getEffectiveTouchZone(s, trg) ?? z0;
      if (z && typeof z.lo === "number" && typeof z.hi === "number") {
        const buffer = brk * 0.0008; // 8 bps buffer after reclaim/break
        const passStrength = strength >= 0.7;

        if (s.side === "LONG") {
          // Require actual candle-range overlap with the retest zone (not just "low <= zone.hi")
          const touched = candleTouchesZone(last, z);
          const reclaimed = last.c > brk + buffer && passStrength;
          if (touched && reclaimed)
            return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
        } else {
          // Require actual candle-range overlap with the retest zone (not just "high >= zone.lo")
          const touched = candleTouchesZone(last, z);
          const broke = last.c < brk - buffer && passStrength;
          if (touched && broke)
            return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
        }

        // Not triggered yet; just persist bookkeeping.
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      // If no zone is present, use simple strength-based close beyond level.
      const passStrength = strength >= 0.7;
      if (s.side === "LONG") {
        if (last.c > brk && passStrength)
          return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
      } else {
        if (last.c < brk && passStrength)
          return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
      }

      return {
        ...s,
        entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
      };
    }
    // TREND_PULLBACK / RANGE_MEAN_REVERT / SCALP_MOMENTUM_PULLBACK / SCALP_1H_REACTION
    // trigger logic (zone touch + reclaim/reject on close-confirm)
    if (
      s.status === "READY" &&
      (
        s.type === "TREND_PULLBACK" ||
        s.type === "RANGE_MEAN_REVERT" ||
        s.type === "SCALP_MOMENTUM_PULLBACK" ||
        s.type === "SCALP_1H_REACTION"
      ) &&
      trg?.confirmed !== true &&
      last
    ) {
      const z0 = s?.entry?.zone;
      const z = getEffectiveTouchZone(s, trg) ?? z0;
      if (!z || typeof z.lo !== "number" || typeof z.hi !== "number") {
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      const strength = candleCloseStrengthPct(last, s.side);
      const passStrength = strength >= 0.7;
      const touched = candleTouchesZone(last, z);

      const bufRef = s.side === "LONG" ? z.hi : z.lo;
      const buffer = bufRef * 0.0008; // 8 bps buffer

      // For reaction-type setups we require a directional rejection away from the level.
      // For zone-type pullbacks we require reclaim beyond the zone boundary.
      const isReaction = s.type === "SCALP_1H_REACTION";
      const reclaimed = isReaction
        ? (s.side === "LONG" ? (last.c > z.hi + buffer) : (last.c < z.lo - buffer))
        : (s.side === "LONG" ? (last.c > z.hi + buffer) : (last.c < z.lo - buffer));

      // Keep checklist aligned with runtime gate keys
      checklistNow = upsertChecklist(checklistNow, {
        key: "pre_trigger",
        ok: touched,
        note: `candleTouch=${touched} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}]`,
      });

      if (touched && reclaimed && passStrength) {
        return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
      }

      return {
        ...s,
        entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
      };
    }

    // SCALP_RANGE_FADE trigger logic
    // - Requires: zone touch + close-confirm re-entry back inside the swing range.
    // - Uses checklist keys: range_hi / range_lo (engine writes "@ <price>")
    if (s.status === "READY" && s.type === "SCALP_RANGE_FADE" && trg?.confirmed !== true && last) {
      const z0 = s?.entry?.zone;
      const z = getEffectiveTouchZone(s, trg) ?? z0;
      if (!z || typeof z.lo !== "number" || typeof z.hi !== "number") {
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      const hi = parseLevelFromChecklistKey(s, "range_hi");
      const lo = parseLevelFromChecklistKey(s, "range_lo");
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      const strength = candleCloseStrengthPct(last, s.side);
      const passStrength = strength >= 0.65;
      const touched = candleTouchesZone(last, z);

      // Re-entry definition: close back inside [lo..hi] with a small buffer.
      const buf = (s.side === "LONG" ? Number(lo) : Number(hi)) * 0.0008; // 8 bps
      const inside = last.c >= Number(lo) + buf && last.c <= Number(hi) - buf;

      checklistNow = upsertChecklist(checklistNow, {
        key: "pre_trigger",
        ok: touched,
        note: `candleTouch=${touched} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}] | range=[${Number(lo).toFixed(2)}, ${Number(hi).toFixed(2)}]`,
      });

      if (touched && inside && passStrength) {
        return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
      }

      return {
        ...s,
        entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
      };
    }

    // LIQUIDITY_SWEEP_REVERSAL / SCALP_LIQUIDITY_SNAPBACK trigger logic
    // - Requires: retest zone touch + close-confirm reclaim of swept level
    if (
      s.status === "READY" &&
      (s.type === "LIQUIDITY_SWEEP_REVERSAL" || s.type === "SCALP_LIQUIDITY_SNAPBACK") &&
      trg?.confirmed !== true &&
      last
    ) {
      const level = parseLevelFromChecklistKey(s, "sweep");
      const z0 = s?.entry?.zone;
      const z = getEffectiveTouchZone(s, trg) ?? z0;

      if (!Number.isFinite(level) || !z || typeof z.lo !== "number" || typeof z.hi !== "number") {
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      const strength = candleCloseStrengthPct(last, s.side);
      const passStrength = strength >= 0.7;
      const touched = candleTouchesZone(last, z);

      checklistNow = upsertChecklist(checklistNow, {
        key: "retest",
        ok: touched,
        note: `candleTouch=${touched} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}] | lvl=${Number(level).toFixed(2)}`,
      });

      const buffer = Number(level) * 0.0008; // 8 bps buffer
      const reclaimed =
        s.side === "LONG" ? (last.c > Number(level) + buffer) : (last.c < Number(level) - buffer);

      if (touched && reclaimed && passStrength) {
        return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
      }

      return {
        ...s,
        entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
      };
    }

    // FAILED_SWEEP_CONTINUATION trigger logic
    // - Requires: retest zone touch + close-confirm continuation beyond BOS level
    if (s.status === "READY" && s.type === "FAILED_SWEEP_CONTINUATION" && trg?.confirmed !== true && last) {
      const level = parseLevelFromChecklistKey(s, "bos");
      const z0 = s?.entry?.zone;
      const z = getEffectiveTouchZone(s, trg) ?? z0;
      if (!Number.isFinite(level) || !z || typeof z.lo !== "number" || typeof z.hi !== "number") {
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
        };
      }

      const strength = candleCloseStrengthPct(last, s.side);
      const passStrength = strength >= 0.7;
      const touched = candleTouchesZone(last, z);

      checklistNow = upsertChecklist(checklistNow, {
        key: "retest",
        ok: touched,
        note: `candleTouch=${touched} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}] | lvl=${Number(level).toFixed(2)}`,
      });

      const buffer = Number(level) * 0.0008; // 8 bps buffer
      const continued =
        s.side === "LONG" ? (last.c > Number(level) + buffer) : (last.c < Number(level) - buffer);

      if (touched && continued && passStrength) {
        return markTriggered({ ...s, entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow } } });
      }

      return {
        ...s,
        entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs } },
      };
    }

    // Default: persist checklist/base
    return {
      ...s,
      entry: { ...s.entry, trigger: { ...trg, checklist: checklistNow, _cc_base_ts: lastTs ?? baseTs } },
    };
  });

  return { ...out, setups: updated };
}
// ---------- Shared time helpers (used by per-setup and global execution gating) ----------
function tfToMinutes(tf: unknown): number | undefined {
  const s = String(tf ?? "").trim().toLowerCase();
  const m = s.match(/^(\d+)(m|h|d)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = m[2];
  if (unit === "m") return n;
  if (unit === "h") return n * 60;
  if (unit === "d") return n * 60 * 24;
  return undefined;
}

function inferStaleLimitSecForEntryTf(entryTf: unknown): number {
  const entryTfMin = tfToMinutes(entryTf);
  // Default conservative (matches legacy behavior)
  if (entryTfMin == null) return 5;

  // Intraday entry TF => stricter stale gate
  if (entryTfMin <= 5) return 2;   // 1m/3m/5m
  if (entryTfMin <= 15) return 3;  // 10m/15m
  if (entryTfMin <= 60) return 5;  // 30m/1h
  return 8;                        // 4h+ (swing context)
}

function inferStaleLimitSecForSetup(setup: any): number {
  return inferStaleLimitSecForEntryTf(setup?.entry_tf);
}

function deriveExecutionDecision(
  setup: any,
  ctx: {
    mid: number;
    dqOk: boolean;
    bybitOk: boolean;
    staleSec?: number;
    paused: boolean;
  }
): ExecutionDecision {
  const blockers: string[] = [];
  const checklist = setup?.entry?.trigger?.checklist ?? [];
  const status = setup?.status;
  const mode = setup?.entry?.mode;



  // ---------- Quality gate: grade C/D are monitor-only ----------
  // Requirement from you: grade C must never allow canEnterMarket.
  // We also treat grade D as monitor-only to prevent low-confidence execution.
  const grade = String(setup?.confidence?.grade ?? "").toUpperCase();
  const gradePlus = String(setup?.confidence?.grade_plus ?? "").toUpperCase(); // "A+"|"A"|"B"|"C"
  const gp = (gradePlus === "A+" || gradePlus === "A" || gradePlus === "B" || gradePlus === "C") ? gradePlus : "";

  // ---------- Quality gate: grade_plus C (or legacy grade C/D) are monitor-only ----------
  // Priority:
  // - If grade_plus is present: use it.
  // - Else: fall back to legacy grade.
  if (gp === "C" || (gp === "" && (grade === "C" || grade === "D"))) {
    const label = gp ? `grade_plus ${gp}` : `Confidence ${grade}`;
    return {
      state: "MONITOR",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: ["CONFIDENCE_MONITOR_ONLY"],
      reason: `${label}: monitor only`,
    };
  }

  // ---------- Global execution gates (machine-readable blockers) ----------
  const gateBlockers: string[] = [];
  if (!ctx.dqOk) gateBlockers.push("DQ_NOT_OK");
  if (!ctx.bybitOk) gateBlockers.push("BYBIT_FEED_NOT_OK");
  if (ctx.paused) gateBlockers.push("PAUSED");

  // ---------- Dynamic stale threshold (intraday stricter) ----------
  const staleLimitSec = inferStaleLimitSecForEntryTf(setup?.entry_tf);

  if (ctx.staleSec != null && ctx.staleSec > staleLimitSec) gateBlockers.push("STALE_PRICE_FEED");

  if (gateBlockers.length > 0) {
    const parts: string[] = [];
    if (!ctx.dqOk) parts.push("DQ not OK");
    if (!ctx.bybitOk) parts.push("Bybit feed not OK");
    if (ctx.paused) parts.push("Paused");
    if (ctx.staleSec != null && ctx.staleSec > staleLimitSec) parts.push(`Stale (${ctx.staleSec.toFixed(1)}s > ${staleLimitSec}s)`);

    return {
      state: "BLOCKED",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: gateBlockers,
      reason: parts.length ? `Execution gated: ${parts.join(" • ")}` : "Execution gated",
    };
  }

  // ---------- Dead setups ----------
  if (status === "INVALIDATED" || status === "EXPIRED") {
    return {
      state: "NO_TRADE",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: ["SETUP_DEAD"],
      reason: "Setup no longer valid",
    };
  }

  // ---------- Collect checklist blockers ----------
  for (const item of checklist) {
    if (item?.ok === false) blockers.push(item.key);
  }
  // HARD BLOCK: trigger TF candles stale => do not pretend we're "waiting next close"
  if (blockers.includes("tf_candles_stale")) {
    return {
      state: "BLOCKED",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: ["TF_CANDLES_STALE"],
      reason: "Trigger timeframe candles are stale (no new confirmed closes)",
    };
  }

  // ---------- FORMING ----------
  if (status === "FORMING") {
    return {
      state: blockers.includes("retest") ? "WAIT_RETEST" : "FORMING",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers,
      reason: "Setup forming",
    };
  }


  // ---------- READY ----------
  if (status === "READY") {
    if (blockers.includes("close_confirm")) {
      return {
        state: "WAIT_CLOSE",
        canEnterMarket: false,
        canPlaceLimit: false,
        blockers,
        reason: "Waiting candle close-confirm",
      };
    }

    if (mode === "LIMIT") {
      const z = setup?.entry?.zone;
      const inZone =
        z &&
        Number.isFinite(Number(z.lo)) &&
        Number.isFinite(Number(z.hi)) &&
        Number.isFinite(Number(ctx.mid)) &&
        ctx.mid >= Number(z.lo) &&
        ctx.mid <= Number(z.hi);

      if (!inZone) {
        return {
          state: "WAIT_ZONE",
          canEnterMarket: false,
          canPlaceLimit: false,
          blockers,
          reason: "Price not in entry zone",
        };
      }

      // Tier-based execution policy (logic-first; UI later can show tier explicitly)
      const grade2 = String(setup?.confidence?.grade ?? "").toUpperCase();
      const trg = setup?.entry?.trigger ?? {};
      const tier =
        String((trg as any)?.tier ?? "") ||
        ((trg as any)?.confirmed === true ? "CONFIRMED" : "");

      // If grade B: require CONFIRMED to place limit (more conservative)
      if ((gp === "B" || (gp === "" && grade2 === "B")) && tier !== "CONFIRMED") {
        return {
          state: "WAIT_CLOSE",
          canEnterMarket: false,
          canPlaceLimit: false,
          blockers: Array.isArray(blockers) ? Array.from(new Set([...blockers, "close_confirm"])) : ["close_confirm"],
          reason: "Grade B: require close-confirm before placing limit",
        };
      }

      // Grade A: allow placing limit when TOUCHED or CONFIRMED (faster, still controlled)
      // If tier is empty, fall back to existing close_confirm gating via checklist.
      return {
        state: "PLACE_LIMIT",
        canEnterMarket: false,
        canPlaceLimit: true,
        blockers,
        reason: tier === "TOUCHED" ? "Limit entry available (touched zone)" : "Limit entry available",
      };

    }

    // MARKET
    const trgM = setup?.entry?.trigger ?? {};
    const tierM =
      String((trgM as any)?.tier ?? "") ||
      ((trgM as any)?.confirmed === true ? "CONFIRMED" : "");

    // Conservative: only allow market entry on CONFIRMED tier
    if (tierM !== "CONFIRMED") {
      return {
        state: "WAIT_CLOSE",
        canEnterMarket: false,
        canPlaceLimit: false,
        blockers: Array.isArray(blockers) ? Array.from(new Set([...blockers, "close_confirm"])) : ["close_confirm"],
        reason: "Market entry requires close-confirm (CONFIRMED tier)",
      };
    }

    return {
      state: "ENTER_MARKET",
      canEnterMarket: true,
      canPlaceLimit: false,
      blockers,
      reason: "Market entry allowed (confirmed)",
    };

  }
  // ---------- TRIGGERED ----------
  if (status === "TRIGGERED") {
    if (mode === "LIMIT") {
      return {
        state: "WAIT_FILL",
        canEnterMarket: false,
        canPlaceLimit: false,
        blockers,
        reason: "Triggered, waiting limit fill",
      };
    }

    return {
      state: "ENTER_MARKET",
      canEnterMarket: true,
      canPlaceLimit: false,
      blockers,
      reason: "Trigger confirmed",
    };
  }

  // ---------- Fallback ----------
  return {
    state: "NO_TRADE",
    canEnterMarket: false,
    canPlaceLimit: false,
    blockers,
    reason: "No execution action",
  };
}
function buildDecisionNarrative(
  setup: any,
  decision: ExecutionDecision,
  ctx: { mid: number; dqOk: boolean; bybitOk: boolean; staleSec?: number; paused: boolean; },
): DecisionNarrative {
  const grade = String(setup?.confidence?.grade ?? "").toUpperCase();
  const mode = String(setup?.entry?.mode ?? "");
  const status = String(setup?.status ?? "");
  const trg = setup?.entry?.trigger ?? {};
  const tier = String((trg as any)?.tier ?? (trg as any)?.confirmed ? "CONFIRMED" : "") || "APPROACHING";

  const bullets: string[] = [];

  // Always include core blockers (bounded)
  const bl = Array.isArray(decision?.blockers) ? decision.blockers : [];
  for (const b of bl) {
    if (bullets.length >= 4) break;
    bullets.push(String(b));
  }

  // Helpful context bullets (bounded)
  const z = setup?.entry?.zone;
  if (mode === "LIMIT" && z && Number.isFinite(Number(z.lo)) && Number.isFinite(Number(z.hi))) {
    bullets.push(`zone=[${Number(z.lo).toFixed(2)}, ${Number(z.hi).toFixed(2)}]`);
  }
  const stopPx = setup?.stop?.price;
  if (Number.isFinite(Number(stopPx))) bullets.push(`SL=${Number(stopPx).toFixed(2)}`);

  const invalidationRule =
    Number.isFinite(Number(stopPx))
      ? (setup?.side === "LONG" ? `Invalid if mid <= ${Number(stopPx).toFixed(2)}` : `Invalid if mid >= ${Number(stopPx).toFixed(2)}`)
      : "Invalidation: n/a";

  const nextCloseTs = Number((trg as any)?._cc_next_close_ts);
  const tf = (String((trg as any)?._cc_tf ?? "") === "5m" || String((trg as any)?._cc_tf ?? "") === "15m")
    ? String((trg as any)?._cc_tf)
    : undefined;

  const mk = (code: DecisionCode, headline: string, next_action: string): DecisionNarrative => ({
    code,
    headline,
    bullets: bullets.slice(0, 5),
    next_action,
    timing: (tf || Number.isFinite(nextCloseTs)) ? { tf: tf as any, next_close_ts: Number.isFinite(nextCloseTs) ? nextCloseTs : undefined } : undefined,
    invalidation: { rule: invalidationRule },
  });

  // BLOCKED
  if (decision.state === "BLOCKED") {
    if (!ctx.dqOk) return mk("BLOCKED_DQ", "Blocked: data quality not OK", "Wait for DQ to recover (A/B).");
    if (!ctx.bybitOk) return mk("BLOCKED_BYBIT_DOWN", "Blocked: Bybit feed not OK", "Wait for Bybit feed to recover.");
    if (ctx.paused) return mk("BLOCKED_PAUSED", "Blocked: updates paused", "Resume updates to continue.");
    if (bl.includes("TF_CANDLES_STALE") || bl.includes("tf_candles_stale")) return mk("BLOCKED_TF_STALE", "Blocked: trigger timeframe candles stale", "Wait for a new confirmed candle close.");
    if (ctx.staleSec != null) return mk("BLOCKED_FEED_STALE", "Blocked: price feed stale", "Wait for live price feed to update.");
    return mk("BLOCKED_FEED_STALE", "Blocked: execution gated", "Resolve execution gates, then reassess.");
  }

  // MONITOR
  if (decision.state === "MONITOR") {
    if (grade === "C") return mk("NO_TRADE_GRADE_C", "Monitor only (Grade C)", "Wait for higher-quality setup (A/B).");
    if (grade === "D") return mk("NO_TRADE_GRADE_D", "Monitor only (Grade D)", "Avoid trading; wait for market to improve.");
    return mk("NO_TRADE_SETUP_NOT_READY", "Monitor only", "Observe; do not execute.");
  }

  // NO_TRADE
  if (decision.state === "NO_TRADE") {
    if (status === "EXPIRED") return mk("NO_TRADE_EXPIRED", "No trade: setup expired", "Wait for a new setup.");
    if (status === "INVALIDATED") return mk("NO_TRADE_INVALIDATED", "No trade: setup invalidated", "Wait for a new setup.");
    return mk("NO_TRADE_SETUP_NOT_READY", "No trade", "Wait for a valid setup.");
  }

  // WAIT states
  if (decision.state === "WAIT_CLOSE") {
    const ta = (tf && Number.isFinite(nextCloseTs))
      ? `Wait for ${tf} close-confirm (next close at ${new Date(nextCloseTs).toLocaleTimeString()}).`
      : "Wait for close-confirm.";
    return mk("WAIT_CLOSE_CONFIRM", `Waiting close-confirm (tier=${tier})`, ta);
  }
  if (decision.state === "WAIT_ZONE") {
    return mk("WAIT_PRICE_IN_ZONE", `Waiting price into entry zone (tier=${tier})`, "Wait for price to enter the zone, then place limit.");
  }
  if (decision.state === "WAIT_RETEST") {
    return mk("WAIT_RETEST", `Waiting retest (tier=${tier})`, "Wait for retest condition to be satisfied.");
  }

  // OK states
  if (decision.state === "PLACE_LIMIT") {
    return mk("OK_PLACE_LIMIT", `Place limit now (tier=${tier})`, "Place the limit order within the entry zone.");
  }
  if (decision.state === "ENTER_MARKET") {
    return mk("OK_ENTER_MARKET", `Enter market now (tier=${tier})`, "Enter at market per playbook.");
  }

  // Fallback
  return mk("NO_TRADE_SETUP_NOT_READY", `State: ${decision.state}`, "Follow the decision state.");
}

function deriveSetupTelemetry(setup: any, execution: ExecutionDecision | undefined): SetupTelemetry {
  const checklist = Array.isArray(setup?.entry?.trigger?.checklist)
    ? (setup.entry.trigger.checklist as Array<{ key?: unknown; ok?: unknown }>)
    : [];

  const keys = checklist
    .map((x) => String(x?.key ?? "").trim())
    .filter((k) => k.length > 0);

  // Stable unique keys (preserve checklist order, de-dupe)
  const seen = new Set<string>();
  const orderedKeys = keys.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const total = orderedKeys.length;

  const passed = new Set<string>();
  const blocked = new Set<string>();

  for (const item of checklist) {
    const key = String(item?.key ?? "").trim();
    if (!key) continue;
    if (item?.ok === true) passed.add(key);
    if (item?.ok === false) blocked.add(key);
  }

  // Keep stable ordering (checklist order), but de-duped.
  const passedTriggers = orderedKeys.filter((k) => passed.has(k) && !blocked.has(k));
  const triggerBlockers = orderedKeys.filter((k) => blocked.has(k));

  let progressPct = 0;
  if (total > 0) {
    progressPct = Math.round((passedTriggers.length / total) * 100);
  } else {
    const st = String(setup?.status ?? "");
    // If a setup is READY/TRIGGERED with no checklist, treat as complete.
    if (st === "READY" || st === "TRIGGERED") progressPct = 100;
  }

  const execBlockers = Array.isArray(execution?.blockers)
    ? (execution!.blockers as string[])
    : undefined;

  return {
    totalTriggers: total,
    passedTriggers,
    triggerBlockers,
    progressPct,
    executionState: execution?.state,
    executionBlockers: execBlockers,
  };
}
function withTemporalTelemetry(
  key: string,
  setupStatus: string,
  base: SetupTelemetry,
  nowTs: number,
  history: Map<
    string,
    {
      firstSeenTs: number;
      lastSeenTs: number;
      lastProgressPct: number;
      lastChangeTs: number;
      lastStatus: string;
    }
  >
): SetupTelemetry {
  if (!key) return base;

  const prev = history.get(key);
  const progressPct = Number.isFinite(base?.progressPct) ? Number(base.progressPct) : 0;

  if (!prev) {
    const init = {
      firstSeenTs: nowTs,
      lastSeenTs: nowTs,
      lastProgressPct: progressPct,
      lastChangeTs: nowTs,
      lastStatus: String(setupStatus ?? ""),
    };
    history.set(key, init);

    return {
      ...base,
      firstSeenTs: init.firstSeenTs,
      lastSeenTs: init.lastSeenTs,
      ageMs: 0,
      lastProgressPct: init.lastProgressPct,
      progressDeltaPct: 0,
      lastChangeTs: init.lastChangeTs,
      stalledMs: String(setupStatus ?? "") === "FORMING" ? 0 : 0,
    };
  }

  const nextLastSeen = nowTs;

  const statusNow = String(setupStatus ?? "");
  const statusPrev = String(prev.lastStatus ?? "");

  const progressPrev = Number.isFinite(prev.lastProgressPct) ? prev.lastProgressPct : progressPct;
  const progressDeltaPct = progressPct - progressPrev;

  // Define "change" as: status changed OR progress changed (integer pct)
  const progressChanged = Math.round(progressPct) !== Math.round(progressPrev);
  const statusChanged = statusNow !== statusPrev;

  const lastChangeTs = (progressChanged || statusChanged) ? nowTs : prev.lastChangeTs;

  const ageMs = Math.max(0, nextLastSeen - prev.firstSeenTs);
  const stalledMs = statusNow === "FORMING" ? Math.max(0, nextLastSeen - lastChangeTs) : 0;

  history.set(key, {
    firstSeenTs: prev.firstSeenTs,
    lastSeenTs: nextLastSeen,
    lastProgressPct: progressPct,
    lastChangeTs,
    lastStatus: statusNow,
  });

  return {
    ...base,
    firstSeenTs: prev.firstSeenTs,
    lastSeenTs: nextLastSeen,
    ageMs,
    lastProgressPct: progressPrev,
    progressDeltaPct,
    lastChangeTs,
    stalledMs,
  };
}

function scaleConfidenceForReadiness(setup: any, execution: any, telemetry?: SetupTelemetry) {
  const raw = Number(setup?.confidence?.score ?? 0);
  const status = String(setup?.status ?? "");
  const state = String(execution?.state ?? "");
  const blockers = Array.isArray(execution?.blockers) ? execution.blockers : [];

  // Preserve engine score as-is for READY/TRIGGERED; scale only in FORMING (execution-readiness phase).
  if (status !== "FORMING") {
    return {
      confidence: setup?.confidence,
      confidence_raw: setup?.confidence, // keep a reference for export/debug
    };
  }

  // Derive trigger progress from the setup's trigger checklist (if present).
  // Do not infer from text; rely on checklist's ok flags.
  // Prefer telemetry progress (single source of truth). Fallback to checklist if missing.
  let progress01 = Number.isFinite(telemetry?.progressPct)
    ? Math.max(0, Math.min(1, (telemetry!.progressPct as number) / 100))
    : NaN;

  let total = 0;
  let passed = 0;

  if (!Number.isFinite(progress01)) {
    const checklist = Array.isArray(setup?.entry?.trigger?.checklist) ? setup.entry.trigger.checklist : [];
    const keyed = checklist
      .filter((c: any) => c && typeof c.key === "string" && c.key.trim().length > 0)
      .map((c: any) => ({ key: c.key.trim(), ok: c.ok }));

    total = keyed.length;
    passed = keyed.filter((c: any) => c.ok === true).length;
    progress01 = total > 0 ? passed / total : NaN;
  } else {
    total = Number(telemetry?.totalTriggers ?? 0);
    passed = Array.isArray(telemetry?.passedTriggers) ? telemetry!.passedTriggers.length : 0;
  }

  let adj = raw;

  if (Number.isFinite(progress01)) {
    // Progress-based scaling:
    // - FORMING always has some penalty (not execution-ready).
    // - The closer to completion, the smaller the penalty.
    // - Keep the scale soft; do not collapse confidence to zero.
    const remaining = 1 - progress01; // 0..1
    const basePenalty = 4; // constant for any FORMING
    const progressPenalty = Math.round(16 * remaining); // 0..16

    adj -= basePenalty + progressPenalty;

    // Blockers (explicit unmet conditions) — keep small to avoid double-counting with progress.
    if (blockers.length > 0) {
      adj -= Math.min(6, blockers.length * 2);
    }

    // Execution state nuance (only when FORMING)
    if (state === "WAIT_ZONE") adj -= 2;
    else if (
      state === "WAIT_CLOSE" ||
      state === "WAIT_RECLAIM" ||
      state === "WAIT_TOUCH" ||
      state === "WAIT_RETEST"
    ) {
      adj -= 3;
    }
  } else {
    // Fallback: checklist absent/unusable — use the previous conservative heuristic.
    // Base penalty: FORMING means not structurally/execution-ready yet.
    adj -= 8;

    // Checklist blockers: each blocker is an explicit unmet condition.
    if (blockers.length > 0) {
      adj -= Math.min(12, blockers.length * 4);
    }

    // Execution state nuance (only when FORMING)
    if (state === "WAIT_ZONE") adj -= 4;
    else if (
      state === "WAIT_CLOSE" ||
      state === "WAIT_RECLAIM" ||
      state === "WAIT_TOUCH" ||
      state === "WAIT_RETEST"
    )
      adj -= 6;
  }

  // Clamp
  const score = Math.max(0, Math.min(100, Math.round(adj)));

  // Keep reasons minimal; do not spam.
  const reasonsBase: string[] = Array.isArray(setup?.confidence?.reasons) ? setup.confidence.reasons : [];
  const reasons = [...reasonsBase];

  const delta = score - raw;

  // Add at most 1 readiness note (progress-aware when possible)
  if (Number.isFinite(progress01)) {
    const pct = Math.round(progress01 * 100);
    reasons.push(`Readiness: FORMING ${pct}% (${passed}/${total}) (${delta >= 0 ? "+" : ""}${delta})`);
  } else {
    reasons.push(`Readiness: FORMING (${delta >= 0 ? "+" : ""}${delta})`);
  }

  const confidence = {
    ...setup.confidence,
    score,
    grade: gradeFromScore(score),
    reasons,
  };

  return { confidence, confidence_raw: setup?.confidence };
}

function deriveExecutionGlobal(ctx: { dqOk: boolean; bybitOk: boolean; staleSec?: number; paused: boolean }) {
  const reasons: string[] = [];
  if (ctx.paused) reasons.push("PAUSED");
  if (!ctx.dqOk) reasons.push("DQ_NOT_OK");
  if (!ctx.bybitOk) reasons.push("BYBIT_NOT_OK");
  if (typeof ctx.staleSec === "number" && ctx.staleSec > 15) reasons.push("PRICE_STALE");

  return {
    state: reasons.length ? "BLOCKED" : "ENABLED",
    reasons,
  } as const;
}

/**
 * Snapshot builder (client-side):
 * - buildSetups() returns canonical setup lifecycle status (FORMING/READY/TRIGGERED/...)
 * - this hook enriches each setup with an execution decision separate from setup.status
 * - IMPORTANT: This hook does NOT auto-select. UI must handle user selection.
 */
// --- Engine input keying (frontend-only performance + timeliness) ---
function lastCandleTsOfTf(snap: any, tf: string): number {
  const node = snap?.timeframes?.find((x: any) => String(x?.tf) === tf);
  const arr = node?.candles?.ohlcv;
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const last = arr[arr.length - 1];
  const ts = Number(last?.ts);
  return Number.isFinite(ts) ? ts : 0;
}

function featureKeySubset(features: any): string {
  // Conservative subset: include all fields that engine gates/uses heavily (best-effort, no guessing).
  // If your FeaturesSnapshot later exposes a stable revision (e.g., features.ts), you can switch to that.
  const q = features?.quality;
  const bias = features?.bias;
  const cross = features?.cross;
  const ms = features?.market_structure;

  const msKey = (() => {
    // include latest event timestamps for common tfs if present
    const tfs = ["4h", "1h", "15m", "5m"];
    const parts: string[] = [];
    for (const tf of tfs) {
      const node = (ms as any)?.[tf];
      const bosTs = Number(node?.lastBOS?.ts);
      const chochTs = Number(node?.lastCHOCH?.ts);
      const shTs = Number(node?.lastSwingHigh?.ts);
      const slTs = Number(node?.lastSwingLow?.ts);
      parts.push(
        `${tf}:bos=${Number.isFinite(bosTs) ? bosTs : 0},choch=${Number.isFinite(chochTs) ? chochTs : 0},sh=${Number.isFinite(shTs) ? shTs : 0},sl=${Number.isFinite(slTs) ? slTs : 0}`
      );
    }
    return parts.join("|");
  })();

  return [
    `dq=${String(q?.dq_grade ?? "")}`,
    `bybit_ok=${String(q?.bybit_ok ?? "")}`,
    `binance_ok=${String(q?.binance_ok ?? "")}`,
    `bias_dir=${String(bias?.trend_dir ?? "")}`,
    `bias_strength=${String(bias?.trend_strength ?? "")}`,
    `vol_regime=${String(bias?.vol_regime ?? "")}`,
    `cross_consensus=${String(cross?.consensus_score ?? "")}`,
    `ms=${msKey}`,
  ].join("|");
}

function engineInputKey(snap: any, features: any): string {
  // Engine currently derives px from 15m/1h close (see engine.ts), so these are must-include.
  const c15 = lastCandleTsOfTf(snap, "15m");
  const c1h = lastCandleTsOfTf(snap, "1h");
  const c4h = lastCandleTsOfTf(snap, "4h");
  const c5m = lastCandleTsOfTf(snap, "5m"); // affects your close-confirm layer
  const fKey = featureKeySubset(features);
  return `c15=${c15}|c1h=${c1h}|c4h=${c4h}|c5m=${c5m}|f=${fKey}`;
}
function snapshotRevision(snap: any): string {
  if (!snap || !Array.isArray(snap.timeframes)) return "nosnap";

  // Build a stable primitive key from "latest candle ts" per TF and per venue.
  // This avoids stale useMemo results when upstream mutates objects/arrays in place
  // or reuses snapshot references.
  const parts: string[] = [];

  for (const tfNode of snap.timeframes as any[]) {
    const tf = String(tfNode?.tf ?? "");
    if (!tf) continue;

    const a = tfNode?.candles?.ohlcv;
    const b = tfNode?.candles_binance?.ohlcv;

    const lastA = Array.isArray(a) && a.length ? a[a.length - 1]?.ts : undefined;
    const lastB = Array.isArray(b) && b.length ? b[b.length - 1]?.ts : undefined;

    // include confirmed-bar timestamp as well if present (helps status_tf stabilization)
    const confA =
      Array.isArray(a) && a.length
        ? (() => {
          for (let i = a.length - 1; i >= 0; i--) {
            if (a[i]?.confirm) return a[i]?.ts;
          }
          return undefined;
        })()
        : undefined;

    parts.push(`${tf}:${lastA ?? 0}:${confA ?? 0}:${lastB ?? 0}`);
  }

  // Also include availability heartbeat/probe gates if present (keeps DQ gating responsive)
  const hbBybit = snap?.availability?.bybit?.ok ? 1 : 0;
  const hbBinance = snap?.availability?.binance?.ok ? 1 : 0;
  parts.push(`ab:${hbBybit}:an:${hbBinance}`);

  return parts.join("|");
}

export function useSetupsSnapshot(symbol: string, paused: boolean = false): UseSetupsSnapshotResult {
  const { snap, features } = useFeaturesSnapshot(symbol);
  const snapRev = snapshotRevision(snap);

  // Persisted per-hook instance cache to stabilize FORMING/READY status
  const statusCacheRef = useRef<Map<string, { status: SetupStatus; barTs: number }>>(new Map());
  // Persist close-confirm runtime fields across engine recomputations (keyed by setup key)
  const closeConfirmCacheRef = useRef<
    Map<
      string,
      {
        baseTs?: number;
        nextCloseTs?: number;
        tf?: string;
        lastSeenTs: number;
      }
    >
  >(new Map());

  const prevSymbolRef = useRef<string>(symbol);
  const persistRef = useRef<{
    key: string;
    setup: any;
    ts: number;
  } | null>(null);
  const engineCacheRef = useRef<{ key: string; base: any } | null>(null);
  // Temporal readiness history (client-side): track age/stall/progress deltas
  const telemetryHistoryRef = useRef<
    Map<
      string,
      {
        firstSeenTs: number;
        lastSeenTs: number;
        lastProgressPct: number;
        lastChangeTs: number;
        lastStatus: string;
      }
    >
  >(new Map());

  const setups = useMemo(() => {
    if (!snap || !features) return null;

    // Reset cache when symbol changes (so we don't carry status across symbols)
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      statusCacheRef.current.clear();
      telemetryHistoryRef.current.clear();
      closeConfirmCacheRef.current.clear();
    }

    const base = buildSetups({ snap, features });

    // Hard invalidation is intrabar (by mid)
    const withHardInvalid = applyHardInvalidationIntrabar(base, snap);

    const withPre = applyPreTrigger(withHardInvalid, snap);

    // Close-confirm runtime fields (_cc_*) must persist across engine recomputations.
    const hydrated = hydrateCloseConfirmRuntime(withPre, closeConfirmCacheRef.current);

    // Trigger confirmation still uses trigger_tf close-confirm (5m/15m)
    const withConfirm = applyCloseConfirm(hydrated, snap);

    // Persist runtime close-confirm fields for next evaluation cycle
    persistCloseConfirmRuntime(withConfirm, closeConfirmCacheRef.current, Date.now());


    // Stabilize FORMING/READY by status_tf confirmed bar (1h for intraday, 4h for swing)
    const stabilized = stabilizeStatusByConfirmedBar(withConfirm, snap, statusCacheRef.current);

    const scored = applyPriorityScore(stabilized, snap, features);

    // Attach execution decision per setup (UI-facing)
    const mid = computeMidFromSnap(snap);

    const dqOk = Boolean(scored?.dq_ok ?? (features?.quality?.dq_grade === "A" || features?.quality?.dq_grade === "B"));
    const bybitOk = Boolean(features?.quality?.bybit_ok);

    // staleness based on price feed timestamp
    let staleSec: number | undefined = undefined;
    const priceTs = Number(snap?.price?.ts);
    if (Number.isFinite(priceTs)) {
      staleSec = (Date.now() - priceTs) / 1000;
    } else {
      staleSec = undefined;
    }

    const ctx = {
      mid,
      dqOk,
      bybitOk,
      staleSec,
      paused,
    };

    const enriched = Array.isArray(scored?.setups)
      ? scored.setups.map((s: any) => {
        const execution0 = deriveExecutionDecision(s, ctx);
        const execution: ExecutionDecision = { ...execution0, narrative: buildDecisionNarrative(s, execution0, ctx) };
        const { confidence, confidence_raw } = scaleConfidenceForReadiness(s, execution);

        const baseTelemetry = deriveSetupTelemetry(s, execution);
        const tKey = String(s?.canon ?? s?.id ?? "");
        const telemetry = withTemporalTelemetry(
          tKey,
          String(s?.status ?? ""),
          baseTelemetry,
          Date.now(),
          telemetryHistoryRef.current
        );

        return {
          ...s,
          execution,
          telemetry,
          confidence,        // UI uses this (scaled for FORMING)
          confidence_raw,    // keep engine score for debug/export
        };
      })
      : scored?.setups;

    const arr = Array.isArray(enriched) ? enriched : [];
    const nowTs = Date.now();

    // TTL giữ setup hiển thị để giảm flicker (không ảnh hưởng execution)
    // Sticky cache: keep last valid setup visible across transient upstream drops
    // - Upstream drops happen on DQ jitter, price feed hiccups, or engine gating.
    // - We keep the last setup until it is INVALIDATED/EXPIRED or past expires_ts (+grace), whichever comes first.
    let finalArr = arr;

    const prev = persistRef.current;
    if (arr.length > 0) {
      // Engine currently publishes a setup (engine enforces only-1-per-symbol)
      const s0 = arr[0];
      const k = String(s0?.canon ?? s0?.id ?? "");
      if (k) persistRef.current = { key: k, setup: s0, ts: nowTs };
    } else if (prev) {
      const sPrev = prev.setup;
      const st = String(sPrev?.status ?? "");

      // Never keep terminal setups
      if (st === "INVALIDATED" || st === "EXPIRED") {
        persistRef.current = null;
      } else {
        const expiresTs = Number(sPrev?.expires_ts ?? 0);
        const graceMs = 60_000; // 1m grace to avoid edge flicker at expiry boundary
        const withinExpiry =
          expiresTs > 0 ? (nowTs <= expiresTs + graceMs) : (nowTs - prev.ts <= 10 * 60_000);

        if (withinExpiry) {
          //. Re-derive execution with current ctx (DQ/paused/stale), and re-apply hard invalidation against current mid.
          const execution0 = deriveExecutionDecision(sPrev, ctx);
          const execution: ExecutionDecision = { ...execution0, narrative: buildDecisionNarrative(sPrev, execution0, ctx) };
          const baseTelemetry = deriveSetupTelemetry(sPrev, execution);
          const tKey = String(sPrev?.canon ?? sPrev?.id ?? "");
          const telemetry = withTemporalTelemetry(
            tKey,
            String(sPrev?.status ?? ""),
            baseTelemetry,
            nowTs,
            telemetryHistoryRef.current
          );
          const { confidence, confidence_raw } = scaleConfidenceForReadiness(sPrev, execution, telemetry);
          let kept = {
            ...sPrev,
            execution,
            telemetry,
            confidence,
            confidence_raw,
          };

          // Apply hard invalidation intrabar against current mid/stop
          const stopPx = kept?.stop?.price;
          if (Number.isFinite(Number(ctx.mid)) && typeof stopPx === "number" && Number.isFinite(stopPx)) {
            if (kept.side === "LONG" && ctx.mid <= stopPx) kept = { ...kept, status: "INVALIDATED" };
            if (kept.side === "SHORT" && ctx.mid >= stopPx) kept = { ...kept, status: "INVALIDATED" };
          }

          finalArr = [kept];
        } else {
          // Past expiry horizon → drop
          persistRef.current = null;
        }
      }
    }

    // ---- Hook-level (global) execution + feed telemetry (UI contract) ----
    // executionGlobal: summarizes operator gates that apply regardless of setup details.
    const staleLimitSecGlobal = (() => {
      const xs = Array.isArray(scored?.setups) ? scored.setups : [];
      if (xs.length === 0) return inferStaleLimitSecForEntryTf(undefined);
      let min = Infinity;
      for (const s of xs) {
        const lim = inferStaleLimitSecForSetup(s);
        if (Number.isFinite(lim) && lim < min) min = lim;
      }
      return Number.isFinite(min) ? min : inferStaleLimitSecForEntryTf(undefined);
    })();

    const executionGlobal = (() => {
      const reasons: string[] = [];
      if (!dqOk) reasons.push("DQ_NOT_OK");
      if (!bybitOk) reasons.push("BYBIT_FEED_NOT_OK");
      if (paused) reasons.push("PAUSED");
      if (staleSec != null && staleSec > staleLimitSecGlobal) reasons.push("STALE_PRICE_FEED");
      return {
        state: reasons.length > 0 ? "BLOCKED" : "ENABLED",
        reasons,
      };
    })();

    const feedStatus = (() => {
      const t = (scored as any)?.telemetry;
      if (!t || typeof t !== "object" || Array.isArray(t)) {
        return {
          evaluated: false,
          candidatesEvaluated: null,
          published: Array.isArray(finalArr) ? finalArr.length : 0,
          rejected: null,
          rejectionByCode: null,
          rejectNotesSample: null,
          gate: null,
          readiness: null,
          lastEvaluationTs: Number.isFinite(Number((scored as any)?.ts)) ? Number((scored as any).ts) : Date.now(),
        };
      }

      const candidatesEvaluated = Number.isFinite(Number((t as any).candidates)) ? Number((t as any).candidates) : null;
      const published = Number.isFinite(Number((t as any).accepted)) ? Number((t as any).accepted) : 0;
      const rejected =
        (t as any).rejected == null ? null : (Number.isFinite(Number((t as any).rejected)) ? Number((t as any).rejected) : null);

      const rb = (t as any).rejectByCode;
      const rejectionByCode =
        rb && typeof rb === "object" && !Array.isArray(rb)
          ? (Object.fromEntries(Object.entries(rb).map(([k, v]) => [String(k), Number(v)])) as Record<string, number>)
          : null;

      const rejectNotesSample = Array.isArray((t as any).rejectNotesSample)
        ? (t as any).rejectNotesSample.map((s: any) => String(s))
        : null;

      const gate = (t as any).gate != null ? String((t as any).gate) : null;

      const readinessRaw = (t as any).readiness;
      const readiness =
        readinessRaw && typeof readinessRaw === "object" && !Array.isArray(readinessRaw)
          ? {
            state: String((readinessRaw as any).state ?? ""),
            items: Array.isArray((readinessRaw as any).items)
              ? (readinessRaw as any).items
                .map((it: any) => ({ key: String(it?.key ?? ""), note: String(it?.note ?? "") }))
                .filter((it: any) => it.key && it.note)
              : [],
          }
          : null;

      const lastEvaluationTs = Number.isFinite(Number((scored as any)?.ts)) ? Number((scored as any).ts) : Date.now();

      return {
        evaluated: true,
        candidatesEvaluated,
        published,
        rejected,
        rejectionByCode,
        rejectNotesSample,
        gate,
        readiness,
        lastEvaluationTs,
      };
    })();

    return {
      ...scored,
      setups: finalArr,
      executionGlobal,
      feedStatus,
    };


  }, [snapRev, snap, features, paused, symbol]);

  const executionGlobal = (setups as any)?.executionGlobal ?? null;
  const feedStatus = (setups as any)?.feedStatus ?? null;

  return { snap, features, setups, executionGlobal, feedStatus };

}