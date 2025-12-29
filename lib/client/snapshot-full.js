// lib/client/snapshot-full.js
import { fetchTickerLinear, fetchKlineLinear, fetchFundingRate, fetchOpenInterest, fetchLongShortRatio } from "./bybit-public";
import { ema, atr14, lastCandle } from "./ta";
import { computeKeyLevelsFromKlines } from "./key-levels";
import { trendLabelFromEma } from "./structure";
import { computeLtfGate } from "./ltf-gate";

export async function buildClientFullSnapshot({ symbol }) {
  const generated_at = Date.now();

  // Fetch core klines
  const [ticker, h1, h4, m15] = await Promise.all([
    fetchTickerLinear(symbol),
    fetchKlineLinear(symbol, "60", 300),
    fetchKlineLinear(symbol, "240", 300),
    fetchKlineLinear(symbol, "15", 300),
  ]);

  // Optional derived metrics (best-effort)
  const [funding, oi, lsr] = await Promise.all([
    fetchFundingRate(symbol).catch(() => null),
    fetchOpenInterest(symbol).catch(() => null),
    fetchLongShortRatio(symbol).catch(() => null),
  ]);

  // Series
  const h1Close = h1.map((k) => k.close);
  const h4Close = h4.map((k) => k.close);

  // Indicators
  const atrH1 = atr14(h1, 14);

  const ema20H4 = ema(h4Close, 20);
  const ema50H4 = ema(h4Close, 50);

  const ema20H1 = ema(h1Close, 20);
  const ema50H1 = ema(h1Close, 50);

  // Key levels from H1 (or M15). H1 is stable.
  const keyLevels = computeKeyLevelsFromKlines(h1);

  // Trend labels
  const h4Trend = trendLabelFromEma(h4Close, ema20H4, ema50H4);
  const h1Trend = trendLabelFromEma(h1Close, ema20H1, ema50H1);

  // LTF gate from M15 last candle
  const last15 = lastCandle(m15);
  const ltfGate = computeLtfGate({ tf: "15", lastCandle: last15, now: generated_at });

  // Snapshot blocks
  const htfSymbolBlock = {
    ticker,
    derived_metrics: {
      bybit: {
        open_interest: oi,
        funding_rate: funding,
        long_short_ratio: lsr,
      },
    },
    indicators: {
      "60": {
        atr14: atrH1,
        last: lastCandle(h1),
      },
      "240": {
        ema: { ema20: ema20H4, ema50: ema50H4 },
        last: lastCandle(h4),
      },
    },
    key_levels: keyLevels || {},
    price_structure: {
      H4: { trend_label: h4Trend },
      H1: { trend_label: h1Trend },
    },
    meta: {
      // có thể bổ sung thêm nếu engine/closed-candle module bạn yêu cầu
      generated_at,
    },
  };

  const ltfSymbolBlock = {
    indicators_ltf: {
      "15": { last: last15 },
    },
    ltf_trigger_state: ltfGate,
    meta: { generated_at },
  };

  return {
    schema: { name: "price_analyzer_full_snapshot", version: "3.3-full" },
    generated_at,
    per_exchange: { bybit: { symbols: { [symbol]: htfSymbolBlock } } },
    per_exchange_ltf: { bybit: { symbols: { [symbol]: ltfSymbolBlock } } },
  };
}
