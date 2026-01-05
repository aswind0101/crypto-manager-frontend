import type { Candle } from "../core/types";
import type { FeaturesSnapshot } from "../features/types";
import type { UnifiedSnapshot } from "../snapshot/unifiedTypes";
import { computePivotLevels, nearestLevels } from "./levels";
import { scoreCommon, gradeFromScore } from "./scoring";
import type { SetupEngineOutput, TradeSetup, SetupSide } from "./types";

function now() { return Date.now(); }
function uid(prefix: string) { return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }

function lastClose(candles?: Candle[]) {
  if (!candles || !candles.length) return undefined;
  return candles[candles.length - 1].c;
}

function atrProxyFromFeatures(f: FeaturesSnapshot) {
  // atrp_15m is in %
  const atrp = f.entry.volatility.atrp_15m;
  return typeof atrp === "number" ? atrp / 100 : 0.007; // fallback 0.7%
}

function makeEntryZone(price: number, atrp: number, side: SetupSide) {
  // Zone width ~ 0.35 * ATR% intraday
  const w = price * atrp * 0.35;
  if (side === "LONG") return { lo: price - w, hi: price + w * 0.15 };
  return { lo: price - w * 0.15, hi: price + w };
}

// Task 3.4b: retest zone around BOS level (wider than simple “testing level” bps band)
function makeRetestZone(level: number, atrp: number, side: SetupSide) {
  // floor in bps to avoid being too tight in low ATR regimes
  const w = Math.max(level * 0.0008, level * atrp * 0.25); // max(8 bps, 0.25*ATR)
  if (side === "LONG") return { lo: level - w, hi: level + w * 0.6 };   // allow slightly above
  return { lo: level - w * 0.6, hi: level + w };                         // allow slightly below
}

function rr(entry: number, stop: number, tp: number, side: SetupSide) {
  const risk = side === "LONG" ? (entry - stop) : (stop - entry);
  const reward = side === "LONG" ? (tp - entry) : (entry - tp);
  if (risk <= 0 || reward <= 0) return 0;
  return reward / risk;
}

function pickBiasSide(f: FeaturesSnapshot): SetupSide | null {
  if (f.bias.trend_dir === "bull") return "LONG";
  if (f.bias.trend_dir === "bear") return "SHORT";
  return null;
}

function capGradeForBiasIncomplete(grade: ReturnType<typeof gradeFromScore>, bias_incomplete: boolean) {
  if (!bias_incomplete) return grade;
  return grade === "A" ? "B" : grade;
}

function getBiasCompleteness(snap: UnifiedSnapshot, f: FeaturesSnapshot) {
  const tf = (f.bias?.tf ?? "4h") as any;
  const tfCandles = (snap.timeframes.find((x: any) => x.tf === tf)?.candles?.ohlcv ?? []) as Candle[];
  // EMA200 requires ~200 candles; use a small buffer for stability.
  const need = 210;
  const complete = tfCandles.length >= need;
  return { tf: String(tf), count: tfCandles.length, need, complete };
}

export function buildSetups(args: {
  snap: UnifiedSnapshot;
  features: FeaturesSnapshot;
}): SetupEngineOutput {
  const { snap, features: f } = args;
  const ts = now();

  const dq_ok = f.quality.dq_grade === "A" || f.quality.dq_grade === "B";
  if (!dq_ok) return { ts, dq_ok: false, setups: [], preferred_id: undefined };

  // Bybit execution candles
  const tf15 = (snap.timeframes.find((x: any) => x.tf === "15m")?.candles?.ohlcv ?? []) as Candle[];
  const tf1h = (snap.timeframes.find((x: any) => x.tf === "1h")?.candles?.ohlcv ?? []) as Candle[];
  const px = lastClose(tf15) ?? lastClose(tf1h) ?? 0;
  if (!px) return { ts, dq_ok: true, setups: [], preferred_id: undefined };

  // Levels
  const lv15 = computePivotLevels(tf15, 2, 10);
  const lv1h = computePivotLevels(tf1h, 2, 10);
  const levels = [...lv15, ...lv1h].sort((a, b) => a.price - b.price);

  const { below, above } = nearestLevels(levels, px);
  const atrp = atrProxyFromFeatures(f);
  const common = scoreCommon(f);

  const setups: TradeSetup[] = [];
  const biasMeta = getBiasCompleteness(snap, f);
  const bias_incomplete = !biasMeta.complete;
  const biasSide = pickBiasSide(f);

  // 1) TREND_PULLBACK (ưu tiên) — B+ policy: only when HTF bias is complete
  if (biasSide && !bias_incomplete) {
    const ref = biasSide === "LONG" ? (below?.price ?? px) : (above?.price ?? px);
    const zone = makeEntryZone(ref, atrp, biasSide);

    const slBuffer = px * atrp * 0.5;
    const sl = biasSide === "LONG"
      ? Math.min(zone.lo - slBuffer, (below?.price ?? zone.lo) - slBuffer)
      : Math.max(zone.hi + slBuffer, (above?.price ?? zone.hi) + slBuffer);

    const tp1 = biasSide === "LONG"
      ? (above?.price ?? (px + px * atrp * 1.2))
      : (below?.price ?? (px - px * atrp * 1.2));

    const entryMid = (zone.lo + zone.hi) / 2;
    const rr1 = rr(entryMid, sl, tp1, biasSide);

    const checklist = [
      { key: "bias", ok: true, note: `Bias ${f.bias.trend_dir} (${f.bias.tf})` },
      {
        key: "orderflow",
        ok: biasSide === "LONG" ? (f.orderflow.imbalance.top200 > -0.35) : (f.orderflow.imbalance.top200 < 0.35),
        note: `Imb200=${f.orderflow.imbalance.top200.toFixed(2)}`,
      },
      {
        key: "cross",
        ok: typeof f.cross.consensus_score !== "number" ? true : f.cross.consensus_score >= 0.5,
        note: f.cross.consensus_score != null ? `cons=${f.cross.consensus_score.toFixed(2)}` : "n/a",
      },
    ];

    const ready = rr1 >= 1.5 && common.grade !== "D";
    const confScore = Math.min(100, common.score + (rr1 >= 2 ? 6 : 0) + 4);

    setups.push({
      id: uid("tpb"),
      canon: snap.canon,
      type: "TREND_PULLBACK",
      side: biasSide,
      entry_tf: "5m",
      bias_tf: f.bias.tf,

      status: ready ? "READY" : "FORMING",
      created_ts: ts,
      expires_ts: ts + 1000 * 60 * 90,

      entry: {
        mode: "LIMIT",
        zone,
        trigger: {
          confirmed: false, // Task 3.3
          checklist,
          summary: "Trend pullback: wait for entry zone touch + close-confirm reclaim",
        },
      },

      stop: { price: sl, basis: "STRUCTURE", note: "Below/above zone + buffer" },

      tp: [
        { price: tp1, size_pct: 70, basis: "LEVEL", note: "Nearest pivot target" },
        { price: biasSide === "LONG" ? (tp1 + px * atrp * 0.8) : (tp1 - px * atrp * 0.8), size_pct: 30, basis: "R_MULTIPLE", note: "Extension" },
      ],

      rr_min: rr1,
      rr_est: rr1 * 1.2,

      confidence: {
        score: confScore,
        grade: gradeFromScore(confScore),
        reasons: [...common.reasons, "Trend pullback in bias direction"],
      },

      tags: ["intraday", "pullback", f.bias.trend_dir],
    });
  }

  /**
   * 2) BREAKOUT + RETEST (Task 3.4b)
   * - Uses market structure: 15m lastBOS level
   * - Entry is a RETEST zone around BOS level
   * - Trigger remains close-confirm (handled in hook) and requires “touched retest zone + close beyond level”
   *
   * B+ policy:
   * - Allowed even when HTF EMA200 incomplete, but stricter RR + capped grade (A->B).
   */
  let createdStructureBreakout = false;
  const ms15 = (f as any).market_structure?.["15m"];
  const bos = ms15?.lastBOS;

  // Freshness window for BOS (in ms): 6 * 15m = 90m
  const BOS_FRESH_MS = 90 * 60 * 1000;

  if (bos && typeof bos.level === "number" && typeof bos.ts === "number" && (ts - bos.ts) <= BOS_FRESH_MS) {
    const dir: SetupSide = bos.dir === "UP" ? "LONG" : "SHORT";
    const level = bos.level;

    const zone = makeRetestZone(level, atrp, dir);

    // Stop: prefer swing opposite if available; otherwise below/above level with ATR buffer
    const buffer = level * Math.max(atrp * 0.9, 0.0012); // at least 12 bps, scaled by ATR
    let sl = dir === "LONG" ? (level - buffer) : (level + buffer);

    const swingH = ms15?.lastSwingHigh?.price;
    const swingL = ms15?.lastSwingLow?.price;

    if (dir === "LONG" && typeof swingL === "number" && swingL < level) {
      sl = Math.min(sl, swingL - buffer * 0.35);
    }
    if (dir === "SHORT" && typeof swingH === "number" && swingH > level) {
      sl = Math.max(sl, swingH + buffer * 0.35);
    }

    // TP: nearest pivot in breakout direction; fallback to ATR projection
    const tp1 =
      dir === "LONG"
        ? (above?.price ?? (level + level * atrp * 2.0))
        : (below?.price ?? (level - level * atrp * 2.0));

    const entryMid = (zone.lo + zone.hi) / 2;
    const rr1 = rr(entryMid, sl, tp1, dir);

    let confScore = Math.min(100, common.score + 7); // BOS event adds confidence slightly
    if (bias_incomplete) {
      confScore = Math.floor(confScore * 0.70);
      confScore = Math.min(confScore, 84);
    }

    const rrNeed = bias_incomplete ? 1.8 : 1.5;
    const ready = rr1 >= rrNeed && common.grade !== "D";

    setups.push({
      id: uid("brt"),
      canon: snap.canon,
      type: "BREAKOUT",
      side: dir,
      entry_tf: "5m",
      bias_tf: f.bias.tf,

      status: ready ? "READY" : "FORMING",
      created_ts: ts,
      expires_ts: ts + 1000 * 60 * 60,

      entry: {
        mode: "LIMIT",
        zone,
        trigger: {
          confirmed: false, // Task 3.3 (in hook)
          checklist: [
            {
              key: "bias",
              ok: !bias_incomplete,
              note: bias_incomplete
                ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                : `Bias ${f.bias.trend_dir} (${f.bias.tf})`,
            },
            { key: "bos", ok: true, note: `BOS ${bos.dir} @ ${level.toFixed(2)} (15m)` },
            // Keep a “level” item with "@ <number>" so existing parsing logic works without assumptions
            { key: "level", ok: true, note: `Break ${dir === "LONG" ? "R" : "S"} @ ${level.toFixed(2)}` },
            { key: "retest", ok: false, note: `Wait retest zone [${zone.lo.toFixed(2)}–${zone.hi.toFixed(2)}]` },
          ],
          summary: "Breakout+Retest: wait for price to retest BOS level, then 5m close-confirm beyond level",
        },
      },

      stop: { price: sl, basis: "STRUCTURE", note: "Below/above BOS level (prefer swing) + buffer" },

      tp: [
        { price: tp1, size_pct: 60, basis: "LEVEL", note: "Nearest pivot target" },
        { price: dir === "LONG" ? (tp1 + level * atrp * 1.0) : (tp1 - level * atrp * 1.0), size_pct: 40, basis: "R_MULTIPLE", note: "Continuation" },
      ],

      rr_min: rr1,
      rr_est: rr1 * 1.20,

      confidence: {
        score: confScore,
        grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
        reasons: [
          ...common.reasons,
          "BOS detected (15m)",
          "Retest-based breakout plan",
          ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : []),
        ],
      },

      tags: ["intraday", "breakout", "bos", "retest"],
    });

    createdStructureBreakout = true;
  }

  /**
   * 2b) BREAKOUT (legacy: squeeze → expansion)
   * - Keep as fallback when structure BOS is not available/fresh.
   */
  if (!createdStructureBreakout) {
    // Need squeeze: BB width very low
    const width = f.entry.volatility.bbWidth_15m;
    const squeeze = typeof width === "number" ? width < 0.02 : false;

    if (squeeze && below && above) {
      // pick direction: bias if present else mean cross
      let dir: SetupSide = "LONG";
      if (biasSide) dir = biasSide;
      else dir = (f.cross.dev_bps != null && f.cross.dev_bps > 0) ? "SHORT" : "LONG";

      const brk = dir === "LONG" ? above.price : below.price;
      const zone = makeEntryZone(brk, atrp, dir);

      const sl = dir === "LONG"
        ? (brk - px * atrp * 1.1)
        : (brk + px * atrp * 1.1);

      const tp1 = dir === "LONG"
        ? (brk + px * atrp * 1.8)
        : (brk - px * atrp * 1.8);

      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tp1, dir);

      let confScore = Math.min(100, common.score + 3);
      if (bias_incomplete) {
        confScore = Math.floor(confScore * 0.70);
        confScore = Math.min(confScore, 84);
      }

      const ready = rr1 >= (bias_incomplete ? 1.8 : 1.5) && common.grade !== "D";

      setups.push({
        id: uid("brk"),
        canon: snap.canon,
        type: "BREAKOUT",
        side: dir,
        entry_tf: "5m",
        bias_tf: f.bias.tf,

        status: ready ? "READY" : "FORMING",
        created_ts: ts,
        expires_ts: ts + 1000 * 60 * 60,

        entry: {
          mode: "MARKET",
          zone,
          trigger: {
            confirmed: false, // Task 3.3
            checklist: [
              {
                key: "bias",
                ok: !bias_incomplete,
                note: bias_incomplete
                  ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                  : `Bias ${f.bias.trend_dir} (${f.bias.tf})`,
              },
              { key: "squeeze", ok: true, note: `BBWidth15m=${width!.toFixed(4)}` },
              { key: "level", ok: true, note: `Break ${dir === "LONG" ? "R" : "S"} @ ${brk.toFixed(2)}` },
            ],
            summary: "Breakout: wait for 5m close beyond level + follow-through",
          },
        },

        stop: { price: sl, basis: "ATR", note: "Breakout ATR stop" },

        tp: [
          { price: tp1, size_pct: 60, basis: "R_MULTIPLE", note: "Expansion target" },
          { price: dir === "LONG" ? (tp1 + px * atrp * 1.0) : (tp1 - px * atrp * 1.0), size_pct: 40, basis: "R_MULTIPLE", note: "Continuation" },
        ],

        rr_min: rr1,
        rr_est: rr1 * 1.25,

        confidence: {
          score: confScore,
          grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
          reasons: [...common.reasons, "Breakout from squeeze", ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : [])],
        },

        tags: ["intraday", "breakout", "squeeze"],
      });
    }
  }

  // 3) RANGE_MEAN_REVERT (bias sideways) — B+ policy: allowed even when HTF bias incomplete (with stricter RR)
  if (f.bias.trend_dir === "sideways" && below && above) {
    const nearSupport = Math.abs(px - below.price) / px < 0.002;
    const nearRes = Math.abs(px - above.price) / px < 0.002;

    if (nearSupport || nearRes) {
      const dir: SetupSide = nearSupport ? "LONG" : "SHORT";
      const ref = nearSupport ? below.price : above.price;

      const zone = makeEntryZone(ref, atrp, dir);
      const sl = dir === "LONG" ? (ref - px * atrp * 0.9) : (ref + px * atrp * 0.9);

      const midRange = (below.price + above.price) / 2;
      const tp1 = midRange;

      const entryMid = (zone.lo + zone.hi) / 2;
      const rr1 = rr(entryMid, sl, tp1, dir);

      let confScore = Math.min(100, common.score + 2);

      if (bias_incomplete) {
        confScore = Math.floor(confScore * 0.65);
        confScore = Math.min(confScore, 82);
      }

      setups.push({
        id: uid("mr"),
        canon: snap.canon,
        type: "RANGE_MEAN_REVERT",
        side: dir,
        entry_tf: "15m",
        bias_tf: f.bias.tf,

        status: rr1 >= (bias_incomplete ? 1.6 : 1.3) ? "READY" : "FORMING",
        created_ts: ts,
        expires_ts: ts + 1000 * 60 * 120,

        entry: {
          mode: "LIMIT",
          zone,
          trigger: {
            confirmed: false, // Task 3.3
            checklist: [
              {
                key: "bias",
                ok: !bias_incomplete,
                note: bias_incomplete
                  ? `HTF bias incomplete (${biasMeta.tf} ${biasMeta.count}/${biasMeta.need})`
                  : "Bias sideways",
              },
              { key: "range", ok: true, note: "Bias sideways" },
              { key: "edge", ok: true, note: nearSupport ? "Near support" : "Near resistance" },
            ],
            summary: "Range MR: fade edges, target mid-range",
          },
        },

        stop: { price: sl, basis: "STRUCTURE", note: "Beyond edge + ATR buffer" },

        tp: [
          { price: tp1, size_pct: 70, basis: "LEVEL", note: "Mid-range" },
          { price: dir === "LONG" ? above.price : below.price, size_pct: 30, basis: "LEVEL", note: "Opposite edge (optional)" },
        ],

        rr_min: rr1,
        rr_est: rr1 * 1.15,

        confidence: {
          score: confScore,
          grade: capGradeForBiasIncomplete(gradeFromScore(confScore), bias_incomplete),
          reasons: [...common.reasons, "Mean reversion in range", ...(bias_incomplete ? [`HTF bias incomplete (${biasMeta.tf})`] : [])],
        },

        tags: ["intraday", "range", nearSupport ? "support" : "resistance"],
      });
    }
  }

  // Preferred: READY + confidence cao nhất
  const candidates = setups
    .filter((s) => s.status === "READY" && s.confidence.grade !== "D")
    .sort((a, b) => b.confidence.score - a.confidence.score);

  return {
    ts,
    dq_ok: true,
    preferred_id: candidates[0]?.id,
    setups: setups.sort((a, b) => {
      const pa = a.status === "READY" ? 0 : 1;
      const pb = b.status === "READY" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.confidence.score - a.confidence.score;
    }),
  };
}
