import type { Candle } from "../../core/types";
import { mean, stdev, safeDiv } from "../math";

export function deviationZ(args: {
  bybit: Candle[];
  binance: Candle[];
  windowBars?: number; // default 120
}) {
  const w = args.windowBars ?? 120;
  const a = args.bybit.slice(-w);
  const b = args.binance.slice(-w);
  const n = Math.min(a.length, b.length);
  if (n < 30) return undefined;

  const dev: number[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = a[a.length - n + i].c;
    const p2 = b[b.length - n + i].c;
    const mid = (p1 + p2) / 2;
    if (mid !== 0) dev.push(((p1 - p2) / mid) * 10000);
  }

  if (dev.length < 30) return undefined;

  const m = mean(dev);
  const sd = stdev(dev);
  const last = dev[dev.length - 1];
  return safeDiv((last - m), sd, 0);
}
