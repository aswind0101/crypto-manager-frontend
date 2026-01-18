export type SetupSide = "LONG" | "SHORT";
export type SetupStatus = "FORMING" | "READY" | "TRIGGERED" | "INVALIDATED" | "EXPIRED";
export type SetupType =
  | "TREND_PULLBACK"
  | "BREAKOUT"
  | "RANGE_MEAN_REVERT"
  | "LIQUIDITY_SWEEP_REVERSAL"
  | "FAILED_SWEEP_CONTINUATION"
  // Scalp setups (short-horizon; 5m/15m/1h)
  | "SCALP_RANGE_FADE"
  | "SCALP_LIQUIDITY_SNAPBACK"
  | "SCALP_MOMENTUM_PULLBACK"
  | "SCALP_1H_REACTION";

export type EntryPlan = {
  mode: "LIMIT" | "MARKET";
  zone: { lo: number; hi: number };
  trigger: {
    confirmed: boolean;
    // NEW: Trigger tiers (runtime + UI)
    // - APPROACHING: setup is READY but price has not touched the zone/level
    // - TOUCHED: intrabar touch (mid in zone / retest touched)
    // - CONFIRMED: close-confirm satisfied (new confirmed candle close on trigger_tf)
    tier?: "APPROACHING" | "TOUCHED" | "CONFIRMED";
    touched_ts?: number;     // set when tier becomes TOUCHED
    confirmed_ts?: number;   // set when tier becomes CONFIRMED

    // Internal runtime metadata (not used by engine, only by hook/UI)
    _cc_base_ts?: number;        // baseline confirmed candle ts used by close-confirm
    _cc_next_close_ts?: number;  // next expected close time for trigger_tf
    _cc_tf?: "5m" | "15m";       // trigger tf chosen at runtime (must respect setup.trigger_tf)

    checklist: Array<{ key: string; ok: boolean; note?: string }>;
    summary: string;
  };
};

export type StopPlan = {
  price: number;
  basis: "STRUCTURE" | "ATR" | "LIQUIDITY";
  note: string;
};

export type TakeProfitPlan = Array<{
  price: number;
  size_pct: number; // 0..100
  basis: "R_MULTIPLE" | "LEVEL";
  note?: string;
}>;
export type GradePlus = "A+" | "A" | "B" | "C";

export type SetupConfidence = {
  score: number; // 0..100
  grade: "A" | "B" | "C" | "D";
  reasons: string[];
    // NEW: refined grade used for execution policy (non-breaking)
  grade_plus?: GradePlus;

  // Optional: reasons that specifically justify grade_plus
  grade_plus_reasons?: string[];
};

// Setup-level telemetry (analytics / replay)
// - Derived from trigger checklist + execution decision.
// - Does not affect scoring or setup selection.
export type SetupTelemetry = {
  // Trigger checklist progress (setup-internal readiness)
  totalTriggers: number;
  passedTriggers: string[];
  triggerBlockers: string[];
  progressPct: number; // 0..100

  // Execution layer (operator readiness). Includes global gates.
  executionState?: ExecutionState;
  executionBlockers?: string[];
  // --- Temporal readiness (analytics / replay) ---
  firstSeenTs?: number;        // first time this setup was observed (client-side)
  lastSeenTs?: number;         // last time observed (client-side)
  ageMs?: number;              // lastSeenTs - firstSeenTs

  lastProgressPct?: number;    // progress at previous observation
  progressDeltaPct?: number;   // progressPct - lastProgressPct

  lastChangeTs?: number;       // last time progress/status changed (client-side)
  stalledMs?: number;          // if FORMING: lastSeenTs - lastChangeTs else 0
};

export type TradeSetup = {
  id: string;
  canon: string;

  type: SetupType;
  side: SetupSide;

  entry_tf: "5m" | "15m";
  bias_tf: "1h" | "4h";
  trigger_tf: "5m" | "15m";

  status: SetupStatus;
  created_ts: number;
  expires_ts: number;

  entry: EntryPlan;
  stop: StopPlan;
  tp: TakeProfitPlan;

  rr_min: number;
  rr_est: number;

  confidence: SetupConfidence;
  tags: string[];

  // Optional, UI/analytics-facing. Engine does not depend on it.
  telemetry?: SetupTelemetry;
};

export type SetupReadinessItem = {
  key: string;   // short stable key (for UI grouping)
  note: string;  // human-readable reason
};

export type SetupReadinessTelemetry = {
  state: "NO_SIGNAL";
  items: SetupReadinessItem[]; // bounded list
};

export type SetupEngineTelemetry = {
  // Global gates (engine-level)
  gate?: "OK" | "DQ_NOT_OK" | "NO_PRICE" | "GRADE_D";

  // Candidate accounting (quality gates)
  candidates: number;
  accepted: number;
  rejected: number;

  // Reject breakdown
  rejectByCode: Record<string, number>;
  rejectNotesSample: string[]; // small sample for UI/debug (bounded)

  // NEW: readiness (only meaningful when candidates==0 and gate==OK)
  readiness?: SetupReadinessTelemetry;
};


export type SetupEngineOutput = {
  ts: number;
  dq_ok: boolean;
  preferred_id?: string;
  setups: TradeSetup[];

  telemetry?: SetupEngineTelemetry;
};
// NEW: Standardized operator narrative (logic-first; UI can render later)
export type DecisionCode =
  | "OK_ENTER_MARKET"
  | "OK_PLACE_LIMIT"
  | "WAIT_CLOSE_CONFIRM"
  | "WAIT_PRICE_IN_ZONE"
  | "WAIT_RETEST"
  | "NO_TRADE_GRADE_C"
  | "NO_TRADE_GRADE_D"
  | "NO_TRADE_SETUP_NOT_READY"
  | "NO_TRADE_EXPIRED"
  | "NO_TRADE_INVALIDATED"
  | "BLOCKED_DQ"
  | "BLOCKED_FEED_STALE"
  | "BLOCKED_BYBIT_DOWN"
  | "BLOCKED_PAUSED"
  | "BLOCKED_TF_STALE";

export type DecisionNarrative = {
  code: DecisionCode;
  headline: string;
  bullets: string[];       // keep concise (<=5)
  next_action: string;

  timing?: {
    tf?: "5m" | "15m";
    next_close_ts?: number;
    stale_reason?: string;
  };

  invalidation?: {
    rule: string;
  };
};

// Execution / Operator readiness (derived, not engine state)
export type ExecutionState =
  | "BLOCKED"        // dq / feed / stale / paused
  | "MONITOR"        // setup exists but execution is intentionally disabled (e.g., grade C/D)
  | "FORMING"        // setup forming; do not execute yet
  | "NO_TRADE"       // setup dead / invalid
  | "WAIT_CLOSE"     // waiting close-confirm
  | "WAIT_RETEST"    // waiting retest condition
  | "WAIT_ZONE"      // limit mode, price not in entry zone
  | "PLACE_LIMIT"    // can place limit order
  | "ENTER_MARKET"   // can enter market now
  | "WAIT_FILL";     // triggered + limit, waiting fill


export interface ExecutionDecision {
  state: ExecutionState;
  canEnterMarket: boolean;
  canPlaceLimit: boolean;
  blockers: string[];     // checklist keys blocking execution (and/or global gates)
  reason: string;         // one-line operator reason

  // NEW: standardized narrative (optional, non-breaking)
  narrative?: DecisionNarrative;
}
