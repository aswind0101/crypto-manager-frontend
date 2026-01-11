import { useMemo, useRef } from "react";
import { useFeaturesSnapshot } from "./useFeaturesSnapshot";
import { buildSetups } from "../lib/feeds/setups/engine";
import { gradeFromScore } from "../lib/feeds/setups/scoring";
import type { ExecutionDecision, SetupTelemetry } from "../lib/feeds/setups/types";


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

/**
 * Status timeframe policy:
 * - If bias_tf is 4h => swing status_tf = 4h
 * - Else => intraday status_tf = 1h
 *
 * This matches your chosen rule:
 * - intraday status_tf = 1h
 * - swing status_tf = 4h
 */
function inferStatusTf(setup: any): "1h" | "4h" {
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

  const last1h = lastConfirmedCandle(getTimeframeCandles(snap, "1h"));
  const last4h = lastConfirmedCandle(getTimeframeCandles(snap, "4h"));

  const barTsByTf: Record<"1h" | "4h", number> = {
    "1h": Number.isFinite(last1h?.ts as number) ? (last1h!.ts as number) : 0,
    "4h": Number.isFinite(last4h?.ts as number) ? (last4h!.ts as number) : 0,
  };

  const updated = out.setups.map((s: any) => {
    if (!s) return s;

    const key = String(s?.canon ?? s?.id ?? "");
    if (!key) return s;

    const statusTf = inferStatusTf(s);
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
  const out = Array.isArray(list) ? [...list] : [];
  const idx = out.findIndex((x) => x?.key === item.key);
  if (idx >= 0) out[idx] = item;
  else out.push(item);
  return out;
}

function parseBreakLevelFromChecklist(setup: any): number | undefined {
  const items = setup?.entry?.trigger?.checklist;
  if (!Array.isArray(items)) return undefined;

  for (const it of items) {
    const note = String(it?.note ?? "");
    // engine note format: "... @ 1234.56"
    const m = note.match(/@\s*([0-9]+(?:\.[0-9]+)?)/);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return undefined;
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
        const inZone = mid >= z.lo && mid <= z.hi;

        checklist = upsertChecklist(checklist, {
          key: "retest",
          ok: inZone,
          note:
            `mid=${mid.toFixed(2)} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}]` +
            (brk ? ` | lvl=${brk.toFixed(2)}` : ""),
        });

        checklist = upsertChecklist(checklist, {
          key: "pre_trigger",
          ok: inZone,
          note: `mid=${mid.toFixed(2)} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}]`,
        });

        if (inZone) summary = "PRE-TRIGGER: price is retesting BOS level (await close-confirm breakout)";
        return {
          ...s,
          entry: { ...s.entry, trigger: { ...trg, checklist, summary } },
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
    }

    if (s.type === "RANGE_MEAN_REVERT" || s.type === "TREND_PULLBACK") {
      const zone = s?.entry?.zone;
      if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number") return s;

      const inZone = mid >= zone.lo && mid <= zone.hi;

      checklist = upsertChecklist(checklist, {
        key: "pre_trigger",
        ok: inZone,
        note: `mid=${mid.toFixed(2)} | zone=[${zone.lo.toFixed(2)}, ${zone.hi.toFixed(2)}]`,
      });

      if (inZone) summary = "PRE-TRIGGER: price is inside entry zone (await close-confirm)";
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
function applyCloseConfirm(out: any, snap: any): any {
  if (!out || !Array.isArray(out.setups) || !snap) return out;

  const tf = pickTriggerTf(snap);
  if (!tf) return out;

  const candles = getTimeframeCandles(snap, tf);
  const last = lastConfirmedCandle(candles);
  if (!last) return out;

  const tnow = Date.now();

  const updated = out.setups.map((s: any) => {
    if (!s) return s;

    // Expiry
    if (typeof s.expires_ts === "number" && tnow > s.expires_ts) {
      return { ...s, status: "EXPIRED" };
    }

    // Hard invalidation by stop on close-confirm candle
    const stopPx = s?.stop?.price;
    if (typeof stopPx === "number") {
      if (s.side === "LONG" && last.c <= stopPx) return { ...s, status: "INVALIDATED" };
      if (s.side === "SHORT" && last.c >= stopPx) return { ...s, status: "INVALIDATED" };
    }

    if (s.status !== "READY") return s;

    if (s.type === "BREAKOUT") {
      const brk = parseBreakLevelFromChecklist(s);
      if (!brk) return s;

      const strength = candleCloseStrengthPct(last, s.side);

      // If breakout has a retest zone, require “touch retest + close beyond level”
      const z = s?.entry?.zone;
      if (z && typeof z.lo === "number" && typeof z.hi === "number") {
        const buffer = brk * 0.0008; // 8 bps buffer after reclaim/break
        const passStrength = strength >= 0.7;

        if (s.side === "LONG") {
          const touched = last.l <= z.hi; // retest touch
          const passPrice = last.c > brk + buffer; // close beyond level
          if (touched && passPrice && passStrength) {
            return {
              ...s,
              status: "TRIGGERED",
              entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
            };
          }
          return s;
        }

        const touched = last.h >= z.lo;
        const passPrice = last.c < brk - buffer;
        if (touched && passPrice && passStrength) {
          return {
            ...s,
            status: "TRIGGERED",
            entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
          };
        }
        return s;
      }

      // Legacy breakout (no retest zone)
      const buffer = brk * 0.001; // 0.10% buffer
      const passPrice = s.side === "LONG" ? last.c > brk + buffer : last.c < brk - buffer;
      const passStrength = strength >= 0.7;

      if (passPrice && passStrength) {
        return {
          ...s,
          status: "TRIGGERED",
          entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
        };
      }
      return s;
    }

    if (s.type === "RANGE_MEAN_REVERT") {
      const zone = s?.entry?.zone;
      if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number") return s;

      if (s.side === "LONG") {
        const touched = last.l <= zone.hi;
        const reclaimed = last.c >= zone.hi;
        const hasRejection = last.l < last.c;
        if (touched && reclaimed && hasRejection) {
          return {
            ...s,
            status: "TRIGGERED",
            entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
          };
        }
        return s;
      }

      const touched = last.h >= zone.lo;
      const reclaimed = last.c <= zone.lo;
      const hasRejection = last.h > last.c;
      if (touched && reclaimed && hasRejection) {
        return {
          ...s,
          status: "TRIGGERED",
          entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
        };
      }
      return s;
    }

    if (s.type === "TREND_PULLBACK") {
      const zone = s?.entry?.zone;
      if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number") return s;

      if (s.side === "LONG") {
        const touched = last.l <= zone.hi;
        const reclaimed = last.c >= zone.hi;
        if (touched && reclaimed) {
          return {
            ...s,
            status: "TRIGGERED",
            entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
          };
        }
        return s;
      }

      const touched = last.h >= zone.lo;
      const reclaimed = last.c <= zone.lo;
      if (touched && reclaimed) {
        return {
          ...s,
          status: "TRIGGERED",
          entry: { ...s.entry, trigger: { ...s.entry.trigger, confirmed: true } },
        };
      }
      return s;
    }

    return s;
  });

  return { ...out, setups: updated };
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

  // ---------- Helper: parse timeframe to minutes ----------
  const tfToMinutes = (tf: unknown): number | undefined => {
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
  };

  // ---------- Helper: dynamic stale threshold (intraday stricter) ----------
  const inferStaleLimitSec = (): number => {
    const entryTfMin = tfToMinutes(setup?.entry_tf);
    // Default conservative
    if (entryTfMin == null) return 5;

    // Intraday entry TF => stricter stale gate
    if (entryTfMin <= 5) return 2;   // 1m/3m/5m
    if (entryTfMin <= 15) return 3;  // 10m/15m
    if (entryTfMin <= 60) return 5;  // 30m/1h
    return 8;                        // 4h+ (swing context)
  };

  // ---------- Quality gate: grade C/D are monitor-only ----------
  // Requirement from you: grade C must never allow canEnterMarket.
  // We also treat grade D as monitor-only to prevent low-confidence execution.
  const grade = String(setup?.confidence?.grade ?? "").toUpperCase();
  if (grade === "C" || grade === "D") {
    return {
      state: "MONITOR",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: ["CONFIDENCE_MONITOR_ONLY"],
      reason: `Confidence ${grade}: monitor only`,
    };
  }

  // ---------- Global execution gates (machine-readable blockers) ----------
  const gateBlockers: string[] = [];
  if (!ctx.dqOk) gateBlockers.push("DQ_NOT_OK");
  if (!ctx.bybitOk) gateBlockers.push("BYBIT_FEED_NOT_OK");
  if (ctx.paused) gateBlockers.push("PAUSED");

  const staleLimitSec = inferStaleLimitSec();
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

      return {
        state: "PLACE_LIMIT",
        canEnterMarket: false,
        canPlaceLimit: true,
        blockers,
        reason: "Limit entry available",
      };
    }

    // MARKET
    return {
      state: "ENTER_MARKET",
      canEnterMarket: true,
      canPlaceLimit: false,
      blockers,
      reason: "Market entry allowed",
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

export function useSetupsSnapshot(symbol: string, paused: boolean = false) {
  const { snap, features } = useFeaturesSnapshot(symbol);

  // Persisted per-hook instance cache to stabilize FORMING/READY status
  const statusCacheRef = useRef<Map<string, { status: SetupStatus; barTs: number }>>(new Map());
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
    }

    const base = buildSetups({ snap, features });

    // Hard invalidation is intrabar (by mid)
    const withHardInvalid = applyHardInvalidationIntrabar(base, snap);

    const withPre = applyPreTrigger(withHardInvalid, snap);

    // Trigger confirmation still uses trigger_tf close-confirm (5m/15m)
    const withConfirm = applyCloseConfirm(withPre, snap);

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
        const execution = deriveExecutionDecision(s, ctx);
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
          const execution = deriveExecutionDecision(sPrev, ctx);
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

    return {
      ...scored,
      setups: finalArr,
    };

  }, [snap, features, paused, symbol]);

  return { snap, features, setups };
}