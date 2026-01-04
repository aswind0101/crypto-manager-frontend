import type { Tf } from "../core/types";

export type TrendDir = "bull" | "bear" | "sideways";
export type VolRegime = "low" | "normal" | "high";

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
  };

  entry: {
    tfs: Array<"5m" | "15m">;
    momentum: {
      rsi14_5m?: number;
      rsi14_15m?: number;
      macdHist_5m?: number;
      macdHist_15m?: number;
    };
    volatility: {
      atrp_15m?: number;  // ATR/price (%)
      bbWidth_15m?: number;
    };
  };

  orderflow: {
    imbalance: { top10: number; top50: number; top200: number }; // [-1..1]
    aggression_ratio: number; // buy/(buy+sell) 0..1
  };

  cross: {
    dev_bps?: number;
    dev_z?: number;
    lead_lag?: { leader: "bybit" | "binance" | "none"; lag_bars: number; score: number };
    consensus_score?: number; // 0..1
  };

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
