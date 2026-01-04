import type { Tf, Candle, Orderbook, Trade } from "../core/types";

export type UnifiedSnapshot = {
  canon: string;
  ts_generated: number;
  clock_skew_ms: number;

  availability: {
    bybit: { ok: boolean; notes?: string[] };
    binance: { ok: boolean; notes?: string[] };
    okx: { ok: boolean; notes?: string[] };
  };

  timeframes: Array<{
    tf: Tf;
    candles?: { ohlcv: Candle[]; src: "bybit"; ts_last: number };
    orderflow?: {
      orderbook?: Orderbook;
      trades?: Trade[]; // newest-first hoặc oldest-first tuỳ bạn (khuyến nghị newest-first cho UI)
    };
    diagnostics: {
      stale_ms: number;
      partial: boolean;
    };
  }>;
  cross_exchange?: {
    deviation_bps?: {
      bybit_binance?: number; // (bybit - binance) / mid * 10_000
    };
    lead_lag?: {
      leader: "bybit" | "binance" | "none";
      lag_bars: number;   // số bar (1m) lệch, âm nghĩa bybit đi trước
      score: number;      // 0..1 (corr chuẩn hoá)
      window_bars: number;
    };
  };
  data_quality: {
    grade: "A" | "B" | "C" | "D";
    score: number;
    reasons: string[];
  };
};
