import type { Tf } from "../core/types";

export const BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws";

export function tfToBinanceKline(tf: Tf): string {
  switch (tf) {
    case "1m": return "1m";
    case "3m": return "3m";
    case "5m": return "5m";
    case "15m": return "15m";
    case "1h": return "1h";
    case "4h": return "4h";
    case "1D": return "1d";
    default: return "1m";
  }
}

export function binanceAggTradeStream(symbolCanon: string) {
  return `${symbolCanon.toLowerCase()}@aggTrade`;
}

export function binanceKlineStream(tf: Tf, symbolCanon: string) {
  return `${symbolCanon.toLowerCase()}@kline_${tfToBinanceKline(tf)}`;
}

export function binanceSubscribeMsg(streams: string[]) {
  return {
    method: "SUBSCRIBE",
    params: streams,
    id: Date.now(),
  };
}
