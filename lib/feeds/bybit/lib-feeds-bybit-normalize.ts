import type { Candle, Trade, Orderbook, Side } from "../core/types";

function toNum(x: any): number { return typeof x === "number" ? x : Number(x); }

export function normBybitTrades(msg: any): Trade[] {
  // topic: publicTrade.SYMBOL
  const arr = msg?.data;
  if (!Array.isArray(arr)) return [];
  return arr.map((t: any) => ({
    ts: toNum(t.T),
    p: toNum(t.p),
    q: toNum(t.v),
    side: (String(t.S).toLowerCase() === "buy" ? "buy" : "sell") as Side,
  }));
}

export function normBybitKlines(msg: any): Candle[] {
  // topic: kline.<interval>.<symbol>
  const arr = msg?.data;
  if (!Array.isArray(arr)) return [];
  return arr.map((k: any) => ({
    ts: toNum(k.start),
    o: toNum(k.open),
    h: toNum(k.high),
    l: toNum(k.low),
    c: toNum(k.close),
    v: toNum(k.volume),
    confirm: Boolean(k.confirm),
  }));
}

export type BybitOrderbookDelta = {
  ts: number;
  bids?: Array<[number, number]>;
  asks?: Array<[number, number]>;
  snapshot?: boolean;
};

export function normBybitOrderbook(msg: any): BybitOrderbookDelta | null {
  // topic: orderbook.<depth>.<symbol>
  const d = msg?.data;
  if (!d) return null;

  // Bybit trả bids/asks dạng [price, size]
  const bids = Array.isArray(d.b) ? d.b.map((x: any) => [toNum(x[0]), toNum(x[1])] as [number, number]) : undefined;
  const asks = Array.isArray(d.a) ? d.a.map((x: any) => [toNum(x[0]), toNum(x[1])] as [number, number]) : undefined;

  // "type": "snapshot" | "delta" (tuỳ doc / implementation)
  const isSnapshot = String(msg?.type || d?.type || "").toLowerCase().includes("snapshot");

  return {
    ts: toNum(d.ts || msg?.ts || Date.now()),
    bids,
    asks,
    snapshot: isSnapshot,
  };
}

// Apply delta vào local book (price->size map)
export function applyOrderbookDelta(
  book: { bids: Map<number, number>; asks: Map<number, number> },
  delta: BybitOrderbookDelta
) {
  if (delta.bids) {
    for (const [p, s] of delta.bids) {
      if (s === 0) book.bids.delete(p);
      else book.bids.set(p, s);
    }
  }
  if (delta.asks) {
    for (const [p, s] of delta.asks) {
      if (s === 0) book.asks.delete(p);
      else book.asks.set(p, s);
    }
  }
}

export function materializeOrderbook(book: { bids: Map<number, number>; asks: Map<number, number> }, depth: number, ts: number): Orderbook {
  const bids = Array.from(book.bids.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, depth)
    .map(([p, s]) => [p, s] as [number, number]);

  const asks = Array.from(book.asks.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, depth)
    .map(([p, s]) => [p, s] as [number, number]);

  return { ts, depth, bids, asks };
}
