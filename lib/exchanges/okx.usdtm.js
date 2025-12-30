// lib/exchanges/okx.usdtm.js
const BASE = "https://www.okx.com";

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
      await sleep(350 * (attempt + 1));
    }
  }
}

export function toOkxInstId(symbol) {
  // BTCUSDT -> BTC-USDT-SWAP
  const s = String(symbol || "").toUpperCase().trim();
  const base = s.replace("USDT", "");
  return `${base}-USDT-SWAP`;
}

export function tfToOkx(tf) {
  // OKX bar: "5m","15m","1H","4H","1D"
  const s = String(tf);
  if (s === "5") return "5m";
  if (s === "15") return "15m";
  if (s === "60") return "1H";
  if (s === "240") return "4H";
  if (s === "D") return "1D";
  return "1H";
}

export async function getKlines(symbol, tf, limit = 300) {
  const instId = toOkxInstId(symbol);
  const url = new URL("/api/v5/market/candles", BASE);
  url.searchParams.set("instId", instId);
  url.searchParams.set("bar", tfToOkx(tf));
  url.searchParams.set("limit", String(limit));

  const j = await fetchJson(url.toString());
  const list = j?.data || [];
  // OKX candles: [ ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm ]
  const asc = [...list].reverse().map(r => ({
    ts: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[5]),
    confirm: String(r[8] ?? ""),
  }));
  return asc;
}

export async function getTicker(symbol) {
  const instId = toOkxInstId(symbol);
  const url = new URL("/api/v5/public/funding-rate", BASE);
  url.searchParams.set("instId", instId);
  const j = await fetchJson(url.toString());
  const x = j?.data?.[0] || {};
  return {
    last: null,
    mark: Number(x.markPrice),
    index: Number(x.indexPrice),
    funding: Number(x.fundingRate),
    nextFundingTime: Number(x.nextFundingTime),
  };
}

export async function getOpenInterest(symbol) {
  const instId = toOkxInstId(symbol);
  const url = new URL("/api/v5/public/open-interest", BASE);
  url.searchParams.set("instType", "SWAP");
  url.searchParams.set("instId", instId);
  const j = await fetchJson(url.toString());
  const x = j?.data?.[0] || {};
  return { ts: Date.now(), oi: Number(x.oi) };
}

export async function getOrderbook(symbol, depth = 50) {
  const instId = toOkxInstId(symbol);
  const url = new URL("/api/v5/market/books", BASE);
  url.searchParams.set("instId", instId);
  url.searchParams.set("sz", String(Math.min(400, Math.max(1, depth))));
  const j = await fetchJson(url.toString());
  const x = j?.data?.[0] || {};
  return {
    ts: Date.now(),
    bids: (x.bids || []).map(([p, s]) => ({ p: Number(p), s: Number(s) })),
    asks: (x.asks || []).map(([p, s]) => ({ p: Number(p), s: Number(s) })),
  };
}

export async function getRecentTrades(symbol, limit = 500) {
  const instId = toOkxInstId(symbol);
  const url = new URL("/api/v5/market/trades", BASE);
  url.searchParams.set("instId", instId);
  url.searchParams.set("limit", String(Math.min(500, Math.max(1, limit))));
  const j = await fetchJson(url.toString());
  const arr = j?.data || [];
  // OKX trades: { ts, px, sz, side }
  return arr.map(t => ({
    ts: Number(t.ts),
    px: Number(t.px),
    qty: Number(t.sz),
    side: String(t.side || "").toUpperCase(), // BUY/SELL
  }));
}
