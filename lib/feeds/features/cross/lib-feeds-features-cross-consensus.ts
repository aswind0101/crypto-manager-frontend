import type { Candle } from "../../core/types";
import { clamp } from "../math";

function returns(c: Candle[], w: number) {
  const xs = c.slice(-w - 1);
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const prev = xs[i - 1].c;
    const cur = xs[i].c;
    if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
  }
  return out;
}

export function consensusScore(args: {
  bybit: Candle[];
  binance: Candle[];
  windowBars?: number; // default 30 (5m*30=150m)
}) {
  const w = args.windowBars ?? 30;
  const rb = returns(args.bybit, w);
  const rn = returns(args.binance, w);
  const n = Math.min(rb.length, rn.length);
  if (n < 10) return undefined;

  let agree = 0;
  for (let i = 0; i < n; i++) {
    const sb = Math.sign(rb[rb.length - n + i]);
    const sn = Math.sign(rn[rn.length - n + i]);
    if (sb === sn) agree += 1;
  }
  return clamp(agree / n, 0, 1);
}
