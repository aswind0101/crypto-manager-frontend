// lib/feeds/bybit/universe.ts

export type BybitUniverseItem = {
  symbol: string;
  turnover24h: number; // quote turnover
  volume24h?: number;
  lastPrice?: number;
};

function toNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function isLikelyLinearUsdtPerpSymbol(sym: string): boolean {
  return typeof sym === "string" && sym.endsWith("USDT") && sym.length >= 6;
}

/**
 * Top symbols by 24h quote turnover (Bybit v5 market/tickers, linear).
 * No “beauty filtering”, only liquidity ordering.
 */
export async function fetchBybitTopUniverse(args?: {
  limit?: number;
  minTurnover24h?: number;
  signal?: AbortSignal;
}): Promise<BybitUniverseItem[]> {
  const limit = Math.max(1, Math.min(200, args?.limit ?? 60));
  const minTurnover24h = Math.max(0, args?.minTurnover24h ?? 0);

  const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", {
    method: "GET",
    cache: "no-store",
    signal: args?.signal,
  });
  if (!res.ok) return [];

  const json = await res.json().catch(() => null);
  const list = json?.result?.list;
  if (!Array.isArray(list)) return [];

  const out: BybitUniverseItem[] = [];

  for (const row of list) {
    const symbol = String(row?.symbol ?? "");
    if (!symbol) continue;
    if (!isLikelyLinearUsdtPerpSymbol(symbol)) continue;

    const turnover24h = toNum(row?.turnover24h ?? row?.turnoverUsd ?? row?.turnover24H);
    if (!Number.isFinite(turnover24h)) continue;
    if (turnover24h < minTurnover24h) continue;

    const volume24h = toNum(row?.volume24h ?? row?.volume24H);
    const lastPrice = toNum(row?.lastPrice);

    out.push({
      symbol,
      turnover24h,
      volume24h: Number.isFinite(volume24h) ? volume24h : undefined,
      lastPrice: Number.isFinite(lastPrice) ? lastPrice : undefined,
    });
  }

  out.sort((a, b) => b.turnover24h - a.turnover24h);
  return out.slice(0, limit);
}
