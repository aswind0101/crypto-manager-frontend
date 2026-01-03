import useSWR from "swr";

// Engines (JS)
import { buildSetupsV3 } from "../lib/indicators/setup-engine";
import { buildMarketOutlookV1 } from "../lib/indicators/market-outlook";

const fetchJson = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
};

// -------- Bybit (linear futures) --------
async function fetchBybit(symbol) {
  const base = "https://api.bybit.com";
  const ticker = await fetchJson(
    `${base}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`
  );
  const klines = await fetchJson(
    `${base}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=60&limit=200`
  );
  const orderbook = await fetchJson(
    `${base}/v5/market/orderbook?category=linear&symbol=${encodeURIComponent(symbol)}&limit=50`
  );
  return { ticker, klines, orderbook };
}

// -------- Binance Futures --------
async function fetchBinance(symbol) {
  const base = "https://fapi.binance.com";
  const bookTicker = await fetchJson(
    `${base}/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`
  );
  const klines = await fetchJson(
    `${base}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=200`
  );
  const depth = await fetchJson(
    `${base}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=50`
  );
  return { bookTicker, klines, depth };
}

// -------- Minimal snapshot builder --------
// Snapshot engines v3/outlook expect certain shapes.
// This is a "minimum viable snapshot" so UI runs immediately.
// You can expand later (funding/OI/liquidations/etc).
function buildSnapshotFromClientData({ symbol, bybit, binance }) {
  const normalizeBybitKlines = (raw) => {
    const list = raw?.result?.list;
    if (!Array.isArray(list)) return [];
    const rows = list
      .map((r) => ({
        ts: Number(r?.[0]),
        o: Number(r?.[1]),
        h: Number(r?.[2]),
        l: Number(r?.[3]),
        c: Number(r?.[4]),
        v: Number(r?.[5]),
      }))
      .filter((x) => [x.ts, x.o, x.h, x.l, x.c].every(Number.isFinite))
      .sort((a, b) => a.ts - b.ts);

    // keep strictly closed: drop last candle
    if (rows.length > 2) rows.pop();
    return rows;
  };

  const normalizeBinanceKlines = (raw) => {
    if (!Array.isArray(raw)) return [];
    const rows = raw
      .map((r) => ({
        ts: Number(r?.[0]),
        o: Number(r?.[1]),
        h: Number(r?.[2]),
        l: Number(r?.[3]),
        c: Number(r?.[4]),
        v: Number(r?.[5]),
      }))
      .filter((x) => [x.ts, x.o, x.h, x.l, x.c].every(Number.isFinite))
      .sort((a, b) => a.ts - b.ts);

    if (rows.length > 2) rows.pop();
    return rows;
  };

  const bybitTicker = bybit?.ticker?.result?.list?.[0];
  const bybitMark = Number(bybitTicker?.markPrice);
  const bybitLast = Number(bybitTicker?.lastPrice);

  const binBook = binance?.bookTicker;
  const binBid = Number(binBook?.bidPrice);
  const binAsk = Number(binBook?.askPrice);
  const binMid = Number.isFinite(binBid) && Number.isFinite(binAsk) ? (binBid + binAsk) / 2 : null;

  return {
    symbol,
    generated_at: Date.now(),
    request: { symbol },

    per_exchange: {
      bybit: bybit
        ? {
            ticker: { mark: bybitMark, last: bybitLast },
            klines: { "60": { closed: normalizeBybitKlines(bybit?.klines) } },
            orderbook: bybit?.orderbook ?? null,
          }
        : undefined,
      binance: binance
        ? {
            ticker: { mark: binMid, last: binMid },
            klines: { "60": { closed: normalizeBinanceKlines(binance?.klines) } },
            orderbook: binance?.depth ?? null,
          }
        : undefined,
    },

    unified: {
      data_quality: "partial",
      scores: { overall: 0.55, trend: 0.50 },
      features: {
        timeframes: {},
        derivatives: {},
        orderflow: {},
      },
      anchor_layer: null,
      setups_v2: null,
    },
  };
}

async function computeAnalysis({ symbol, preferExchange, preferTf }) {
  let bybit = null;
  let binance = null;
  const errors = [];

  await Promise.all([
    fetchBybit(symbol).then((x) => (bybit = x)).catch((e) => errors.push(`bybit: ${String(e?.message || e)}`)),
    fetchBinance(symbol).then((x) => (binance = x)).catch((e) => errors.push(`binance: ${String(e?.message || e)}`)),
  ]);

  const snapshot = buildSnapshotFromClientData({ symbol, bybit, binance });
  snapshot.__client_errors = errors;

  const setups = buildSetupsV3(snapshot, {
    prefer_tf: preferTf || "60",
    prefer_exchange: preferExchange || "bybit",
    min_score: 0.55,
  });

  // outlook expects snapshot.unified.setups_v2
  snapshot.unified = snapshot.unified || {};
  snapshot.unified.setups_v2 = setups;

  const outlook = buildMarketOutlookV1(snapshot);

  return { snapshot, setups, outlook };
}

export function useAnalysisEngine({ symbol, preferExchange = "bybit", preferTf = "60" }) {
  const key = symbol ? ["analysis", symbol, preferExchange, preferTf] : null;

  return useSWR(
    key,
    () => computeAnalysis({ symbol, preferExchange, preferTf }),
    {
      refreshInterval: 25000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    }
  );
}
