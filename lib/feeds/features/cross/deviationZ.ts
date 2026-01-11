import type { Candle } from "../../core/types";
import { mean, stdev, safeDiv } from "../math";

/**
 * Compute deviation z-score between Bybit and Binance prices, but align by timestamp (candle open time).
 * This prevents false z-spikes when one venue has missing/extra candles or slightly different update cadence.
 */
export function deviationZ(args: {
  bybit: Candle[];
  binance: Candle[];
  windowBars?: number; // default 120
}) {
  const w = args.windowBars ?? 120;

  if (!Array.isArray(args.bybit) || !Array.isArray(args.binance)) return undefined;
  if (args.bybit.length < 30 || args.binance.length < 30) return undefined;

  // Conservative: drop the last candle if it is unconfirmed to avoid intrabar mismatch
  const by = stripUnconfirmed(args.bybit).slice(-w * 2);     // take a wider tail to find matches
  const bn = stripUnconfirmed(args.binance).slice(-w * 2);

  // Build binance map by ts for fast alignment
  const bnMap = new Map<number, number>(); // ts -> close
  for (const c of bn) {
    if (Number.isFinite(c.ts) && Number.isFinite(c.c)) bnMap.set(c.ts, c.c);
  }

  // Collect aligned deviations using the last w matched bars
  const dev: number[] = [];
  for (let i = by.length - 1; i >= 0 && dev.length < w; i--) {
    const c1 = by[i];
    const c2 = bnMap.get(c1.ts);
    if (!Number.isFinite(c1.c) || !Number.isFinite(c2 as number)) continue;

    const p1 = c1.c;
    const p2 = c2 as number;
    const mid = (p1 + p2) / 2;
    if (mid !== 0) dev.push(((p1 - p2) / mid) * 10000);
  }

  // We iterated backwards; restore chronological order
  dev.reverse();

  if (dev.length < 30) return undefined;

  const m = mean(dev);
  const sd = stdev(dev);
  const last = dev[dev.length - 1];

  return safeDiv(last - m, sd, 0);
}

function stripUnconfirmed(candles: Candle[]) {
  if (!candles.length) return candles;
  const last = candles[candles.length - 1];
  if (last && last.confirm === false) return candles.slice(0, -1);
  return candles;
}
