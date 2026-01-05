export type SetupSide = "LONG" | "SHORT";
export type SetupStatus = "FORMING" | "READY" | "TRIGGERED" | "INVALIDATED" | "EXPIRED";
export type SetupType =
  | "TREND_PULLBACK"
  | "BREAKOUT"
  | "RANGE_MEAN_REVERT"
  | "LIQUIDITY_SWEEP_REVERSAL"
  | "FAILED_SWEEP_CONTINUATION";

export type EntryPlan = {
  mode: "LIMIT" | "MARKET";
  zone: { lo: number; hi: number };
  trigger: {
    confirmed: boolean;
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

export type SetupConfidence = {
  score: number; // 0..100
  grade: "A" | "B" | "C" | "D";
  reasons: string[];
};

export type TradeSetup = {
  id: string;
  canon: string;

  type: SetupType;
  side: SetupSide;

  entry_tf: "5m" | "15m";
  bias_tf: "1h" | "4h";

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
};

export type SetupEngineOutput = {
  ts: number;
  dq_ok: boolean;
  preferred_id?: string;
  setups: TradeSetup[];
};
