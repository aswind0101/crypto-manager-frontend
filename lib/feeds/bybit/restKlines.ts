import type { Candle, Tf } from "../core/types";

const TF_MAP: Record<Tf, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1D": "D",
};

export async function fetchBybitKlines(
  symbol: string,
  tf: Tf,
  limit = 200
): Promise<Candle[]> {
  const interval = TF_MAP[tf];
  const url =
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit kline HTTP ${res.status}`);
  const json = await res.json();

  const list = json?.result?.list as any[] | undefined;
  if (!Array.isArray(list)) return [];

  // REST trả newest-first → đảo lại
  const rows = list.slice().reverse();

  return rows.map((r) => ({
    ts: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[5]),
    confirm: true, // REST candles coi như confirmed
  }));
}
