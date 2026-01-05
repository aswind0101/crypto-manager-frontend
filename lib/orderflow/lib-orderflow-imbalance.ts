import { safeDiv, clamp } from "../feeds/features/math";

export function orderbookImbalance(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  depth: number
) {
  const b = bids.slice(0, depth);
  const a = asks.slice(0, depth);

  let sb = 0, sa = 0;
  for (const [, sz] of b) sb += sz;
  for (const [, sz] of a) sa += sz;

  // imbalance in [-1..1]
  const im = safeDiv((sb - sa), (sb + sa), 0);
  return clamp(im, -1, 1);
}
