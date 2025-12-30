// lib/indicators/setup-engine.js
// Setup Engine v1.2 (merged, drop-in)
// Upgrades vs v1.1:
// 1) EvidenceStrong gating tightened (requires HTF compatibility + orderflow confirmation when available)
// 2) Confidence caps lowered (default cap 0.85, strong-evidence cap 0.92) to avoid overconfidence
// 3) Adds structural target + rr_estimate_structural for meaningful ranking beyond fixed 1R TP1
// 4) Candidate ranking uses confidence, then rr_structural (fallback rr_tp1)

function clamp(x, a, b) {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}
function nz(x, d = null) {
  return Number.isFinite(x) ? x : d;
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
  const t15 = pickTf(tfFeatures, "15");
  const t60 = pickTf(tfFeatures, "60");
  const t240 = pickTf(tfFeatures, "240");
  const tD = pickTf(tfFeatures, "D");

  const d15 = inferDirectionFromTrendLabel(t15?.labels?.trend);
  const d60 = inferDirectionFromTrendLabel(t60?.labels?.trend);
  const d240 = inferDirectionFromTrendLabel(t240?.labels?.trend);
  const dD = inferDirectionFromTrendLabel(tD?.labels?.trend);

  const composite = 0.15 * d15 + 0.30 * d60 + 0.35 * d240 + 0.20 * dD;
  const strength = Math.abs(composite);

  let regime = "range";
  if (strength >= 0.55) regime = composite > 0 ? "bull" : "bear";
  else if (strength >= 0.30) regime = composite > 0 ? "bull_weak" : "bear_weak";

  return { regime, composite, strength, dirs: { d15, d60, d240, dD } };
}

function levelFromStructure(structure, side) {
  const swings = structure?.swings_last || [];
  const bosLast = structure?.bos_last || null;

  if (bosLast?.type === "BOS_UP" && side === "long" && Number.isFinite(bosLast.level)) return bosLast.level;
  if (bosLast?.type === "BOS_DOWN" && side === "short" && Number.isFinite(bosLast.level)) return bosLast.level;

  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i];
    if (side === "long" && s.type === "low" && Number.isFinite(s.price)) return s.price;
    if (side === "short" && s.type === "high" && Number.isFinite(s.price)) return s.price;
  }
  return null;
}

function structuralTarget(structure, side) {
  // For long: target swing high. For short: target swing low.
  const swings = structure?.swings_last || [];
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i];
    if (side === "long" && s.type === "high" && Number.isFinite(s.price)) return s.price;
    if (side === "short" && s.type === "low" && Number.isFinite(s.price)) return s.price;
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
  if (![entry, stop].every(Number.isFinite)) return null;
  const r = Math.abs(entry - stop);
  if (r <= 0) return null;

  const tp1 = side === "long" ? entry + r : entry - r;
  const tp2 = side === "long" ? entry + 2 * r : entry - 2 * r;

  return { tp1, tp2, runner: null };
}

function orderflowAlignment(ofBest, side) {
  const bi = nz(ofBest?.book_imbalance, null); // -1..1
  const dn = nz(ofBest?.delta_notional, null); // sign indicates aggressor imbalance
  let score = 0.0;
  let usable = false;

  if (Number.isFinite(bi)) {
    usable = true;
    score += (side === "long" ? bi : -bi) * 0.6;
  }
  if (Number.isFinite(dn)) {
    usable = true;
    score += (side === "long" ? Math.sign(dn) : -Math.sign(dn)) * 0.4;
  }
  return { usable, score: clamp((score + 1) / 2, 0, 1) }; // 0..1
}

function derivativesPenalty(derivSynth, fundingLabels, side) {
  let penalty = 0;

  const lev = derivSynth?.leverage_regime || "neutral";

  if (lev === "risk_on") {
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

  const fd = nz(derivSynth?.funding_divergence, 0);
  const pd = nz(derivSynth?.premium_divergence, 0);
  penalty += clamp(fd * 50, 0, 0.08);
  penalty += clamp(pd * 20, 0, 0.06);

  return clamp(penalty, -0.10, 0.25);
}

function liquidationSignal(liqFeat, side) {
  if (!liqFeat?.observed) return { usable: false, score: 0.5 };

  const inten = nz(liqFeat.intensity_15m, null);
  const bias = nz(liqFeat.bias, null);

  let strength = 0.5;
  if (Number.isFinite(inten)) {
    if (inten > 0.15) strength = 0.85;
    else if (inten > 0.05) strength = 0.70;
    else strength = 0.60;
  } else {
    strength = 0.60;
  }

  // bias>0 => more SHORT liquidation => bullish edge
  let directionEdge = 0.5;
  if (Number.isFinite(bias)) {
    if (side === "long") directionEdge = clamp(0.5 + 0.5 * bias, 0, 1);
    else directionEdge = clamp(0.5 - 0.5 * bias, 0, 1);
  }

  return { usable: true, score: clamp(0.5 * strength + 0.5 * directionEdge, 0, 1) };
}

function computeEntryStopFromEMA(tf, side) {
  const l = tf?.last || {};
  const close = nz(l.close ?? null, null); // optional if snapshot includes it
  const ema20 = nz(l.ema20, null);
  const ema50 = nz(l.ema50, null);
  const atr14 = nz(l.atr14, null);

  let entry = null;
  let zone = null;

  if (Number.isFinite(ema20) && Number.isFinite(ema50)) {
    entry = (ema20 + ema50) / 2;
    zone = [Math.min(ema20, ema50), Math.max(ema20, ema50)];
  } else if (Number.isFinite(ema20)) {
    entry = ema20;
    zone = [ema20, ema20];
  } else if (Number.isFinite(close)) {
    entry = close;
    zone = [close, close];
  }

  const atrStop =
    Number.isFinite(atr14) && Number.isFinite(entry)
      ? (side === "long" ? entry - 1.2 * atr14 : entry + 1.2 * atr14)
      : null;

  return { entry, zone, atrStop, atr14 };
}

function computeStop(entry, structureLevel, atrStop, side) {
  if (!Number.isFinite(entry)) return null;

  const candidates = [];
  if (Number.isFinite(structureLevel)) candidates.push(structureLevel);
  if (Number.isFinite(atrStop)) candidates.push(atrStop);

  if (!candidates.length) return null;

  // Wider stop:
  // long => lower price; short => higher price
  if (side === "long") return Math.min(...candidates);
  return Math.max(...candidates);
}

function grabPolarity(grab) {
  // +1 bullish (down sweep reclaim), -1 bearish (up sweep reject), 0 unknown
  const t = String(grab?.type || "");
  if (t.includes("grab_down") || t.includes("reclaim")) return 1;
  if (t.includes("grab_up") || t.includes("reject")) return -1;
  return 0;
}

function combineConfidence(baseConfidence, modifiers, evidenceStrong) {
  let conf = clamp(baseConfidence, 0, 1);

  let msum = 0;
  for (const m of modifiers || []) if (Number.isFinite(m)) msum += m;

  const eps = 1e-6;
  const logit = (p) => Math.log(clamp(p, eps, 1 - eps) / (1 - clamp(p, eps, 1 - eps)));
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  const z = logit(conf) + 1.35 * msum;
  conf = sigmoid(z);

  // v1.2 caps (more conservative)
  return evidenceStrong ? Math.min(conf, 0.92) : Math.min(conf, 0.85);
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
  evidenceStrong = false,
  structure,
}) {
  const tp1 = targets?.tp1 ?? null;
  const rr1 = computeRR(entry, stop, tp1);

  const tStruct = structuralTarget(structure, side);
  const rrStruct = computeRR(entry, stop, tStruct);

  const conf = combineConfidence(baseConfidence, modifiers, evidenceStrong);

  return {
    symbol,
    type,
    bias: side === "long" ? "Long" : "Short",
    trigger,
    entry_zone: entryZone,
    entry,
    invalidation: stop,
    stop,
    targets: targets ? { tp1: targets.tp1, tp2: targets.tp2, runner: targets.runner } : null,
    rr_estimate_tp1: rr1,
    target_structural: tStruct,
    rr_estimate_structural: rrStruct,
    confidence: conf,
    rationale: rationale || [],
    notes: [],
  };
}

export function buildSetupsV1(snapshot) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";

  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const structure = snapshot?.unified?.features?.structure || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const derivSynth = deriv?.derivatives_synthesis || {};
  const fundingLabels = deriv?.funding_labels || {};
  const liqFeat = deriv?.liquidation_features || {};

  const orderflow = snapshot?.unified?.features?.orderflow || {};
  const ofCandidates = [
    { ex: "bybit", ...orderflow.bybit },
    { ex: "binance", ...orderflow.binance },
    { ex: "okx", ...orderflow.okx },
  ].filter((x) => Number.isFinite(x.confidence));
  ofCandidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const ofBest = ofCandidates[0] || null;

  const scores = snapshot?.unified?.scores || {};
  const baseOverall = clamp(nz(scores.overall, 0.55), 0, 1);

  const reg = scoreRegime(tfFeatures);

  const tf15 = pickTf(tfFeatures, "15");
  const tf60 = pickTf(tfFeatures, "60");
  const tf240 = pickTf(tfFeatures, "240");
  const tfD = pickTf(tfFeatures, "D");

  const candidates = [];

  function genForSide(side) {
    const dir = side === "long" ? 1 : -1;

    const t15Trend = inferDirectionFromTrendLabel(tf15?.labels?.trend);
    const t60Trend = inferDirectionFromTrendLabel(tf60?.labels?.trend);
    const t240Trend = inferDirectionFromTrendLabel(tf240?.labels?.trend);

    const emaStack15 = tf15?.labels?.ema_stack || "unknown";
    const rsiBias15 = tf15?.labels?.rsi_bias || "unknown";

    const { entry, zone, atrStop, atr14 } = computeEntryStopFromEMA(tf15, side);
    const structLevel = levelFromStructure(structure, side);
    const stop = computeStop(entry, structLevel, atrStop, side);
    const targets = buildTargets(entry, stop, side);

    const coreOk = Number.isFinite(entry) && Number.isFinite(stop);

    const ofAlign = orderflowAlignment(ofBest || {}, side);
    const derivPen = derivativesPenalty(derivSynth, fundingLabels, side);
    const liqSig = liquidationSignal(liqFeat, side);

    const bosLast = structure?.bos_last || null;
    const grab = structure?.liquidity_grab || null;
    const pol = grabPolarity(grab);

    // Compatibility with HTF direction (soft): 0..1
    const htfCompat = clamp((dir * reg.composite + 1) / 2, 0, 1);

    // 1) Trend continuation
    {
      const rationale = [];
      let modifier = 0;

      const align = 0.25 * t15Trend + 0.35 * t60Trend + 0.40 * t240Trend;
      const alignScore = clamp((dir * align + 1) / 2, 0, 1);

      rationale.push(`Regime: ${reg.regime} (composite=${reg.composite.toFixed(3)})`);
      if (emaStack15 !== "unknown") rationale.push(`15m EMA stack: ${emaStack15}`);
      if (rsiBias15 !== "unknown") rationale.push(`15m RSI bias: ${rsiBias15}`);
      if (Number.isFinite(structLevel)) rationale.push(`Structure level: ${structLevel}`);
      if (bosLast?.type) rationale.push(`Last BOS: ${bosLast.type}`);
      if (Number.isFinite(atr14)) rationale.push(`15m ATR14: ${atr14}`);

      const trigger =
        side === "long"
          ? "Pullback into EMA(20/50) zone on 15m, then bullish reclaim / continuation"
          : "Pullback into EMA(20/50) zone on 15m, then bearish reject / continuation";

      modifier += 0.22 * (alignScore - 0.5);
      modifier += 0.10 * (htfCompat - 0.5);
      if (ofAlign.usable) modifier += 0.14 * (ofAlign.score - 0.5);
      if (liqSig.usable) modifier += 0.05 * (liqSig.score - 0.5);
      modifier -= derivPen;

      const macdHist = nz(tf15?.last?.macd_hist, null);
      if (Number.isFinite(macdHist)) {
        const macdOk = side === "long" ? macdHist > 0 : macdHist < 0;
        modifier += macdOk ? 0.03 : -0.03;
        rationale.push(`15m MACD hist: ${macdHist.toFixed(4)}`);
      }

      // v1.2: stricter evidenceStrong
      const ofOk = !ofAlign.usable || ofAlign.score >= 0.65;
      const evidenceStrong = coreOk && alignScore >= 0.75 && htfCompat >= 0.60 && ofOk;

      candidates.push(
        makeSetup({
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
          modifiers: [coreOk ? 0 : -0.35, modifier],
          evidenceStrong,
          structure,
        })
      );
    }

    // 2) Breakout
    {
      const rationale = [];
      let modifier = 0;

      const trigger =
        side === "long"
          ? "Break and close above recent structure high (60m), then retest-hold"
          : "Break and close below recent structure low (60m), then retest-reject";

      const swingLevel = levelFromStructure(structure, side === "long" ? "short" : "long");
      const breakoutLevel = swingLevel;

      const buffer = Number.isFinite(tf15?.last?.atr14) ? 0.25 * tf15.last.atr14 : 0;
      const entryB = Number.isFinite(breakoutLevel)
        ? side === "long"
          ? breakoutLevel + buffer
          : breakoutLevel - buffer
        : entry;

      const stopB = computeStop(entryB, structLevel, atrStop, side);
      const targetsB = buildTargets(entryB, stopB, side);
      const coreOkB = Number.isFinite(entryB) && Number.isFinite(stopB);

      rationale.push(`Regime: ${reg.regime}`);
      if (Number.isFinite(breakoutLevel)) rationale.push(`Breakout level: ${breakoutLevel}`);
      if (ofAlign.usable) rationale.push(`Orderflow align score: ${ofAlign.score.toFixed(2)}`);

      const dirCompat = clamp((dir * reg.composite + 1) / 2, 0, 1);
      modifier += 0.16 * (dirCompat - 0.5);
      modifier += 0.08 * (htfCompat - 0.5);
      if (ofAlign.usable) modifier += 0.16 * (ofAlign.score - 0.5);
      modifier -= derivPen * 0.8;

      const ofOk = !ofAlign.usable || ofAlign.score >= 0.70;
      const evidenceStrong = coreOkB && Number.isFinite(breakoutLevel) && htfCompat >= 0.60 && ofOk;

      candidates.push(
        makeSetup({
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
          modifiers: [coreOkB ? 0 : -0.35, modifier],
          evidenceStrong,
          structure,
        })
      );
    }

    // 3) Mean reversion
    {
      const rationale = [];
      let modifier = 0;

      const trigger =
        side === "long"
          ? "Range support hold (15m/60m) + momentum stabilizes (RSI recovers) → mean reversion"
          : "Range resistance hold (15m/60m) + momentum fades (RSI rolls) → mean reversion";

      const rangeAffinity = reg.regime === "range" ? 0.85 : reg.regime.endsWith("_weak") ? 0.55 : 0.35;
      modifier += 0.14 * (rangeAffinity - 0.5);

      const rsi = nz(tf15?.last?.rsi14, null);
      if (Number.isFinite(rsi)) {
        const rsiOk = side === "long" ? rsi <= 45 : rsi >= 55;
        modifier += rsiOk ? 0.06 : -0.03;
        rationale.push(`15m RSI14: ${rsi.toFixed(1)}`);
      }

      modifier -= 0.14 * clamp(Math.abs(reg.composite), 0, 1);

      const evidenceStrong = coreOk && reg.regime === "range";

      candidates.push(
        makeSetup({
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
          modifiers: [coreOk ? 0 : -0.35, modifier],
          evidenceStrong,
          structure,
        })
      );
    }

    // 4) Reversal sweep
    {
      const rationale = [];
      let modifier = 0;

      const hasGrab = !!grab?.type;

      const trigger =
        side === "long"
          ? "Down-sweep + reclaim (close back above swing) → reversal long confirmation"
          : "Up-sweep + reject (close back below swing) → reversal short confirmation";

      if (!hasGrab) {
        modifier -= 0.28;
        rationale.push("No liquidity grab detected (reversal_sweep low-confidence placeholder)");
      } else {
        rationale.push(`Liquidity grab: ${grab.type} at swing ${grab.swing}`);

        const align = side === "long" ? pol : -pol; // +1 aligned
        if (align > 0) modifier += 0.18;
        else if (align < 0) modifier -= 0.24;
        else modifier -= 0.06;

        modifier += 0.06;
      }

      if (liqSig.usable) modifier += 0.10 * (liqSig.score - 0.5);
      if (derivSynth?.leverage_regime === "risk_on" && side === "short") modifier += 0.04;
      if (derivSynth?.leverage_regime === "risk_off" && side === "long") modifier += 0.04;

      const swing = Number(grab?.swing);
      const atr = nz(tf15?.last?.atr14, null);
      const buf = Number.isFinite(atr) ? 0.15 * atr : 0;

      let entryR = entry;
      let zoneR = zone;

      if (Number.isFinite(swing)) {
        if (side === "long") {
          entryR = swing + buf;
          zoneR = [swing, swing + 2 * buf];
        } else {
          entryR = swing - buf;
          zoneR = [swing - 2 * buf, swing];
        }
      }

      const stopR = computeStop(entryR, structLevel, atrStop, side);
      const targetsR = buildTargets(entryR, stopR, side);
      const coreOkR = Number.isFinite(entryR) && Number.isFinite(stopR);

      // v1.2: stricter evidenceStrong (needs HTF compatibility + orderflow confirmation when available)
      const polAlign = hasGrab ? (side === "long" ? pol : -pol) : 0;
      const ofOk = !ofAlign.usable || ofAlign.score >= 0.62;
      const evidenceStrong = coreOkR && hasGrab && polAlign > 0 && htfCompat >= 0.55 && ofOk;

      candidates.push(
        makeSetup({
          symbol,
          type: "reversal_sweep",
          side,
          trigger,
          entryZone: zoneR,
          entry: entryR,
          stop: stopR,
          targets: targetsR,
          rationale,
          baseConfidence: baseOverall,
          modifiers: [coreOkR ? 0 : -0.40, modifier],
          evidenceStrong,
          structure,
        })
      );
    }
  }

  genForSide("long");
  genForSide("short");

  // Ranking: confidence, then structural RR (fallback to tp1 RR)
  candidates.sort((a, b) => {
    const ca = nz(a.confidence, 0);
    const cb = nz(b.confidence, 0);
    if (cb !== ca) return cb - ca;

    const rsa = nz(a.rr_estimate_structural, nz(a.rr_estimate_tp1, 0));
    const rsb = nz(b.rr_estimate_structural, nz(b.rr_estimate_tp1, 0));
    return rsb - rsa;
  });

  const primary = candidates[0] || null;

  // Alternative selection: prefer different TYPE first, then different BIAS
  let alternative = null;
  if (primary) {
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && c.type !== primary.type) {
        alternative = c;
        break;
      }
    }
    if (!alternative) {
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        if (c && c.bias !== primary.bias) {
          alternative = c;
          break;
        }
      }
    }
  } else {
    alternative = candidates[1] || null;
  }
  if (!alternative) alternative = candidates[1] || null;

  return {
    regime: {
      label: reg.regime,
      composite: reg.composite,
      strength: reg.strength,
      per_tf: reg.dirs,
    },
    primary,
    alternative,
    top_candidates: candidates.slice(0, 6),
  };
}
