// lib/client/snapshot-mini.js
import { fetchTickerLinear, fetchKlineLinear } from "./bybit-public";

function tfMs(tf) {
  const n = Number(tf);
  if (tf === "D") return 24 * 60 * 60 * 1000;
  if (!Number.isFinite(n)) return null;
  return n * 60 * 1000;
}

function computeLastClosedTs(tf) {
  const ms = tfMs(tf);
  const now = Date.now();
  if (!ms) return null;
  return Math.floor(now / ms) * ms - ms;
}

function toIndicatorLastFromKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) return null;
  const sorted = [...klines].sort((a, b) => a.startTime - b.startTime);
  const last = sorted[sorted.length - 1];
  return { ts: last.startTime, o: last.open, h: last.high, l: last.low, c: last.close };
}

export async function buildClientMiniSnapshot({ symbol }) {
  const generated_at = Date.now();

  const [ticker, h1, h4, m15] = await Promise.all([
    fetchTickerLinear(symbol),
    fetchKlineLinear(symbol, "60", 210),
    fetchKlineLinear(symbol, "240", 210),
    fetchKlineLinear(symbol, "15", 210),
  ]);

  const lastClosedH1 = computeLastClosedTs("60");
  const lastClosedM15 = computeLastClosedTs("15");

  const htfSymbolBlock = {
    ticker,
    indicators: {
      "60": { last: toIndicatorLastFromKlines(h1) },
      "240": { last: toIndicatorLastFromKlines(h4) },
    },
    meta: {
      candle_status: {
        "60": { last_closed_ts: lastClosedH1, is_last_closed: true },
      },
      last_closed_kline_ts: {
        "60": lastClosedH1,
        "240": computeLastClosedTs("240"),
      },
    },
  };

  const ltfSymbolBlock = {
    indicators_ltf: {
      "15": { last: toIndicatorLastFromKlines(m15) },
    },
    meta: {
      candle_status: {
        "15": { last_closed_ts: lastClosedM15, is_last_closed: true },
      },
    },
    ltf_trigger_state: {
      primary_tf: "15",
      state: "READY",
      actionable: true,
      reason_code: "OK",
      reason_detail: "",
    },
  };

  return {
    schema: { name: "price_analyzer_full_snapshot", version: "3.3-full" },
    generated_at,
    per_exchange: { bybit: { symbols: { [symbol]: htfSymbolBlock } } },
    per_exchange_ltf: { bybit: { symbols: { [symbol]: ltfSymbolBlock } } },
  };
}
