/**
 * Setup Engine v3.0 (FULL REWRITE)
 * ============================================================
 * Uses ONLY data already present in market-snapshot-v4 JSON.
 *
 * Export:
 *   - buildSetupsV3(snapshot, opts)
 *
 * Notes:
 *   - No reliance on the JSON risk_policy "setup" section; the engine focuses on data blocks under:
 *       snapshot.unified.features.*  and  snapshot.unified.anchor_layer.*
 *   - Deterministic, rule-based, with gates + scores for tradability.
 */

// -------------------------
// Helpers
// -------------------------
function clamp(x, a, b) {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}
function clamp01(x) { return clamp(x, 0, 1); }
function nz(x, d = null) { return Number.isFinite(x) ? x : d; }
function s(x) { return String(x ?? ""); }

function roundToStep(x, step) {
  if (!Number.isFinite(x) || !Number.isFinite(step) || step <= 0) return x;
  return Math.round(x / step) * step;
}

function rr(entry, stop, target) {
  if (![entry, stop, target].every(Number.isFinite)) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  return Math.abs(target - entry) / risk;
}

function rrToScore(rr1) {
  // Smooth mapping: RR 0.8 -> ~0.35, RR 1.2 -> ~0.55, RR 2.0 -> ~0.78
  if (!Number.isFinite(rr1)) return 0;
  const x = clamp(rr1, 0, 6);
  const z = (x - 1.15) / 0.55;
  return clamp01(1 / (1 + Math.exp(-z)));
}

function inZone(px, zone) {
  if (!Number.isFinite(px) || !Array.isArray(zone) || zone.length !== 2) return false;
  const lo = Math.min(zone[0], zone[1]);
  const hi = Math.max(zone[0], zone[1]);
  return px >= lo && px <= hi;
}

function distToZone(px, zone) {
  if (!Number.isFinite(px) || !Array.isArray(zone) || zone.length !== 2) return null;
  const lo = Math.min(zone[0], zone[1]);
  const hi = Math.max(zone[0], zone[1]);
  if (px < lo) return lo - px;
  if (px > hi) return px - hi;
  return 0;
}

function pickTf(tfMap, tfKey) {
  const t = tfMap?.[tfKey];
  return (t && t.last) ? t : null;
}

function trendDir(label) {
  if (label === "bull") return 1;
  if (label === "bear") return -1;
  return 0;
}

function scoreRegime(tfFeatures) {
  const t15 = pickTf(tfFeatures, "15");
  const t60 = pickTf(tfFeatures, "60");
  const t240 = pickTf(tfFeatures, "240");
  const tD = pickTf(tfFeatures, "D");

  const d15 = trendDir(t15?.labels?.trend);
  const d60 = trendDir(t60?.labels?.trend);
  const d240 = trendDir(t240?.labels?.trend);
  const dD = trendDir(tD?.labels?.trend);

  // Weight HTF more heavily; LTF used mainly for execution confirmation.
  const composite = 0.10 * d15 + 0.25 * d60 + 0.40 * d240 + 0.25 * dD;
  const strength = Math.abs(composite);

  let regime = "range";
  if (strength >= 0.60) regime = composite > 0 ? "bull" : "bear";
  else if (strength >= 0.35) regime = composite > 0 ? "bull_weak" : "bear_weak";

  return { regime, composite, strength, dirs: { d15, d60, d240, dD } };
}

function getNowTs(snapshot) {
  return (
    snapshot?.unified?.anchor_layer?.market?.now_ts ??
    snapshot?.generated_at ??
    Date.now()
  );
}

function getRefPx(snapshot, preferExchange = "bybit") {
  // Prefer mark; fallback to last/index.
  const ex = snapshot?.per_exchange?.[preferExchange];
  const t = ex?.ticker;
  const cands = [t?.mark, t?.last, t?.index, t?.price, t?.close];
  for (const v of cands) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  // Cross-exchange fallback
  for (const name of ["bybit", "binance", "okx"]) {
    const tt = snapshot?.per_exchange?.[name]?.ticker;
    const xs = [tt?.mark, tt?.last, tt?.index, tt?.price, tt?.close];
    for (const v of xs) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Klines / Candlestick utilities
 * Snapshot v4 includes per_exchange.<ex>.klines[tf].closed[] with {ts,o,h,l,c,v}.
 * We use only CLOSED candles to avoid repainting.
 */
function getClosedCandles(snapshot, tf, preferExchange = "bybit", lookback = 3) {
  const tfKey = s(tf);
  const exOrder = [s(preferExchange), "bybit", "binance", "okx"].filter(Boolean);
  const tried = new Set();
  for (const ex of exOrder) {
    if (tried.has(ex)) continue;
    tried.add(ex);
    const arr = snapshot?.per_exchange?.[ex]?.klines?.[tfKey]?.closed;
    if (Array.isArray(arr) && arr.length >= 2) {
      const n = Math.max(2, Math.min(arr.length, lookback));
      return { exchange: ex, candles: arr.slice(-n) };
    }
  }
  // Fallback: any exchange that has candles
  for (const ex of ["bybit", "binance", "okx"]) {
    const arr = snapshot?.per_exchange?.[ex]?.klines?.[tfKey]?.closed;
    if (Array.isArray(arr) && arr.length >= 2) {
      const n = Math.max(2, Math.min(arr.length, lookback));
      return { exchange: ex, candles: arr.slice(-n) };
    }
  }
  return { exchange: null, candles: null };
}

function candleStats(c) {
  const o = Number(c?.o), h = Number(c?.h), l = Number(c?.l), cl = Number(c?.c);
  if (![o, h, l, cl].every(Number.isFinite)) return null;
  const range = Math.max(0, h - l);
  const body = Math.abs(cl - o);
  const upper = h - Math.max(o, cl);
  const lower = Math.min(o, cl) - l;
  const dir = cl > o ? "up" : (cl < o ? "down" : "flat");
  return { o, h, l, c: cl, range, body, upper, lower, dir };
}

function detectCandlePatterns(prev, cur) {
  const p = candleStats(prev);
  const c = candleStats(cur);
  if (!p || !c || c.range <= 0) return null;

  const doji = c.body <= 0.1 * c.range;

  const bullPin = c.lower >= 2.0 * Math.max(c.body, 1e-12) && c.upper <= 0.75 * Math.max(c.body, 1e-12) && c.dir !== "down";
  const bearPin = c.upper >= 2.0 * Math.max(c.body, 1e-12) && c.lower <= 0.75 * Math.max(c.body, 1e-12) && c.dir !== "up";

  const pBodyHi = Math.max(p.o, p.c);
  const pBodyLo = Math.min(p.o, p.c);
  const cBodyHi = Math.max(c.o, c.c);
  const cBodyLo = Math.min(c.o, c.c);

  const bullEngulf = (p.dir === "down" || p.dir === "flat") && (c.dir === "up") && cBodyHi >= pBodyHi && cBodyLo <= pBodyLo;
  const bearEngulf = (p.dir === "up" || p.dir === "flat") && (c.dir === "down") && cBodyHi >= pBodyHi && cBodyLo <= pBodyLo;

  const insideBar = c.h < p.h && c.l > p.l;

  // "Impulse" body: strong directional candle (proxy for momentum confirmation)
  const impulseUp = c.dir === "up" && c.body >= 0.55 * c.range;
  const impulseDown = c.dir === "down" && c.body >= 0.55 * c.range;

  return {
    doji,
    pinbar: bullPin ? "bull" : (bearPin ? "bear" : null),
    engulfing: bullEngulf ? "bull" : (bearEngulf ? "bear" : null),
    inside: insideBar,
    impulse: impulseUp ? "bull" : (impulseDown ? "bear" : null),
    cur: c,
    prev: p,
  };
}

function candleTriggerScore(patterns, side) {
  if (!patterns || !side) return { score: 0, tags: [] };
  const want = side === "long" ? "bull" : "bear";
  const tags = [];
  let score = 0;

  if (patterns.engulfing === want) { score += 0.55; tags.push(`${want}_engulfing`); }
  if (patterns.pinbar === want) { score += 0.45; tags.push(`${want}_pinbar`); }
  if (patterns.impulse === want) { score += 0.35; tags.push(`${want}_impulse`); }

  // Doji is weaker; only meaningful if it follows a push into the zone (we don't know that here),
  // so we give small weight and treat it as "pause/indecision".
  if (patterns.doji) { score += 0.15; tags.push("doji"); }

  if (patterns.inside) { score += 0.10; tags.push("inside_bar"); }

  // Cap at 1
  score = Math.min(1, Math.max(0, score));
  return { score, tags };
}


function pickBestOrderflow(orderflow) {
  // orderflow: { bybit:{book_imbalance, delta_notional, confidence}, ... }
  const exs = [
    { k: "bybit", v: orderflow?.bybit },
    { k: "binance", v: orderflow?.binance },
    { k: "okx", v: orderflow?.okx },
  ].filter(x => x.v);

  exs.sort((a, b) => nz(b.v?.confidence, 0) - nz(a.v?.confidence, 0));
  const best = exs[0] || null;
  if (!best) return { usable: false, best: null };
  const conf = nz(best.v?.confidence, 0);
  if (conf < 0.25) return { usable: false, best: { exchange: best.k, ...best.v } };
  return { usable: true, best: { exchange: best.k, ...best.v } };
}

function orderflowAlignScore(ofBest, side) {
  // side: "long" | "short"
  if (!ofBest) return { usable: false, score: null, details: null };

  const conf = nz(ofBest.confidence, 0);
  const imb = nz(ofBest.book_imbalance, null); // positive => bid-dominant
  const dlt = nz(ofBest.delta_notional, null); // positive => aggressive buys

  if (conf < 0.25) return { usable: false, score: null, details: { conf, imb, dlt } };

  // Convert each component to directional agreement in [0..1]
  const want = side === "long" ? 1 : -1;

  let s1 = null;
  if (Number.isFinite(imb)) s1 = clamp01(0.5 + 0.5 * want * Math.tanh(imb / 0.25));

  let s2 = null;
  if (Number.isFinite(dlt)) s2 = clamp01(0.5 + 0.5 * want * Math.tanh(dlt / Math.max(1e-9, Math.abs(dlt))));

  // dlt term above is sign-only robust; if you later normalize to volume you can improve it.
  const parts = [s1, s2].filter(Number.isFinite);
  const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;

  return { usable: Number.isFinite(score), score, details: { conf, imb, dlt } };
}

function derivativesPenalty(deriv, side) {
  // Penalize when funding extreme + OI rising in a crowded direction.
  // Also consider premium divergence (fragmentation) and leverage regime.
  const labels = deriv?.funding_labels || {};
  const synth = deriv?.derivatives_synthesis || {};

  const oiTrend = synth?.oi_trend?.binance || "unknown";
  const lev = synth?.leverage_regime || "neutral";
  const fBy = labels?.bybit;
  const fBn = labels?.binance;
  const fOk = labels?.okx;

  const anyPosExtreme = [fBy, fBn, fOk].includes("positive_extreme");
  const anyNegExtreme = [fBy, fBn, fOk].includes("negative_extreme");

  const oiRising = (oiTrend === "rising" || oiTrend === "rising_strong");
  const oiFalling = (oiTrend === "falling" || oiTrend === "falling_strong");

  let p = 0;

  // Crowded longs
  if (side === "long" && anyPosExtreme && oiRising) p += 0.18;
  if (side === "long" && anyPosExtreme && oiFalling) p += 0.10;

  // Crowded shorts
  if (side === "short" && anyNegExtreme && oiRising) p += 0.18;
  if (side === "short" && anyNegExtreme && oiFalling) p += 0.10;

  // Leverage regime adjustment
  if (lev === "risk_off") p += 0.05; // be conservative
  if (lev === "risk_on") p -= 0.03;  // mild tailwind

  // Fragmentation / divergence: more divergence => worse reliability
  const fd = nz(synth?.funding_divergence, 0);
  const pd = nz(synth?.premium_divergence, 0);
  if (Number.isFinite(fd) && fd > 0) p += clamp(fd * 3.0, 0, 0.06);
  if (Number.isFinite(pd) && pd > 0) p += clamp(pd * 2.0, 0, 0.06);

  return clamp(p, 0, 0.28);
}

function liquidationSignal(deriv, side) {
  const liq = deriv?.liquidation_features || {};
  const observed = !!liq?.observed;
  const inten = nz(liq?.intensity_15m, null);
  const bias = nz(liq?.bias, null); // positive => more short liq than long liq

  if (!observed) return { usable: false, score: null, details: { observed: false } };

  // Intensity: 0.05..0.15+ considered meaningful in your snapshot code.
  let iScore = 0.5;
  if (Number.isFinite(inten)) {
    if (inten > 0.15) iScore = 0.85;
    else if (inten > 0.08) iScore = 0.70;
    else if (inten > 0.04) iScore = 0.60;
    else iScore = 0.52;
  }

  // Bias interpretation:
  // - If short liquidations dominate (bias>0), that tends to support long continuation/reversal.
  // - If long liquidations dominate (bias<0), that tends to support short.
  let bScore = 0.5;
  if (Number.isFinite(bias)) {
    const want = side === "long" ? 1 : -1;
    bScore = clamp01(0.5 + 0.5 * want * Math.tanh(bias / 0.35));
  }

  const score = 0.55 * iScore + 0.45 * bScore;
  return { usable: true, score: clamp01(score), details: { inten, bias } };
}

function pickOpposingSwingTarget(swings_last, side) {
  // swings_last elements: {type:"low"|"high", price, i, ts}
  if (!Array.isArray(swings_last) || !swings_last.length) return null;
  if (side === "long") {
    for (let i = swings_last.length - 1; i >= 0; i--) {
      const x = swings_last[i];
      if (x?.type === "high" && Number.isFinite(x.price)) return x.price;
    }
  } else {
    for (let i = swings_last.length - 1; i >= 0; i--) {
      const x = swings_last[i];
      if (x?.type === "low" && Number.isFinite(x.price)) return x.price;
    }
  }
  return null;
}

function pickStopFromStructure(anchorStruct, side) {
  const sl = anchorStruct?.swing_last;
  if (!sl || !Number.isFinite(sl.price)) return null;
  // For long: invalidation is below last swing low.
  // For short: invalidation is above last swing high.
  if (side === "long" && sl.type === "low") return sl.price;
  if (side === "short" && sl.type === "high") return sl.price;
  // If swing_last is not the right type (e.g. last was a high, but we need a low),
  // fall back to scanning swings_last.
  const list = anchorStruct?.swings_last || [];
  if (side === "long") {
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (x?.type === "low" && Number.isFinite(x.price)) return x.price;
    }
  } else {
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (x?.type === "high" && Number.isFinite(x.price)) return x.price;
    }
  }
  return null;
}

function buildExecutionState(setup, snapshot, refPx) {
  const nowTs = getNowTs(snapshot);
  const atr = nz(setup?.execution_metrics?.atr, null);
  const zone = setup?.entry_zone;
  const ep = nz(setup?.entry_preferred, null);
  const stop = nz(setup?.stop, null);

  const reasons = [];
  if (!Number.isFinite(refPx)) reasons.push("ref_price_missing");
  if (!Number.isFinite(atr) || atr <= 0) reasons.push("atr_missing");

  const side = setup.bias === "Long" ? "long" : (setup.bias === "Short" ? "short" : null);

  // Pull a minimal LTF/HTF execution context from unified.features.
  // We intentionally avoid using any "setup" policy blocks; this is pure indicator context.
  const tfMap = snapshot?.unified?.features?.timeframes || {};
  const tfKey = s(setup?.timeframe);
  const tfSelf = pickTf(tfMap, tfKey);
  const tfLTF = pickTf(tfMap, "15");
  const tfHTF = pickTf(tfMap, "240") || pickTf(tfMap, "D") || pickTf(tfMap, "60");

  function momentumConfirmScore(side) {
    // Uses only fields that exist in v4 snapshot features (ema, rsi, macd) if present.
    // Returns [0..1] with 0.5 neutral.
    if (!side) return { score: 0.5, tags: ["side_missing"] };
    const want = side === "long" ? 1 : -1;
    const tags = [];
    let sAcc = 0;
    let n = 0;

    const rsi = nz(tfSelf?.last?.rsi, nz(tfLTF?.last?.rsi, null));
    if (Number.isFinite(rsi)) {
      // Prefer RSI being >50 for long, <50 for short; also avoid extremes against entry.
      const sRsi = clamp01(0.5 + 0.5 * want * Math.tanh((rsi - 50) / 9));
      sAcc += sRsi; n++; tags.push("rsi");
    }

    const macdH = nz(tfSelf?.last?.macd_hist, nz(tfLTF?.last?.macd_hist, null));
    if (Number.isFinite(macdH)) {
      const sMacd = clamp01(0.5 + 0.5 * want * Math.tanh(macdH / 0.6));
      sAcc += sMacd; n++; tags.push("macd_hist");
    }

    const emaFast = nz(tfSelf?.last?.ema_fast, null);
    const emaSlow = nz(tfSelf?.last?.ema_slow, null);
    const px = nz(refPx, null);
    if ([emaFast, emaSlow, px].every(Number.isFinite)) {
      // EMA stack + price location proxy.
      const stack = emaFast > emaSlow ? 1 : (emaFast < emaSlow ? -1 : 0);
      const sStack = clamp01(0.5 + 0.5 * want * stack);
      const sPx = clamp01(0.5 + 0.5 * want * Math.tanh((px - emaFast) / Math.max(1e-9, atr || 1)));
      sAcc += 0.6 * sStack + 0.4 * sPx; n++; tags.push("ema_stack");
    }

    if (!n) return { score: 0.5, tags: ["no_momentum_fields"] };
    return { score: clamp01(sAcc / n), tags };
  }

  // Orderflow alignment for execution (if confidence is sufficient).
  const ofPick = pickBestOrderflow(snapshot?.unified?.features?.orderflow);
  const ofAlign = ofPick?.usable ? orderflowAlignScore(ofPick.best, side) : { usable: false, score: null, details: null };

  // Lightweight volume confirmation from klines (last candle vs trailing average).
  function volumeConfirmScore(candleArr) {
    if (!Array.isArray(candleArr) || candleArr.length < 6) return { score: 0.5, tags: ["no_volume_lookback"] };
    const vols = candleArr
      .map(x => Number(x?.v))
      .filter(Number.isFinite);
    if (vols.length < 6) return { score: 0.5, tags: ["volume_missing"] };
    const last = vols[vols.length - 1];
    const base = vols.slice(Math.max(0, vols.length - 21), -1);
    if (base.length < 3) return { score: 0.5, tags: ["volume_base_short"] };
    const avg = base.reduce((a, b) => a + b, 0) / base.length;
    if (!(avg > 0)) return { score: 0.5, tags: ["volume_avg_zero"] };
    const ratio = last / avg;
    // Ratio 1.0 neutral, 1.5 meaningful, 2.2 strong.
    const sVol = clamp01(0.5 + 0.5 * Math.tanh((ratio - 1.0) / 0.7));
    const tag = ratio >= 1.8 ? "vol_spike" : (ratio >= 1.3 ? "vol_up" : (ratio <= 0.8 ? "vol_down" : "vol_flat"));
    return { score: sVol, tags: [tag], ratio };
  }

  // Candle confirmation (uses CLOSED klines from snapshot.per_exchange.*.klines[tf].closed)
  // Note: for volume confirmation we also need a longer lookback; we fetch up to 30 closed candles.
  const tfKeyForKline = s(setup?.timeframe);
  const exPref = s(setup?.meta?.prefer_exchange || setup?.meta?.exchange || "bybit");
  const { exchange: klineEx, candles } = getClosedCandles(snapshot, tfKeyForKline, exPref, 3);
  const { candles: candlesVol } = getClosedCandles(snapshot, tfKeyForKline, exPref, 30);
  let candle = null;
  let candleScore = 0;
  let candleTags = [];
  const volConf = volumeConfirmScore(candlesVol);
  const momConf = momentumConfirmScore(side);
  if (Array.isArray(candles) && candles.length >= 2) {
    candle = detectCandlePatterns(candles[candles.length - 2], candles[candles.length - 1]);
    const trig = candleTriggerScore(candle, side);
    candleScore = trig.score;
    candleTags = trig.tags;
  } else {
    reasons.push("kline_missing_for_tf");
  }

  // Composite trigger: candle + momentum + orderflow + volume.
  // We intentionally weight candle most heavily because it captures immediate acceptance/rejection.
  const ofScore = (ofAlign?.usable && Number.isFinite(ofAlign.score)) ? ofAlign.score : 0.5;
  const triggerComposite = clamp01(
    0.50 * candleScore +
    0.22 * nz(momConf?.score, 0.5) +
    0.18 * ofScore +
    0.10 * nz(volConf?.score, 0.5)
  );

  const triggerTags = [
    ...candleTags,
    ...(momConf?.tags || []).map(x => `mom_${x}`),
    ...(volConf?.tags || []).map(x => `vol_${x}`),
    ...(ofAlign?.usable ? ["of_aligned"] : ["of_unusable"]),
  ];

  // Invalidation checks
  let invalidated = false;
  if (side && Number.isFinite(refPx) && Number.isFinite(stop)) {
    if (side === "long" && refPx <= stop) invalidated = true;
    if (side === "short" && refPx >= stop) invalidated = true;
  }
  if (invalidated) reasons.push("invalidated_by_stop");

  // Zone proximity
  const zLo = Number(zone?.low);
  const zHi = Number(zone?.high);
  const inside = Number.isFinite(refPx) && Number.isFinite(zLo) && Number.isFinite(zHi) ? (refPx >= zLo && refPx <= zHi) : null;

  const distToEntry = Number.isFinite(refPx) && Number.isFinite(ep) ? Math.abs(refPx - ep) : null;
  const distToEntryAtr = Number.isFinite(distToEntry) && Number.isFinite(atr) ? distToEntry / atr : null;

  // Distance to zone (0 if inside)
  let dz = null;
  if (Number.isFinite(refPx) && Number.isFinite(zLo) && Number.isFinite(zHi)) {
    if (refPx < zLo) dz = zLo - refPx;
    else if (refPx > zHi) dz = refPx - zHi;
    else dz = 0;
  }
  const distToZoneAtr = Number.isFinite(dz) && Number.isFinite(atr) ? dz / atr : null;

  // Overrun / missed-entry heuristics
  const overrunAtr = nz(setup?.execution_metrics?.overrun_atr, 0.9);
  const farFromZone = Number.isFinite(distToZoneAtr) ? (distToZoneAtr > overrunAtr) : false;

  // Confirmation policy by setup type
  const t = s(setup?.type);
  // Stricter approval thresholds by setup type.
  // - reversal_sweep: must show decisive rejection/acceptance + supportive momentum (avoid weak doji-only entries).
  // - range_mean_reversion: must show rejection + non-adverse orderflow.
  // - breakout_retest: must show acceptance on retest (impulse/engulf/pin) + momentum.
  // - trend_pullback: can pre-place limit in zone, but market entry requires confirmation.
  const requireTrigger = (t === "reversal_sweep" || t === "range_mean_reversion" || t === "breakout_retest");
  const strongCandle = candleScore >= 0.45;
  const weakCandle = candleScore > 0 && candleScore < 0.45;

  const thr = (
    t === "reversal_sweep" ? 0.62 :
    t === "range_mean_reversion" ? 0.58 :
    t === "breakout_retest" ? 0.56 :
    0.52
  );
  const thrLimit = (
    t === "reversal_sweep" ? 0.52 :
    t === "range_mean_reversion" ? 0.50 :
    t === "breakout_retest" ? 0.49 :
    0.46
  );

  // Phase & readiness
  let phase = "monitor";
  let readiness = "wait";
  let order = null;

  if (invalidated) {
    phase = "no_trade";
    readiness = "invalidated";
    order = null;
  } else if (farFromZone) {
    // Price is too far from zone: likely missed, avoid FOMO.
    phase = "no_trade";
    readiness = "missed";
    reasons.push("price_far_from_entry_zone");
  } else if (inside === true) {
    // Inside zone: we decide between "ready" vs "wait_confirm" based on confirmation policy
    phase = "in_zone";

    if (requireTrigger) {
      if (triggerComposite >= thr && strongCandle) {
        readiness = "ready_market";
        order = { type: "market_or_stop", note: "trigger_confirmed" };
      } else if (triggerComposite >= thrLimit) {
        readiness = "ready_limit";
        order = { type: "limit", note: "partial_confirm" };
        if (weakCandle) reasons.push("weak_candle_confirmation");
        if (!strongCandle) reasons.push("candle_not_decisive");
        if (!(momConf?.score >= 0.50)) reasons.push("momentum_not_supportive");
      } else {
        readiness = "wait_confirm";
        order = { type: "limit_or_wait", note: "waiting_trigger" };
        reasons.push("awaiting_trigger_confirmation");
      }
    } else {
      // Trend pullback: limit execution allowed in zone; market/stop only after confirmation.
      if (triggerComposite >= thr && strongCandle) {
        readiness = "ready_market";
        order = { type: "market_or_stop", note: "trigger_confirmed" };
      } else {
        readiness = "ready_limit";
        order = { type: "limit", note: "zone_entry" };
        if (triggerComposite < thrLimit) reasons.push("trigger_weak_limit_only");
      }
    }
  } else {
    // Not inside zone
    phase = "approach";
    if (Number.isFinite(distToZoneAtr)) {
      if (distToZoneAtr <= 0.25) {
        readiness = "near_zone";
        order = { type: "prepare_limit", note: "near_entry_zone" };
      } else {
        readiness = "wait";
        order = null;
      }
    } else {
      readiness = "wait";
      order = null;
    }
  }

  // Additional context for execution (explain candle)
  const candleInfo = candle
    ? {
        exchange: klineEx,
        tf: s(setup?.timeframe),
        tags: triggerTags,
        score: candleScore,
        trigger_composite: triggerComposite,
        momentum_score: nz(momConf?.score, 0.5),
        volume_score: nz(volConf?.score, 0.5),
        orderflow_score: ofScore,
        last: candle?.cur ? { o: candle.cur.o, h: candle.cur.h, l: candle.cur.l, c: candle.cur.c, dir: candle.cur.dir } : null,
      }
    : {
        exchange: klineEx,
        tf: s(setup?.timeframe),
        tags: triggerTags,
        score: 0,
        trigger_composite: triggerComposite,
        momentum_score: nz(momConf?.score, 0.5),
        volume_score: nz(volConf?.score, 0.5),
        orderflow_score: ofScore,
        last: null,
      };

  return {
    ts: nowTs,
    ref_px: refPx,
    atr,
    tradable: setup.tradable === true,
    phase,
    readiness,
    order,
    proximity: {
      dist_to_entry: distToEntry,
      dist_to_entry_atr: distToEntryAtr,
      dist_to_zone: dz,
      dist_to_zone_atr: distToZoneAtr,
      inside_entry_zone: inside,
    },
    candle: candleInfo,
    reason: reasons,
  };
}

function timeframeLabel(tf) {
  if (tf === "15") return "15m";
  if (tf === "60") return "1H";
  if (tf === "240") return "4H";
  if (tf === "D") return "1D";
  return String(tf);
}

function recommendHorizon(tf, type) {
  // Execution horizon suggestion (user asked: 30m-1H short term, or hours-days medium).
  // We derive hold-time from execution timeframe and setup type.
  if (tf === "15") {
    if (type === "breakout_retest") return { horizon: "30m–4h", hold: "30 phút đến vài giờ" };
    return { horizon: "30m–3h", hold: "30 phút đến vài giờ" };
  }
  if (tf === "60") {
    if (type === "trend_pullback") return { horizon: "2h–12h", hold: "vài giờ đến 1 ngày" };
    return { horizon: "1h–8h", hold: "vài giờ" };
  }
  if (tf === "240") {
    return { horizon: "8h–3d", hold: "vài tiếng đến vài ngày" };
  }
  if (tf === "D") {
    return { horizon: "2d–10d", hold: "vài ngày" };
  }
  return { horizon: "intraday", hold: "vài giờ" };
}

// -------------------------
// Gates & Scoring
// -------------------------
function hardGate({ type, atr, entry, stop, rr1, penetration_atr = null }) {
  const reasons = [];

  if (!(Number.isFinite(atr) && atr > 0)) reasons.push("atr_missing");

  const risk = (Number.isFinite(entry) && Number.isFinite(stop)) ? Math.abs(entry - stop) : null;
  const riskOverAtr = (Number.isFinite(risk) && Number.isFinite(atr) && atr > 0) ? (risk / atr) : null;

  // Practical stop distance
  if (!Number.isFinite(riskOverAtr)) reasons.push("risk_over_atr_missing");
  else {
    if (riskOverAtr < 0.30) reasons.push("stop_too_tight");
    if (riskOverAtr > 3.00) reasons.push("stop_too_wide");
  }

  // RR minimums
  if (!Number.isFinite(rr1)) reasons.push("rr_missing");
  else {
    const minRR = (type === "range_mean_reversion") ? 0.80 : 0.95;
    if (rr1 < minRR) reasons.push("rr_too_low");
  }

  // Reversal sweep must be a real sweep
  if (type === "reversal_sweep") {
    if (!Number.isFinite(penetration_atr)) reasons.push("sweep_strength_missing");
    else if (penetration_atr < 0.08) reasons.push("sweep_too_weak");
  }

  return { ok: reasons.length === 0, reasons, risk_over_atr: riskOverAtr };
}

function computeParameterReliability({
  nowTs,
  anchorTs,
  atr,
  entry,
  stop,
  tp1,
  rr1,
  hasStructure,
  hasTargets,
  frictionPenalty = 0,
}) {
  const warnings = [];
  let pr = 0;

  // 1) Anchor freshness (0..0.25)
  let a = 0;
  if (Number.isFinite(anchorTs) && Number.isFinite(nowTs)) {
    const ageH = (nowTs - anchorTs) / 3600000;
    if (ageH <= 6) a = 0.25;
    else if (ageH <= 18) a = 0.20;
    else if (ageH <= 48) a = 0.14;
    else if (ageH <= 96) a = 0.10;
    else { a = 0.06; warnings.push("anchor_old"); }
  } else {
    a = 0.10;
    warnings.push("anchor_ts_missing");
  }
  pr += a;

  // 2) Executability primitives (0..0.35)
  let e = 0;
  if (Number.isFinite(atr) && atr > 0) e += 0.12; else warnings.push("atr_missing");
  if (Number.isFinite(entry) && Number.isFinite(stop)) e += 0.10; else warnings.push("entry_or_stop_missing");
  if (hasStructure) e += 0.08; else warnings.push("structure_weak");
  if (Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(atr) && atr > 0) {
    const roa = Math.abs(entry - stop) / atr;
    if (roa >= 0.35 && roa <= 2.50) e += 0.05;
    else warnings.push(roa < 0.35 ? "stop_too_tight" : "stop_too_wide");
  }
  pr += clamp(e, 0, 0.35);

  // 3) Targets / RR (0..0.25)
  let t = 0;
  if (hasTargets && Number.isFinite(tp1)) t += 0.10; else warnings.push("tp1_missing");
  if (Number.isFinite(rr1)) {
    if (rr1 >= 1.2) t += 0.15;
    else if (rr1 >= 0.9) t += 0.08;
    else warnings.push("rr_low");
  } else {
    warnings.push("rr_missing");
  }
  pr += clamp(t, 0, 0.25);

  // 4) Market friction penalty (0..0.20)
  const fp = clamp(nz(frictionPenalty, 0), 0, 0.20);
  if (fp > 0.12) warnings.push("market_friction_high");
  pr -= fp;

  return { parameter_reliability: clamp01(pr), warnings };
}

function computeSignalQuality({
  type,
  side,
  reg,
  tfFeat,
  ofAlign,
  liqSig,
  derivPenalty,
  extra = {},
}) {
  // Signal quality is context-only (non-price); price-based quality handled by parameter reliability + RR.
  let q = 0.50;

  // Regime alignment
  const want = side === "long" ? 1 : -1;
  if (Number.isFinite(reg?.composite)) {
    const align = clamp01(0.5 + 0.5 * want * Math.tanh(reg.composite / 0.55));
    q += 0.18 * (align - 0.5) * 2;
  }

  // Trend label / EMA stack
  const trend = tfFeat?.labels?.trend;
  if (trend === "bull" && side === "long") q += 0.06;
  if (trend === "bear" && side === "short") q += 0.06;
  if (trend === "bull" && side === "short") q -= 0.04;
  if (trend === "bear" && side === "long") q -= 0.04;

  // RSI bias (soft)
  const rsi = nz(tfFeat?.last?.rsi14, null);
  if (Number.isFinite(rsi)) {
    if (side === "long") {
      if (rsi >= 52) q += 0.03;
      if (rsi <= 38 && type !== "reversal_sweep" && type !== "range_mean_reversion") q -= 0.04;
    } else {
      if (rsi <= 48) q += 0.03;
      if (rsi >= 62 && type !== "reversal_sweep" && type !== "range_mean_reversion") q -= 0.04;
    }
  }

  // MACD histogram direction (soft)
  const mh = nz(tfFeat?.last?.macd_hist, null);
  if (Number.isFinite(mh)) {
    if (side === "long" && mh > 0) q += 0.03;
    if (side === "short" && mh < 0) q += 0.03;
  }

  // Orderflow
  if (ofAlign?.usable && Number.isFinite(ofAlign.score)) {
    q += 0.10 * (clamp01(ofAlign.score) - 0.5) * 2;
  }

  // Liquidations
  if (liqSig?.usable && Number.isFinite(liqSig.score)) {
    q += 0.06 * (clamp01(liqSig.score) - 0.5) * 2;
  }

  // Derivatives penalty
  q -= clamp(nz(derivPenalty, 0), 0, 0.28);

  // Type-specific adjustments
  if (type === "reversal_sweep") {
    // Reversals are harder; demand more context alignment.
    const st = nz(reg?.strength, 0);
    if (st >= 0.6) q -= 0.04; // strong trend makes reversal tougher
    if (extra?.sweep_side_ok === false) q -= 0.10;
  }

  return clamp01(q);
}

function computeFrictionPenalty({ dataQuality, overallScore }) {
  // Translate snapshot unified quality into mild penalty.
  let p = 0;
  if (dataQuality === "partial") p += 0.06;
  if (dataQuality === "unavailable") p += 0.12;
  if (Number.isFinite(overallScore) && overallScore < 0.50) p += 0.06;
  return clamp(p, 0, 0.20);
}

function makeSetupBase({
  symbol,
  type,
  side,
  tf,
  trigger,
  entryZone,
  entryPreferred,
  stop,
  tp1,
  tp2,
  anchors,
  executionAnchors,
  signalMetrics,
  scores,
  parameterReliability,
  ideaConfidence,
  finalScore,
  qualityTier,
  warnings,
  tradable,
}) {
  const { horizon, hold } = recommendHorizon(tf, type);

  return {
    symbol,
    type,
    bias: side === "long" ? "Long" : "Short",
    timeframe: tf,
    timeframe_label: timeframeLabel(tf),
    horizon,
    hold_time: hold,

    trigger,

    entry_zone: entryZone,
    entry_preferred: entryPreferred,
    invalidation: stop,
    stop,

    targets: { tp1, tp2, tp3: null },
    r_multiple: {
      tp1: rr(entryPreferred, stop, tp1),
      tp2: rr(entryPreferred, stop, tp2),
      tp3: null,
    },

    anchors: anchors || {},
    execution_anchors: executionAnchors || {},
    signal_metrics: signalMetrics || {},

    // scores
    parameter_reliability: parameterReliability,
    idea_confidence: ideaConfidence,
    final_score: finalScore,
    confidence: finalScore,
    quality_tier: qualityTier,

    scores: scores || {},
    warnings: warnings || [],

    tradable: tradable === true,
  };
}

// -------------------------
// Builders
// -------------------------
function buildReversalSweep({ snapshot, tf }) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const orderflow = snapshot?.unified?.features?.orderflow || {};
  const anchorLayer = snapshot?.unified?.anchor_layer;

  const tfFeat = tfFeatures?.[tf] || null;
  const aStruct = anchorLayer?.structure?.by_tf?.[tf] || null;
  const aLiq = anchorLayer?.liquidity?.by_tf?.[tf] || null;
  const sweep = aLiq?.sweep_last || null;
  if (!sweep) return null;

  const atr = nz(anchorLayer?.volatility?.atr?.[tf], nz(tfFeat?.last?.atr14, null));
  if (!(Number.isFinite(atr) && atr > 0)) return null;

  // Side inferred from sweep direction
  // sweep.side === "down" => down sweep then reclaim => bullish
  const side = sweep.side === "down" ? "long" : (sweep.side === "up" ? "short" : null);
  if (!side) return null;

  const reclaimed = nz(sweep.reclaimed_level, null);
  const wick = nz(sweep.wick_extreme, null);
  const confirmClose = nz(sweep.confirm_close, null);

  if (![reclaimed, wick, confirmClose].every(Number.isFinite)) return null;

  // Confirm polarity correctness: for long we want confirmClose above reclaimed; for short below.
  const sweepSideOk = side === "long" ? (confirmClose >= reclaimed) : (confirmClose <= reclaimed);

  // Entry design: reclaimed level with tight band
  const zoneHalf = 0.22 * atr;
  const entryPreferred = reclaimed;
  const entryZone = side === "long"
    ? [reclaimed - zoneHalf, reclaimed + 0.08 * atr]
    : [reclaimed - 0.08 * atr, reclaimed + zoneHalf];

  // Stop: wick extreme +/- buffer
  const stopBuf = 0.18 * atr;
  const stop = side === "long" ? (wick - stopBuf) : (wick + stopBuf);

  // Targets: opposing swing on same TF; tp2 as extension
  const swings_last = aStruct?.swings_last || [];
  const tp1 = pickOpposingSwingTarget(swings_last, side);

  let tp2 = null;
  if (Number.isFinite(tp1)) {
    // Use 1.6R extension toward direction
    const r1 = Math.abs(entryPreferred - stop);
    if (r1 > 0) tp2 = side === "long" ? Math.max(tp1, entryPreferred + 1.6 * r1) : Math.min(tp1, entryPreferred - 1.6 * r1);
  }

  const rr1 = rr(entryPreferred, stop, tp1);

  // Penetration strength
  const penetration = nz(sweep?.quality?.penetration, null);
  const penAtr = (Number.isFinite(penetration) && atr > 0) ? (penetration / atr) : null;

  // Gates
  const g = hardGate({ type: "reversal_sweep", atr, entry: entryPreferred, stop, rr1, penetration_atr: penAtr });
  if (!g.ok) return {
    setup: makeSetupBase({
      symbol,
      type: "reversal_sweep",
      side,
      tf,
      trigger: side === "long"
        ? "Down-sweep + reclaim → reversal long (confirmation close above reclaimed)"
        : "Up-sweep + reject → reversal short (confirmation close below reclaimed)",
      entryZone,
      entryPreferred,
      stop,
      tp1,
      tp2,
      anchors: {
        sweep: {
          side: sweep.side,
          reclaimed_level: reclaimed,
          wick_extreme: wick,
          confirm_close: confirmClose,
          ts: sweep.confirm_ts ?? sweep.sweep_ts ?? null,
        },
      },
      executionAnchors: {
        sweep: {
          ts: sweep.confirm_ts ?? sweep.sweep_ts ?? null,
          reclaimed_level: reclaimed,
          wick_extreme: wick,
          confirm_close: confirmClose,
          quality: {
            penetration,
            penetration_atr: penAtr,
            close_back_distance: nz(sweep?.quality?.close_back_distance, null),
          },
        },
      },
      signalMetrics: {},
      scores: { gates: { hard: { ok: false, reasons: g.reasons } } },
      parameterReliability: 0,
      ideaConfidence: 0,
      finalScore: 0,
      qualityTier: "D",
      warnings: g.reasons,
      tradable: false,
    }),
    reg: null,
  };

  // Context
  const reg = scoreRegime(tfFeatures);
  const { usable: ofUsable, best: ofBest } = pickBestOrderflow(orderflow);
  const ofAlign = orderflowAlignScore(ofBest, side);
  const liqSig = liquidationSignal(deriv, side);
  const derivPen = derivativesPenalty(deriv, side);

  // Friction
  const friction = computeFrictionPenalty({
    dataQuality: snapshot?.unified?.data_quality,
    overallScore: snapshot?.unified?.scores?.overall,
  });

  const nowTs = getNowTs(snapshot);
  const anchorTs = nz(sweep?.confirm_ts ?? sweep?.sweep_ts, null);

  const prRes = computeParameterReliability({
    nowTs,
    anchorTs,
    atr,
    entry: entryPreferred,
    stop,
    tp1,
    rr1,
    hasStructure: !!pickStopFromStructure(aStruct, side),
    hasTargets: Number.isFinite(tp1),
    frictionPenalty: friction,
  });

  const ic = computeSignalQuality({
    type: "reversal_sweep",
    side,
    reg,
    tfFeat,
    ofAlign,
    liqSig,
    derivPenalty: derivPen,
    extra: { sweep_side_ok: sweepSideOk },
  });

  const rrScore = rrToScore(rr1);

  // Final score weights: prioritize reliability for reversal
  const finalScore = clamp01(
    0.42 * prRes.parameter_reliability +
    0.28 * ic +
    0.30 * rrScore
  );

  const qualityTier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const setup = makeSetupBase({
    symbol,
    type: "reversal_sweep",
    side,
    tf,
    trigger: side === "long"
      ? "Down-sweep + reclaim → reversal long (confirmation close above reclaimed)"
      : "Up-sweep + reject → reversal short (confirmation close below reclaimed)",
    entryZone,
    entryPreferred,
    stop,
    tp1,
    tp2,
    anchors: {
      entry_anchor: "reclaimed_level",
      stop_anchor: "wick_extreme+atr_buffer",
      sweep: {
        side: sweep.side,
        reclaimed_level: reclaimed,
        wick_extreme: wick,
        confirm_close: confirmClose,
        ts: sweep.confirm_ts ?? sweep.sweep_ts ?? null,
      },
    },
    executionAnchors: {
      sweep: {
        ts: sweep.confirm_ts ?? sweep.sweep_ts ?? null,
        reclaimed_level: reclaimed,
        wick_extreme: wick,
        confirm_close: confirmClose,
        quality: {
          penetration,
          penetration_atr: penAtr,
          close_back_distance: nz(sweep?.quality?.close_back_distance, null),
        },
      },
    },
    signalMetrics: {
      regime: { label: reg.regime, composite: reg.composite, strength: reg.strength },
      orderflow: ofUsable ? { exchange: ofBest.exchange, score: ofAlign.score, confidence: ofBest.confidence } : null,
      derivatives: { penalty: derivPen, funding_labels: deriv?.funding_labels ?? null },
      liquidations: liqSig.usable ? { score: liqSig.score, intensity_15m: deriv?.liquidation_features?.intensity_15m ?? null } : null,
    },
    scores: {
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: ic,
      rr_tp1: rr1,
      rr_score: rrScore,
      deriv_penalty: derivPen,
      gates: { hard: { ok: true, reasons: [] } },
      final_score: finalScore,
      quality_tier: qualityTier,
    },
    parameterReliability: prRes.parameter_reliability,
    ideaConfidence: ic,
    finalScore,
    qualityTier,
    warnings: prRes.warnings,
    tradable: true,
  });

  return { setup, reg };
}

function buildBreakoutRetest({ snapshot, tf }) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const orderflow = snapshot?.unified?.features?.orderflow || {};
  const anchorLayer = snapshot?.unified?.anchor_layer;

  const tfFeat = tfFeatures?.[tf] || null;
  const aStruct = anchorLayer?.structure?.by_tf?.[tf] || null;
  const bos = aStruct?.bos_last || null;
  if (!bos || bos.kind !== "BOS" || !Number.isFinite(bos.price)) return null;

  const atr = nz(anchorLayer?.volatility?.atr?.[tf], nz(tfFeat?.last?.atr14, null));
  if (!(Number.isFinite(atr) && atr > 0)) return null;

  const side = bos.side === "bull" ? "long" : (bos.side === "bear" ? "short" : null);
  if (!side) return null;

  // Entry retest band around BOS level
  const lvl = bos.price;
  const band = 0.28 * atr;
  const entryZone = side === "long" ? [lvl - band, lvl + 0.10 * atr] : [lvl - 0.10 * atr, lvl + band];
  const entryPreferred = lvl;

  // Stop from structure opposite + ATR buffer
  const structStop = pickStopFromStructure(aStruct, side);
  const atrStop = side === "long" ? (entryPreferred - 1.25 * atr) : (entryPreferred + 1.25 * atr);
  let stop = null;
  if (Number.isFinite(structStop)) {
    stop = side === "long" ? Math.min(structStop, atrStop) : Math.max(structStop, atrStop);
  } else {
    stop = atrStop;
  }

  const swings_last = aStruct?.swings_last || [];
  const tp1 = pickOpposingSwingTarget(swings_last, side);

  let tp2 = null;
  if (Number.isFinite(tp1)) {
    const r1 = Math.abs(entryPreferred - stop);
    if (r1 > 0) tp2 = side === "long" ? Math.max(tp1, entryPreferred + 1.8 * r1) : Math.min(tp1, entryPreferred - 1.8 * r1);
  }

  const rr1 = rr(entryPreferred, stop, tp1);

  // Gates
  const g = hardGate({ type: "breakout_retest", atr, entry: entryPreferred, stop, rr1 });
  if (!g.ok) return null;

  // Context
  const reg = scoreRegime(tfFeatures);
  const { usable: ofUsable, best: ofBest } = pickBestOrderflow(orderflow);
  const ofAlign = orderflowAlignScore(ofBest, side);
  const liqSig = liquidationSignal(deriv, side);
  const derivPen = derivativesPenalty(deriv, side);

  // BOS freshness penalty via friction
  const nowTs = getNowTs(snapshot);
  const anchorTs = nz(bos.ts, null);
  let bosAgePenalty = 0;
  if (Number.isFinite(anchorTs)) {
    const ageH = (nowTs - anchorTs) / 3600000;
    if (ageH > 120) bosAgePenalty = 0.06;
    else if (ageH > 72) bosAgePenalty = 0.04;
  } else {
    bosAgePenalty = 0.03;
  }

  const friction = clamp(
    computeFrictionPenalty({ dataQuality: snapshot?.unified?.data_quality, overallScore: snapshot?.unified?.scores?.overall }) +
    bosAgePenalty,
    0,
    0.20
  );

  const prRes = computeParameterReliability({
    nowTs,
    anchorTs,
    atr,
    entry: entryPreferred,
    stop,
    tp1,
    rr1,
    hasStructure: Number.isFinite(structStop),
    hasTargets: Number.isFinite(tp1),
    frictionPenalty: friction,
  });

  const ic = computeSignalQuality({
    type: "breakout_retest",
    side,
    reg,
    tfFeat,
    ofAlign,
    liqSig,
    derivPenalty: derivPen,
  });

  const rrScore = rrToScore(rr1);

  const finalScore = clamp01(
    0.40 * prRes.parameter_reliability +
    0.25 * ic +
    0.35 * rrScore
  );

  const qualityTier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const setup = makeSetupBase({
    symbol,
    type: "breakout_retest",
    side,
    tf,
    trigger: side === "long"
      ? "BOS up → retest-hold at broken level → continuation long"
      : "BOS down → retest-reject at broken level → continuation short",
    entryZone,
    entryPreferred,
    stop,
    tp1,
    tp2,
    anchors: {
      bos: { kind: bos.kind, side: bos.side, price: lvl, ts: bos.ts ?? null },
      entry_anchor: "bos_level",
      stop_anchor: Number.isFinite(structStop) ? "structure+atr_buffer" : "atr_stop",
    },
    executionAnchors: {
      bos: { price: lvl, ts: bos.ts ?? null },
    },
    signalMetrics: {
      regime: { label: reg.regime, composite: reg.composite, strength: reg.strength },
      orderflow: ofUsable ? { exchange: ofBest.exchange, score: ofAlign.score, confidence: ofBest.confidence } : null,
      derivatives: { penalty: derivPen, funding_labels: deriv?.funding_labels ?? null },
      liquidations: liqSig.usable ? { score: liqSig.score, intensity_15m: deriv?.liquidation_features?.intensity_15m ?? null } : null,
    },
    scores: {
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: ic,
      rr_tp1: rr1,
      rr_score: rrScore,
      deriv_penalty: derivPen,
      gates: { hard: { ok: true, reasons: [] } },
      final_score: finalScore,
      quality_tier: qualityTier,
    },
    parameterReliability: prRes.parameter_reliability,
    ideaConfidence: ic,
    finalScore,
    qualityTier,
    warnings: prRes.warnings,
    tradable: true,
  });

  return { setup, reg };
}

function buildTrendPullback({ snapshot, tf }) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const orderflow = snapshot?.unified?.features?.orderflow || {};
  const anchorLayer = snapshot?.unified?.anchor_layer;

  const tfFeat = tfFeatures?.[tf] || null;
  if (!tfFeat?.last) return null;

  const atr = nz(anchorLayer?.volatility?.atr?.[tf], nz(tfFeat?.last?.atr14, null));
  if (!(Number.isFinite(atr) && atr > 0)) return null;

  // Direction from trend label on the same TF, but cross-check HTF regime.
  const trend = tfFeat?.labels?.trend;
  const side = trend === "bull" ? "long" : (trend === "bear" ? "short" : null);
  if (!side) return null;

  const e20 = nz(tfFeat?.last?.ema20, null);
  const e50 = nz(tfFeat?.last?.ema50, null);
  if (!Number.isFinite(e20) || !Number.isFinite(e50)) return null;

  const entryZone = [Math.min(e20, e50), Math.max(e20, e50)];
  const entryPreferred = (e20 + e50) / 2;

  const aStruct = anchorLayer?.structure?.by_tf?.[tf] || null;
  const structStop = pickStopFromStructure(aStruct, side);
  const atrStop = side === "long" ? (entryPreferred - 1.20 * atr) : (entryPreferred + 1.20 * atr);

  let stop = null;
  if (Number.isFinite(structStop)) {
    stop = side === "long" ? Math.min(structStop - 0.10 * atr, atrStop) : Math.max(structStop + 0.10 * atr, atrStop);
  } else {
    stop = atrStop;
  }

  const swings_last = aStruct?.swings_last || [];
  const tp1 = pickOpposingSwingTarget(swings_last, side);

  let tp2 = null;
  if (Number.isFinite(tp1)) {
    const r1 = Math.abs(entryPreferred - stop);
    if (r1 > 0) tp2 = side === "long" ? Math.max(tp1, entryPreferred + 2.0 * r1) : Math.min(tp1, entryPreferred - 2.0 * r1);
  }

  const rr1 = rr(entryPreferred, stop, tp1);

  const g = hardGate({ type: "trend_pullback", atr, entry: entryPreferred, stop, rr1 });
  if (!g.ok) return null;

  // Context
  const reg = scoreRegime(tfFeatures);

  // If HTF strongly conflicts, apply extra friction (do not delete setup; just score it down).
  const want = side === "long" ? 1 : -1;
  const htfConflict = (Number.isFinite(reg?.composite) && Math.abs(reg.composite) >= 0.55 && Math.sign(reg.composite) !== want);

  const { usable: ofUsable, best: ofBest } = pickBestOrderflow(orderflow);
  const ofAlign = orderflowAlignScore(ofBest, side);
  const liqSig = liquidationSignal(deriv, side);
  const derivPen = derivativesPenalty(deriv, side);

  const frictionBase = computeFrictionPenalty({ dataQuality: snapshot?.unified?.data_quality, overallScore: snapshot?.unified?.scores?.overall });
  const friction = clamp(frictionBase + (htfConflict ? 0.08 : 0), 0, 0.20);

  const nowTs = getNowTs(snapshot);
  const anchorTs = nz(aStruct?.swing_last?.ts, null);

  const prRes = computeParameterReliability({
    nowTs,
    anchorTs,
    atr,
    entry: entryPreferred,
    stop,
    tp1,
    rr1,
    hasStructure: Number.isFinite(structStop),
    hasTargets: Number.isFinite(tp1),
    frictionPenalty: friction,
  });

  const ic = computeSignalQuality({
    type: "trend_pullback",
    side,
    reg,
    tfFeat,
    ofAlign,
    liqSig,
    derivPenalty: derivPen,
  });

  const rrScore = rrToScore(rr1);

  const finalScore = clamp01(
    0.45 * prRes.parameter_reliability +
    0.30 * ic +
    0.25 * rrScore
  );

  const qualityTier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const setup = makeSetupBase({
    symbol,
    type: "trend_pullback",
    side,
    tf,
    trigger: side === "long"
      ? "Bull trend (EMA stack) → pullback into EMA20–EMA50 band → continuation long"
      : "Bear trend (EMA stack) → pullback into EMA20–EMA50 band → continuation short",
    entryZone,
    entryPreferred,
    stop,
    tp1,
    tp2,
    anchors: {
      ema_band: { ema20: e20, ema50: e50, tf },
      entry_anchor: "ema20_ema50_band",
      stop_anchor: Number.isFinite(structStop) ? "swing+atr_buffer" : "atr_stop",
    },
    executionAnchors: {
      ema_band: { ema20: e20, ema50: e50, tf },
    },
    signalMetrics: {
      regime: { label: reg.regime, composite: reg.composite, strength: reg.strength },
      htf_conflict: htfConflict,
      orderflow: ofUsable ? { exchange: ofBest.exchange, score: ofAlign.score, confidence: ofBest.confidence } : null,
      derivatives: { penalty: derivPen, funding_labels: deriv?.funding_labels ?? null },
      liquidations: liqSig.usable ? { score: liqSig.score, intensity_15m: deriv?.liquidation_features?.intensity_15m ?? null } : null,
    },
    scores: {
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: ic,
      rr_tp1: rr1,
      rr_score: rrScore,
      deriv_penalty: derivPen,
      gates: { hard: { ok: true, reasons: [] } },
      final_score: finalScore,
      quality_tier: qualityTier,
    },
    parameterReliability: prRes.parameter_reliability,
    ideaConfidence: ic,
    finalScore,
    qualityTier,
    warnings: prRes.warnings.concat(htfConflict ? ["htf_conflict"] : []),
    tradable: true,
  });

  return { setup, reg };
}

function buildRangeMeanReversion({ snapshot, tf }) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const orderflow = snapshot?.unified?.features?.orderflow || {};
  const anchorLayer = snapshot?.unified?.anchor_layer;

  const tfFeat = tfFeatures?.[tf] || null;
  const aStruct = anchorLayer?.structure?.by_tf?.[tf] || null;
  if (!tfFeat?.last || !aStruct) return null;

  const reg = scoreRegime(tfFeatures);
  if (reg.regime !== "range") return null; // only in range

  const atr = nz(anchorLayer?.volatility?.atr?.[tf], nz(tfFeat?.last?.atr14, null));
  if (!(Number.isFinite(atr) && atr > 0)) return null;

  const rsi = nz(tfFeat?.last?.rsi14, null);
  if (!Number.isFinite(rsi)) return null;

  // Mean reversion side from RSI extremes
  let side = null;
  if (rsi <= 34) side = "long";
  if (rsi >= 66) side = "short";
  if (!side) return null;

  // Entry at last swing extreme with ATR band
  const swing = aStruct?.swing_last;
  if (!swing || !Number.isFinite(swing.price)) return null;

  // For long MR: want swing_low; for short MR: want swing_high
  if (side === "long" && swing.type !== "low") return null;
  if (side === "short" && swing.type !== "high") return null;

  const px = swing.price;
  const band = 0.25 * atr;
  const entryZone = side === "long" ? [px - band, px + 0.10 * atr] : [px - 0.10 * atr, px + band];
  const entryPreferred = px;

  // Stop beyond swing with buffer
  const stopBuf = 0.20 * atr;
  const stop = side === "long" ? (px - stopBuf) : (px + stopBuf);

  const swings_last = aStruct?.swings_last || [];
  const tp1 = pickOpposingSwingTarget(swings_last, side);

  let tp2 = null;
  if (Number.isFinite(tp1)) {
    const r1 = Math.abs(entryPreferred - stop);
    if (r1 > 0) tp2 = side === "long" ? Math.max(tp1, entryPreferred + 1.4 * r1) : Math.min(tp1, entryPreferred - 1.4 * r1);
  }

  const rr1 = rr(entryPreferred, stop, tp1);
  const g = hardGate({ type: "range_mean_reversion", atr, entry: entryPreferred, stop, rr1 });
  if (!g.ok) return null;

  const { usable: ofUsable, best: ofBest } = pickBestOrderflow(orderflow);
  const ofAlign = orderflowAlignScore(ofBest, side);
  const liqSig = liquidationSignal(deriv, side);
  const derivPen = derivativesPenalty(deriv, side);

  const friction = computeFrictionPenalty({ dataQuality: snapshot?.unified?.data_quality, overallScore: snapshot?.unified?.scores?.overall });

  const nowTs = getNowTs(snapshot);
  const anchorTs = nz(swing.ts, null);

  const prRes = computeParameterReliability({
    nowTs,
    anchorTs,
    atr,
    entry: entryPreferred,
    stop,
    tp1,
    rr1,
    hasStructure: true,
    hasTargets: Number.isFinite(tp1),
    frictionPenalty: friction,
  });

  const ic = computeSignalQuality({
    type: "range_mean_reversion",
    side,
    reg,
    tfFeat,
    ofAlign,
    liqSig,
    derivPenalty: derivPen,
  });

  const rrScore = rrToScore(rr1);

  const finalScore = clamp01(
    0.48 * prRes.parameter_reliability +
    0.22 * ic +
    0.30 * rrScore
  );

  const qualityTier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const setup = makeSetupBase({
    symbol,
    type: "range_mean_reversion",
    side,
    tf,
    trigger: side === "long"
      ? "Range regime → RSI oversold near swing low → mean reversion long"
      : "Range regime → RSI overbought near swing high → mean reversion short",
    entryZone,
    entryPreferred,
    stop,
    tp1,
    tp2,
    anchors: {
      swing: { type: swing.type, price: px, ts: swing.ts ?? null },
      entry_anchor: "swing_extreme",
      stop_anchor: "swing_extreme+atr_buffer",
    },
    executionAnchors: {
      swing: { type: swing.type, price: px, ts: swing.ts ?? null },
    },
    signalMetrics: {
      regime: { label: reg.regime, composite: reg.composite, strength: reg.strength },
      rsi14: rsi,
      orderflow: ofUsable ? { exchange: ofBest.exchange, score: ofAlign.score, confidence: ofBest.confidence } : null,
      derivatives: { penalty: derivPen, funding_labels: deriv?.funding_labels ?? null },
      liquidations: liqSig.usable ? { score: liqSig.score, intensity_15m: deriv?.liquidation_features?.intensity_15m ?? null } : null,
    },
    scores: {
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: ic,
      rr_tp1: rr1,
      rr_score: rrScore,
      deriv_penalty: derivPen,
      gates: { hard: { ok: true, reasons: [] } },
      final_score: finalScore,
      quality_tier: qualityTier,
    },
    parameterReliability: prRes.parameter_reliability,
    ideaConfidence: ic,
    finalScore,
    qualityTier,
    warnings: prRes.warnings,
    tradable: true,
  });

  return { setup, reg };
}

// -------------------------
// Public API
// -------------------------
export function buildSetupsV3(snapshot, opts = {}) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
  const anchorLayer = snapshot?.unified?.anchor_layer;
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};

  if (!anchorLayer) {
    return {
      version: "3.0",
      symbol,
      regime: null,
      primary: null,
      alternative: null,
      top_candidates: [],
      notes: ["anchor_layer_missing"],
    };
  }

  const preferTf = s(opts.prefer_tf || "60");
  const tfUniverse = ["15", "60", "240", "D"];

  // Ensure preferTf comes first if valid.
  const tfs = Array.from(new Set([preferTf, ...tfUniverse])).filter((tf) => anchorLayer?.structure?.by_tf?.[tf]);

  const candidates = [];
  let regOut = null;

  for (const tf of tfs) {
    // Priority: sweep reversal (if present), breakout retest, trend pullback, then range MR.
    const rs = buildReversalSweep({ snapshot, tf });
    if (rs?.setup) { candidates.push(rs.setup); regOut = regOut || rs.reg || scoreRegime(tfFeatures); }

    const bo = buildBreakoutRetest({ snapshot, tf });
    if (bo?.setup) { candidates.push(bo.setup); regOut = regOut || bo.reg || scoreRegime(tfFeatures); }

    const tp = buildTrendPullback({ snapshot, tf });
    if (tp?.setup) { candidates.push(tp.setup); regOut = regOut || tp.reg || scoreRegime(tfFeatures); }

    const mr = buildRangeMeanReversion({ snapshot, tf });
    if (mr?.setup) { candidates.push(mr.setup); regOut = regOut || mr.reg || scoreRegime(tfFeatures); }
  }

  // Attach execution_state using reference price
  const refPx = getRefPx(snapshot, s(opts.prefer_exchange || "bybit"));
  for (let i = 0; i < candidates.length; i++) {
    candidates[i].execution_state = buildExecutionState(candidates[i], snapshot, refPx);
  }

  // Tradability filter: must pass hard-gate already, plus final_score floor
  const tradable = candidates
    .filter((x) => x && x.tradable === true)
    .filter((x) => Number.isFinite(x.final_score) && x.final_score >= nz(opts.min_score, 0.55));

  // Ranking
  tradable.sort((a, b) => {
    const fa = nz(a.final_score, 0);
    const fb = nz(b.final_score, 0);
    if (fb !== fa) return fb - fa;

    const pa = nz(a.parameter_reliability, 0);
    const pb = nz(b.parameter_reliability, 0);
    if (pb !== pa) return pb - pa;

    const ra = nz(a?.execution_metrics?.rr_tp1, nz(a?.r_multiple?.tp1, 0));
    const rb = nz(b?.execution_metrics?.rr_tp1, nz(b?.r_multiple?.tp1, 0));
    return rb - ra;
  });

  const primary = tradable[0] || null;

  // Alternative: prefer different type; else different bias.
  let alternative = null;
  if (primary) {
    for (let i = 1; i < tradable.length; i++) {
      if (tradable[i]?.type && tradable[i].type !== primary.type) { alternative = tradable[i]; break; }
    }
    if (!alternative) {
      for (let i = 1; i < tradable.length; i++) {
        if (tradable[i]?.bias && tradable[i].bias !== primary.bias) { alternative = tradable[i]; break; }
      }
    }
  }
  if (!alternative) alternative = tradable[1] || null;

  const notes = [];
  if (!primary) notes.push("no_tradable_setups");
  if (!Number.isFinite(refPx)) notes.push("ref_price_missing");

  return {
    version: "3.0",
    symbol,
    regime: regOut
      ? { label: regOut.regime, composite: regOut.composite, strength: regOut.strength, per_tf: regOut.dirs }
      : scoreRegime(tfFeatures),
    ref_px: refPx,
    primary,
    alternative,
    top_candidates: tradable.slice(0, 8),
    notes,
  };
}
