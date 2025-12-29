// lib/client/bybit-public.js
async function bybitGet(path, params = {}) {
  const u = new URL(`https://api.bybit.com${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }

  const res = await fetch(u.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}: ${text.slice(0, 200)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Bybit non-JSON response: ${text.slice(0, 200)}`);
  }
  if (json?.retCode !== 0 && json?.retCode !== undefined) {
    throw new Error(`Bybit retCode=${json.retCode}: ${json.retMsg || "Unknown"}`);
  }
  return json;
}

export async function fetchTickerLinear(symbol) {
  const j = await bybitGet("/v5/market/tickers", { category: "linear", symbol });
  const t = j?.result?.list?.[0];
  if (!t) throw new Error(`No ticker for ${symbol}`);
  return {
    lastPrice: Number(t.lastPrice),
    indexPrice: Number(t.indexPrice),
    highPrice24h: Number(t.highPrice24h),
    lowPrice24h: Number(t.lowPrice24h),
  };
}

export async function fetchKlineLinear(symbol, interval, limit = 200) {
  const j = await bybitGet("/v5/market/kline", {
    category: "linear",
    symbol,
    interval,
    limit,
  });
  const list = j?.result?.list || [];
  return list.map((r) => ({
    startTime: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}
