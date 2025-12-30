// lib/exchanges/binance.usdtm.js
const BASE = "https://fapi.binance.com";

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

export function tfToBinance(tf) {
    const s = String(tf);
    if (s === "D") return "1d";
    return `${s}m`; // "5m","15m","60m","240m"
}

export async function getKlines(symbol, tf, limit = 300) {
    const url = new URL("/fapi/v1/klines", BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", tfToBinance(tf));
    url.searchParams.set("limit", String(limit));

    const arr = await fetchJson(url.toString());
    // [ openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBase, takerQuote, ignore ]
    return (arr || []).map(r => ({
        ts: Number(r[0]),
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
        v: Number(r[5]),
        trades: Number(r[8]),
        takerBase: Number(r[9]),
    }));
}

export async function getTicker(symbol) {
    const url = new URL("/fapi/v1/premiumIndex", BASE);
    url.searchParams.set("symbol", symbol);
    const t = await fetchJson(url.toString());
    return {
        last: Number(t.lastPrice),
        mark: Number(t.markPrice),
        index: Number(t.indexPrice),
        funding: Number(t.lastFundingRate),
        nextFundingTime: Number(t.nextFundingTime),
    };
}

export async function getOpenInterest(symbol) {
    const url = new URL("/fapi/v1/openInterest", BASE);
    url.searchParams.set("symbol", symbol);
    const j = await fetchJson(url.toString());
    return { ts: Date.now(), oi: Number(j.openInterest) };
}

export async function getFundingHistory(symbol, limit = 50) {
    const url = new URL("/fapi/v1/fundingRate", BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("limit", String(Math.min(1000, Math.max(1, limit))));
    const arr = await fetchJson(url.toString());
    return (arr || []).map(x => ({ ts: Number(x.fundingTime), funding: Number(x.fundingRate) }));
}

export async function getOrderbook(symbol, depth = 50) {
    const url = new URL("/fapi/v1/depth", BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("limit", String([5, 10, 20, 50, 100, 500, 1000].includes(depth) ? depth : 50));
    const j = await fetchJson(url.toString());
    return {
        ts: Date.now(),
        bids: (j.bids || []).map(([p, s]) => ({ p: Number(p), s: Number(s) })),
        asks: (j.asks || []).map(([p, s]) => ({ p: Number(p), s: Number(s) })),
    };
}
// Binance Open Interest Statistics (history) :contentReference[oaicite:4]{index=4}
export async function getOpenInterestHist(symbol, period = "5m", limit = 50) {
    const url = new URL("/futures/data/openInterestHist", BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("period", period); // "5m","15m","30m","1h","2h","4h","6h","12h","1d"
    url.searchParams.set("limit", String(Math.min(500, Math.max(1, limit))));

    const arr = await fetchJson(url.toString());
    return (arr || []).map(x => ({
        ts: Number(x.timestamp),
        oi: Number(x.sumOpenInterest),
        oiValue: Number(x.sumOpenInterestValue),
    }));
}

export async function getRecentTrades(symbol, limit = 500) {
    const url = new URL("/fapi/v1/trades", BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("limit", String(Math.min(1000, Math.max(1, limit))));
    const arr = await fetchJson(url.toString());
    // Binance trade: { price, qty, time, isBuyerMaker }
    return (arr || []).map(t => ({
        ts: Number(t.time),
        px: Number(t.price),
        qty: Number(t.qty),
        // isBuyerMaker=true -> buyer is maker => aggressor is SELL
        side: t.isBuyerMaker ? "SELL" : "BUY",
    }));
}
