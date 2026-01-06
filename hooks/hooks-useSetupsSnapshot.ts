import { useMemo } from "react";
import { useFeaturesSnapshot } from "./useFeaturesSnapshot";
import { buildSetups } from "../lib/feeds/setups/engine";
import type { ExecutionDecision } from "../lib/feeds/setups/types";


type Candle = {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  confirm: boolean;
};

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
        // Task 3.4b: if breakout has an explicit retest zone, use it
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

    const statusScore =
      status === "READY" ? 18 :
      status === "FORMING" ? 8 :
      0;

    const preOk = getChecklistOk(s, "pre_trigger");
    const preScore = preOk ? 15 : 0;

    let expiryPenalty = 0;
    if (typeof s.expires_ts === "number") {
      const minsLeft = (s.expires_ts - now) / 60000;
      if (minsLeft <= 0) expiryPenalty = 30;
      else if (minsLeft < 10) expiryPenalty = 18;
      else if (minsLeft < 20) expiryPenalty = 10;
    }

    const confScore = clamp(conf * 0.20, 0, 20);

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

  const preferred = sorted.find((s: any) => s?.status === "READY")?.id ?? sorted[0]?.id;

  return {
    ...out,
    preferred_id: preferred,
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

      // Task 3.4b: if we have a retest zone, use in-zone as “retest ok”
      if (z && typeof z.lo === "number" && typeof z.hi === "number") {
        const inZone = mid >= z.lo && mid <= z.hi;

        checklist = upsertChecklist(checklist, {
          key: "retest",
          ok: inZone,
          note: `mid=${mid.toFixed(2)} | zone=[${z.lo.toFixed(2)}, ${z.hi.toFixed(2)}]` + (brk ? ` | lvl=${brk.toFixed(2)}` : ""),
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

      // Task 3.4b: if breakout has a retest zone, require “touch retest + close beyond level”
      const z = s?.entry?.zone;
      if (z && typeof z.lo === "number" && typeof z.hi === "number") {
        const buffer = brk * 0.0008; // 8 bps buffer after reclaim/break
        const passStrength = strength >= 0.7;

        if (s.side === "LONG") {
          const touched = last.l <= z.hi;          // retest touch
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

  // --- Global execution gates ---
  if (!ctx.dqOk || !ctx.bybitOk || ctx.paused || (ctx.staleSec != null && ctx.staleSec > 5)) {
    return {
      state: "BLOCKED",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: [],
      reason: "Execution gated (DQ / feed / stale / paused)",
    };
  }

  // --- Dead setups ---
  if (status === "INVALIDATED" || status === "EXPIRED") {
    return {
      state: "NO_TRADE",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers: [],
      reason: "Setup no longer valid",
    };
  }

  // --- Collect checklist blockers ---
  for (const item of checklist) {
    if (item?.ok === false) blockers.push(item.key);
  }

  // --- FORMING ---
  if (status === "FORMING") {
    return {
      state: blockers.includes("retest") ? "WAIT_RETEST" : "NO_TRADE",
      canEnterMarket: false,
      canPlaceLimit: false,
      blockers,
      reason: "Setup forming",
    };
  }

  // --- READY ---
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
        z && ctx.mid >= z.lo && ctx.mid <= z.hi;

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

  // --- TRIGGERED ---
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

  // --- Fallback ---
  return {
    state: "NO_TRADE",
    canEnterMarket: false,
    canPlaceLimit: false,
    blockers,
    reason: "No execution action",
  };
}

export function useSetupsSnapshot(symbol: string) {
  const { snap, features } = useFeaturesSnapshot(symbol);

  const setups = useMemo(() => {
    if (!snap || !features) return null;

    const base = buildSetups({ snap, features });

    const withPre = applyPreTrigger(base, snap);
    const withConfirm = applyCloseConfirm(withPre, snap);
    return applyPriorityScore(withConfirm, snap, features);
  }, [snap, features]);

  return { snap, features, setups };
}
