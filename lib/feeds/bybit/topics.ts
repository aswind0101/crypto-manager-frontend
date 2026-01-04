import type { Tf } from "../core/types";

export const BYBIT_PUBLIC_WS = "wss://stream.bybit.com/v5/public/linear";

export function tfToBybitInterval(tf: Tf): string {
  switch (tf) {
    case "1m": return "1";
    case "3m": return "3";
    case "5m": return "5";
    case "15m": return "15";
    case "1h": return "60";
    case "4h": return "240";
    case "1D": return "D";
    default: return "1";
  }
}

export function bybitKlineTopic(tf: Tf, symbol: string) {
  return `kline.${tfToBybitInterval(tf)}.${symbol}`;
}

export function bybitTradeTopic(symbol: string) {
  return `publicTrade.${symbol}`;
}

// Depth 200 (engine); UI có thể render top 20/50 tuỳ bạn.
export function bybitOrderbookTopic(symbol: string, depth = 200) {
  return `orderbook.${depth}.${symbol}`;
}
