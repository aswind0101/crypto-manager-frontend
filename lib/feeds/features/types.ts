import type { Tf } from "../core/types";

export type TrendDir = "bull" | "bear" | "sideways";
export type VolRegime = "low" | "normal" | "high";

export type BiasTfSnapshot = {
  tf: string;

  trend_dir?: TrendDir;
  trend_strength?: number; // 0..1
  vol_regime?: VolRegime;
  adx14?: number;
  ema200?: number;
  ema200_slope_bps?: number;   // NEW
  trend_angle_deg?: number;    // NEW
  complete: boolean;
  have: number;
  need: number;
};

export type FeaturesSnapshot = {
  canon: string;
  ts: number;

  quality: {
    dq_grade: "A" | "B" | "C" | "D";
    bybit_ok: boolean;
    binance_ok: boolean;
  };

  bias: {
    tf: "1h" | "4h";
    trend_dir: TrendDir;
    trend_strength: number; // 0..1
    vol_regime: VolRegime;
    adx14?: number;
    ema200?: number;
    ema200_slope_bps?: number; // EMA200 slope in bps per bar
  };
  bias_by_tf?: Record<"15m" | "1h" | "4h" | "1D", BiasTfSnapshot>;
  entry: {
    tfs: Array<"5m" | "15m">;
    momentum: {
      rsi14_5m?: number;
      rsi14_15m?: number;
      macdHist_5m?: number;
      macdHist_15m?: number;
    };
    volatility: {
      atrp_5m?: number;   // ATR/price (%) 5m (scalp sizing)
      atrp_15m?: number;  // ATR/price (%) 15m

      atrp_1h?: number;   // NEW: ATR/price (%) 1h
      atrp_4h?: number;   // NEW: ATR/price (%) 4h

      bbWidth_15m?: number;
      bbWidth_1h?: number; // NEW
      bbWidth_4h?: number; // NEW
    };

  };

  orderflow: {
    imbalance: { top10: number; top50: number; top200: number }; // [-1..1]
    aggression_ratio: number; // buy/(buy+sell) 0..1

    // NEW: trade-delta derived signals (optional)
    delta?: {
      buy_qty: number;
      sell_qty: number;
      delta_qty: number;        // buy - sell
      delta_norm: number;       // (buy-sell)/(buy+sell) in [-1..1]
      cvd: number;              // for now: window CVD proxy (same units as qty)

      divergence_score: number; // 0..1 (price vs delta disagreement)
      divergence_dir: "bull" | "bear" | "none";

      absorption_score: number; // 0..1 (high aggressive qty + small price movement)
      absorption_dir: "bull" | "bear" | "none";
    };
  };


  cross: {
    dev_bps?: number;
    dev_z?: number;
    lead_lag?: { leader: "bybit" | "binance" | "none"; lag_bars: number; score: number };
    consensus_score?: number; // 0..1
  };
  market_structure?: MarketStructureSnapshot;

  flags: {
    partial: boolean;
    notes?: string[];
  };
};

export type FeatureEngineInput = {
  canon: string;
  ts: number;

  dq: { grade: "A" | "B" | "C" | "D"; score: number };

  bybitOk: boolean;
  binanceOk: boolean;

  candles: Partial<Record<Tf, { bybit?: any[]; binance?: any[] }>>;

  // From snapshot timeframes[tf].orderflow for 1m
  orderbook?: {
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
  };
  trades1m?: Array<{ ts: number; p: number; q: number; side: "buy" | "sell" }>;

  cross?: {
    dev_bps?: number;
    lead_lag?: { leader: "bybit" | "binance" | "none"; lag_bars: number; score: number };
  };
};

export type MarketTrend = "BULL" | "BEAR" | "RANGE" | "UNKNOWN";
export type SwingType = "HIGH" | "LOW";

export type SwingPoint = {
  type: SwingType;
  ts: number;
  price: number;
  strength: number;
};

export type StructureEvent = {
  kind: "BOS" | "CHOCH";
  dir: "UP" | "DOWN";
  tf: string;
  ts: number;
  level: number;
  close: number;
};

export type SweepEvent = {
  dir: "UP" | "DOWN";
  tf: string;
  ts: number;
  level: number;
  high: number;
  low: number;
  close: number;
};

export type MarketStructureTF = {
  tf: string;
  trend: MarketTrend;
  confirmed_count: number;

  lastSwingHigh?: SwingPoint;
  lastSwingLow?: SwingPoint;
  recentSwings: SwingPoint[];

  lastBOS?: StructureEvent;
  lastCHOCH?: StructureEvent;
  lastSweep?: SweepEvent;

  bosUp: boolean;
  bosDown: boolean;
  chochUp: boolean;
  chochDown: boolean;
  sweepUp: boolean;
  sweepDown: boolean;
};

export type MarketStructureSnapshot = Record<string, MarketStructureTF>;