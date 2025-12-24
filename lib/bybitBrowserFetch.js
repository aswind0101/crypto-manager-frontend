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

export async function fetchBybitKlines({ symbol, interval, limit = 300 }) {
  const url = new URL("/v5/market/kline", BYBIT_BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bybit HTTP ${res.status}: ${text || "request failed"}`);
  }

  const json = await res.json();
  if (json?.retCode !== 0) {
    throw new Error(`Bybit retCode ${json?.retCode}: ${json?.retMsg}`);
  }

  const list = json?.result?.list || [];
  return list.map(mapBybitKlineRow).sort((a, b) => a.t - b.t);
}
