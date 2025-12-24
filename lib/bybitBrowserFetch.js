// crypto-manager-frontend/lib/bybitBrowserFetch.js
const BYBIT_BASE = "https://api.bybit.com";

function mapBybitKlineRow(r) {
  // Bybit: [startTime, open, high, low, close, volume, turnover]
  return {
    t: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[5]),
  };
}

async function bybitGet(path, params) {
  const qs = new URLSearchParams(params || {}).toString();
  const url = `${BYBIT_BASE}${path}?${qs}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bybit HTTP ${res.status}: ${text || "request failed"}`);
  }
  const json = await res.json();
  if (json?.retCode !== 0) throw new Error(`Bybit retCode ${json?.retCode}: ${json?.retMsg}`);
  return json;
}

export async function fetchBybitKlines({ symbol, interval, limit = 300, category = "linear" }) {
  const json = await bybitGet("/v5/market/kline", { category, symbol, interval, limit: String(limit) });
  const list = json?.result?.list || [];
  return list.map(mapBybitKlineRow).sort((a, b) => a.t - b.t);
}

// Market snapshot (public endpoints)
export async function fetchMarketContext({ symbol, category = "linear" }) {
  // ticker
  const ticker = await bybitGet("/v5/market/tickers", { category, symbol });
  const t = (ticker?.result?.list?.[0] || {});

  // mark/index are usually inside ticker list for linear
  const last = Number(t.lastPrice);
  const mark = Number(t.markPrice);
  const index = Number(t.indexPrice);
  const bid = Number(t.bid1Price);
  const ask = Number(t.ask1Price);
  const high24h = Number(t.highPrice24h);
  const low24h = Number(t.lowPrice24h);
  const vol24h = Number(t.volume24h);
  const turn24h = Number(t.turnover24h);

  let spread = null;
  let spread_bps = null;
  if (Number.isFinite(bid) && Number.isFinite(ask) && ask > 0) {
    spread = ask - bid;
    spread_bps = (spread / ask) * 10_000;
  }

  // funding
  // Some markets expose funding via /v5/market/funding/history or /v5/market/funding/prev-funding-rate
  // We use history with limit=1 for current-ish rate.
  let fundingRate = null;
  let nextFundingTs = null;
  try {
    const fr = await bybitGet("/v5/market/funding/history", { category, symbol, limit: "1" });
    const row = fr?.result?.list?.[0];
    if (row) {
      fundingRate = Number(row.fundingRate);
      nextFundingTs = Number(row.fundingRateTimestamp);
    }
  } catch (_) {
    // optional; keep null
  }

  // open interest (public)
  let openInterest = null;
  try {
    const oi = await bybitGet("/v5/market/open-interest", { category, symbol, intervalTime: "5min", limit: "1" });
    const row = oi?.result?.list?.[0];
    if (row) openInterest = Number(row.openInterest);
  } catch (_) {}

  // long/short ratio (public)
  let lsrAccount = null;
  try {
    const lsr = await bybitGet("/v5/market/account-ratio", { category, symbol, period: "5min", limit: "1" });
    const row = lsr?.result?.list?.[0];
    if (row) lsrAccount = Number(row.buyRatio) / Math.max(1e-9, Number(row.sellRatio));
  } catch (_) {}

  // orderbook (optional)
  let orderbook = { ts: null, bids: [], asks: [], imbalance: null };
  try {
    const ob = await bybitGet("/v5/market/orderbook", { category, symbol, limit: "50" });
    const bids = (ob?.result?.b || []).slice(0, 20).map(([p, q]) => [Number(p), Number(q)]);
    const asks = (ob?.result?.a || []).slice(0, 20).map(([p, q]) => [Number(p), Number(q)]);
    const bidVol = bids.reduce((s, [, q]) => s + (Number.isFinite(q) ? q : 0), 0);
    const askVol = asks.reduce((s, [, q]) => s + (Number.isFinite(q) ? q : 0), 0);
    const imb = (bidVol + askVol) > 0 ? (bidVol - askVol) / (bidVol + askVol) : null;
    orderbook = { ts: Date.now(), bids, asks, imbalance: imb };
  } catch (_) {}

  return {
    market: {
      price: { last, mark, index, bid, ask, spread, spread_bps },
      ticker_24h: { high: high24h, low: low24h, volume: vol24h, turnover: turn24h, change_pct: null },
      derivatives: {
        funding: { rate: fundingRate, next_funding_ts: nextFundingTs, history: [] },
        open_interest: { value: openInterest, history: [] },
        long_short_ratio: { account: { value: lsrAccount, history: [] }, position: { value: null, history: [] } },
        liquidations: { history: [] },
      },
      microstructure: {
        orderbook,
        recent_trades: { ts: null, buy_vol: null, sell_vol: null, delta: null },
      }
    },
    fetched_at_ts: Date.now(),
    server_time_ts: null,
    request_ids: [],
  };
}
