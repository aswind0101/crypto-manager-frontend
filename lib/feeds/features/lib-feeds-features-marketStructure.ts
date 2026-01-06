import type { Candle } from "../core/types";
import type {
  MarketStructureSnapshot,
  MarketStructureTF,
  MarketTrend,
  SwingPoint,
  StructureEvent,
  SweepEvent,
} from "../features/types";

function confirmedOnly(candles: Candle[]) {
  return candles.filter((c: any) => Boolean((c as any).confirm));
}

function cap<T>(xs: T[], n: number) {
  if (xs.length <= n) return xs;
  return xs.slice(xs.length - n);
}

function detectSwings(confirmed: Candle[], window: number): SwingPoint[] {
  const out: SwingPoint[] = [];
  const n = confirmed.length;
  if (n < window * 2 + 1) return out;

  for (let i = window; i < n - window; i++) {
    const c = confirmed[i];
    const hi = c.h;
    const lo = c.l;

    let isHigh = true;
    let isLow = true;

    for (let k = i - window; k <= i + window; k++) {
      if (k === i) continue;
      if (confirmed[k].h >= hi) isHigh = false;
      if (confirmed[k].l <= lo) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) out.push({ type: "HIGH", ts: c.ts, price: hi, strength: window });
    else if (isLow) out.push({ type: "LOW", ts: c.ts, price: lo, strength: window });
  }

  return out;
}

function lastOfType(swings: SwingPoint[], type: "HIGH" | "LOW") {
  for (let i = swings.length - 1; i >= 0; i--) if (swings[i].type === type) return swings[i];
  return undefined;
}

function mkStructureEvent(
  kind: "BOS" | "CHOCH",
  dir: "UP" | "DOWN",
  tf: string,
  level: number,
  candle: Candle
): StructureEvent {
  return { kind, dir, tf, ts: candle.ts, level, close: candle.c };
}

function detectSweep(
  tf: string,
  candle: Candle,
  lastHigh?: SwingPoint,
  lastLow?: SwingPoint
): SweepEvent | undefined {
  // Sweep UP: wick > swingHigh, close back below
  if (lastHigh && candle.h > lastHigh.price && candle.c < lastHigh.price) {
    return {
      dir: "UP",
      tf,
      ts: candle.ts,
      level: lastHigh.price,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    };
  }
  // Sweep DOWN: wick < swingLow, close back above
  if (lastLow && candle.l < lastLow.price && candle.c > lastLow.price) {
    return {
      dir: "DOWN",
      tf,
      ts: candle.ts,
      level: lastLow.price,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    };
  }
  return undefined;
}

function defaultTrend(lastHigh?: SwingPoint, lastLow?: SwingPoint): MarketTrend {
  if (!lastHigh || !lastLow) return "UNKNOWN";
  return "RANGE";
}

export function computeMarketStructureTF(args: {
  tf: string;
  candles?: Candle[];
  pivotWindow?: number; // default 2
  swingsCap?: number;   // default 20
  prevTrend?: MarketTrend;
}): MarketStructureTF {
  const tf = args.tf;
  const pivotWindow = args.pivotWindow ?? 2;
  const swingsCap = args.swingsCap ?? 20;

  const raw = Array.isArray(args.candles) ? args.candles : [];
  const conf = confirmedOnly(raw);
  const last = conf[conf.length - 1];

  const swingsAll = detectSwings(conf, pivotWindow);
  const swings = cap(swingsAll, swingsCap);

  const lastSwingHigh = lastOfType(swings, "HIGH");
  const lastSwingLow = lastOfType(swings, "LOW");

  let trend: MarketTrend = args.prevTrend ?? defaultTrend(lastSwingHigh, lastSwingLow);

  let lastBOS: StructureEvent | undefined;
  let lastCHOCH: StructureEvent | undefined;
  let lastSweep: SweepEvent | undefined;

  let bosUp = false,
    bosDown = false,
    chochUp = false,
    chochDown = false,
    sweepUp = false,
    sweepDown = false;

  // Detect BOS/CHOCH as "most recent confirmed event" (not only on last candle).
  // We scan confirmed candles left-to-right, using swing points as structural levels.
  if (conf.length && swingsAll.length) {
    // Build swing lookup by timestamp (ts should match candle.ts)
    const swingsByTs = new Map<number, SwingPoint[]>();
    for (const sp of swingsAll) {
      const arr = swingsByTs.get(sp.ts);
      if (arr) arr.push(sp);
      else swingsByTs.set(sp.ts, [sp]);
    }

    let curHigh: SwingPoint | undefined = undefined;
    let curLow: SwingPoint | undefined = undefined;

    // flags specifically for the LAST confirmed candle (for UI signals)
    bosUp = false;
    bosDown = false;
    chochUp = false;
    chochDown = false;

    // Walk all confirmed candles to find latest BOS/CHOCH
    for (let i = 0; i < conf.length; i++) {
      const c = conf[i];
      const isLast = i === conf.length - 1;

      // Update current swing levels if this candle forms a swing
      const sps = swingsByTs.get(c.ts);
      if (sps?.length) {
        for (const sp of sps) {
          if (sp.type === "HIGH") curHigh = sp;
          else if (sp.type === "LOW") curLow = sp;
        }
      }

      const brokeUp = Boolean(curHigh && c.c > curHigh.price);
      const brokeDown = Boolean(curLow && c.c < curLow.price);

      if (brokeUp) {
        if (trend === "BEAR") {
          lastCHOCH = mkStructureEvent("CHOCH", "UP", tf, curHigh!.price, c);
          if (isLast) chochUp = true;
          trend = "BULL";
        } else {
          lastBOS = mkStructureEvent("BOS", "UP", tf, curHigh!.price, c);
          if (isLast) bosUp = true;
          trend = "BULL";
        }

        // prevent repeated triggers while price stays above the same level
        curHigh = undefined;
      } else if (brokeDown) {
        if (trend === "BULL") {
          lastCHOCH = mkStructureEvent("CHOCH", "DOWN", tf, curLow!.price, c);
          if (isLast) chochDown = true;
          trend = "BEAR";
        } else {
          lastBOS = mkStructureEvent("BOS", "DOWN", tf, curLow!.price, c);
          if (isLast) bosDown = true;
          trend = "BEAR";
        }

        // prevent repeated triggers while price stays below the same level
        curLow = undefined;
      } else {
        if (trend === "UNKNOWN") trend = "RANGE";
      }
    }
  }

  // Sweeps are still evaluated on the last confirmed candle against the last swings (as before).
  if (last && (lastSwingHigh || lastSwingLow)) {
    lastSweep = detectSweep(tf, last, lastSwingHigh, lastSwingLow);
    if (lastSweep?.dir === "UP") sweepUp = true;
    if (lastSweep?.dir === "DOWN") sweepDown = true;
  }

  return {
    tf,
    trend,

    // ✅ thêm để UI biết chắc có bao nhiêu candle confirm
    confirmed_count: conf.length,

    lastSwingHigh,
    lastSwingLow,
    recentSwings: swings,
    lastBOS,
    lastCHOCH,
    lastSweep,
    bosUp,
    bosDown,
    chochUp,
    chochDown,
    sweepUp,
    sweepDown,
  };
}

export function computeMarketStructureSnapshot(args: {
  tfs: string[];
  candlesByTf: Record<string, Candle[] | undefined>;
  pivotWindow?: number;
  swingsCap?: number;
}): MarketStructureSnapshot {
  const out: MarketStructureSnapshot = {};
  for (const tf of args.tfs) {
    out[tf] = computeMarketStructureTF({
      tf,
      candles: args.candlesByTf[tf],
      pivotWindow: args.pivotWindow,
      swingsCap: args.swingsCap,
    });
  }
  return out;
}
