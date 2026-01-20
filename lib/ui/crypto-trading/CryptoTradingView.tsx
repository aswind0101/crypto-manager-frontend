import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSetupsSnapshot } from "../../../hooks/useSetupsSnapshot";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  SearchIcon,
  CircleDashed,
  Clock,
  Crosshair,
  Database,
  ExternalLink,
  Flame,
  Gauge,
  Layers,
  LineChart,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
  Sparkles,
} from "lucide-react";

function AnimatedEllipsis() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const id = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "." : prev + "."));
    }, 450);
    return () => clearInterval(id);
  }, []);

  return <span>{dots}</span>;
}
function EcgBeatIcon({ className }: { className?: string }) {
  return (
    <span className={["inline-flex items-center justify-center", className || ""].join(" ")}>
      <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-hidden="true">
        {/* Base ECG path */}
        <path
          d="M2 12 H6.8 L8.3 8.2 L11 17.6 L13 12 H22"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />

        {/* Beat dot that runs along the path */}
        <circle r="1.6" fill="currentColor" className="ct-ecg-dot">
          <animateMotion
            dur="1.25s"
            repeatCount="indefinite"
            keyTimes="0;0.78;1"
            keySplines="0.2 0 0.2 1; 0.2 0 0.2 1"
            calcMode="spline"
            path="M2 12 H6.8 L8.3 8.2 L11 17.6 L13 12 H22"
          />
        </circle>
      </svg>
    </span>
  );
}

/** ---------- Minimal UI types (best-effort) ---------- */
type SetupSide = "LONG" | "SHORT";
type SetupStatus = "FORMING" | "READY" | "TRIGGERED" | "INVALIDATED" | "EXPIRED";
type ExecutionState =
  | "BLOCKED"
  | "READY"
  | "WAIT_CONFIRM"
  | "WAIT_CLOSE"
  | "WAIT_RETEST"
  | "WAIT_ZONE"
  | "PLACE_LIMIT"
  | "ENTER_MARKET"
  | "WAIT_FILL"
  | "NO_TRADE";

type ExecutionDecision = {
  state: ExecutionState;
  canEnterMarket: boolean;
  canPlaceLimit: boolean;
  blockers: string[];
  reason: string;

  // NEW (optional): narrative from hook/engine (UI will use this first)
  narrative?: {
    code?: string;
    headline?: string;
    bullets?: string[];
    next_action?: string;
    timing?: { next_close_ts?: number; tf?: string; stale_reason?: string };
    invalidation?: { rule?: string };
  };
};


type TradeSetup = {
  id: string;
  canon?: string;
  type: string;
  side: SetupSide;
  entry_tf: string;
  bias_tf: string;
  trigger_tf: string;
  status: SetupStatus;
  created_ts: number;
  expires_ts: number;

  entry: {
    mode: "LIMIT" | "MARKET";
    zone: { lo: number; hi: number };
    trigger: {
      confirmed: boolean;

      // NEW (optional): trigger tiers + metadata
      tier?: "APPROACHING" | "TOUCHED" | "CONFIRMED";
      touched_ts?: number;
      confirmed_ts?: number;
      _cc_base_ts?: number;
      _cc_next_close_ts?: number;
      _cc_tf?: string;

      checklist: Array<{ key: string; ok: boolean; note?: string }>;
      summary: string;
    };
  };

  stop: { price: number; basis?: string; note?: string };
  tp: Array<{ price: number; size_pct: number; basis?: string; note?: string }>;

  rr_min: number;
  rr_est: number;

  confidence: { score: number; grade: string; reasons: string[]; grade_plus?: string; grade_plus_reasons?: string[] };
  tags?: string[];

  priority_score?: number;
  priority_reasons?: string[];

  execution?: ExecutionDecision;
};

type ExecutionGlobal = {
  state: "ENABLED" | "BLOCKED";
  reasons: string[];
};

type FeedStatus = {
  evaluated: boolean;

  candidatesEvaluated: number | null;
  published: number;
  rejected: number | null;

  rejectionByCode: Record<string, number> | null;

  // NEW (optional): richer engine telemetry
  rejectNotesSample?: string[] | null;
  gate?: string | null;
  readiness?: { state: string; items: Array<{ key: string; note: string }> } | null;

  lastEvaluationTs: number;
};


type SetupsOutput = {
  ts: number;
  dq_ok: boolean;
  preferred_id?: string;
  setups: Array<TradeSetup>;
  // optional telemetry (may be injected by useSetupsSnapshot)
  executionGlobal?: ExecutionGlobal | null;
  feedStatus?: FeedStatus | null;
};
/** ---------- Formatting helpers ---------- */
function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function fmtNum(x?: number, maxFrac = 2) {
  if (!Number.isFinite(x as number)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFrac }).format(x as number);
}

function fmtPx(x?: number) {
  if (!Number.isFinite(x as number)) return "—";
  const v = x as number;
  // crypto heuristic
  if (v >= 10000) return v.toFixed(0);
  if (v >= 1000) return v.toFixed(1);
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}
function fmtEntryZone(zone?: { lo: number; hi: number }) {
  const lo = zone?.lo;
  const hi = zone?.hi;
  if (!Number.isFinite(lo as number) || !Number.isFinite(hi as number)) return "—";

  const a = lo as number;
  const b = hi as number;

  // If nearly equal, show single price
  const eps = 1e-12;
  if (Math.abs(a - b) <= eps) return fmtPx(a);

  // Keep natural order (lo-hi), but still handle reversed data safely
  const lo2 = Math.min(a, b);
  const hi2 = Math.max(a, b);
  return `${fmtPx(lo2)}–${fmtPx(hi2)}`;
}

function fmtTpSummary(tp?: Array<{ price: number; size_pct: number }>) {
  const arr = Array.isArray(tp) ? tp : [];
  const prices = arr
    .map((x) => x?.price)
    .filter((p) => Number.isFinite(p as number))
    .map((p) => fmtPx(p as number));

  if (prices.length === 0) return "—";
  if (prices.length <= 2) return prices.join(" / ");

  const head = prices.slice(0, 2).join(" / ");
  const rest = prices.length - 2;
  return `${head} +${rest}`;
}

function fmtPct01(x?: number) {
  if (!Number.isFinite(x as number)) return "—";
  return `${Math.round(clamp01(x as number) * 100)}%`;
}

function fmtScore100(x?: number) {
  if (!Number.isFinite(x as number)) return "—";
  return `${Math.round(Math.max(0, Math.min(100, x as number)))}%`;
}

/** ---------- Snapshot telemetry helpers (UI contract) ---------- */
type FeedUiState = "LOADING" | "NO_SIGNAL" | "QUALITY_GATED" | "EMPTY_UNKNOWN" | "HAS_SETUPS";

function normalizeExecutionGlobal(x: any): ExecutionGlobal | null {
  if (!x) return null;
  const state = x.state === "BLOCKED" ? "BLOCKED" : x.state === "ENABLED" ? "ENABLED" : null;
  if (!state) return null;
  const reasons = Array.isArray(x.reasons) ? x.reasons.map((r: any) => String(r)) : [];
  return { state, reasons };
}

function normalizeFeedStatus(x: any): FeedStatus | null {
  if (!x) return null;

  // Prefer engine output shape: { telemetry: {...}, ts }
  const t = x?.telemetry;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const candidatesEvaluated = Number.isFinite(Number(t.candidates)) ? Number(t.candidates) : null;
    const published = Number.isFinite(Number(t.accepted)) ? Number(t.accepted) : 0;

    const rejected = t.rejected == null ? null : Number.isFinite(Number(t.rejected)) ? Number(t.rejected) : null;

    const rb = t.rejectByCode;
    const rejectionByCode =
      rb && typeof rb === "object" && !Array.isArray(rb)
        ? (Object.fromEntries(Object.entries(rb).map(([k, v]) => [String(k), Number(v)])) as Record<string, number>)
        : null;

    const rejectNotesSample =
      Array.isArray(t.rejectNotesSample) ? t.rejectNotesSample.map((s: any) => String(s)) : null;

    const gate = t.gate != null ? String(t.gate) : null;

    const readinessRaw = t.readiness;
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

    const lastEvaluationTs = Number.isFinite(Number(x.ts)) ? Number(x.ts) : Date.now();

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
  }

  // Backward compatible feedStatus shape (older UI contract)
  const evaluated = x.evaluated === true;
  const published = Number.isFinite(Number(x.published)) ? Number(x.published) : 0;

  const candidatesEvaluated =
    x.candidatesEvaluated == null ? null : Number.isFinite(Number(x.candidatesEvaluated)) ? Number(x.candidatesEvaluated) : null;

  const rejected = x.rejected == null ? null : Number.isFinite(Number(x.rejected)) ? Number(x.rejected) : null;

  const rb = x.rejectionByCode;
  const rejectionByCode =
    rb && typeof rb === "object" && !Array.isArray(rb)
      ? (Object.fromEntries(Object.entries(rb).map(([k, v]) => [String(k), Number(v)])) as Record<string, number>)
      : null;

  const rejectNotesSample =
    Array.isArray(x.rejectNotesSample) ? x.rejectNotesSample.map((s: any) => String(s)) : null;

  const gate = x.gate != null ? String(x.gate) : null;

  const readinessRaw = x.readiness;
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

  const lastEvaluationTs = Number.isFinite(Number(x.lastEvaluationTs)) ? Number(x.lastEvaluationTs) : Date.now();

  return {
    evaluated,
    candidatesEvaluated,
    published,
    rejected,
    rejectionByCode,
    rejectNotesSample,
    gate,
    readiness,
    lastEvaluationTs,
  };
}

function deriveFeedUiState(feedStatus: FeedStatus | null, publishedCount: number): FeedUiState {
  // If we have no telemetry, fall back to a conservative state.
  if (!feedStatus) return publishedCount > 0 ? "HAS_SETUPS" : "EMPTY_UNKNOWN";
  if (!feedStatus.evaluated) return "LOADING";
  if (publishedCount > 0) return "HAS_SETUPS";

  // evaluated=true but published=0
  const ce = feedStatus.candidatesEvaluated;
  if (typeof ce === "number" && Number.isFinite(ce) && ce <= 0) return "NO_SIGNAL";
  if (typeof ce === "number" && Number.isFinite(ce) && ce > 0) return "QUALITY_GATED";

  // evaluated=true but candidates unknown
  return "EMPTY_UNKNOWN";
}

function formatExecutionGlobalReason(code: string): string {
  const c = String(code || "").toUpperCase();
  if (c === "PAUSED") return "Updates are paused";
  if (c === "DQ_NOT_OK") return "Data quality gate not OK";
  if (c === "BYBIT_NOT_OK") return "Bybit feed not OK";
  if (c === "PRICE_STALE") return "Price feed is stale";
  return code;
}

function topRejectionPairs(rejectionByCode: Record<string, number> | null, limit = 6) {
  if (!rejectionByCode) return [];
  const pairs = Object.entries(rejectionByCode)
    .map(([k, v]) => ({ code: k, count: Number(v) }))
    .filter((x) => Number.isFinite(x.count) && x.count > 0)
    .sort((a, b) => b.count - a.count);
  return pairs.slice(0, limit);
}

function isMonitorOnlyGrade(grade?: string) {
  return String(grade || "").toUpperCase() === "C";
}

function isSetupActionableNow(setup: TradeSetup, executionGlobal: ExecutionGlobal | null): boolean {
  // Hard policy: grade C is always monitor-only
  if (isMonitorOnlySetup(setup)) return false;
  if (executionGlobal?.state === "BLOCKED") return false;
  const ex = setup.execution;
  if (!ex) return false;

  // Trust the state machine, not booleans, for "now" actions.
  return ex.state === "ENTER_MARKET" || ex.state === "PLACE_LIMIT";
}


/** ---------- Domain helpers (best-effort, no guessing) ---------- */
function decisionSummary(s: TradeSetup, executionGlobal: ExecutionGlobal | null): string {
  if (isMonitorOnlySetup(s)) {
    return "Monitor-only (Grade C policy): no execution actions permitted";
  }

  if (executionGlobal?.state === "BLOCKED") {
    const primary = executionGlobal.reasons?.[0] ? formatExecutionGlobalReason(executionGlobal.reasons[0]) : "Execution blocked";
    return `Execution blocked: ${primary}`;
  }

  const ex = s.execution;
  if (!ex) return "Monitor setup – no execution decision yet";

  switch (ex.state) {
    case "ENTER_MARKET":
      return "Action now: enter market";
    case "PLACE_LIMIT":
      return "Action now: place limit order";
    case "WAIT_ZONE":
      return "Wait: price must enter the entry zone";
    case "WAIT_CLOSE":
      return "Wait: candle close confirmation required";
    case "WAIT_RETEST":
      return "Wait: retest condition required";
    case "WAIT_FILL":
      return "Triggered: waiting for limit fill";
    case "BLOCKED":
      return "No trade: setup is blocked";
    case "NO_TRADE":
      return "No trade: conditions not met";
    default:
      return "Monitor setup";
  }
}

function formatSetupWaitReason(setup: TradeSetup): string | null {
  const checklist = Array.isArray(setup.entry?.trigger?.checklist) ? setup.entry.trigger.checklist : [];

  // 1) Preferred: explicit blockers from engine execution
  const blockers = setup.execution?.blockers;
  if (Array.isArray(blockers) && blockers.length > 0) {
    const notes: string[] = [];
    for (const key of blockers.slice(0, 2)) {
      const item = checklist.find(
        (c) => c && c.key === key && c.ok === false && typeof c.note === "string" && c.note.trim().length > 0
      );
      notes.push(item?.note?.trim() ? item.note.trim() : String(key));
    }
    const uniq = Array.from(new Set(notes)).filter(Boolean);
    if (uniq.length === 1) return `Waiting for: ${uniq[0]}`;
    if (uniq.length === 2) return `Waiting for: ${uniq[0]} and ${uniq[1]}`;
    if (uniq.length > 2) return `Waiting for: ${uniq.slice(0, 2).join(", ")}…`;
  }

  // 2) Fallback A: derive blockers from checklist unmet items (ok === false)
  const unmet = checklist
    .filter((c: any) => c && c.ok === false)
    .map((c: any) => (typeof c.note === "string" && c.note.trim() ? c.note.trim() : String(c.key ?? "")))
    .filter((s: string) => s);

  if (unmet.length === 1) return `Waiting for: ${unmet[0]}`;
  if (unmet.length >= 2) return `Waiting for: ${unmet[0]} and ${unmet[1]}`;

  // 3) Fallback B: use trigger summary (still actionable)
  const summary = setup.entry?.trigger?.summary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    return `Waiting for: ${summary.trim()}`;
  }

  return null;
}
type ChecklistItem = { key: string; ok: boolean; note?: string };

type ChecklistCategory = "HARD" | "REALTIME" | "CONTEXT";

const CHECKLIST_META: Record<
  string,
  { label: string; category: ChecklistCategory }
> = {
  pre_trigger: { label: "Pre-trigger", category: "HARD" },
  level: { label: "Level", category: "HARD" },
  retest: { label: "Retest", category: "HARD" },
  close_confirm: { label: "Close confirm", category: "HARD" },
  bos: { label: "BOS / structure", category: "HARD" },
  sweep: { label: "Sweep", category: "HARD" },
  displacement: { label: "Displacement", category: "HARD" },
  squeeze: { label: "Squeeze", category: "HARD" },
  edge: { label: "Edge", category: "HARD" },
  range: { label: "Range", category: "HARD" },

  orderflow: { label: "Orderflow", category: "REALTIME" },
  delta: { label: "Delta", category: "REALTIME" },
  cross: { label: "Cross (consensus)", category: "REALTIME" },

  bias: { label: "Bias", category: "CONTEXT" },
  bias_strength: { label: "Bias strength", category: "CONTEXT" },
  htf_ms: { label: "HTF market structure", category: "CONTEXT" },
};

function checklistLabel(key: string): string {
  const k = String(key || "");
  return CHECKLIST_META[k]?.label ?? k;
}

function checklistCategory(key: string): ChecklistCategory {
  const k = String(key || "");
  return CHECKLIST_META[k]?.category ?? "HARD";
}

function buildDerivedTriggerSummary(args: {
  checklist: ChecklistItem[];
  blockers: string[];
}) {
  const checklist = Array.isArray(args.checklist) ? args.checklist : [];
  const blockers = Array.isArray(args.blockers) ? args.blockers : [];

  const total = checklist.length;
  const passed = checklist.filter((c) => c && c.ok === true).length;

  const byKey = new Map<string, ChecklistItem>();
  for (const c of checklist) {
    if (c && typeof c.key === "string") byKey.set(c.key, c);
  }

  // Prioritize engine-provided blockers (state machine truth), but only those that exist in checklist.
  const blockerItems: ChecklistItem[] = [];
  for (const b of blockers) {
    const item = byKey.get(String(b));
    if (item) blockerItems.push(item);
  }

  // Fallback: unmet checklist items (ok !== true)
  const unmetItems =
    blockerItems.length > 0
      ? blockerItems
      : checklist.filter((c) => c && c.ok !== true);

  const hard = unmetItems.filter((c) => checklistCategory(c.key) === "HARD");
  const realtime = unmetItems.filter(
    (c) => checklistCategory(c.key) === "REALTIME"
  );
  const context = unmetItems.filter(
    (c) => checklistCategory(c.key) === "CONTEXT"
  );

  const pick2 = (items: ChecklistItem[]) =>
    items
      .slice(0, 2)
      .map((c) => {
        const note = typeof c.note === "string" ? c.note.trim() : "";
        return note.length > 0 ? note : checklistLabel(c.key);
      })
      .filter(Boolean);

  // Text summary:
  // Prefer HARD blockers; then REALTIME; then CONTEXT; but keep it short.
  const parts =
    hard.length > 0
      ? pick2(hard)
      : realtime.length > 0
        ? pick2(realtime)
        : pick2(context);

  const text =
    parts.length === 0
      ? "All trigger checks passed"
      : parts.length === 1
        ? `Waiting for: ${parts[0]}`
        : `Waiting for: ${parts[0]} and ${parts[1]}`;

  return {
    text,
    total,
    passed,
    hard,
    realtime,
    context,
  };
}


function sideTone(side: SetupSide) {
  return side === "LONG" ? "text-emerald-400" : "text-rose-400";
}

function dqTone(dq?: string) {
  const g = String(dq || "").toUpperCase();
  if (g === "A") return "bg-emerald-500/10 text-emerald-200";
  if (g === "B") return "bg-sky-500/10 text-sky-200";
  if (g === "C") return "bg-amber-500/10 text-amber-200";
  if (g === "D") return "bg-rose-500/10 text-rose-200";
  return "bg-zinc-500/10 text-zinc-200";
}
function uiGrade(setup: TradeSetup): string {
  const gp = String((setup as any)?.confidence?.grade_plus ?? "").toUpperCase();
  if (gp === "A+" || gp === "A" || gp === "B" || gp === "C") return gp;
  return String((setup as any)?.confidence?.grade ?? "").toUpperCase();
}

function isMonitorOnlySetup(setup: TradeSetup) {
  return uiGrade(setup) === "C";
}

function gradeTone(grade?: string) {
  const g = String(grade || "").toUpperCase();
  if (g === "A") return "bg-emerald-500/10 text-emerald-200";
  if (g === "B") return "bg-sky-500/10 text-sky-200";
  if (g === "C") return "bg-amber-500/10 text-amber-200";
  return "bg-rose-500/10 text-rose-200";
}

function statusTone(status?: string) {
  const s = String(status || "").toUpperCase();
  if (s === "READY") return "bg-emerald-500/10 text-emerald-200";
  if (s === "FORMING") return "bg-amber-500/10 text-amber-200";
  if (s === "TRIGGERED") return "bg-sky-500/10 text-sky-200";
  if (s === "INVALIDATED" || s === "EXPIRED") return "bg-rose-500/10 text-rose-200";
  return "bg-zinc-500/10 text-zinc-200";
}
function actionChip(
  s: TradeSetup,
  executionGlobal: ExecutionGlobal | null
): { label: string; tone: string; icon: React.ReactNode } {
  // Hard policy first
  if (isMonitorOnlySetup(s)) {
    return {
      label: "MONITOR ONLY",
      tone: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30",
      icon: <CircleDashed className="h-4 w-4" />,
    };
  }

  // Global execution gate
  if (executionGlobal?.state === "BLOCKED") {
    return {
      label: "EXEC BLOCKED",
      tone: "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30",
      icon: <Lock className="h-4 w-4" />,
    };
  }

  const ex = s.execution;
  if (!ex) {
    return {
      label: "MONITOR",
      tone: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30",
      icon: <CircleDashed className="h-4 w-4" />,
    };
  }

  // Setup-level blocks
  if (ex.state === "BLOCKED") {
    return {
      label: "BLOCKED",
      tone: "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30",
      icon: <Lock className="h-4 w-4" />,
    };
  }

  // Trust the state machine (not booleans) for chips
  if (ex.state === "ENTER_MARKET") {
    return {
      label: "ENTER NOW",
      tone: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30",
      icon: <Crosshair className="h-4 w-4" />,
    };
  }
  if (ex.state === "PLACE_LIMIT") {
    return {
      label: "PLACE LIMIT",
      tone: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30",
      icon: <Target className="h-4 w-4" />,
    };
  }

  // waiting states — show intent (WAIT) instead of a generic MONITOR
  if (ex.state === "WAIT_FILL") {
    return {
      label: "WAIT FILL",
      tone: "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/30",
      icon: <Clock className="h-4 w-4" />,
    };
  }

  if (ex.state === "WAIT_CLOSE") {
    return {
      label: "WAIT CLOSE",
      tone: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30",
      icon: <Clock className="h-4 w-4" />,
    };
  }

  if (ex.state === "WAIT_ZONE") {
    return {
      label: "WAIT ZONE",
      tone: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30",
      icon: <Clock className="h-4 w-4" />,
    };
  }

  if (ex.state === "WAIT_RETEST") {
    return {
      label: "WAIT RETEST",
      tone: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30",
      icon: <Clock className="h-4 w-4" />,
    };
  }

  return {
    label: "WAIT",
    tone: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30",
    icon: <Clock className="h-4 w-4" />,
  };

}

function stableSetupKey(s: TradeSetup): string {
  if (s?.canon) return String(s.canon);
  if (s?.id) return String(s.id);
  const type = String(s?.type ?? "");
  const side = String(s?.side ?? "");
  const tf = String(s?.entry_tf ?? "");
  const mode = String(s?.entry?.mode ?? "");
  const zlo = Number.isFinite(s?.entry?.zone?.lo) ? (s.entry.zone.lo as number).toFixed(2) : "na";
  const zhi = Number.isFinite(s?.entry?.zone?.hi) ? (s.entry.zone.hi as number).toFixed(2) : "na";
  const sl = Number.isFinite(s?.stop?.price) ? (s.stop.price as number).toFixed(2) : "na";
  return `${type}|${side}|${tf}|${mode}|z:${zlo}-${zhi}|sl:${sl}`;
}

function humanizeType(x: string) {
  return (x || "").replace(/_/g, " ");
}
function isScalpSetupUi(s: TradeSetup): boolean {
  const type = String(s?.type ?? "").toUpperCase();

  // Primary signal: explicit tags (engine already uses tags on setups)
  const tags = Array.isArray(s?.tags) ? s.tags : [];
  const hasScalpTag = tags.some((t) => String(t ?? "").toLowerCase() === "scalp");

  // Secondary signal: type prefix (SCALP_*)
  const hasScalpType = type.startsWith("SCALP_");

  return hasScalpTag || hasScalpType;
}

function normDir(x: any): "bull" | "bear" | "sideways" | null {
  const s = String(x ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("bull") || s.includes("up") || s.includes("long")) return "bull";
  if (s.includes("bear") || s.includes("down") || s.includes("short")) return "bear";
  if (s.includes("side") || s.includes("range")) return "sideways";
  return null;
}

/** Market structure helpers (features.market_structure is Record<string, MarketStructureTF>) */
function pickLatestStructureEvent(msNode: any): { kind: "BOS" | "CHOCH" | null; dir: "UP" | "DOWN" | null; level?: number; ts?: number } {
  if (!msNode) return { kind: null, dir: null };
  const bos = msNode.lastBOS;
  const choch = msNode.lastCHOCH;

  const bosTs = Number.isFinite(bos?.ts) ? (bos.ts as number) : -Infinity;
  const chochTs = Number.isFinite(choch?.ts) ? (choch.ts as number) : -Infinity;

  const pick = bosTs >= chochTs ? bos : choch;
  const kind = pick?.kind === "BOS" || pick?.kind === "CHOCH" ? (pick.kind as "BOS" | "CHOCH") : null;
  const dir = pick?.dir === "UP" || pick?.dir === "DOWN" ? (pick.dir as "UP" | "DOWN") : null;
  const level = Number.isFinite(pick?.level) ? (pick.level as number) : undefined;
  const ts = Number.isFinite(pick?.ts) ? (pick.ts as number) : undefined;
  return { kind, dir, level, ts };
}

function structureTrendBadge(trend?: string) {
  const t = String(trend || "").toUpperCase();
  if (t === "BULL") return { label: "BULL", icon: <TrendingUp className="h-4 w-4" />, cls: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30" };
  if (t === "BEAR") return { label: "BEAR", icon: <TrendingDown className="h-4 w-4" />, cls: "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30" };
  if (t === "RANGE") return { label: "RANGE", icon: <Waves className="h-4 w-4" />, cls: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30" };
  return { label: "UNKNOWN", icon: <Minus className="h-4 w-4" />, cls: "bg-zinc-500/10 text-zinc-200 ring-1 ring-zinc-500/30" };
}
function TrendStructureCard({
  tf,
  badge,
  kind,
  dir,
  level,
  ts,
  confirmedCount,
}: {
  tf: string;
  badge: { label: string; icon: React.ReactNode; cls: string };
  kind: "BOS" | "CHOCH" | null;
  dir: "UP" | "DOWN" | null;
  level?: number;
  ts?: number;
  confirmedCount: string;
}) {
  const title = kind && dir ? `${kind} ${dir}` : "—";
  const price = Number.isFinite(level as number) ? `@ ${fmtPx(Number(level))}` : "";
  const ago = Number.isFinite(ts as number) ? relTime(Number(ts)) : "—";

  return (
    <div className="rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-extrabold text-zinc-100">{String(tf).toUpperCase()}</div>
        <span className={["inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", badge.cls].join(" ")}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      <div className="mt-2">
        <div className="text-sm font-extrabold leading-tight text-zinc-50">{title}</div>
        <div className="mt-0.5 text-xs text-zinc-200">{price || "\u00A0"}</div>
      </div>

      <div className="mt-2 text-[11px] text-zinc-400">Confirmed · {ago} · {confirmedCount}</div>
    </div>
  );
}

function signalLevelFromStale(staleSec?: number): 0 | 1 | 2 | 3 | 4 {
  // 0: unknown/no data
  if (!Number.isFinite(staleSec as number)) return 0;
  const s = staleSec as number;
  // Keep thresholds consistent with existing UI gate:
  // <= 1.5s (fresh), <= 5s (warn), > 5s (stale)
  if (s <= 1.5) return 4;
  if (s <= 5) return 3;
  // make stale visibly worse
  if (s <= 10) return 2;
  return 1;
}

function signalToneFromLevel(level: 0 | 1 | 2 | 3 | 4): string {
  // Tailwind classes (no inline colors)
  switch (level) {
    case 4:
      return "text-emerald-200";
    case 3:
      return "text-amber-200";
    case 2:
    case 1:
      return "text-rose-200";
    default:
      return "text-zinc-300";
  }
}

function signalRingFromLevel(level: 0 | 1 | 2 | 3 | 4): string {
  // background/ring consistent with your Pills
  switch (level) {
    case 4:
      return "bg-emerald-500/10 ring-1 ring-emerald-500/30";
    case 3:
      return "bg-amber-500/10 ring-1 ring-amber-500/30";
    case 2:
    case 1:
      return "bg-rose-500/10 ring-1 ring-rose-500/30";
    default:
      return "bg-zinc-500/10 ring-1 ring-zinc-500/30";
  }
}

function RealtimeSignal({
  staleSec,
  label = "Realtime",
  title,
  showSeconds = false,
}: {
  staleSec?: number;
  label?: string;
  title?: string;
  showSeconds?: boolean;
}) {
  const level = signalLevelFromStale(staleSec);
  const tone = signalToneFromLevel(level);
  const ring = signalRingFromLevel(level);

  // Bars: 4 columns, fill based on level
  // level=4 => all on; level=3 => first 3; level=2 => first 2; level=1 => first 1; level=0 => none
  const on = (idx: number) => level >= idx;

  const secText =
    Number.isFinite(staleSec as number) ? `${(staleSec as number).toFixed(1)}s` : "—";

  const tooltip =
    title ||
    (Number.isFinite(staleSec as number)
      ? `Realtime price freshness • last update ${secText} ago`
      : "Realtime price freshness • no timestamp");

  return (
    <span
      title={tooltip}
      className={[
        "inline-flex items-center gap-2 rounded-full px-3 h-7 text-[11px] font-semibold",
        "ring-1 ring-white/10 bg-white/5 text-zinc-100",
        ring,
      ].join(" ")}
      aria-label={`Realtime feed ${level === 0 ? "unknown" : level >= 3 ? "ok" : "stale"}`}
    >
      {/* Signal icon */}
      <span className={["inline-flex items-center", tone].join(" ")}>
        <svg
          width="18"
          height="14"
          viewBox="0 0 18 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block"
          aria-hidden="true"
        >
          {/* baseline */}
          <rect x="1" y="12" width="16" height="1" rx="0.5" fill="currentColor" opacity="0.35" />
          {/* bars */}
          <rect x="2" y="8" width="3" height="4" rx="1" fill="currentColor" opacity={on(1) ? 1 : 0.25} />
          <rect x="6.5" y="6" width="3" height="6" rx="1" fill="currentColor" opacity={on(2) ? 1 : 0.25} />
          <rect x="11" y="4" width="3" height="8" rx="1" fill="currentColor" opacity={on(3) ? 1 : 0.25} />
          <rect x="15.5" y="2" width="3" height="10" rx="1" fill="currentColor" opacity={on(4) ? 1 : 0.25} />
        </svg>
      </span>

      {/* Label */}
      <span className="whitespace-nowrap">{label}</span>

      {/* Optional seconds (small, secondary) */}
      {showSeconds ? (
        <span
          className={[
            "ml-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-100 ring-1 ring-white/10",
            "tabular-nums text-center",
            // Reserve space so the pill never changes width (prevents page jitter)
            "min-w-[46px]",
          ].join(" ")}
        >
          {secText}
        </span>
      ) : null}

    </span>
  );
}
function fmtPxWithSep(x?: number) {
  if (!Number.isFinite(x as number)) return "—";
  const v = x as number;

  // Giữ logic decimal như fmtPx nhưng thêm thousands separator
  let digits = 6;
  if (v >= 10000) digits = 0;
  else if (v >= 1000) digits = 1;
  else if (v >= 100) digits = 2;
  else if (v >= 1) digits = 4;

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(v);
}

function MidBadge({ mid }: { mid: number }) {
  const text = Number.isFinite(mid) ? `$${fmtPxWithSep(mid)}` : "—";

  return (
    <span
      className={[
        "flex items-center gap-2 rounded-full px-3 h-7 text-[11px] font-semibold",
        "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30",
        "tabular-nums min-w-[110px] justify-center",
      ].join(" ")}
      title="Realtime mid price"
    >
      {text}
    </span>
  );
}
function MidAssistButton({ mid }: { mid: number }) {
  const text = Number.isFinite(mid) ? `$${fmtPxWithSep(mid)}` : "—";

  return (
    <span
      className={[
        // iOS AssistiveTouch-ish: blurred, subtle ring, soft shadow
        "inline-flex items-center justify-center",
        "h-8 rounded-full px-3",
        "bg-white/10 backdrop-blur-md",
        "ring-1 ring-white/20",
        "shadow-[0_10px_24px_rgba(0,0,0,0.35)]",
        "text-[11px] font-semibold tabular-nums",
        "text-zinc-100/90",
        "select-none",
      ].join(" ")}
      title="Realtime mid price"
    >
      {text}
    </span>
  );
}
/** ---------- Small UI atoms ---------- */
function SideIcon({ side }: { side: string }) {
  if (side === "LONG") {
    return <span className="text-emerald-400">↑</span>;
  }
  if (side === "SHORT") {
    return <span className="text-rose-400">↓</span>;
  }
  return <span className="text-zinc-400">⇅</span>; // ALL
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "FORMING":
      return <span className="text-zinc-400">⏳</span>;
    case "READY":
      return <span className="text-emerald-400">✔︎</span>;
    case "TRIGGERED":
      return <span className="text-sky-400">⚡</span>;
    case "INVALIDATED":
      return <span className="text-rose-400">✖︎</span>;
    case "EXPIRED":
      return <span className="text-amber-400">⏰</span>;
    default:
      return <span className="text-zinc-400">◯</span>; // ALL
  }
}

function SelectCaret() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      className="pointer-events-none text-zinc-300"
    >
      <path
        fill="currentColor"
        d="M5.5 7.5L10 12l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Pill({
  children,
  tone,
  icon,
  title,
  className,
  fullWidth,
}: {
  children: React.ReactNode;
  tone?: string;
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  fullWidth?: boolean;
}) {
  return (
    <span
      title={title}
      className={[
        "flex items-center gap-2 rounded-full px-3 h-7 text-[11px] font-semibold",
        "bg-white/[0.04] text-zinc-100 shadow-[0_1px_0_rgba(255,255,255,0.05)] backdrop-blur",
        fullWidth ? "w-full justify-center" : "inline-flex",
        tone || "",
        className || "",
      ].join(" ")}
    >
      {icon ? <span className="opacity-90">{icon}</span> : null}
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}
function Card({
  title,
  icon,
  right,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "rounded-2xl bg-zinc-950/40 backdrop-blur",
        "ring-1 ring-white/5",
        "shadow-[0_1px_0_rgba(255,255,255,0.06),0_24px_70px_rgba(0,0,0,0.45)]",
        className || "",
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="rounded-2xl bg-white/[0.04] p-2.5 shadow-[0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/5">{icon}</div>
          <div>
            <div className="text-[13px] font-extrabold tracking-tight text-zinc-50">{title}</div>
          </div>
        </div>
        {right ? <div className="pt-1">{right}</div> : null}
      </header>
      <div className="px-4 pb-4 pt-3">{children}</div>
    </section>
  );
}

function Meter({
  label,
  value01,
  right,
  intent,
}: {
  label: React.ReactNode;
  value01?: number;
  right?: React.ReactNode;
  intent?: "good" | "warn" | "bad" | "neutral";
}) {
  const v = Number.isFinite(value01 as number) ? clamp01(value01 as number) : undefined;
  const cls =
    intent === "good"
      ? "bg-emerald-500/70"
      : intent === "warn"
        ? "bg-amber-500/70"
        : intent === "bad"
          ? "bg-rose-500/70"
          : "bg-sky-500/70";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="text-zinc-300">{label}</div>
        <div className="text-zinc-100">{right ?? (v !== undefined ? fmtPct01(v) : "—")}</div>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
        <div className={["h-full rounded-full", cls].join(" ")} style={{ width: `${v !== undefined ? v * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function KV({
  k,
  v,
}: {
  k: string;
  v: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-xs text-zinc-400">{k}</div>
      <div className="text-xs font-semibold text-zinc-100 text-right">{v}</div>
    </div>
  );
}

function Divider() {
  return <div className="my-4 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />;
}
function relTime(ts?: number) {
  if (!Number.isFinite(ts as number)) return "—";
  const t = ts as number;
  if (t <= 0) return "—";

  const now = Date.now();
  const diffSec = (t - now) / 1000;
  const abs = Math.abs(diffSec);

  if (abs < 2) return "just now";

  const fmt = (n: number, u: string) => `${n}${u}`;
  if (abs < 60) {
    const v = Math.round(abs);
    return diffSec > 0 ? `in ${fmt(v, "s")}` : `${fmt(v, "s")} ago`;
  }
  const m = abs / 60;
  if (m < 60) {
    const v = Math.round(m);
    return diffSec > 0 ? `in ${fmt(v, "m")}` : `${fmt(v, "m")} ago`;
  }
  const h = m / 60;
  if (h < 24) {
    const v = Math.round(h);
    return diffSec > 0 ? `in ${fmt(v, "h")}` : `${fmt(v, "h")} ago`;
  }
  const d = h / 24;
  const v = Math.round(d);
  return diffSec > 0 ? `in ${fmt(v, "d")}` : `${fmt(v, "d")} ago`;
}

export function TradingView({

  symbol,
  paused,
  inputSymbol,
  setInputSymbol,
  setPaused,
  onAnalyze,
  onEnterInput,
  // NEW
  symbolInputEnabled,
}: {
  symbol: string;
  paused: boolean;
  inputSymbol: string;
  setInputSymbol: React.Dispatch<React.SetStateAction<string>>;
  setPaused: React.Dispatch<React.SetStateAction<boolean>>;
  onAnalyze: () => void;
  onEnterInput: React.KeyboardEventHandler<HTMLInputElement>;

  // NEW: input is enabled only when Scan is OFF, or Scan is paused
  symbolInputEnabled: boolean;

}) {

  const { snap, features, setups, executionGlobal: execGlobalRaw, feedStatus: feedStatusRaw } = useSetupsSnapshot(symbol, paused);

  const out = (setups as unknown as SetupsOutput | null) ?? null;
  const executionGlobal = useMemo(() => {
    // Prefer hook-level fields, fall back to out.* if present.
    return (
      normalizeExecutionGlobal(execGlobalRaw) ||
      normalizeExecutionGlobal(out?.executionGlobal) ||
      null
    );
  }, [execGlobalRaw, out?.executionGlobal]);

  const feedStatus = useMemo(() => {
    return (
      normalizeFeedStatus(feedStatusRaw) ||
      normalizeFeedStatus(out?.feedStatus) ||
      normalizeFeedStatus(out) || // allow normalizeFeedStatus to read out.telemetry
      null
    );
  }, [feedStatusRaw, out?.feedStatus, out]);

  // Live derived metrics (best-effort)
  const mid = useMemo(() => {
    const m = Number(snap?.price?.mid);
    if (Number.isFinite(m)) return m;
    const bid = Number(snap?.price?.bid);
    const ask = Number(snap?.price?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
    return NaN;
  }, [snap?.price?.mid, snap?.price?.bid, snap?.price?.ask]);

  const staleSec = useMemo(() => {
    const ts = Number(snap?.price?.ts);
    if (!Number.isFinite(ts)) return undefined;
    return (Date.now() - ts) / 1000;
  }, [snap?.price?.ts]);

  const dq = features?.quality?.dq_grade;
  const bybitOk = Boolean(features?.quality?.bybit_ok);
  const binanceOk = Boolean(features?.quality?.binance_ok);
  const dqOk = Boolean(out?.dq_ok ?? (dq === "A" || dq === "B"));

  const lastUpdated = out?.ts ? relTime(out.ts) : "—";

  // Setup selection
  const ranked = useMemo(() => {
    const arr = out?.setups || [];
    return [...arr].sort((a, b) => {
      const pa = Number(a?.priority_score ?? 0);
      const pb = Number(b?.priority_score ?? 0);
      if (pb !== pa) return pb - pa;
      const ca = Number(a?.confidence?.score ?? 0);
      const cb = Number(b?.confidence?.score ?? 0);
      return cb - ca;
    });
  }, [out?.setups]);
  const rankedWithIndex = useMemo(() => {
    return (ranked || []).map((s, idx) => ({ s, idx }));
  }, [ranked]);
  // ---------- Queue Controls (persisted) ----------

  const [qSide, setQSide] = useLocalStorageState<"ALL" | "LONG" | "SHORT">("ct_ui_q_side", "ALL", {
    serialize: (v) => String(v),
    deserialize: (raw) => {
      const r = String(raw || "ALL").toUpperCase();
      return (r === "LONG" || r === "SHORT" || r === "ALL") ? (r as any) : "ALL";
    },
  });

  const [qStatus, setQStatus] = useLocalStorageState<"ALL" | SetupStatus>("ct_ui_q_status", "ALL", {
    serialize: (v) => String(v),
    deserialize: (raw) => {
      const r = String(raw || "ALL").toUpperCase();
      const ok =
        r === "ALL" ||
        r === "FORMING" ||
        r === "READY" ||
        r === "TRIGGERED" ||
        r === "INVALIDATED" ||
        r === "EXPIRED";
      return ok ? (r as any) : "ALL";
    },
  });

  const applyQueueFilters = useCallback(
    (items: Array<{ s: TradeSetup; idx: number }>) => {
      let arr = items;

      if (qSide !== "ALL") {
        arr = arr.filter(({ s }) => String(s.side) === qSide);
      }

      if (qStatus !== "ALL") {
        arr = arr.filter(({ s }) => String(s.status) === qStatus);
      }

      // Keep upstream order (ranked order) to avoid breaking View/accordion behavior.
      return arr;
    },
    [qSide, qStatus]
  );


  const scalpRanked = useMemo(() => {
    const base = rankedWithIndex.filter(({ s }) => isScalpSetupUi(s));
    return applyQueueFilters(base);
  }, [rankedWithIndex, applyQueueFilters]);

  const nonScalpRanked = useMemo(() => {
    const base = rankedWithIndex.filter(({ s }) => !isScalpSetupUi(s));
    return applyQueueFilters(base);
  }, [rankedWithIndex, applyQueueFilters]);


  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const focusedSetup: TradeSetup | null = useMemo(() => {
    if (!ranked || ranked.length === 0) return null;
    if (expandedKey != null && expandedKey >= 0 && expandedKey < ranked.length) {
      return ranked[expandedKey] as any;
    }
    return ranked[0] as any;
  }, [ranked, expandedKey]);

  const [showLevelsMore, setShowLevelsMore] = useState(false);
  const [showDataCompleteness, setShowDataCompleteness] = useState(false);
  const [showKeyLevels, setShowKeyLevels] = useState(false);

  // Auto-select once when setups appear or symbol changes
  const lastSymbolRef = useRef(symbol);
  useEffect(() => {
    if (lastSymbolRef.current !== symbol) {
      lastSymbolRef.current = symbol;
      setExpandedKey(null);
    }
  }, [symbol]);

  const toggleExpanded = (key: number) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };


  // Banner for ACTIONABLE (state-machine based, policy-safe)
  const actionableKeys = useMemo(() => {
    return (out?.setups || [])
      .filter((s) => isSetupActionableNow(s, executionGlobal))
      .map((s) => stableSetupKey(s));
  }, [out?.setups, executionGlobal]);

  const prevActionableRef = useRef<string[]>([]);
  const [banner, setBanner] = useState<{ active: boolean; text: string }>({ active: false, text: "" });

  useEffect(() => {
    const prev = prevActionableRef.current;
    const now = actionableKeys;
    prevActionableRef.current = now;

    const newOnes = now.filter((k) => !prev.includes(k));

    if (newOnes.length > 0) {
      const s = ranked.find((x) => stableSetupKey(x) === newOnes[0]);
      const text = s
        ? `ACTION: ${symbol} • ${humanizeType(s.type)} • ${s.side} • ${String(s.execution?.state || "")} • RR ${Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"} • Conf ${fmtScore100(s.confidence?.score)}`
        : "Actionable setup detected";
      setBanner({ active: true, text });
      try {
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      } catch { }
    } else {
      if (now.length === 0 && banner.active) setBanner({ active: false, text: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionableKeys.join("|")]);


  // Market context
  const biasDir = useMemo(() => {
    const d = normDir(features?.bias?.trend_dir);
    if (d === "bull") return "BULL";
    if (d === "bear") return "BEAR";
    if (d === "sideways") return "SIDEWAYS";
    return "—";
  }, [features?.bias?.trend_dir]);

  const biasStrength01 = useMemo(() => {
    const v = Number(features?.bias?.trend_strength);
    return Number.isFinite(v) ? clamp01(v) : undefined;
  }, [features?.bias?.trend_strength]);

  const volRegime = useMemo(() => {
    const v = String(features?.bias?.vol_regime || "").toUpperCase();
    return v || "—";
  }, [features?.bias?.vol_regime]);

  const crossConsensus01 = useMemo(() => {
    const v = Number(features?.cross?.consensus_score);
    return Number.isFinite(v) ? clamp01(v) : undefined;
  }, [features?.cross?.consensus_score]);
  const crossConsensusPending = useMemo(() => {
    // Only show "pending" when Binance is OK (so user understands it's warming up, not broken)
    const binOk = !!snap?.availability?.binance?.ok;
    if (!binOk) return false;

    const dev = Number(features?.cross?.dev_bps);
    const cons = Number(features?.cross?.consensus_score);

    // consensus_score depends on dev_bps; if either missing => still computing
    if (!Number.isFinite(dev)) return true;
    if (!Number.isFinite(cons)) return true;

    return false;
  }, [snap?.availability?.binance?.ok, features?.cross?.dev_bps, features?.cross?.consensus_score]);


  // key levels extracted from structure events and swings (HTF emphasis)
  const keyLevels = useMemo(() => {
    const ms = features?.market_structure;
    if (!ms) return [];
    const tfs = ["4h", "1h", "15m", "5m"];
    const outLevels: Array<{ tf: string; kind: string; dir: string; level?: number; ts?: number }> = [];

    for (const tf of tfs) {
      const node = (ms as any)[tf];
      if (!node) continue;

      const e = pickLatestStructureEvent(node);
      if (e.kind && e.dir && Number.isFinite(e.level)) {
        outLevels.push({ tf, kind: e.kind, dir: e.dir, level: e.level, ts: e.ts });
      }
      // swings: show latest swing high/low if present
      if (Number.isFinite(node?.lastSwingHigh?.price)) {
        outLevels.push({ tf, kind: "SWING_HIGH", dir: "—", level: node.lastSwingHigh.price, ts: node.lastSwingHigh.ts });
      }
      if (Number.isFinite(node?.lastSwingLow?.price)) {
        outLevels.push({ tf, kind: "SWING_LOW", dir: "—", level: node.lastSwingLow.price, ts: node.lastSwingLow.ts });
      }
    }

    // de-dup within tolerance
    const uniq: typeof outLevels = [];
    for (const l of outLevels) {
      const exists = uniq.find((x) => x.tf === l.tf && x.kind === l.kind && Math.abs((x.level ?? 0) - (l.level ?? 0)) < 1e-9);
      if (!exists) uniq.push(l);
    }

    return uniq.slice(0, 12);
  }, [features?.market_structure]);
  const keyLevelsView = showLevelsMore ? keyLevels : keyLevels.slice(0, 6);
  function tfToMs(tf: string): number {
    const s = String(tf || "").trim().toLowerCase();
    if (!s) return 0;

    // common aliases
    if (s === "1d" || s === "d" || s === "1day") return 24 * 60 * 60 * 1000;

    const m = s.match(/^(\d+)\s*([mhd])$/);
    if (!m) return 0;
    const n = Number(m[1]);
    const u = m[2];
    if (!Number.isFinite(n) || n <= 0) return 0;

    if (u === "m") return n * 60 * 1000;
    if (u === "h") return n * 60 * 60 * 1000;
    if (u === "d") return n * 24 * 60 * 60 * 1000;
    return 0;
  }

  function lastCandleTs(arr: any[]): number | null {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const last = arr[arr.length - 1];
    const ts = Number(last?.ts);
    return Number.isFinite(ts) ? ts : null;
  }

  // A compact health summary for each TF from snap (stale/partial/availability)
  const tfHealth = useMemo(() => {
    const now = Date.now();

    const tfs = (snap?.timeframes || []).map((x: any) => {
      const tf = String(x?.tf || "");

      const bybitArr = Array.isArray(x?.candles?.ohlcv) ? x.candles.ohlcv : [];
      const binanceArr = Array.isArray(x?.candles_binance?.ohlcv) ? x.candles_binance.ohlcv : [];

      const haveCandlesBybit = bybitArr.length;
      const haveCandlesBinance = binanceArr.length;

      // Prefer bybit last candle; fallback to binance
      const lastTs =
        lastCandleTs(bybitArr) ??
        lastCandleTs(binanceArr);

      const tfMs = tfToMs(tf);
      const ageMs = lastTs != null ? Math.max(0, now - lastTs) : NaN;

      // staleBars = how many full TF intervals behind "now"
      const staleBars =
        Number.isFinite(ageMs) && tfMs > 0 ? Math.floor(ageMs / tfMs) : NaN;

      // If backend provides diagnostics.stale_ms and it's > 0, you can keep it as reference,
      // but we will prefer computed ageMs for display.
      const backendStaleMs = Number(x?.diagnostics?.stale_ms);

      const partial =
        Boolean(x?.diagnostics?.partial) ||
        (haveCandlesBybit === 0 && haveCandlesBinance === 0);

      return {
        tf,
        // computed
        tfMs,
        lastTs,
        ageMs,
        staleBars,
        // raw/backend
        backendStaleMs,
        partial,
        haveCandlesBybit,
        haveCandlesBinance,
        haveTrades: Array.isArray(x?.orderflow?.trades) ? x.orderflow.trades.length : 0,
        haveOrderbook: Boolean(x?.orderflow?.orderbook),
      };
    });

    return tfs.sort((a, b) => a.tf.localeCompare(b.tf));
  }, [snap?.timeframes]);

  const [showTfHealthMore, setShowTfHealthMore] = useState(false);

  const tfHealthPrimary = useMemo(() => {
    const priority = ["1h", "15m", "5m", "4h"];
    return priority
      .map((tf) => tfHealth.find((t) => t.tf === tf))
      .filter(Boolean) as typeof tfHealth;
  }, [tfHealth]);

  const tfHealthView = showTfHealthMore ? tfHealth : tfHealthPrimary;

  const appBlocked = executionGlobal?.state === "BLOCKED";

  return (
    <>
      <style>{`
      /* ECG "beat" styling (scoped by class names) */
      .ct-ecg-dot {
        filter: drop-shadow(0 0 6px rgba(16,185,129,0.25));
      }

      /* Optional: subtle breathing on the whole svg to feel alive */
      @keyframes ct-ecg-breathe {
        0%, 100% { opacity: 0.90; }
        50% { opacity: 1; }
      }
      .ct-ecg-breathe {
        animation: ct-ecg-breathe 1.25s ease-in-out infinite;
      }
    `}</style>
      <div className="min-h-dvh bg-[#070A12] text-zinc-100 antialiased selection:bg-sky-500/20 selection:text-sky-50"
      >
        {/* subtle background */}
        <div className="pointer-events-none fixed inset-0 opacity-50">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] via-transparent to-black/30" />
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute -bottom-44 left-1/3 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute -bottom-52 right-1/4 h-[520px] w-[520px] translate-x-1/2 rounded-full bg-rose-500/10 blur-3xl" />
        </div>

        <div
          className={[
            // Mobile: full width + safe-area friendly padding
            "relative w-full",
            "px-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))]",
            "pt-[max(12px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]",
            // Desktop: keep centered max width
            "md:mx-auto md:max-w-7xl md:px-6 md:pt-5 md:pb-10",
          ].join(" ")}
        >
          {/* Top bar */}
          <div className="flex flex-col gap-4 rounded-3xl bg-zinc-950/35 p-5 backdrop-blur ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.06),0_28px_90px_rgba(0,0,0,0.55)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl bg-white/[0.04] p-2.5 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.05)]">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div className="text-lg font-black tracking-tight text-zinc-50">Crypto Setup Analyzer</div>
                </div>
                <div className="text-[12px] leading-snug text-zinc-300/70">
                  Frontend-only • Realtime snapshot → features → setups • Built for iPhone/iPad clarity
                </div>
              </div>

              <div className="grid w-full grid-cols-1 gap-2 md:w-[520px] md:grid-cols-[1fr_auto_auto]">
                <div
                  className={[
                    "group flex items-center gap-2 rounded-2xl px-3 py-2.5 transition",
                    symbolInputEnabled
                      ? "bg-white/[0.045] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] focus-within:ring-sky-500/25 focus-within:bg-white/[0.06]"
                      : "bg-white/[0.03] ring-1 ring-white/5 opacity-80",
                  ].join(" ")}
                  title={
                    symbolInputEnabled
                      ? "Enter a symbol to analyze"
                      : "Disabled while scanning. Pause scan or turn Scan OFF to enter a symbol."
                  }
                >
                  <Database className={["h-4 w-4", symbolInputEnabled ? "text-zinc-300" : "text-zinc-600"].join(" ")} />
                  <input
                    value={inputSymbol}
                    onChange={(e) => setInputSymbol(String(e.target.value || "").toUpperCase())}
                    onKeyDown={onEnterInput}
                    disabled={!symbolInputEnabled}
                    placeholder="BTCUSDT"
                    className={[
                      "w-full bg-transparent text-sm font-semibold outline-none",
                      symbolInputEnabled
                        ? "text-zinc-50 placeholder:text-zinc-500"
                        : "text-zinc-500 placeholder:text-zinc-700 cursor-not-allowed",
                    ].join(" ")}
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </div>

                <button
                  onClick={onAnalyze}
                  disabled={!symbolInputEnabled}
                  className={[
                    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-extrabold tracking-tight transition",
                    symbolInputEnabled
                      ? "bg-gradient-to-b from-sky-500/30 to-sky-500/15 text-sky-50 shadow-[0_10px_30px_rgba(56,189,248,0.14)] hover:from-sky-500/35 hover:to-sky-500/18 active:from-sky-500/40"
                      : "bg-white/[0.04] text-zinc-500 cursor-not-allowed shadow-none",
                  ].join(" ")}
                  title={
                    symbolInputEnabled
                      ? "Analyze input symbol"
                      : "Disabled while scanning. Pause scan or turn Scan OFF to analyze a symbol."
                  }
                >
                  <RefreshCw className="h-4 w-4" />
                  Analyze
                </button>

                <button
                  onClick={() => setPaused((p) => !p)}
                  className={[
                    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-extrabold tracking-tight transition",
                    paused
                      ? "bg-gradient-to-b from-rose-500/28 to-rose-500/14 text-rose-50 shadow-[0_10px_30px_rgba(244,63,94,0.12)] hover:from-rose-500/32 hover:to-rose-500/16"
                      : "bg-gradient-to-b from-emerald-500/26 to-emerald-500/12 text-emerald-50 shadow-[0_10px_30px_rgba(16,185,129,0.12)] hover:from-emerald-500/30 hover:to-emerald-500/14",
                  ].join(" ")}
                  title={paused ? "Resume updates" : "Pause updates"}
                >
                  {paused ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <EcgBeatIcon className="h-5 w-5 text-emerald-100 ct-ecg-breathe" />
                  )}

                  <span className="inline-flex items-center gap-2">
                    <span>{paused ? "Paused" : "Live"}</span>

                    {!paused ? (
                      <span className="relative inline-flex h-2.5 w-2.5" aria-label="Live indicator">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-200/40" />
                        <span className="relative inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-200 shadow-[0_0_0_3px_rgba(16,185,129,0.10)]" />
                      </span>
                    ) : null}
                  </span>
                </button>
              </div>

            </div>

            {/* status row */}
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={dqTone(dq)} icon={dqOk ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}>
                DQ {String(dq || "—")}
              </Pill>
              <Pill
                tone={bybitOk ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30" : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"}
                icon={bybitOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                title="Bybit feed health (execution venue)"
              >
                Bybit {bybitOk ? "OK" : "NOT OK"}
              </Pill>
              <Pill
                tone={binanceOk ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30" : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"}
                icon={binanceOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                title="Binance feed health (cross exchange context)"
              >
                Binance {binanceOk ? "OK" : "NOT OK"}
              </Pill>
              {crossConsensusPending ? (
                <Pill
                  tone="bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                  icon={<Clock className="h-4 w-4" />}
                  title="Computing cross-exchange consensus"
                >
                  Computing consensus <AnimatedEllipsis />
                </Pill>
              ) : null}
              <RealtimeSignal
                staleSec={staleSec}
                label="Realtime"
                // Nếu bạn muốn vẫn thấy số giây nhỏ bên cạnh, bật true:
                showSeconds={true}
                title="Realtime price feed health (based on snap.price.ts)"
              />
              <div className="ml-auto text-xs text-zinc-400">Updated {lastUpdated}</div>
            </div>

            {/* banner */}
            {banner.active ? (
              <div className="mt-1 flex items-start justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-emerald-500/15 p-2 ring-1 ring-emerald-500/25">
                    <Flame className="h-4 w-4 text-emerald-200" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-emerald-100">Actionable setup detected</div>
                    <div className="mt-0.5 text-xs text-emerald-100/90">{banner.text}</div>
                  </div>
                </div>
                <button
                  onClick={() => setBanner({ active: false, text: "" })}
                  className="rounded-2xl bg-white/[0.04] px-3 py-2 text-xs font-extrabold tracking-tight text-zinc-50 shadow-[0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.08]">
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
          {/* Main layout */}
          <div className="mt-4 grid grid-cols-1 gap-4 min-[1440px]:grid-cols-[380px_1fr]">
            {/* LEFT: queue */}
            <div className="space-y-4">
              <Card
                title="Market Context"
                icon={<LineChart className="h-5 w-5" />}
                right={
                  <div className="flex items-center gap-2">
                    <MidBadge mid={mid} />
                    <Pill
                      tone={
                        biasDir === "BULL"
                          ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30"
                          : biasDir === "BEAR"
                            ? "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"
                            : biasDir === "SIDEWAYS"
                              ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                              : "bg-zinc-500/10 text-zinc-200 ring-1 ring-zinc-500/30"
                      }
                      icon={
                        biasDir === "BULL"
                          ? <TrendingUp className="h-4 w-4" />
                          : biasDir === "BEAR"
                            ? <TrendingDown className="h-4 w-4" />
                            : <Waves className="h-4 w-4" />
                      }
                    >
                      {biasDir}
                    </Pill>
                  </div>
                }
              >
                <div className="space-y-3">
                  <Meter
                    label="Bias strength"
                    value01={biasStrength01}
                    intent={biasStrength01 != null && biasStrength01 >= 0.62 ? "good" : "warn"}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                        <Waves className="h-4 w-4 text-zinc-300" />
                        Volatility regime
                      </div>
                      <div className="mt-2">
                        <Pill
                          tone={
                            volRegime === "HIGH"
                              ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                              : volRegime === "LOW"
                                ? "bg-zinc-500/10 text-zinc-200 ring-1 ring-zinc-500/30"
                                : "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/30"
                          }
                        >
                          {volRegime}
                        </Pill>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        <KV k="ADX14" v={Number.isFinite(Number(features?.bias?.adx14)) ? fmtNum(Number(features?.bias?.adx14), 1) : "—"} />
                        <KV k="EMA200" v={Number.isFinite(Number(features?.bias?.ema200)) ? fmtPx(Number(features?.bias?.ema200)) : "—"} />
                        <KV
                          k="EMA200 slope (bps/bar)"
                          v={Number.isFinite(Number(features?.bias?.ema200_slope_bps)) ? fmtNum(Number(features?.bias?.ema200_slope_bps), 1) : "—"}
                        />
                      </div>
                    </div>

                    <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                        <Layers className="h-4 w-4 text-zinc-300" />
                        Cross / Consensus
                      </div>
                      <div className="mt-2">
                        <Meter
                          label={
                            <span className="inline-flex items-center gap-1">
                              <span>Consensus</span>
                              {crossConsensusPending ? <AnimatedEllipsis /> : null}
                            </span>
                          }
                          value01={crossConsensus01}
                          right={crossConsensus01 != null ? fmtPct01(crossConsensus01) : "—"}
                          intent={crossConsensus01 != null && crossConsensus01 >= 0.65 ? "good" : crossConsensus01 != null && crossConsensus01 <= 0.35 ? "warn" : "neutral"}
                        />
                      </div>
                      {null}
                      <div className="mt-3 space-y-1.5">
                        <KV k="dev_bps" v={Number.isFinite(Number(features?.cross?.dev_bps)) ? `${fmtNum(Number(features?.cross?.dev_bps), 1)} bps` : "—"} />
                        <KV k="dev_z" v={Number.isFinite(Number(features?.cross?.dev_z)) ? fmtNum(Number(features?.cross?.dev_z), 2) : "—"} />
                        <KV
                          k="lead/lag"
                          v={
                            features?.cross?.lead_lag
                              ? `${String(features.cross.lead_lag.leader)} • ${fmtNum(Number(features.cross.lead_lag.lag_bars), 0)} bars • ${fmtPct01(Number(features.cross.lead_lag.score))}`
                              : "—"
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
              {/* Trend by timeframe (Structure) */}
              <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                  <LineChart className="h-4 w-4 text-zinc-300" />
                  Trend by timeframe (Structure)
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {["4h", "1h", "15m", "5m"].map((tf) => {
                    const node = (features?.market_structure as any)?.[tf];
                    const badge = structureTrendBadge(node?.trend);
                    const e = pickLatestStructureEvent(node);

                    return (
                      <TrendStructureCard
                        key={tf}   // 👈 FIX: thêm key
                        tf={tf}
                        badge={badge}
                        kind={e.kind}
                        dir={e.dir}
                        level={e.level}
                        ts={e.ts}
                        confirmedCount={
                          Number.isFinite(Number(node?.confirmed_count))
                            ? fmtNum(Number(node?.confirmed_count), 0)
                            : "—"
                        }
                      />
                    );
                  })}
                </div>
              </div>
              <Card title="Setup Queue" icon={<Target className="h-5 w-5" />} right={<div className="text-xs text-zinc-400">{ranked.length} setups</div>}>
                {/* Queue filters */}
                <div className="mb-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="relative mt-1">
                      <div className="pointer-events-none absolute left-2 inset-y-0 flex items-center">
                        <SideIcon side={qSide} />
                      </div>

                      <select
                        className="w-full appearance-none bg-transparent pl-7 pr-8 text-sm font-semibold text-zinc-100 outline-none"
                        value={qSide}
                        onChange={(e) => setQSide(e.target.value as any)}
                      >
                        <option value="ALL">All Sides</option>
                        <option value="LONG">Long only</option>
                        <option value="SHORT">Short only</option>
                      </select>

                      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                        <SelectCaret />
                      </div>
                    </div>

                    <div className="relative mt-1">
                      <div className="pointer-events-none absolute left-2 inset-y-0 flex items-center">
                        <StatusIcon status={qStatus} />
                      </div>

                      <select
                        className="w-full appearance-none bg-transparent pl-7 pr-8 text-sm font-semibold text-zinc-100 outline-none"
                        value={qStatus}
                        onChange={(e) => setQStatus(e.target.value as any)}
                      >
                        <option value="ALL">All Statuses</option>
                        <option value="FORMING">Forming</option>
                        <option value="READY">Ready</option>
                        <option value="TRIGGERED">Triggered</option>
                        <option value="INVALIDATED">Invalidated</option>
                        <option value="EXPIRED">Expired</option>
                      </select>

                      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                        <SelectCaret />
                      </div>
                    </div>


                  </div>
                </div>

                {executionGlobal?.state === "BLOCKED" ? (
                  <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-rose-500/15 p-2 ring-1 ring-rose-500/25">
                        <ShieldAlert className="h-5 w-5 text-rose-200" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-rose-100">Execution blocked (system gate)</div>
                        <div className="mt-1 text-xs text-rose-100/90">
                          The system is running, but execution actions are blocked by policy/health gates. You may still review market context and monitor setups.
                        </div>

                        {Array.isArray(executionGlobal.reasons) && executionGlobal.reasons.length > 0 ? (
                          <div className="mt-3 space-y-1.5 text-xs">
                            {executionGlobal.reasons.slice(0, 6).map((r) => (
                              <div key={r} className="flex items-start gap-2">
                                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-rose-200/70" />
                                <span className="min-w-0">{formatExecutionGlobalReason(r)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <Pill tone={dqTone(dq)} icon={<Database className="h-4 w-4" />}>
                            DQ {String(dq || "—")}
                          </Pill>
                          <Pill
                            tone={bybitOk ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30" : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"}
                            icon={bybitOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                          >
                            Bybit {bybitOk ? "OK" : "NOT OK"}
                          </Pill>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {(() => {
                      const publishedCount = ranked.length;
                      const state = deriveFeedUiState(feedStatus, publishedCount);

                      if (state === "HAS_SETUPS") {
                        const renderList = (items: Array<{ s: TradeSetup; idx: number }>) => {
                          if (!items || items.length === 0) {
                            return (
                              <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3 text-xs text-zinc-400">
                                No setups in this category right now.
                              </div>
                            );
                          }

                          return items.map(({ s, idx }) => {
                            const keyStr = stableSetupKey(s);
                            const reactKey = `${keyStr}::${idx}`;
                            const accordionKey = idx;
                            const isOpen = expandedKey === accordionKey;

                            const pri = Number.isFinite(Number(s.priority_score)) ? Number(s.priority_score) : 0;
                            const pri01 = clamp01(pri / 100);

                            const chip = actionChip(s, executionGlobal);
                            const entryText = fmtEntryZone(s.entry?.zone);
                            const slText = fmtPx(s.stop?.price);
                            const tpText = fmtTpSummary(s.tp);

                            return (
                              <div
                                key={reactKey}
                                className={[
                                  "rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] transition",
                                  isOpen ? "bg-white/[0.06] ring-sky-500/25 shadow-[0_0_0_3px_rgba(56,189,248,0.12)]" : "hover:bg-white/[0.05]",
                                ].join(" ")}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <div className="truncate text-sm font-extrabold text-zinc-50">{humanizeType(String(s.type))}</div>
                                      <div className={["text-sm font-extrabold", sideTone(s.side)].join(" ")}>{s.side}</div>
                                      {isMonitorOnlySetup(s) ? (
                                        <Pill tone="bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30" title="Grade C policy">
                                          MONITOR-ONLY
                                        </Pill>
                                      ) : null}
                                    </div>

                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                      <span>C: {fmtScore100(s.confidence?.score)}</span>
                                      <span>•</span>
                                      <span>RR: {Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"}</span>
                                      <span>•</span>
                                      <span>P: {Number.isFinite(s.priority_score) ? s.priority_score : "—"}</span>
                                      <span>•</span>
                                      <span>[{uiGrade(s)}]</span>
                                    </div>

                                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                                      <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${pri01 * 100}%` }} />
                                    </div>

                                  </div>

                                  <div className="flex shrink-0 flex-col items-end justify-center gap-2">
                                    <div className="grid justify-items-end gap-2">
                                      <Pill tone={statusTone(s.status)}>{s.status}</Pill>
                                      {chip ? (
                                        <Pill tone={chip.tone} icon={chip.icon}>
                                          {chip.label}
                                        </Pill>
                                      ) : null}
                                    </div>

                                  </div>
                                </div>
                                {/* Mid (anchored above the divider, left-aligned) */}
                                <div className="mt-2 -mb-2">
                                  <div className="tabular-nums text-[11px] font-semibold text-zinc-300 ">
                                    <span className="text-amber-200/90">Mid:</span>{" "}
                                    <span className="text-zinc-100">
                                      {Number.isFinite(mid) ? `$${fmtPxWithSep(mid)}` : "—"}
                                    </span>
                                  </div>
                                </div>

                                {/* Bottom bar: Entry / TP / SL + View (anchored at the bottom of the setup card) */}
                                <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/5 pt-2 text-[11px] font-semibold">
                                  {/* Left: Entry / TP / SL */}
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="tabular-nums text-sky-300">
                                      <span className="font-bold text-sky-200">E:</span> {entryText}
                                    </span>

                                    <span className="tabular-nums text-emerald-300">
                                      <span className="font-bold text-emerald-200">TP:</span> {tpText}
                                    </span>

                                    <span className="tabular-nums text-rose-300">
                                      <span className="font-bold text-rose-200">SL:</span> {slText}
                                    </span>
                                  </div>

                                  {/* Right: View / Hide */}
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(accordionKey)}
                                    className={[
                                      "ml-2 inline-flex items-center gap-1",
                                      "rounded-xl bg-white/[0.04] px-2 py-1 shadow-[0_1px_0_rgba(255,255,255,0.04)]",
                                      "text-[10px] font-extrabold tracking-tight",
                                      "text-zinc-200/80 hover:text-zinc-50",
                                      "hover:bg-white/[0.07]",
                                      "transition",
                                    ].join(" ")}
                                    aria-label={isOpen ? "Hide setup details" : "View setup details"}
                                    title={isOpen ? "Hide details" : "View details"}
                                  >
                                    {isOpen ? (
                                      <>
                                        <Minus className="h-3 w-3" />
                                        <span className="hidden sm:inline">Hide</span>
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="h-3 w-3" />
                                        <span className="hidden sm:inline">View</span>
                                      </>
                                    )}
                                  </button>
                                </div>

                                {isOpen ? (
                                  <div className="mt-3">
                                    <Divider />
                                    <SetupDetail
                                      setup={s}
                                      symbol={symbol}
                                      mid={mid}
                                      dqOk={dqOk}
                                      bybitOk={bybitOk}
                                      staleSec={staleSec}
                                      paused={paused}
                                      features={features}
                                      executionGlobal={executionGlobal}
                                    />

                                  </div>
                                ) : null}
                              </div>
                            );
                          });
                        };

                        return (
                          <div className="space-y-4">
                            {/* SCALP panel */}
                            <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3 ring-1 ring-white/10">
                              <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-extrabold text-zinc-100">
                                  <Sparkles className="h-4 w-4 text-zinc-300" />
                                  SCALP
                                </div>
                                <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">{scalpRanked.length} setups</Pill>
                              </div>
                              <div className="space-y-2">{renderList(scalpRanked)}</div>
                            </div>

                            {/* NON-SCALP panel */}
                            <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3 ring-1 ring-white/10">
                              <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-extrabold text-zinc-100">
                                  <Layers className="h-4 w-4 text-zinc-300" />
                                  NON-SCALP
                                </div>
                                <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">{nonScalpRanked.length} setups</Pill>
                              </div>
                              <div className="space-y-2">{renderList(nonScalpRanked)}</div>
                            </div>
                          </div>
                        );
                      }


                      // Empty states (policy-safe)
                      if (state === "LOADING") {
                        return (
                          <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
                            <div className="flex items-start gap-3">
                              <div className="rounded-xl bg-white/5 p-2">
                                <RefreshCw className="h-5 w-5 text-zinc-200" />
                              </div>
                              <div>
                                <div className="text-sm font-bold text-zinc-100">Loading snapshots and evaluating setups…</div>
                                <div className="mt-1 text-xs text-zinc-400">This may be normal during warm-up or when switching symbols/timeframes.</div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      const readinessItems = Array.isArray(feedStatus?.readiness?.items) ? feedStatus!.readiness!.items : [];
                      if (state === "NO_SIGNAL") {
                        return (
                          <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
                            <div className="flex items-start gap-3">
                              <div className="rounded-xl bg-white/5 p-2">
                                <Minus className="h-5 w-5 text-zinc-200" />
                              </div>
                              {readinessItems.length > 0 ? (
                                <div className="mt-3">
                                  <div className="text-[11px] font-bold text-zinc-200">Readiness notes</div>
                                  <div className="mt-2 space-y-1.5 text-xs text-zinc-300/90">
                                    {readinessItems.slice(0, 6).map((it, i) => (
                                      <div key={`${it.key}-${i}`} className="flex items-start gap-2">
                                        <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300/60" />
                                        <span className="min-w-0">{it.note}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      }

                      if (state === "QUALITY_GATED") {
                        const ce = feedStatus?.candidatesEvaluated;
                        const rejected = feedStatus?.rejected;
                        const top = topRejectionPairs(feedStatus?.rejectionByCode || null, 6);
                        const hasNotes = Array.isArray(feedStatus?.rejectNotesSample) && (feedStatus?.rejectNotesSample?.length ?? 0) > 0;
                        const hasBreakdown = top.length > 0;
                        return (
                          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                            <div className="flex items-start gap-3">
                              <div className="rounded-xl bg-amber-500/15 p-2 ring-1 ring-amber-500/25">
                                <ShieldAlert className="h-5 w-5 text-amber-200" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-extrabold text-amber-100">No setups published (quality gated)</div>
                                <div className="mt-1 text-xs text-amber-100/90">
                                  Candidates were generated but rejected by quality gates (conflict checks, invariants, RR/TP tradeability, or publish constraints).
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                  <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">Candidates {ce != null ? ce : "—"}</Pill>
                                  <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">Rejected {rejected != null ? rejected : "—"}</Pill>
                                </div>

                                {hasBreakdown ? (
                                  <div className="mt-3">
                                    <div className="text-[11px] font-bold text-amber-100">Top rejection reasons</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {top.map((p) => (
                                        <Pill key={p.code} tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">
                                          {p.code} • {p.count}
                                        </Pill>
                                      ))}
                                    </div>
                                  </div>
                                ) : !hasNotes ? (
                                  <div className="mt-3 text-[11px] text-amber-100/80">
                                    Rejection breakdown not available yet (telemetry not provided by the engine). The empty feed is still a valid outcome.
                                  </div>
                                ) : null}

                                {hasNotes ? (
                                  <div className="mt-3">
                                    <div className="text-[11px] font-bold text-amber-100">Sample rejection notes</div>
                                    <div className="mt-2 space-y-1.5 text-xs text-amber-100/90">
                                      {feedStatus!.rejectNotesSample!.slice(0, 3).map((n, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                          <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-200/70" />
                                          <span className="min-w-0">{n}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                {feedStatus?.gate ? (
                                  <div className="mt-2 text-[11px] text-amber-100/80">Engine gate: {feedStatus.gate}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // EMPTY_UNKNOWN
                      return (
                        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
                          <div className="text-sm font-bold text-zinc-100">No setups</div>
                          <div className="mt-1 text-xs text-zinc-400">
                            The system did not publish setups. This can be normal when conditions are not met or telemetry is not available yet.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Card>
            </div>

            {/* RIGHT: details */}
            <div className="space-y-4">
              <Card
                title="Data Completeness"
                icon={<Database className="h-5 w-5" />}
                right={
                  <div className="flex items-center gap-2">
                    <Pill
                      tone={
                        snap?.availability?.bybit?.ok
                          ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30"
                          : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"
                      }
                      icon={snap?.availability?.bybit?.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    >
                      Snapshot {snap ? "OK" : "—"}
                    </Pill>

                    <button
                      type="button"
                      onClick={() => setShowDataCompleteness((v) => !v)}
                      className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-200/80 hover:text-zinc-50 hover:bg-white/[0.05]"
                      title={showDataCompleteness ? "Hide Data Completeness details" : "Show Data Completeness details"}
                    >
                      {showDataCompleteness ? "Hide" : "Show"}
                    </button>
                  </div>
                }

              >
                {showDataCompleteness ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                        <Clock className="h-4 w-4 text-zinc-300" />
                        Realtime availability
                      </div>
                      <div className="mt-3 space-y-2 text-xs">
                        <KV
                          k="Bybit availability"
                          v={
                            snap?.availability?.bybit
                              ? snap.availability.bybit.ok
                                ? "OK"
                                : `NOT OK${Array.isArray(snap.availability.bybit.notes) && snap.availability.bybit.notes.length ? ` • ${snap.availability.bybit.notes.join(", ")}` : ""}`
                              : "—"
                          }
                        />
                        <KV
                          k="Binance availability"
                          v={
                            snap?.availability?.binance
                              ? snap.availability.binance.ok
                                ? "OK"
                                : `NOT OK${Array.isArray(snap.availability.binance.notes) && snap.availability.binance.notes.length ? ` • ${snap.availability.binance.notes.join(", ")}` : ""}`
                              : "—"
                          }
                        />
                        <KV k="Quality grade (raw snapshot)" v={snap?.data_quality?.grade ? String(snap.data_quality.grade) : "—"} />
                        <KV k="Quality score (raw snapshot)" v={Number.isFinite(Number(snap?.data_quality?.score)) ? fmtNum(Number(snap?.data_quality?.score), 0) : "—"} />
                      </div>
                      {Array.isArray(snap?.data_quality?.reasons) && snap!.data_quality!.reasons.length > 0 ? (
                        <div className="mt-3">
                          <div className="text-[11px] font-bold text-zinc-200">Quality notes</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {snap!.data_quality!.reasons.slice(0, 8).map((r, i) => (
                              <Pill key={i} tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">
                                {r}
                              </Pill>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                        <Layers className="h-4 w-4 text-zinc-300" />
                        Timeframe health (stale/partial)
                      </div>

                      <div className="mt-3 space-y-2">
                        {tfHealthView.length === 0 ? (
                          <div className="text-xs text-zinc-400">No timeframe diagnostics yet.</div>
                        ) : (
                          tfHealthView.map((t) => {
                            const bars = Number.isFinite(t.staleBars) ? t.staleBars : NaN;

                            // Tone by bars behind (more meaningful than 1.5s/5s for candles)
                            const staleTone =
                              Number.isFinite(bars) && bars <= 0
                                ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30"
                                : Number.isFinite(bars) && bars <= 1
                                  ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                                  : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30";

                            const staleLabel =
                              Number.isFinite(bars)
                                ? (bars === 0 ? "0 bars" : `${bars} bars`)
                                : "—";

                            const countLabel = `B:${t.haveCandlesBybit} / N:${t.haveCandlesBinance}`;

                            return (
                              <div
                                key={t.tf}
                                className="flex items-center justify-between rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-extrabold text-zinc-100">{t.tf}</div>
                                  <div className="mt-1 text-[11px] text-zinc-400">
                                    {countLabel}
                                    {Number.isFinite(t.lastTs) ? ` • last ${relTime(t.lastTs)}` : ""}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <Pill tone={staleTone} icon={<Clock className="h-4 w-4" />} title="Bars behind current time">
                                    {staleLabel}
                                  </Pill>

                                  <Pill
                                    tone={
                                      t.partial
                                        ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                                        : "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30"
                                    }
                                    title={t.partial ? "Data incomplete for this TF" : "Data complete"}
                                  >
                                    {t.partial ? "PARTIAL" : "OK"}
                                  </Pill>
                                </div>
                              </div>
                            );
                          })
                        )}

                        {tfHealth.length > tfHealthPrimary.length ? (
                          <button
                            type="button"
                            onClick={() => setShowTfHealthMore((v) => !v)}
                            className="mt-2 inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-200/70 hover:text-zinc-50 hover:bg-white/[0.05]"
                          >
                            {showTfHealthMore ? "Show less" : `Show more (${tfHealth.length - tfHealthPrimary.length})`}
                          </button>
                        ) : null}
                      </div>

                    </div>
                  </div>
                ) : null}


              </Card>

              <Card
                title="Key Levels"
                icon={<Target className="h-5 w-5" />}
                right={
                  <button
                    type="button"
                    onClick={() => setShowKeyLevels((v) => !v)}
                    className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-200/80 hover:text-zinc-50 hover:bg-white/[0.05]"
                    title={showKeyLevels ? "Hide Key Levels" : "Show Key Levels"}
                  >
                    {showKeyLevels ? "Hide" : "Show"}
                  </button>
                }
              >
                {showKeyLevels ? (
                  <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                      <Target className="h-4 w-4 text-zinc-300" />
                      Key levels (events & swings)
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      Showing {keyLevelsView.length} of {keyLevels.length} levels • Sorted by TF priority (4h → 5m)
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {keyLevelsView.length === 0 ? (
                        <div className="text-xs text-zinc-400">No market structure levels yet.</div>
                      ) : (
                        keyLevelsView.map((l, i) => {
                          const lvl = Number.isFinite(l.level) ? (l.level as number) : NaN;
                          const haveMid = Number.isFinite(mid);
                          const haveLvl = Number.isFinite(lvl);
                          const deltaAbs = haveMid && haveLvl ? Math.abs(mid - lvl) : NaN;

                          const dirLabel =
                            haveMid && haveLvl
                              ? lvl > mid
                                ? "ABOVE"
                                : lvl < mid
                                  ? "BELOW"
                                  : "AT"
                              : "";

                          const kindTone =
                            l.kind === "BOS"
                              ? "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/30"
                              : l.kind === "CHOCH"
                                ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                                : l.kind === "SWING_HIGH"
                                  ? "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"
                                  : "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30";

                          return (
                            <div
                              key={`${l.tf}-${l.kind}-${i}`}
                              className="rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3"
                            >
                              {/* Top row: TF + Kind + optional dir */}
                              <div className="flex flex-wrap items-center gap-2">
                                <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">{l.tf}</Pill>
                                <Pill tone={kindTone}>{l.kind}</Pill>
                                {l.dir && l.dir !== "—" ? (
                                  <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">{l.dir}</Pill>
                                ) : null}

                                {/* Right-side mini meta */}
                                <div className="ml-auto flex items-center gap-2">
                                  {haveMid && haveLvl ? (
                                    <Pill
                                      tone="bg-white/5 text-zinc-100 ring-1 ring-white/10"
                                      title="Relative to realtime mid"
                                    >
                                      {dirLabel} · Δ {fmtPx(deltaAbs)}
                                    </Pill>
                                  ) : null}
                                </div>
                              </div>

                              {/* Price row: big number + timestamp */}
                              <div className="mt-2 flex items-end justify-between gap-3">
                                <div className="text-base font-extrabold text-zinc-50 tabular-nums">
                                  {haveLvl ? fmtPx(lvl) : "—"}
                                </div>
                                <div className="text-[11px] text-zinc-400">
                                  {Number.isFinite(l.ts) ? relTime(l.ts) : ""}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {keyLevels.length > 6 ? (
                      <button
                        type="button"
                        onClick={() => setShowLevelsMore((v) => !v)}
                        className="mt-2 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200"
                      >
                        {showLevelsMore ? "Show less" : `Show more (${keyLevels.length - 6})`}
                      </button>
                    ) : null}
                  </div>
                ) : null}


              </Card>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] text-zinc-500">
            This UI does not place trades. It explains signals, risk, and conditions so the user can execute confidently.
          </div>
        </div>
      </div>
    </>
  );
}
/** ---------- Detail component ---------- */
function SetupDetail({
  symbol,
  mid,
  dqOk,
  bybitOk,
  staleSec,
  paused,
  features,
  setup,
  executionGlobal,
}: {
  symbol: string;
  mid: number;
  dqOk: boolean;
  bybitOk: boolean;
  staleSec?: number;
  paused: boolean;
  features: any;
  setup: TradeSetup;
  executionGlobal: ExecutionGlobal | null;
}) {
  const action = actionChip(setup, executionGlobal);
  const [showGuidanceDetails, setShowGuidanceDetails] = useState(false);
  const [showRiskMore, setShowRiskMore] = useState(false);
  useEffect(() => {
    setShowGuidanceDetails(false);
  }, [setup.id]);

  const entry = setup.entry;
  const zone = entry?.zone;
  const stop = setup.stop?.price;
  const tps = Array.isArray(setup.tp) ? setup.tp : [];

  const conf01 = Number.isFinite(Number(setup.confidence?.score)) ? clamp01(Number(setup.confidence.score) / 100) : undefined;

  const rr01 = Number.isFinite(Number(setup.rr_min)) ? clamp01(Math.min(3, Math.max(0, Number(setup.rr_min))) / 3) : undefined;

  const biasStrength01 = Number.isFinite(Number(features?.bias?.trend_strength)) ? clamp01(Number(features.bias.trend_strength)) : undefined;

  const of = features?.orderflow;
  const deltaNorm01 =
    Number.isFinite(Number(of?.delta?.delta_norm)) ? clamp01((Number(of.delta.delta_norm) + 1) / 2) : undefined; // [-1..1] => [0..1]
  const divScore01 = Number.isFinite(Number(of?.delta?.divergence_score)) ? clamp01(Number(of.delta.divergence_score)) : undefined;
  const absScore01 = Number.isFinite(Number(of?.delta?.absorption_score)) ? clamp01(Number(of.delta.absorption_score)) : undefined;

  const crossConsensus01 = Number.isFinite(Number(features?.cross?.consensus_score)) ? clamp01(Number(features.cross.consensus_score)) : undefined;

  const checklist = Array.isArray(entry?.trigger?.checklist) ? entry.trigger.checklist : [];
  const waitReason = useMemo(() => formatSetupWaitReason(setup), [setup]);

  const [showChecklistPassed, setShowChecklistPassed] = useState(false);

  const checklistBad = useMemo(() => {
    // show only BLOCK + PENDING
    return checklist.filter((c) => c.ok !== true);
  }, [checklist]);

  const checklistOk = useMemo(() => {
    return checklist.filter((c) => c.ok === true);
  }, [checklist]);

  const blockers = Array.isArray(setup.execution?.blockers) ? setup.execution!.blockers : [];
  const derivedSummary = useMemo(
    () => buildDerivedTriggerSummary({ checklist, blockers }),
    [checklist, blockers]
  );

  const isInZone =
    Number.isFinite(mid) &&
    zone &&
    Number.isFinite(zone?.lo) &&
    Number.isFinite(zone?.hi) &&
    mid >= Number(zone.lo) &&
    mid <= Number(zone.hi);

  const globalGateOk = dqOk && bybitOk && !paused && (staleSec == null || staleSec <= 5);

  const guidance = useMemo(() => {
    // Provide a deterministic, non-contradictory guidance block:
    // - If global gate not ok: show that first.
    // - Else show execution state and how to proceed.
    const ex = setup.execution;
    // Hard policy: Grade C is monitor-only, regardless of local booleans
    if (isMonitorOnlySetup(setup)) {
      return {
        headline: "Monitor-only (Grade C)",
        tone: "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
        bullets: ["Policy enforced: this setup is for monitoring only. No market/limit entry actions are permitted."],
      };
    }

    // Global execution gate overrides any local action suggestions
    if (executionGlobal?.state === "BLOCKED") {
      const primary = executionGlobal.reasons?.[0] ? formatExecutionGlobalReason(executionGlobal.reasons[0]) : "Execution blocked";
      return {
        headline: "Do not execute (system gate blocked)",
        tone: "bg-rose-500/10 text-rose-100 ring-1 ring-rose-500/25",
        bullets: [
          primary,
          ...(Array.isArray(executionGlobal.reasons) ? executionGlobal.reasons.slice(1, 4).map(formatExecutionGlobalReason) : []),
        ].filter(Boolean),
      };
    }

    if (!globalGateOk) {
      const reasons: string[] = [];
      if (!dqOk) reasons.push("Data quality gate not OK");
      if (!bybitOk) reasons.push("Bybit feed not OK");
      if (paused) reasons.push("Updates paused");
      if (staleSec != null && staleSec > 5) reasons.push(`Price feed stale (${fmtNum(staleSec, 1)}s)`);
      return {
        headline: "Do not execute yet",
        tone: "bg-rose-500/10 text-rose-100 ring-1 ring-rose-500/25",
        bullets: reasons.length ? reasons : ["Execution gated"],
      };
    }

    if (!ex) {
      return {
        headline: "Monitor",
        tone: "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
        bullets: ["Execution decision not available yet."],
      };
    }

    if (ex.state === "BLOCKED") {
      return {
        headline: "Blocked",
        tone: "bg-rose-500/10 text-rose-100 ring-1 ring-rose-500/25",
        bullets: [ex.reason || "Blocked"],
      };
    }

    if (ex.state === "ENTER_MARKET") {
      return {
        headline: "Enter market now",
        tone: "bg-emerald-500/10 text-emerald-100 ring-1 ring-emerald-500/25",
        bullets: [
          "All required conditions are satisfied for a market entry.",
          "Double-check stop & position size before executing.",
        ],
      };
    }

    if (ex.state === "PLACE_LIMIT") {
      return {
        headline: "Place limit order",
        tone: "bg-emerald-500/10 text-emerald-100 ring-1 ring-emerald-500/25",
        bullets: [
          "Price is inside the entry zone.",
          "Place a limit order within the zone, with stop and TP ladder configured.",
        ],
      };
    }

    // waiting / monitoring states
    if (ex.state === "WAIT_ZONE") {
      return {
        headline: "Do NOT enter — wait for price to reach the entry zone",
        tone: "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
        bullets: [
          "Action: wait until price is inside the zone, then re-check trigger checklist.",
          "Do not chase outside the zone. Let the trade come to you.",
        ],
      };
    }
    if (ex.state === "WAIT_CLOSE") {
      return {
        headline: "Do NOT enter yet — wait for candle close confirmation",
        tone: "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
        bullets: [
          "Action: do nothing until the next candle close confirms the trigger.",
          "If the close-confirm fails, skip this setup and wait for a new signal.",
        ],
      };
    }

    if (ex.state === "WAIT_RETEST") {
      return {
        headline: "Do NOT enter — wait for the retest condition",
        tone: "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
        bullets: [
          "Action: wait for the retest to complete; do not enter on the first impulse.",
          "If retest does not occur within the setup window, skip.",
        ],
      };
    }

    if (ex.state === "WAIT_FILL") {
      return {
        headline: "Triggered; waiting for limit fill",
        tone: "bg-sky-500/10 text-sky-100 ring-1 ring-sky-500/25",
        bullets: ["Do not chase. Let the limit fill or invalidate."],
      };
    }

    return {
      headline: "Monitor",
      tone: "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
      bullets: [ex.reason || "Monitor conditions"],
    };
  }, [setup.execution, setup.confidence?.grade, executionGlobal, globalGateOk, dqOk, bybitOk, paused, staleSec]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <div className="text-base font-extrabold text-zinc-50">{humanizeType(String(setup.type))}</div>
              <div className={["text-base font-extrabold", sideTone(setup.side)].join(" ")}>{setup.side}</div>
              <Pill tone={gradeTone(setup.confidence?.grade)}>Grade {String(uiGrade(setup) || "—").toUpperCase()}</Pill>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Pill tone={action.tone} icon={action.icon}>
                {action.label}
              </Pill>
              <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10" icon={<Clock className="h-4 w-4" />}>
                Created {relTime(setup.created_ts)}
              </Pill>
              <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10" icon={<Clock className="h-4 w-4" />}>
                Expires {relTime(setup.expires_ts)}
              </Pill>
              <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10" icon={<Layers className="h-4 w-4" />}>
                TF entry {setup.entry_tf} • trigger {setup.trigger_tf} • bias {setup.bias_tf}
              </Pill>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <a
              href={`https://www.bybit.com/trade/usdt/${encodeURIComponent(symbol)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-bold text-zinc-100 ring-1 ring-white/10 hover:bg-white/10"
              title="Open symbol on Bybit"
            >
              <ExternalLink className="h-4 w-4" />
              Open on Bybit
            </a>
            <div className="text-[11px] text-zinc-400 text-right">
              This link is optional. The app does not trade automatically.
            </div>
          </div>
        </div>
        <Divider />

        {/* Guidance */}
        {/* Guidance */}
        <div className={["rounded-2xl p-4", guidance.tone].join(" ")}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-white/5 p-2">
              {guidance.headline.includes("Enter") || guidance.headline.includes("Place") ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : guidance.headline.includes("Do not") || guidance.headline.includes("Blocked") ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Clock className="h-5 w-5" />
              )}
            </div>

            <div className="min-w-0">
              {/* HEADLINE – LUÔN HIỆN */}
              <div className="text-sm font-extrabold">
                {guidance.headline}
              </div>

              {/* DETAILS – COLLAPSED */}
              {showGuidanceDetails ? (
                <div className="mt-2 space-y-1.5 text-xs text-zinc-100/90">
                  {guidance.bullets.map((b, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
                      <span className="min-w-0">{b}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* TOGGLE */}
              <button
                type="button"
                onClick={() => setShowGuidanceDetails((v) => !v)}
                className="mt-2 text-[11px] font-semibold text-zinc-300 hover:text-zinc-100"
              >
                {showGuidanceDetails ? "Hide details" : "Why?"}
              </button>

              {/* ENGINE NOTE */}
              {/* WAIT REASON (prefer blockers/checklist note for UX) */}
              {waitReason ? (
                <div className="mt-3 text-[11px] font-semibold text-zinc-100/90">
                  {waitReason}
                </div>
              ) : setup.execution?.reason ? (
                <div className="mt-3 text-[11px] text-zinc-100/80">
                  Engine note: {setup.execution.reason}
                </div>
              ) : null}
            </div>
          </div>
        </div>

      </div>

      {/* Plan */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
            <Target className="h-4 w-4 text-zinc-300" />
            Entry Plan
          </div>

          <div className="mt-3 space-y-2">
            <KV k="Mode" v={entry?.mode ? entry.mode : "—"} />
            <KV
              k="Entry zone"
              v={
                zone && Number.isFinite(zone.lo) && Number.isFinite(zone.hi)
                  ? `${fmtPx(zone.lo)} → ${fmtPx(zone.hi)}`
                  : "—"
              }
            />
            <KV
              k="Mid vs zone"
              v={
                Number.isFinite(mid) && zone && Number.isFinite(zone.lo) && Number.isFinite(zone.hi)
                  ? isInZone
                    ? "INSIDE"
                    : mid < zone.lo
                      ? `BELOW (Δ ${fmtPx(zone.lo - mid)})`
                      : `ABOVE (Δ ${fmtPx(mid - zone.hi)})`
                  : "—"
              }
            />
            <KV
              k="Trigger summary"
              v={
                entry?.trigger?.summary && String(entry.trigger.summary).trim().length > 0
                  ? String(entry.trigger.summary).trim()
                  : derivedSummary.text
              }
            />
          </div>

          <Divider />

          <div className="space-y-2">
            <div className="text-xs font-bold text-zinc-100">Trigger checklist</div>
            <div className="rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-zinc-100">Summary</div>
                <div className="text-[11px] text-zinc-400 tabular-nums">
                  {derivedSummary.passed}/{derivedSummary.total} passed
                </div>
              </div>

              <div className="mt-2 space-y-2">
                {derivedSummary.hard.length > 0 ? (
                  <div>
                    <div className="text-[11px] font-semibold text-zinc-200">Next (hard)</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {derivedSummary.hard.slice(0, 4).map((c) => (
                        <span
                          key={`hard-${c.key}`}
                          className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-1 text-[10px] text-rose-100 ring-1 ring-rose-500/20"
                          title={typeof c.note === "string" ? c.note : c.key}
                        >
                          {checklistLabel(c.key)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {derivedSummary.realtime.length > 0 ? (
                  <div>
                    <div className="text-[11px] font-semibold text-zinc-200">Realtime signals</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {derivedSummary.realtime.slice(0, 4).map((c) => (
                        <span
                          key={`rt-${c.key}`}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100 ring-1 ring-amber-500/20"
                          title={typeof c.note === "string" ? c.note : c.key}
                        >
                          {checklistLabel(c.key)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {checklist.length === 0 ? (
              <div className="text-xs text-zinc-400">—</div>
            ) : (
              <div className="space-y-2">
                {/* BLOCK + PENDING (default) */}
                {checklistBad.map((c) => {
                  const ok = c.ok === true;
                  const pending = c.ok !== true && c.ok !== false;

                  return (
                    <div key={c.key} className="rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={[
                                "inline-flex h-6 w-6 items-center justify-center rounded-full ring-1",
                                ok
                                  ? "bg-emerald-500/15 ring-emerald-500/25 text-emerald-100"
                                  : pending
                                    ? "bg-amber-500/15 ring-amber-500/25 text-amber-100"
                                    : "bg-rose-500/15 ring-rose-500/25 text-rose-100",
                              ].join(" ")}
                            >
                              {ok ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : pending ? (
                                <CircleDashed className="h-4 w-4" />
                              ) : (
                                <AlertTriangle className="h-4 w-4" />
                              )}
                            </span>
                            <div className="text-xs font-extrabold text-zinc-100">{c.key}</div>
                          </div>
                          {c.note ? <div className="mt-2 text-[11px] text-zinc-400">{c.note}</div> : null}
                        </div>

                        <Pill
                          tone={
                            ok
                              ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30"
                              : pending
                                ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"
                                : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"
                          }
                        >
                          {ok ? "OK" : pending ? "PENDING" : "BLOCK"}
                        </Pill>
                      </div>
                    </div>
                  );
                })}

                {/* Passed (OK) toggle */}
                {checklistOk.length > 0 ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowChecklistPassed((v) => !v)}
                      className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-200/80 hover:text-zinc-50 hover:bg-white/[0.05]"
                    >
                      {showChecklistPassed ? "Hide passed" : `Show passed (${checklistOk.length})`}
                    </button>
                  </div>
                ) : null}

                {/* Passed (OK) list */}
                {showChecklistPassed ? (
                  <div className="space-y-2">
                    {checklistOk.map((c) => (
                      <div key={c.key} className="rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25 text-emerald-100">
                                <CheckCircle2 className="h-4 w-4" />
                              </span>
                              <div className="text-xs font-extrabold text-zinc-100">{c.key}</div>
                            </div>
                            {c.note ? <div className="mt-2 text-[11px] text-zinc-400">{c.note}</div> : null}
                          </div>

                          <Pill tone="bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30">OK</Pill>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}


            {blockers.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-200" />
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-amber-100">Current blockers</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {blockers.slice(0, 10).map((b) => (
                        <Pill key={b} tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">
                          {b}
                        </Pill>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
            <ShieldCheck className="h-4 w-4 text-zinc-300" />
            Risk & Targets
          </div>

          <div className="mt-3 space-y-2">
            <KV k="Stop loss" v={Number.isFinite(stop) ? fmtPx(stop) : "—"} />
            <KV k="Stop basis" v={setup.stop?.basis ? setup.stop.basis : "—"} />
            <KV k="RR min / est" v={`${Number.isFinite(setup.rr_min) ? setup.rr_min.toFixed(2) : "—"} / ${Number.isFinite(setup.rr_est) ? setup.rr_est.toFixed(2) : "—"}`} />
          </div>

          <Divider />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-zinc-100">TP ladder</div>
            </div>

            {tps.length === 0 ? (
              <div className="text-xs text-zinc-400">—</div>
            ) : (
              <div className="space-y-2">
                {tps.map((tp, i) => (
                  <div key={i} className="rounded-xl bg-zinc-950/30 ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-zinc-100">TP{i + 1}</div>
                        <div className="mt-1 text-sm font-extrabold text-zinc-50">{Number.isFinite(tp.price) ? fmtPx(tp.price) : "—"}</div>
                        <div className="mt-1 text-[11px] text-zinc-400">
                          Size {Number.isFinite(tp.size_pct) ? `${fmtNum(tp.size_pct, 0)}%` : "—"}
                          {tp.basis ? ` • ${tp.basis}` : ""}
                        </div>
                        {tp.note ? <div className="mt-1 text-[11px] text-zinc-400">{tp.note}</div> : null}
                      </div>
                      {Number.isFinite(mid) && Number.isFinite(tp.price) ? (
                        <Pill tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">
                          Δ {fmtPx(Math.abs(mid - tp.price))}
                        </Pill>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

          <Divider />

          <div className="space-y-3">
            <div className="text-xs font-bold text-zinc-100">Strength meters</div>
            <Meter
              label="Confidence"
              value01={conf01}
              right={fmtScore100(setup.confidence?.score)}
              intent={conf01 != null && conf01 >= 0.7 ? "good" : "warn"}
            />
            <Meter
              label="RR quality"
              value01={rr01}
              right={Number.isFinite(setup.rr_min) ? setup.rr_min.toFixed(2) : "—"}
              intent={rr01 != null && rr01 >= 0.5 ? "good" : "warn"}
            />

            <Meter
              label="Bias strength"
              value01={biasStrength01}
              intent={biasStrength01 != null && biasStrength01 >= 0.62 ? "good" : "warn"}
            />
            <Meter
              label="Delta alignment"
              value01={deltaNorm01}
              right={Number.isFinite(Number(of?.delta?.delta_norm)) ? fmtNum(Number(of.delta.delta_norm), 2) : "—"}
              intent="neutral"
            />
            <Meter
              label="Divergence signal"
              value01={divScore01}
              right={divScore01 != null ? fmtPct01(divScore01) : "—"}
              intent={divScore01 != null && divScore01 >= 0.65 ? "good" : "neutral"}
            />
            <Meter
              label="Absorption signal"
              value01={absScore01}
              right={absScore01 != null ? fmtPct01(absScore01) : "—"}
              intent={absScore01 != null && absScore01 >= 0.65 ? "good" : "neutral"}
            />
            <Meter
              label="Cross consensus"
              value01={crossConsensus01}
              right={crossConsensus01 != null ? fmtPct01(crossConsensus01) : "—"}
              intent={
                crossConsensus01 != null && crossConsensus01 >= 0.65
                  ? "good"
                  : crossConsensus01 != null && crossConsensus01 <= 0.35
                    ? "warn"
                    : "neutral"
              }
            />
          </div>
        </div>
      </div>

      {/* Reasons & context */}
      <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 shadow-[0_1px_0_rgba(255,255,255,0.04)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
            <Gauge className="h-4 w-4 text-zinc-300" />
            Explanation (why this setup)
          </div>

          <div className="flex items-center gap-2">
            <Pill
              tone={
                globalGateOk
                  ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30"
                  : "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30"
              }
              icon={globalGateOk ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              title="Global execution gate status"
            >
              Gate {globalGateOk ? "OK" : "BLOCKED"}
            </Pill>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div className="text-xs font-extrabold text-zinc-100">Reasons</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(setup.confidence?.reasons || []).slice(0, 16).map((r, i) => (
                <Pill key={i} tone="bg-white/5 text-zinc-100 ring-1 ring-white/10">
                  {r}
                </Pill>
              ))}
              {(setup.confidence?.reasons || []).length === 0 ? <div className="text-xs text-zinc-400">—</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div className="text-xs font-extrabold text-zinc-100">Orderflow & context</div>
            <div className="mt-2 space-y-2 text-xs">
              <KV
                k="Imbalance"
                v={
                  features?.orderflow?.imbalance
                    ? `${fmtNum(Number(features.orderflow.imbalance.top10), 2)} / ${fmtNum(Number(features.orderflow.imbalance.top50), 2)} / ${fmtNum(Number(features.orderflow.imbalance.top200), 2)}`
                    : "—"
                }
              />
              <KV
                k="Aggression ratio"
                v={Number.isFinite(Number(features?.orderflow?.aggression_ratio)) ? fmtPct01(Number(features.orderflow.aggression_ratio)) : "—"}
              />
              <KV
                k="Delta dir"
                v={
                  features?.orderflow?.delta?.delta_norm != null
                    ? Number(features.orderflow.delta.delta_norm) > 0
                      ? "BULL"
                      : Number(features.orderflow.delta.delta_norm) < 0
                        ? "BEAR"
                        : "NEUTRAL"
                    : "—"
                }
              />
              <KV
                k="Divergence"
                v={
                  features?.orderflow?.delta
                    ? `${String(features.orderflow.delta.divergence_dir)} • ${fmtPct01(Number(features.orderflow.delta.divergence_score))}`
                    : "—"
                }
              />
              <KV
                k="Absorption"
                v={
                  features?.orderflow?.delta
                    ? `${String(features.orderflow.delta.absorption_dir)} • ${fmtPct01(Number(features.orderflow.delta.absorption_score))}`
                    : "—"
                }
              />
            </div>
          </div>
        </div>

        <Divider />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-extrabold text-zinc-100">Entry zone check</div>
              <Pill
                tone={isInZone ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30" : "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30"}
              >
                {isInZone ? "IN ZONE" : "OUTSIDE"}
              </Pill>
            </div>
            <div className="mt-2 space-y-2 text-xs">
              <KV k="Mid" v={Number.isFinite(mid) ? fmtPx(mid) : "—"} />
              <KV k="Zone" v={zone && Number.isFinite(zone.lo) && Number.isFinite(zone.hi) ? `${fmtPx(zone.lo)} → ${fmtPx(zone.hi)}` : "—"} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div className="text-xs font-extrabold text-zinc-100">Stop check</div>
            <div className="mt-2 space-y-2 text-xs">
              <KV k="Stop" v={Number.isFinite(stop) ? fmtPx(stop) : "—"} />
              <KV
                k="Distance to stop"
                v={Number.isFinite(mid) && Number.isFinite(stop) ? fmtPx(Math.abs(mid - (stop as number))) : "—"}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/30 p-3">
            <div className="text-xs font-extrabold text-zinc-100">Execution gate snapshot</div>
            <div className="mt-2 space-y-2 text-xs">
              <KV k="DQ ok" v={dqOk ? "YES" : "NO"} />
              <KV k="Bybit ok" v={bybitOk ? "YES" : "NO"} />
              <KV k="Paused" v={paused ? "YES" : "NO"} />
              <KV k="Stale" v={staleSec == null ? "—" : `${fmtNum(staleSec, 1)}s`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}