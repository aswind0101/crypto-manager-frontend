import type { Candle } from "../core/types";
import type { FeatureEngineInput, FeaturesSnapshot, TrendDir, VolRegime, BiasTfSnapshot } from "./types";

import { closes, highs, lows, last } from "./series";
import { clamp, safeDiv } from "./math";

import { ema } from "../../indicators/ema";
import { rsi } from "../../indicators/rsi";
import { atr } from "../../indicators/atr";
import { macd } from "../../indicators/macd";
import { bbands } from "../../indicators/bbands";
import { adx } from "../../indicators/adx";

import { orderbookImbalance } from "../../orderflow/imbalance";
import { aggressionRatio } from "../../orderflow/aggression";

import { deviationZ } from "./cross/deviationZ";
import { consensusScore } from "./cross/consensus";
import { computeMarketStructureSnapshot } from "./marketStructure";


function pickCandles(input: FeatureEngineInput, tf: any): Candle[] | undefined {
  const slot = input.candles?.[tf];
  // Bybit ưu tiên làm chính
  return (slot?.bybit as Candle[]) || undefined;
}

function pickBinanceCandles(input: FeatureEngineInput, tf: any): Candle[] | undefined {
  const slot = input.candles?.[tf];
  return (slot?.binance as Candle[]) || undefined;
}

function trendFromEmaAdx(args: { candles: Candle[]; adx14?: number }) {
  const c = args.candles;
  const cls = closes(c);
  const e200 = ema(cls, 200);
  const lastClose = cls[cls.length - 1];
  const lastE = e200[e200.length - 1];
  const slope = e200.length >= 6 ? (e200[e200.length - 1] - e200[e200.length - 6]) : 0;
  const slopeBps = lastE ? (slope / lastE) * 10000 : 0;

  const adxVal = args.adx14 ?? 0;
  const trending = adxVal >= 18; // intraday bias threshold

  let dir: TrendDir = "sideways";
  if (trending) {
    if (lastClose > lastE && slope > 0) dir = "bull";
    else if (lastClose < lastE && slope < 0) dir = "bear";
    else dir = "sideways";
  } else {
    dir = "sideways";
  }

  // strength: combine distance to EMA + ADX
  const dist = safeDiv(Math.abs(lastClose - lastE), lastClose, 0);
  const s = clamp((adxVal / 40) * 0.7 + clamp(dist * 50, 0, 1) * 0.3, 0, 1);

  return { dir, strength: s, ema200: lastE, ema200_slope_bps: slopeBps };

}

function volRegimeFromAtr(candles: Candle[]) {
  const cls = closes(candles);
  const hi = highs(candles);
  const lo = lows(candles);
  const a = atr(hi, lo, cls, 14);
  const lastAtr = last(a);
  const lastClose = cls[cls.length - 1];
  const atrp = lastAtr && lastClose ? (lastAtr / lastClose) : 0;

  // thresholds: tune later per coin class
  let reg: VolRegime = "normal";
  if (atrp < 0.004) reg = "low";
  else if (atrp > 0.010) reg = "high";

  return { reg, atrp };
}
function computeBiasForTf(tf: "15m" | "1h" | "4h" | "1d", candles?: Candle[]): BiasTfSnapshot {
  const have = candles?.length ?? 0;
  const need = 210;
  const complete = have >= need;

  // thiếu data => pending (đúng yêu cầu UI)
  if (!candles || !complete) {
    return { tf, complete: false, have, need };
  }

  // ADX (nếu đủ bars)
  let adxVal: number | undefined = undefined;
  if (candles.length >= 60) {
    const cls = closes(candles);
    const hi = highs(candles);
    const lo = lows(candles);
    const a = adx(hi, lo, cls, 14);
    adxVal = last(a.adx);
  }

  // Trend (EMA200 + ADX) – dùng đúng helper hiện tại
  let trend_dir: TrendDir = "sideways";
  let trend_strength = 0;
  let ema200: number | undefined = undefined;
  let ema200_slope_bps: number | undefined = undefined;


  if (candles.length >= 220) {
    const t = trendFromEmaAdx({ candles, adx14: adxVal });
    trend_dir = t.dir;
    trend_strength = t.strength;
    ema200 = t.ema200;
    ema200_slope_bps = t.ema200_slope_bps;

  } else {
    // vẫn complete theo gate 210, nhưng không đủ 220 cho EMA200 slope => giữ sideways/0
    // không set partial/notes vì bias_by_tf chỉ phục vụ UI.
  }

  // Vol regime – dùng đúng helper hiện tại (ATR%)
  const vr = volRegimeFromAtr(candles);

  return {
    tf,
    trend_dir,
    trend_strength,
    vol_regime: vr.reg,
    adx14: adxVal,
    ema200,
    ema200_slope_bps, // NEW
    complete: true,
    have,
    need,
  };
}

export function computeFeatures(input: FeatureEngineInput): FeaturesSnapshot {
  const notes: string[] = [];
  let partial = false;

  const c5 = pickCandles(input, "5m");
  const c15 = pickCandles(input, "15m");
  const c1h = pickCandles(input, "1h");
  const c4h = pickCandles(input, "4h");
  const c1d = pickCandles(input, "1d");

  const b5 = pickBinanceCandles(input, "5m");
  const b15 = pickBinanceCandles(input, "15m");

  if (!c5 || !c15 || !c1h || !c4h) {
    partial = true;
    notes.push("Missing required candles (need 5m/15m/1h/4h Bybit)");
  }

  // --- Bias TF selection: ưu tiên 1h để intraday, 4h confirm
  const biasCandles = c1h && c1h.length >= 250 ? c1h : c4h;
  const biasTf = (biasCandles === c1h ? "1h" : "4h") as "1h" | "4h";

  // ADX on bias tf
  let adxVal: number | undefined = undefined;
  if (biasCandles && biasCandles.length >= 60) {
    const cls = closes(biasCandles);
    const hi = highs(biasCandles);
    const lo = lows(biasCandles);
    const a = adx(hi, lo, cls, 14);
    adxVal = last(a.adx);
  }

  // Trend
  let trend_dir: TrendDir = "sideways";
  let trend_strength = 0;
  let ema200: number | undefined = undefined;
  let ema200_slope_bps: number | undefined = undefined;

  if (biasCandles && biasCandles.length >= 220) {
    const t = trendFromEmaAdx({ candles: biasCandles, adx14: adxVal });
    trend_dir = t.dir;
    trend_strength = t.strength;
    ema200 = t.ema200;
    ema200_slope_bps = t.ema200_slope_bps;

  } else {
    partial = true;
    notes.push("Not enough candles for EMA200 bias computation");
  }

  // Vol regime (15m)
  let vol_regime: VolRegime = "normal";
  let atrp_15m: number | undefined = undefined;
  let atrp_1h: number | undefined = undefined;
  let atrp_4h: number | undefined = undefined;

  if (c15 && c15.length >= 50) {
    const vr = volRegimeFromAtr(c15);
    vol_regime = vr.reg;
    atrp_15m = vr.atrp * 100; // %
  }
  if (c1h && c1h.length >= 50) {
    const vr = volRegimeFromAtr(c1h);
    atrp_1h = vr.atrp * 100; // %
  }

  if (c4h && c4h.length >= 50) {
    const vr = volRegimeFromAtr(c4h);
    atrp_4h = vr.atrp * 100; // %
  }

  // Momentum (RSI + MACD hist) for 5m/15m
  const rsi14_5m = c5 && c5.length >= 20 ? last(rsi(closes(c5), 14)) : undefined;
  const rsi14_15m = c15 && c15.length >= 20 ? last(rsi(closes(c15), 14)) : undefined;

  const macdHist_5m = c5 && c5.length >= 40 ? last(macd(closes(c5)).hist) : undefined;
  const macdHist_15m = c15 && c15.length >= 40 ? last(macd(closes(c15)).hist) : undefined;

  // BB width 15m
  let bbWidth_15m: number | undefined = undefined;
  let bbWidth_1h: number | undefined = undefined;
  let bbWidth_4h: number | undefined = undefined;

  if (c15 && c15.length >= 40) {
    const bb = bbands(closes(c15), 20, 2);
    const w = last(bb.width);
    bbWidth_15m = typeof w === "number" && !Number.isNaN(w) ? w : undefined;
  }
  if (c1h && c1h.length >= 40) {
    const bb = bbands(closes(c1h), 20, 2);
    const w = last(bb.width);
    bbWidth_1h = typeof w === "number" && !Number.isNaN(w) ? w : undefined;
  }

  if (c4h && c4h.length >= 40) {
    const bb = bbands(closes(c4h), 20, 2);
    const w = last(bb.width);
    bbWidth_4h = typeof w === "number" && !Number.isNaN(w) ? w : undefined;
  }

  // Orderflow: imbalance buckets + aggression ratio
  let im10 = 0, im50 = 0, im200 = 0;
  if (input.orderbook?.bids && input.orderbook?.asks) {
    im10 = orderbookImbalance(input.orderbook.bids, input.orderbook.asks, 10);
    im50 = orderbookImbalance(input.orderbook.bids, input.orderbook.asks, 50);
    im200 = orderbookImbalance(input.orderbook.bids, input.orderbook.asks, 200);
  } else {
    partial = true;
    notes.push("Orderbook missing (1m orderflow degraded)");
  }

  const agg = input.trades1m && input.trades1m.length ? aggressionRatio(input.trades1m) : 0.5;
  // Trade-delta signals (from trades1m window)
  let deltaBlock: FeaturesSnapshot["orderflow"]["delta"] | undefined = undefined;

  if (input.trades1m && input.trades1m.length) {
    let buy = 0;
    let sell = 0;

    let minP = Infinity;
    let maxP = -Infinity;

    for (const t of input.trades1m) {
      if (t.side === "buy") buy += t.q;
      else sell += t.q;

      if (t.p < minP) minP = t.p;
      if (t.p > maxP) maxP = t.p;
    }

    const total = buy + sell;
    const deltaQty = buy - sell;
    const deltaNorm = total > 0 ? Math.max(-1, Math.min(1, deltaQty / total)) : 0;

    // Price movement proxy over the same “recent” context:
    // use 5m candles if available else 15m; this is not future leak (only historical candles).
    const pxNow = (c5 && c5.length ? c5[c5.length - 1].c : undefined) ??
      (c15 && c15.length ? c15[c15.length - 1].c : undefined);

    const pxPrev = (c5 && c5.length >= 7 ? c5[c5.length - 7].c : undefined) ??
      (c15 && c15.length >= 7 ? c15[c15.length - 7].c : undefined);

    const pxChg = (pxNow != null && pxPrev != null && pxPrev !== 0) ? (pxNow - pxPrev) / pxPrev : 0;

    // Divergence: price up but delta negative => bearish divergence; price down but delta positive => bullish divergence.
    const opp =
      (pxChg > 0 && deltaNorm < 0) || (pxChg < 0 && deltaNorm > 0);

    const divScoreRaw = opp ? Math.min(1, Math.abs(pxChg) * 400) * Math.min(1, Math.abs(deltaNorm) * 2.0) : 0;
    const divergence_dir =
      divScoreRaw <= 0 ? "none" :
        (pxChg > 0 && deltaNorm < 0) ? "bear" :
          (pxChg < 0 && deltaNorm > 0) ? "bull" : "none";

    // Absorption: big aggressive qty but small trade price range.
    const midP = (minP !== Infinity && maxP !== -Infinity) ? (minP + maxP) / 2 : 0;
    const rangeNorm = (midP && minP !== Infinity && maxP !== -Infinity) ? (maxP - minP) / midP : 0;

    // Small range => stronger absorption. Threshold ~15 bps.
    const tightness = Math.max(0, Math.min(1, 1 - (rangeNorm / 0.0015)));

    // Qty scale: normalize by a soft cap using sqrt to avoid over-sensitivity.
    const qtyNorm = Math.max(0, Math.min(1, Math.sqrt(total) / 30));

    const absorptionScore = Math.max(0, Math.min(1, tightness * qtyNorm));

    const absorption_dir =
      absorptionScore <= 0 ? "none" :
        deltaQty > 0 ? "bull" :
          deltaQty < 0 ? "bear" : "none";

    deltaBlock = {
      buy_qty: buy,
      sell_qty: sell,
      delta_qty: deltaQty,
      delta_norm: deltaNorm,
      cvd: deltaQty,

      divergence_score: divScoreRaw,
      divergence_dir,

      absorption_score: absorptionScore,
      absorption_dir,
    };
  }


  // Cross: deviation bps (từ snapshot), deviation z-score (5m preferred), consensus
  const dev_bps = input.cross?.dev_bps;

  let dev_z: number | undefined = undefined;
  if (c5 && b5 && c5.length >= 60 && b5.length >= 60) {
    dev_z = deviationZ({ bybit: c5, binance: b5, windowBars: 120 });
  } else if (c15 && b15 && c15.length >= 60 && b15.length >= 60) {
    dev_z = deviationZ({ bybit: c15, binance: b15, windowBars: 120 });
  }

  const consensus_score = consensusScore({
    dev_bps,
    lead_lag: input.cross?.lead_lag,
  });

  const market_structure = computeMarketStructureSnapshot({
    tfs: ["15m", "1h", "4h"], // NEW: add 4h
    candlesByTf: {
      "15m": c15,
      "1h": c1h,
      "4h": c4h,
    },
    pivotWindow: 2,
    swingsCap: 20,
  });


  // log chỉ khi có event (để không spam)
  /*
  const ms15 = market_structure["15m"];
  if (ms15?.lastBOS || ms15?.lastCHOCH || ms15?.lastSweep) {
    console.log("[3.4] MS 15m", {
      trend: ms15.trend,
      swingH: ms15.lastSwingHigh?.price,
      swingL: ms15.lastSwingLow?.price,
      bos: ms15.lastBOS,
      choch: ms15.lastCHOCH,
      sweep: ms15.lastSweep,
    });
  }*/

  return {
    canon: input.canon,
    ts: input.ts,

    quality: {
      dq_grade: input.dq.grade,
      bybit_ok: input.bybitOk,
      binance_ok: input.binanceOk,
    },

    bias: {
      tf: biasTf,
      trend_dir,
      trend_strength,
      vol_regime,
      adx14: adxVal,
      ema200,
      ema200_slope_bps,
    },
    bias_by_tf: {
      "15m": computeBiasForTf("15m", c15),
      "1h": computeBiasForTf("1h", c1h),
      "4h": computeBiasForTf("4h", c4h),
      "1d": computeBiasForTf("1d", c1d),
    },
    entry: {
      tfs: ["5m", "15m"],
      momentum: {
        rsi14_5m,
        rsi14_15m,
        macdHist_5m,
        macdHist_15m,
      },
      volatility: {
        atrp_15m,
        atrp_1h,
        atrp_4h,

        bbWidth_15m,
        bbWidth_1h,
        bbWidth_4h,
      },

    },

    orderflow: {
      imbalance: { top10: im10, top50: im50, top200: im200 },
      aggression_ratio: agg,
      delta: deltaBlock, // NEW
    },

    cross: {
      dev_bps,
      dev_z,
      lead_lag: input.cross?.lead_lag,
      consensus_score,
    },
    market_structure,
    flags: {
      partial,
      notes: notes.length ? notes : undefined,
    },
  };
}