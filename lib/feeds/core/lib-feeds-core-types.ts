export type Exchange = "bybit" | "binance" | "okx";

export type Tf =
  | "1m" | "3m" | "5m" | "15m"
  | "1h" | "4h" | "1D";

export type Side = "buy" | "sell";

export type Candle = {
  ts: number;     // open time (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  confirm: boolean; // true nếu nến đóng (close-confirm)
};

export type Trade = {
  ts: number;
  p: number;
  q: number;
  side: Side;
};

export type Orderbook = {
  ts: number;
  depth: number; // 200
  bids: Array<[number, number]>; // [price, size]
  asks: Array<[number, number]>;
};
