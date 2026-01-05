import type { Candle, Trade, Side } from "../core/types";

function toNum(x: any): number { return typeof x === "number" ? x : Number(x); }

export function normBinanceAggTrade(msg: any): Trade | null {
  // e: "aggTrade"
  if (msg?.e !== "aggTrade") return null;
  return {
    ts: toNum(msg.T),
    p: toNum(msg.p),
    q: toNum(msg.q),
    // m=true => buyer is maker => trade is sell-initiated (aggression)
    side: (msg.m ? "sell" : "buy") as Side,
  };
}

export function normBinanceKline(msg: any): { tf: string; candle: Candle } | null {
  // e:"kline", k:{t,o,h,l,c,v,x}
  if (msg?.e !== "kline") return null;
  const k = msg.k;
  if (!k) return null;

  return {
    tf: String(k.i), // "1m","5m","1h"...
    candle: {
      ts: toNum(k.t),
      o: toNum(k.o),
      h: toNum(k.h),
      l: toNum(k.l),
      c: toNum(k.c),
      v: toNum(k.v),
      confirm: Boolean(k.x), // closed?
    },
  };
}
