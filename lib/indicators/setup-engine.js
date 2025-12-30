// lib/indicators/setup-engine.js

function clamp(x, a, b) {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}
function last(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}
function nz(x, d = null) {
  return Number.isFinite(x) ? x : d;
}
function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (a - b) / b;
}

function pickTf(tfMap, tfKey) {
  return tfMap?.[tfKey]?.last ? tfMap[tfKey] : null;
}

function inferDirectionFromTrendLabel(label) {
  if (label === "bull") return 1;
  if (label === "bear") return -1;
  return 0; // range/unknown
}

function scoreRegime(tfFeatures) {
  // tfFeatures: { "15":{labels,last}, "60":..., "240":..., "D":... }
  const t15 = pickTf(tfFeatures, "15");
  const t60 = pickTf(tfFeatures, "60");
  const t240 = pickTf(tfFeatures, "240");
  const tD = pickTf(tfFeatures, "D");

  const d15 = inferDirectionFromTrendLabel(t15?.labels?.trend);
  const d60 = inferDirectionFromTrendLabel(t60?.labels?.trend);
  const d240 = inferDirectionFromTrendLabel(t240?.labels?.trend);
  const dD = inferDirectionFromTrendLabel(tD?.labels?.trend);

  // Weighted HTF
  const composite = 0.15 * d15 + 0.30 * d60 + 0.35 * d240 + 0.20 * dD;

  const strength = Math.abs(composite);

  let regime = "range";
  if (strength >= 0.55) regime = composite > 0 ? "bull" : "bear";
  else if (strength >= 0.30) regime = composite > 0 ? "bull_weak" : "bear_weak";

  return { regime, composite, strength, dirs: { d15, d60, d240, dD } };
}

function levelFromStructure(structure, side) {
  // side: "long" => use last swing low / bos level; "short" => last swing high / bos level
  const swings = structure?.swings_last || [];
  const bosLast = structure?.bos_last || null;

  // Prefer BOS level if aligned
  if (bosLast?.type === "BOS_UP" && side === "long" && Number.isFinite(bosLast.level)) return bosLast.level;
  if (bosLast?.type === "BOS_DOWN" && side === "short" && Number.isFinite(bosLast.level)) return bosLast.level;

  // Else use nearest recent swing
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i];
    if (side === "long" && s.type === "low" && Number.isFinite(s.price)) return s.price;
    if (side === "short" && s.type === "high" && Number.isFinite(s.price)) return s.price;
  }
  return null;
}

function computeRR(entry, stop, target) {
  if (![entry, stop, target].every(Number.isFinite)) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return null;
  return reward / risk;
}

function buildTargets(entry, stop, side) {
  // TP1=1R, TP2=2R, Runner open
  if (![entry, stop].every(Number.isFinite)) return null;
  const r = Math.abs(entry - stop);
  if (r <= 0) return null;

  const tp1 = side === "long" ? entry + r : entry - r;
  const tp2 = side === "long" ? entry + 2 * r : entry - 2 * r;

  return { tp1, tp2, runner: null };
}

function orderflowAlignment(orderflow, side) {
  const of = orderflow || {};
  // Use best exchange signal (max confidence already in your unified orderflow block)
  // We accept: book_imbalance (-1..1), delta_notional (+ buy pressure)
  const bi = nz(of.book_imbalance, null);
  const dn = nz(of.delta_notional, null);

  let score = 0.0;
  let usable = false;

  if (Number.isFinite(bi)) {
    usable = true;
    // For long: want positive imbalance; short: negative
    score += (side === "long" ? bi : -bi) * 0.6;
  }
  if (Number.isFinite(dn)) {
    usable = true;
    // Normalize delta direction only (magnitude varies)
    score += (side === "long" ? Math.sign(dn) : -Math.sign(dn)) * 0.4;
  }
  return { usable, score: clamp((score + 1) / 2, 0, 1) }; // 0..1
}

function derivativesPenalty(derivSynth, fundingLabels, side) {
  // Penalize when leverage regime suggests squeeziness against the direction.
  // Keep it soft (do not eliminate setups).
  let penalty = 0;

  const lev = derivSynth?.leverage_regime || "neutral";
  if (lev === "risk_on") {
    // can be crowded
    // If going long with strong risk_on + positive extreme funding -> mild penalty; if short -> mild bonus
    const posExtreme =
      fundingLabels?.bybit === "positive_extreme" ||
      fundingLabels?.binance === "positive_extreme" ||
      fundingLabels?.okx === "positive_extreme";
    if (posExtreme && side === "long") penalty += 0.10;
    if (posExtreme && side === "short") penalty -= 0.05;
  }
  if (lev === "risk_off") {
    const negExtreme =
      fundingLabels?.bybit === "negative_extreme" ||
      fundingLabels?.binance === "negative_extreme" ||
      fundingLabels?.okx === "negative_extreme";
    if (negExtreme && side === "short") penalty += 0.10;
    if (negExtreme && side === "long") penalty -= 0.05;
  }

  // Divergence suggests friction; small penalty (both sides)
  const fd = nz(derivSynth?.funding_divergence, 0);
  const pd = nz(derivSynth?.premium_divergence, 0);
  penalty += clamp(fd * 50, 0, 0.08); // scale heuristic
  penalty += clamp(pd * 20, 0, 0.06);

  return clamp(penalty, -0.10, 0.25);
}

function liquidationSignal(liqFeat, side) {
  // liqFeat: {observed, bias, intensity_15m}
  // Only meaningful if observed; else neutral
  if (!liqFeat?.observed) return { usable: false, score: 0.5 };

  const inten = nz(liqFeat.intensity_15m, null);
  const bias = nz(liqFeat.bias, null);

  // intensity -> strength
  let strength = 0.5;
  if (Number.isFinite(inten)) {
    if (inten > 0.15) strength = 0.85;
    else if (inten > 0.05) strength = 0.70;
    else strength = 0.60;
  }

  // bias: positive means more SHORT liquidation (potential bullish reversal); negative means more LONG liquidation
  let directionEdge = 0.5;
  if (Number.isFinite(bias)) {
    if (side === "long") directionEdge = clamp(0.5 + 0.5 * bias, 0, 1);
    else directionEdge = clamp(0.5 - 0.5 * bias, 0, 1);
  }

  return { usable: true, score: clamp(0.5 * strength + 0.5 * directionEdge, 0, 1) };
}

function computeEntryStopFromEMA(tf, side) {
  // Use 15m TF for timing by default
  const l = tf?.last || {};
  const close = nz(l.close ?? null, null); // may not exist
  // In your tfFeatures.last: { ema20, ema50, ema100, ema200, atr14, ... }
  // We use "ema20/ema50" entry zone.
  const ema20 = nz(l.ema20, null);
  const ema50 = nz(l.ema50, null);
  const atr14 = nz(l.atr14, null);

  // entry zone around ema20/ema50 midpoint if available
  let entry = null;
  let zone = null;

  if (Number.isFinite(ema20) && Number.isFinite(ema50)) {
    entry = (ema20 + ema50) / 2;
    zone = side === "long" ? [Math.min(ema20, ema50), Math.max(ema20, ema50)] : [Math.min(ema20, ema50), Math.max(ema20, ema50)];
  } else if (Number.isFinite(ema20)) {
    entry = ema20;
    zone = [ema20, ema20];
  } else if (Number.isFinite(close)) {
    entry = close;
    zone = [close, close];
  }

  // stop distance baseline
  const atrStop = Number.isFinite(atr14) ? (side === "long" ? entry - 1.2 * atr14 : entry + 1.2 * atr14) : null;

  return { entry, zone, atrStop, atr14 };
}

function computeStop(entry, structureLevel, atrStop, side) {
  // stop = max(structure invalidation, atr-based) with correct side semantics
  // For long: stop below; choose the LOWER (more conservative) between structureLevel and atrStop?
  // Actually "max(structure_invalidation, 1.2*ATR)" means pick the one farther (wider stop) to avoid noise.
  // For long: farther stop is the smaller price; for short: farther stop is the larger price.
  if (!Number.isFinite(entry)) return null;

  const candidates = [];
  if (Number.isFinite(structureLevel)) candidates.push(structureLevel);
  if (Number.isFinite(atrStop)) candidates.push(atrStop);

  if (!candidates.length) return null;

  if (side === "long") return Math.min(...candidates);
  return Math.max(...candidates);
}

function makeSetup({
  symbol,
  type,
  side,
  trigger,
  entryZone,
  entry,
  stop,
  targets,
  rationale,
  baseConfidence,
  modifiers,
}) {
  const tp1 = targets?.tp1 ?? null;
  const rr1 = computeRR(entry, stop, tp1);

  // Combine confidence
  let conf = baseConfidence;
  for (const m of modifiers || []) conf += m;
  conf = clamp(conf, 0, 1);

  return {
    symbol,
    type, // "trend_continuation" | "breakout" | "mean_reversion" | "reversal_sweep"
    bias: side === "long" ? "Long" : "Short",
    trigger,
    entry_zone: entryZone,
    entry,
    invalidation: stop,
    stop,
    targets: targets
      ? {
          tp1: targets.tp1,
          tp2: targets.tp2,
          runner: targets.runner,
        }
      : null,
    rr_estimate_tp1: rr1,
    confidence: conf,
    rationale: rationale || [],
    notes: [],
  };
}

/**
 * Build Setup Engine v1:
 * - Generates multiple candidates for both directions and ranks them.
 * - Never eliminates a scenario outright; it scores them.
 */
export function buildSetupsV1(snapshot) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";

  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const structure = snapshot?.unified?.features?.structure || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const derivSynth = deriv?.derivatives_synthesis || {};
  const fundingLabels = deriv?.funding_labels || {};
  const liqFeat = deriv?.liquidation_features || {};

  const orderflow = snapshot?.unified?.features?.orderflow || {};
  // Use best exchange orderflow (highest confidence)
  const ofCandidates = [
    { ex: "bybit", ...orderflow.bybit },
    { ex: "binance", ...orderflow.binance },
    { ex: "okx", ...orderflow.okx },
  ].filter(x => Number.isFinite(x.confidence));
  ofCandidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const ofBest = ofCandidates[0] || null;

  const scores = snapshot?.unified?.scores || {};
  const baseOverall = clamp(nz(scores.overall, 0.5), 0, 1);

  // Regime scoring
  const reg = scoreRegime(tfFeatures);

  // Entry TF = 15m (timing), confirm TF = 60m, HTF = 240m/D
  const tf15 = pickTf(tfFeatures, "15");
  const tf60 = pickTf(tfFeatures, "60");
  const tf240 = pickTf(tfFeatures, "240");
  const tfD = pickTf(tfFeatures, "D");

  const candidates = [];

  function genForSide(side) {
    const dir = side === "long" ? 1 : -1;

    // Indicators alignment
    const t15Trend = inferDirectionFromTrendLabel(tf15?.labels?.trend);
    const t60Trend = inferDirectionFromTrendLabel(tf60?.labels?.trend);
    const t240Trend = inferDirectionFromTrendLabel(tf240?.labels?.trend);
    const emaStack15 = tf15?.labels?.ema_stack || "unknown";
    const rsiBias15 = tf15?.labels?.rsi_bias || "unknown";

    // Entry/stop baseline
    const { entry, zone, atrStop, atr14 } = computeEntryStopFromEMA(tf15, side);
    const structLevel = levelFromStructure(structure, side);
    const stop = computeStop(entry, structLevel, atrStop, side);
    const targets = buildTargets(entry, stop, side);

    // If core prices missing, still create candidate but with low confidence
    const coreOk = Number.isFinite(entry) && Number.isFinite(stop);

    // Orderflow alignment
    const ofAlign = orderflowAlignment(ofBest || {}, side);

    // Derivatives penalty (soft)
    const derivPen = derivativesPenalty(derivSynth, fundingLabels, side);

    // Liquidation signal
    const liqSig = liquidationSignal(liqFeat, side);

    // Structure context
    const bosLast = structure?.bos_last || null;
    const grab = structure?.liquidity_grab || null;

    // --- Candidate types ---

    // 1) Trend continuation (pullback to EMA zone, align with HTF)
    {
      const rationale = [];
      let modifier = 0;

      // Alignment scoring
      const align = 0.25 * t15Trend + 0.35 * t60Trend + 0.40 * t240Trend; // -1..1 approx
      const alignScore = clamp((dir * align + 1) / 2, 0, 1);

      rationale.push(`Regime: ${reg.regime} (composite=${reg.composite.toFixed(3)})`);
      if (emaStack15 !== "unknown") rationale.push(`15m EMA stack: ${emaStack15}`);
      if (rsiBias15 !== "unknown") rationale.push(`15m RSI bias: ${rsiBias15}`);
      if (Number.isFinite(structLevel)) rationale.push(`Structure level: ${structLevel}`);

      // Trigger
      const trigger = side === "long"
        ? "Pullback into EMA(20/50) zone on 15m, then bullish reclaim / continuation"
        : "Pullback into EMA(20/50) zone on 15m, then bearish reject / continuation";

      // Confidence mods
      modifier += 0.18 * (alignScore - 0.5);
      if (ofAlign.usable) modifier += 0.12 * (ofAlign.score - 0.5);
      if (liqSig.usable) modifier += 0.06 * (liqSig.score - 0.5);
      modifier -= derivPen;

      // MACD confirmation (optional)
      const macdHist = nz(tf15?.last?.macd_hist, null);
      if (Number.isFinite(macdHist)) {
        const macdOk = side === "long" ? macdHist > 0 : macdHist < 0;
        modifier += macdOk ? 0.03 : -0.03;
        rationale.push(`15m MACD hist: ${macdHist.toFixed(4)}`);
      }

      // BOS context
      if (bosLast?.type) rationale.push(`Last BOS: ${bosLast.type}`);

      // ATR info
      if (Number.isFinite(atr14)) rationale.push(`15m ATR14: ${atr14}`);

      const setup = makeSetup({
        symbol,
        type: "trend_continuation",
        side,
        trigger,
        entryZone: zone,
        entry,
        stop,
        targets,
        rationale,
        baseConfidence: baseOverall,
        modifiers: [
          coreOk ? 0 : -0.25,
          modifier,
        ],
      });

      candidates.push(setup);
    }

    // 2) Breakout (range/high-low)
    {
      const rationale = [];
      let modifier = 0;

      const trigger = side === "long"
        ? "Break and close above recent structure high (60m), then retest-hold"
        : "Break and close below recent structure low (60m), then retest-reject";

      // Use swings to estimate breakout level
      const swingLevel = levelFromStructure(structure, side === "long" ? "short" : "long"); // opposite swing as breakout boundary
      // For long breakout: use last swing high; for short breakout: last swing low
      const breakoutLevel = swingLevel;

      // entry at breakout level + small buffer (ATR-based)
      const buffer = Number.isFinite(tf15?.last?.atr14) ? 0.25 * tf15.last.atr14 : 0;
      const entryB = Number.isFinite(breakoutLevel)
        ? (side === "long" ? breakoutLevel + buffer : breakoutLevel - buffer)
        : entry;

      const stopB = computeStop(entryB, structLevel, atrStop, side);
      const targetsB = buildTargets(entryB, stopB, side);

      rationale.push(`Regime: ${reg.regime}`);
      if (Number.isFinite(breakoutLevel)) rationale.push(`Breakout level: ${breakoutLevel}`);
      if (ofAlign.usable) rationale.push(`Orderflow align score: ${ofAlign.score.toFixed(2)}`);

      // Modifiers: breakout works better when regime not opposite
      const dirCompat = clamp((dir * reg.composite + 1) / 2, 0, 1);
      modifier += 0.14 * (dirCompat - 0.5);
      if (ofAlign.usable) modifier += 0.15 * (ofAlign.score - 0.5);
      modifier -= derivPen * 0.8;

      const setup = makeSetup({
        symbol,
        type: "breakout",
        side,
        trigger,
        entryZone: Number.isFinite(breakoutLevel) ? [breakoutLevel, entryB] : zone,
        entry: entryB,
        stop: stopB,
        targets: targetsB,
        rationale,
        baseConfidence: baseOverall,
        modifiers: [
          (Number.isFinite(entryB) && Number.isFinite(stopB)) ? 0 : -0.25,
          modifier,
        ],
      });

      candidates.push(setup);
    }

    // 3) Mean reversion (range) — always included
    {
      const rationale = [];
      let modifier = 0;

      const trigger = side === "long"
        ? "Range support hold (15m/60m) + momentum stabilizes (RSI recovers) → mean reversion to mid/upper"
        : "Range resistance hold (15m/60m) + momentum fades (RSI rolls) → mean reversion to mid/lower";

      // Mean reversion prefers range regime
      const rangeAffinity = reg.regime === "range" ? 0.8 : 0.4;
      modifier += 0.12 * (rangeAffinity - 0.5);

      // RSI condition
      const rsi = nz(tf15?.last?.rsi14, null);
      if (Number.isFinite(rsi)) {
        const rsiOk = side === "long" ? rsi <= 45 : rsi >= 55;
        modifier += rsiOk ? 0.05 : -0.03;
        rationale.push(`15m RSI14: ${rsi.toFixed(1)}`);
      }

      // Penalize if strong trend against mean reversion
      modifier -= 0.10 * clamp(Math.abs(reg.composite), 0, 1);

      const setup = makeSetup({
        symbol,
        type: "mean_reversion",
        side,
        trigger,
        entryZone: zone,
        entry,
        stop,
        targets,
        rationale,
        baseConfidence: baseOverall,
        modifiers: [
          coreOk ? 0 : -0.25,
          modifier,
        ],
      });

      candidates.push(setup);
    }

    // 4) Reversal after sweep (liquidity grab) — only if grab exists, but still “cover” by scoring low if absent
    {
      const rationale = [];
      let modifier = 0;

      const hasGrab = !!grab?.type;

      const trigger = side === "long"
        ? "Bearish liquidity sweep down then reclaim (close back above swing) → reversal long confirmation"
        : "Bullish liquidity sweep up then reject (close back below swing) → reversal short confirmation";

      // If no grab, keep candidate but lower
      modifier += hasGrab ? 0.12 : -0.18;

      // Liquidation observed boosts reversal probability
      if (liqSig.usable) modifier += 0.10 * (liqSig.score - 0.5);

      // Derivatives: crowded leverage can fuel reversal squeezes (soft)
      if (derivSynth?.leverage_regime === "risk_on" && side === "short") modifier += 0.04;
      if (derivSynth?.leverage_regime === "risk_off" && side === "long") modifier += 0.04;

      if (hasGrab) rationale.push(`Liquidity grab: ${grab.type} at swing ${grab.swing}`);

      const setup = makeSetup({
        symbol,
        type: "reversal_sweep",
        side,
        trigger,
        entryZone: zone,
        entry,
        stop,
        targets,
        rationale,
        baseConfidence: baseOverall,
        modifiers: [
          coreOk ? 0 : -0.25,
          modifier,
        ],
      });

      candidates.push(setup);
    }
  }

  // Generate both sides
  genForSide("long");
  genForSide("short");

  // Rank candidates
  // Primary objective: confidence, then RR estimate
  candidates.sort((a, b) => {
    const ca = nz(a.confidence, 0);
    const cb = nz(b.confidence, 0);
    if (cb !== ca) return cb - ca;

    const ra = nz(a.rr_estimate_tp1, 0);
    const rb = nz(b.rr_estimate_tp1, 0);
    return rb - ra;
  });

  // Pick Primary and Alternative ensuring they are not identical type+direction
  const primary = candidates[0] || null;
  let alternative = null;

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (!primary) { alternative = c; break; }
    if (c.bias !== primary.bias || c.type !== primary.type) { alternative = c; break; }
  }
  if (!alternative) alternative = candidates[1] || null;

  // Provide extra: top candidates list (optional for debugging)
  const top = candidates.slice(0, 6);

  return {
    regime: {
      label: reg.regime,
      composite: reg.composite,
      strength: reg.strength,
      per_tf: reg.dirs,
    },
    primary,
    alternative,
    top_candidates: top,
  };
}
