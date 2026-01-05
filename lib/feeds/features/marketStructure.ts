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
    return { dir: "UP", tf, ts: candle.ts, level: lastHigh.price, high: candle.h, low: candle.l, close: candle.c };
  }
  // Sweep DOWN: wick < swingLow, close back above
  if (lastLow && candle.l < lastLow.price && candle.c > lastLow.price) {
    return { dir: "DOWN", tf, ts: candle.ts, level: lastLow.price, high: candle.h, low: candle.l, close: candle.c };
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

  let bosUp = false, bosDown = false, chochUp = false, chochDown = false, sweepUp = false, sweepDown = false;

  if (last && (lastSwingHigh || lastSwingLow)) {
    lastSweep = detectSweep(tf, last, lastSwingHigh, lastSwingLow);
    if (lastSweep?.dir === "UP") sweepUp = true;
    if (lastSweep?.dir === "DOWN") sweepDown = true;

    const brokeUp = Boolean(lastSwingHigh && last.c > lastSwingHigh.price);
    const brokeDown = Boolean(lastSwingLow && last.c < lastSwingLow.price);

    if (brokeUp) {
      if (trend === "BEAR") {
        lastCHOCH = mkStructureEvent("CHOCH", "UP", tf, lastSwingHigh!.price, last);
        chochUp = true;
        trend = "BULL";
      } else {
        lastBOS = mkStructureEvent("BOS", "UP", tf, lastSwingHigh!.price, last);
        bosUp = true;
        trend = "BULL";
      }
    } else if (brokeDown) {
      if (trend === "BULL") {
        lastCHOCH = mkStructureEvent("CHOCH", "DOWN", tf, lastSwingLow!.price, last);
        chochDown = true;
        trend = "BEAR";
      } else {
        lastBOS = mkStructureEvent("BOS", "DOWN", tf, lastSwingLow!.price, last);
        bosDown = true;
        trend = "BEAR";
      }
    } else {
      if (trend === "UNKNOWN") trend = "RANGE";
    }
  }

  return {
    tf,
    trend,
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
