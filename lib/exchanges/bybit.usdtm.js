// lib/exchanges/bybit.usdtm.js
const BASE = "https://api.bybit.com";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, { timeoutMs = 12000, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      if (attempt === retries) throw e;
      await sleep(300 * (attempt + 1));
    }
  }
}

export function tfToBybit(tf) {
  // Bybit: "5","15","60","240","D"
  return String(tf);
}

export async function getKlines(symbol, tf, limit = 300) {
  const interval = tfToBybit(tf);
  const url = new URL("/v5/market/kline", BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const j = await fetchJson(url.toString());
  const list = j?.result?.list || [];
  // Bybit list: [ [startTime, open, high, low, close, volume, turnover], ... ] desc
  const asc = [...list].reverse().map(row => ({
    ts: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  }));
  return asc;
}

export async function getTicker(symbol) {
  const url = new URL("/v5/market/tickers", BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);

  const j = await fetchJson(url.toString());
  const t = j?.result?.list?.[0] || {};
  return {
    last: Number(t.lastPrice),
    mark: Number(t.markPrice),
    index: Number(t.indexPrice),
    funding: Number(t.fundingRate),
    nextFundingTime: Number(t.nextFundingTime),
  };
}

export async function getOpenInterest(symbol) {
  const url = new URL("/v5/market/open-interest", BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("intervalTime", "5min"); // Bybit requires one of: 5min/15min/30min/1h/4h/1d
  url.searchParams.set("limit", "50");

  const j = await fetchJson(url.toString());
  const list = j?.result?.list || [];
  return list.map(x => ({ ts: Number(x.timestamp), oi: Number(x.openInterest) }));
}

export async function getFundingHistory(symbol) {
  const url = new URL("/v5/market/funding/history", BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("limit", "50");

  const j = await fetchJson(url.toString());
  const list = j?.result?.list || [];
  return list.map(x => ({ ts: Number(x.fundingRateTimestamp), funding: Number(x.fundingRate) }));
}

export async function getOrderbook(symbol, depth = 50) {
  const url = new URL("/v5/market/orderbook", BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("limit", String(Math.min(200, Math.max(1, depth))));

  const j = await fetchJson(url.toString());
  const r = j?.result || {};
  const bids = (r.b || []).map(([p, s]) => ({ p: Number(p), s: Number(s) }));
  const asks = (r.a || []).map(([p, s]) => ({ p: Number(p), s: Number(s) }));
  return { ts: Date.now(), bids, asks };
}

export async function getRecentTrades(symbol, limit = 500) {
  const url = new URL("/v5/market/recent-trade", BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("limit", String(Math.min(1000, Math.max(1, limit))));

  const j = await fetchJson(url.toString());
  const list = j?.result?.list || [];
  return list.map(x => ({
    ts: Number(x.time),
    px: Number(x.price),
    qty: Number(x.size),
    side: String(x.side || "").toUpperCase(), // "BUY"/"SELL" (Bybit format)
  }));
}
