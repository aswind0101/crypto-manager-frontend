// setupTracking.ts
// Frontend-only setup performance tracking (localStorage)
//
// Goals:
// - Persist a lightweight trade-quality ledger without backend.
// - Track MFE/MAE in R-multiples for each setup from first appearance.
// - Close a setup when TP1/STOP hit or expires.
//
// Assumptions (verified from engine output shape in your repo):
// - setup.entry.zone has { lo, hi }
// - setup.stop.price exists
// - setup.tp is array with first item { price }
// - setup.expires_ts exists (ms epoch) or can be absent

export type TrackedOutcome = "OPEN" | "TP1" | "STOP" | "EXPIRED";

export type TrackedSetupRecord = {
  key: string;
  symbol: string;

  type?: string;
  side?: "LONG" | "SHORT";
  bias_tf?: string;
  entry_tf?: string;

  created_ts: number;
  last_seen_ts: number;
  expires_ts?: number;

  // Price anchors
  entry_anchor: number;
  stop: number;
  tp1?: number;
  risk: number; // abs(entry_anchor - stop)

  // Tracking of extremes
  high_seen: number;
  low_seen: number;

  // MFE/MAE in R units
  mfe_r: number;
  mae_r: number;

  // Lifecycle
  status_last?: string;
  triggered_ts?: number;

  outcome: TrackedOutcome;
  closed_ts?: number;
};

type StoreDoc = {
  version: 1;
  updated_ts: number;
  items: TrackedSetupRecord[];
};

const LS_KEY = "ct_setup_tracking_v1";

function nowMs() {
  return Date.now();
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function safeNum(x: unknown): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function readStore(): StoreDoc {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { version: 1, updated_ts: 0, items: [] };
    const parsed = JSON.parse(raw) as Partial<StoreDoc>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) {
      return { version: 1, updated_ts: 0, items: [] };
    }
    return {
      version: 1,
      updated_ts: typeof parsed.updated_ts === "number" ? parsed.updated_ts : 0,
      items: parsed.items as TrackedSetupRecord[],
    };
  } catch {
    return { version: 1, updated_ts: 0, items: [] };
  }
}

function pruneStore(doc: StoreDoc): StoreDoc {
  const maxItems = 400;
  if (doc.items.length <= maxItems) return doc;

  // Keep: OPEN first, then most recent closed
  const open = doc.items.filter((x) => x.outcome === "OPEN");
  const closed = doc.items.filter((x) => x.outcome !== "OPEN");
  closed.sort((a, b) => (b.closed_ts ?? 0) - (a.closed_ts ?? 0));

  const kept = [...open, ...closed].slice(0, maxItems);
  return { ...doc, items: kept, updated_ts: nowMs() };
}

function writeStore(doc: StoreDoc) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(doc));
  } catch {
    // If quota exceeded, attempt to prune and retry once
    try {
      const pruned = pruneStore(doc);
      localStorage.setItem(LS_KEY, JSON.stringify(pruned));
    } catch {
      // tracking must never crash UI
    }
  }
}

function setupKey(setup: any): string {
  return String(setup?.canon ?? setup?.id ?? "").trim();
}

function extractEntryAnchor(setup: any): number | undefined {
  const zone = setup?.entry?.zone;
  const lo = safeNum(zone?.lo);
  const hi = safeNum(zone?.hi);
  if (lo == null || hi == null) return undefined;
  if (!(lo < hi)) return undefined;
  return (lo + hi) / 2;
}

function extractStop(setup: any): number | undefined {
  return safeNum(setup?.stop?.price);
}

function extractTp1(setup: any): number | undefined {
  const tp0 = Array.isArray(setup?.tp) ? setup.tp[0] : undefined;
  return safeNum(tp0?.price);
}

function updateRMetrics(args: {
  rec: TrackedSetupRecord;
  mid: number;
}) {
  const { rec, mid } = args;
  if (!Number.isFinite(mid)) return;

  rec.high_seen = Math.max(rec.high_seen, mid);
  rec.low_seen = Math.min(rec.low_seen, mid);

  const risk = Math.max(1e-12, rec.risk);

  // Favorable/adverse distances from entry_anchor
  let favorable = 0;
  let adverse = 0;

  if (rec.side === "SHORT") {
    // Favorable: entry - lowest; adverse: highest - entry
    favorable = rec.entry_anchor - rec.low_seen;
    adverse = rec.high_seen - rec.entry_anchor;
  } else {
    // LONG default
    favorable = rec.high_seen - rec.entry_anchor;
    adverse = rec.entry_anchor - rec.low_seen;
  }

  rec.mfe_r = Math.max(rec.mfe_r, favorable / risk);
  rec.mae_r = Math.max(rec.mae_r, adverse / risk);
}

function shouldCloseByPrice(args: { rec: TrackedSetupRecord; mid: number; now_ts: number }) {
  const { rec, mid, now_ts } = args;
  if (!Number.isFinite(mid)) return;

  if (rec.outcome !== "OPEN") return;

  // STOP
  if (rec.side === "SHORT") {
    if (mid >= rec.stop) {
      rec.outcome = "STOP";
      rec.closed_ts = now_ts;
      return;
    }
  } else {
    if (mid <= rec.stop) {
      rec.outcome = "STOP";
      rec.closed_ts = now_ts;
      return;
    }
  }

  // TP1
  if (typeof rec.tp1 === "number" && Number.isFinite(rec.tp1)) {
    if (rec.side === "SHORT") {
      if (mid <= rec.tp1) {
        rec.outcome = "TP1";
        rec.closed_ts = now_ts;
        return;
      }
    } else {
      if (mid >= rec.tp1) {
        rec.outcome = "TP1";
        rec.closed_ts = now_ts;
        return;
      }
    }
  }
}

function shouldCloseByExpiry(args: { rec: TrackedSetupRecord; now_ts: number }) {
  const { rec, now_ts } = args;
  if (rec.outcome !== "OPEN") return;

  const exp = rec.expires_ts;
  if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) {
    if (now_ts > exp) {
      rec.outcome = "EXPIRED";
      rec.closed_ts = now_ts;
    }
  }
}

function upsertFromSetup(args: {
  symbol: string;
  setup: any;
  now_ts: number;
}): TrackedSetupRecord | null {
  const { symbol, setup, now_ts } = args;

  const key = setupKey(setup);
  if (!key) return null;

  const entry = extractEntryAnchor(setup);
  const stop = extractStop(setup);
  if (entry == null || stop == null) return null;

  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) return null;

  const tp1 = extractTp1(setup);
  const expires = safeNum(setup?.expires_ts);

  const rec: TrackedSetupRecord = {
    key,
    symbol,

    type: typeof setup?.type === "string" ? setup.type : undefined,
    side: setup?.side === "SHORT" ? "SHORT" : "LONG",
    bias_tf: typeof setup?.bias_tf === "string" ? setup.bias_tf : undefined,
    entry_tf: typeof setup?.entry_tf === "string" ? setup.entry_tf : undefined,

    created_ts: now_ts,
    last_seen_ts: now_ts,
    expires_ts: expires,

    entry_anchor: entry,
    stop,
    tp1,
    risk,

    high_seen: entry,
    low_seen: entry,

    mfe_r: 0,
    mae_r: 0,

    status_last: typeof setup?.status === "string" ? setup.status : undefined,
    triggered_ts: setup?.status === "TRIGGERED" ? now_ts : undefined,

    outcome: "OPEN",
    closed_ts: undefined,
  };

  return rec;
}

function mergeLifecycle(rec: TrackedSetupRecord, setup: any, now_ts: number) {
  const st = typeof setup?.status === "string" ? setup.status : undefined;
  if (!st) return;

  rec.status_last = st;
  if (st === "TRIGGERED" && rec.triggered_ts == null) {
    rec.triggered_ts = now_ts;
  }
}

export function trackSetupsTick(args: {
  symbol: string;
  setups: any[];      // finalArr from useSetupsSnapshot
  mid: number;        // current mid price
  now_ts: number;     // Date.now()
  price_ts?: number;  // optional feed ts (not stored, but can be used later)
}) {
  const { symbol, setups, mid, now_ts } = args;

  if (!symbol || !Array.isArray(setups)) return;

  const doc = readStore();
  const items = doc.items;

  const index = new Map<string, number>();
  for (let i = 0; i < items.length; i++) index.set(items[i].key, i);

  // 1) Upsert current visible setups
  for (const s of setups) {
    const key = setupKey(s);
    if (!key) continue;

    const idx = index.get(key);
    if (idx == null) {
      const rec = upsertFromSetup({ symbol, setup: s, now_ts });
      if (rec) {
        items.push(rec);
        index.set(rec.key, items.length - 1);
      }
    } else {
      const rec = items[idx];
      rec.last_seen_ts = now_ts;
      mergeLifecycle(rec, s, now_ts);
    }
  }

  // 2) Update OPEN records for this symbol with current mid (MFE/MAE + close rules)
  for (const rec of items) {
    if (rec.symbol !== symbol) continue;
    if (rec.outcome !== "OPEN") continue;

    updateRMetrics({ rec, mid });
    shouldCloseByPrice({ rec, mid, now_ts });
    shouldCloseByExpiry({ rec, now_ts });
  }

  const out: StoreDoc = pruneStore({ version: 1, updated_ts: now_ts, items });
  writeStore(out);
}

export function readAllTrackedSetups(): TrackedSetupRecord[] {
  return readStore().items;
}

export function clearTrackedSetups() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

// Optional helper: summarize quickly in UI/console
export function summarizeTrackedSetups(records: TrackedSetupRecord[]) {
  const closed = records.filter((r) => r.outcome !== "OPEN");
  const open = records.filter((r) => r.outcome === "OPEN");

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const tp = closed.filter((r) => r.outcome === "TP1").length;
  const sl = closed.filter((r) => r.outcome === "STOP").length;
  const ex = closed.filter((r) => r.outcome === "EXPIRED").length;

  return {
    total: records.length,
    open: open.length,
    closed: closed.length,
    tp1: tp,
    stop: sl,
    expired: ex,
    tp_rate: closed.length ? tp / closed.length : 0,
    stop_rate: closed.length ? sl / closed.length : 0,
    avg_mfe_r_closed: avg(closed.map((r) => r.mfe_r)),
    avg_mae_r_closed: avg(closed.map((r) => r.mae_r)),
  };
}
