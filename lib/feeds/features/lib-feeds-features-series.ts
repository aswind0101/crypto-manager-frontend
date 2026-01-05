import type { Candle } from "../core/types";

export function closes(candles: Candle[]) {
  return candles.map(c => c.c);
}

export function highs(candles: Candle[]) {
  return candles.map(c => c.h);
}

export function lows(candles: Candle[]) {
  return candles.map(c => c.l);
}

export function volumes(candles: Candle[]) {
  return candles.map(c => c.v);
}

export function last<T>(xs: T[]) {
  return xs.length ? xs[xs.length - 1] : undefined;
}
