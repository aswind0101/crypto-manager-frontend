// lib/indicators/setup-engine.js
// Setup Engine v1.3 (drop-in, rule-based + measurable)
// Key upgrades vs the file you sent:
// - Orderflow selection uses consensus on confidence ties (avoids exchange-order bias)
// - Confidence supports: raw, cap, temperature, and components for attribution
// - v1.2-style conservative caps: 0.85 default, 0.92 only with strong evidence
// - Structural target + rr_estimate_structural and ranking uses structural RR
// - Alternative selection prefers different TYPE first, then different BIAS
//
// Note: No scenarios are removed; weak scenarios are down-weighted.

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

// ---------- Orderflow selection (consensus on ties) ----------
function selectOrderflow(orderflow, tieEps = 0.02) {
    const cands = [
        { ex: "bybit", ...(orderflow?.bybit || {}) },
        { ex: "binance", ...(orderflow?.binance || {}) },
        { ex: "okx", ...(orderflow?.okx || {}) },
    ].filter((x) => Number.isFinite(x?.confidence));

    if (!cands.length) return { ofBest: null, ofMode: "none", ofCandidates: [] };

    cands.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const top = cands[0];
    const topConf = top.confidence || 0;

    const tied = cands.filter((c) => (topConf - (c.confidence || 0)) <= tieEps);

    if (tied.length >= 2) {
        let wsum = 0, bi = 0, dn = 0;
        let biOk = false, dnOk = false;

        for (const t of tied) {
            const w = clamp(nz(t.confidence, 0), 0, 1);
            wsum += w;

            if (Number.isFinite(t.book_imbalance)) { bi += w * t.book_imbalance; biOk = true; }
            if (Number.isFinite(t.delta_notional)) { dn += w * t.delta_notional; dnOk = true; }
        }

        const consensus = {
            ex: "consensus",
            confidence: topConf,
            book_imbalance: (biOk && wsum > 0) ? (bi / wsum) : null,
            delta_notional: (dnOk && wsum > 0) ? (dn / wsum) : null,
        };

        return { ofBest: consensus, ofMode: "consensus", ofCandidates: cands };
    }

    return { ofBest: top, ofMode: "best", ofCandidates: cands };
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

// ---------- Evidence -> temperature (soft-cap damping) ----------
function computeEvidenceScore({ coreOk, polarityOk, htfCompat, ofAlign }) {
    let s = 0, w = 0;

    w += 0.35; if (coreOk) s += 0.35;
    w += 0.25; if (polarityOk) s += 0.25;

    w += 0.25; s += 0.25 * clamp(nz(htfCompat, 0), 0, 1);

    if (ofAlign?.usable) {
        w += 0.15; s += 0.15 * clamp(nz(ofAlign.score, 0), 0, 1);
    }

    return w > 0 ? (s / w) : 0;
}

function evidenceToTemperature(eScore) {
    const ev = clamp(nz(eScore, 0), 0, 1);
    // Mild by default; you can raise tMax to 1.45 later if you still see mass 0.85 caps.
    const tMax = 1.30;
    const tMin = 1.00;
    return tMax - (tMax - tMin) * ev;
}

// ---------- Confidence (detailed + caps) ----------
function combineConfidenceDetailed(baseConfidence, modifiers, modifierNames, evidenceStrong, temperature = 1.0) {
    const eps = 1e-6;

    const logit = (p) => Math.log(clamp(p, eps, 1 - eps) / (1 - clamp(p, eps, 1 - eps)));
    const sigmoid = (z) => 1 / (1 + Math.exp(-z));

    const p0 = clamp(baseConfidence, 0, 1);
    const baseLogit = logit(p0);

    let msum = 0;
    const comps = [];
    for (let i = 0; i < (modifiers || []).length; i++) {
        const m = modifiers[i];
        const name = (modifierNames && modifierNames[i]) ? String(modifierNames[i]) : `m${i}`;
        const dz = Number.isFinite(m) ? m : 0;
        msum += dz;
        comps.push({ name, delta_logit: dz });
    }

    const z = (baseLogit + 1.35 * msum) / Math.max(temperature, 1e-6);
    const raw = sigmoid(z);

    const cap = evidenceStrong ? 0.92 : 0.85;
    const capped = Math.min(raw, cap);

    return {
        confidence: capped,
        confidence_raw: raw,
        confidence_cap: cap,
        confidence_temperature: temperature,
        confidence_components: [
            { name: "base_logit", delta_logit: baseLogit },
            ...comps,
            { name: "sum_modifier", delta_logit: msum },
        ],
    };
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
    modifierNames,
    evidenceStrong = false,
    structure,
    temperature = 1.0,
    orderflow_used = null,
}) {
    const tp1 = targets?.tp1 ?? null;
    const rr1 = computeRR(entry, stop, tp1);

    const tStruct = structuralTarget(structure, side);
    const rrStruct = computeRR(entry, stop, tStruct);

    const conf = combineConfidenceDetailed(baseConfidence, modifiers, modifierNames, evidenceStrong, temperature);

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
        confidence: conf.confidence,
        confidence_raw: conf.confidence_raw,
        confidence_cap: conf.confidence_cap,
        confidence_temperature: conf.confidence_temperature,
        confidence_components: conf.confidence_components,
        orderflow_used,
        rationale: rationale || [],
        notes: [],
    };
}

/**
 * Build setups:
 * - Generates multiple candidates for both directions and ranks them.
 * - Never eliminates a scenario outright; weak scenarios get lower confidence.
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
    const { ofBest, ofMode } = selectOrderflow(orderflow, 0.02);

    const scores = snapshot?.unified?.scores || {};

    // NOTE: scores.overall là "strength score", KHÔNG coi như probability.
    // Map nó về base prior probability (nén lại) để tránh base_logit quá cao.
    const s = clamp(nz(scores.overall, 0.55), 0, 1);

    // Option 1 (khuyến nghị): prior ~ [0.40..0.60]
    const baseOverall = 0.50 + 0.20 * (s - 0.50);

    // Option 2 (nhạy hơn): prior ~ [0.35..0.65]
    // const baseOverall = 0.50 + 0.30 * (s - 0.50);


    const reg = scoreRegime(tfFeatures);

    const tf15 = pickTf(tfFeatures, "15");
    const tf60 = pickTf(tfFeatures, "60");
    const tf240 = pickTf(tfFeatures, "240");

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
        const ofUsedMeta = ofBest ? { ex: ofBest.ex, mode: ofMode, confidence: ofBest.confidence } : null;

        const derivPen = derivativesPenalty(derivSynth, fundingLabels, side);
        const liqSig = liquidationSignal(liqFeat, side);

        const bosLast = structure?.bos_last || null;
        const grab = structure?.liquidity_grab || null;
        const pol = grabPolarity(grab);

        // 0..1
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
                    modifierNames: ["core_ok", "trend_mod"],
                    evidenceStrong,
                    structure,
                    temperature: 1.0,
                    orderflow_used: ofUsedMeta,
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
                    modifierNames: ["core_ok", "breakout_mod"],
                    evidenceStrong,
                    structure,
                    temperature: 1.0,
                    orderflow_used: ofUsedMeta,
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

            // Keep evidenceStrong stricter than v1.0 (range-only)
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
                    modifierNames: ["core_ok", "meanrev_mod"],
                    evidenceStrong,
                    structure,
                    temperature: 1.0,
                    orderflow_used: ofUsedMeta,
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

            const polAlign = hasGrab ? (side === "long" ? pol : -pol) : 0;
            const ofOk = !ofAlign.usable || ofAlign.score >= 0.62;

            // --- Close / momentum confirmation (minimal desk-grade) ---
            // If close is missing in snapshot, it gracefully falls back to RSI/MACD.
            const close15 = nz(tf15?.last?.close, null);
            const swingPx = Number(grab?.swing);

            const rsi15 = nz(tf15?.last?.rsi14, null);
            const macdHist15 = nz(tf15?.last?.macd_hist, null);

            // For SHORT reversal: prefer close back below swing,
            // or at least momentum is not strongly bullish.
            const confirmShort =
                (Number.isFinite(close15) && Number.isFinite(swingPx) && close15 < swingPx) ||
                (Number.isFinite(macdHist15) && macdHist15 <= 0) ||
                (Number.isFinite(rsi15) && rsi15 <= 60);

            // For LONG reversal: prefer close back above swing,
            // or at least momentum is not strongly bearish.
            const confirmLong =
                (Number.isFinite(close15) && Number.isFinite(swingPx) && close15 > swingPx) ||
                (Number.isFinite(macdHist15) && macdHist15 >= 0) ||
                (Number.isFinite(rsi15) && rsi15 >= 40);

            const confirmOk = side === "long" ? confirmLong : confirmShort;

            // Strong evidence now requires confirmation as well:
            const evidenceStrong =
                coreOkR && hasGrab && polAlign > 0 && htfCompat >= 0.55 && ofOk && confirmOk;

            // Optional: log confirmation status for debugging
            rationale.push(`Reversal confirm: ${confirmOk ? "OK" : "NOT_OK"} (close15=${nz(close15, null)}, swing=${nz(swingPx, null)}, rsi15=${nz(rsi15, null)}, macdHist15=${nz(macdHist15, null)})`);


            // Soft damping (temperature) for reversal only (highest leverage against 0.85 mass caps)
            const polarityOk = hasGrab && polAlign > 0;
            const eScore = computeEvidenceScore({ coreOk: coreOkR, polarityOk, htfCompat, ofAlign });
            const temperature = evidenceToTemperature(eScore);

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
                    modifierNames: ["core_ok", "reversal_mod"],
                    evidenceStrong,
                    structure,
                    temperature,
                    orderflow_used: ofUsedMeta,
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
            if (c && c.type !== primary.type) { alternative = c; break; }
        }
        if (!alternative) {
            for (let i = 1; i < candidates.length; i++) {
                const c = candidates[i];
                if (c && c.bias !== primary.bias) { alternative = c; break; }
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
// ==========================
// Setup Engine v2 (anchor-driven numbers + parameter reliability)
// v2 is additive: it does not change v1 outputs unless you call buildSetupsV2.
// ==========================

function roundToStep(x, step) {
    if (!Number.isFinite(x) || !Number.isFinite(step) || step <= 0) return x;
    return Math.round(x / step) * step;
}

function computeR(entry, stop) {
    if (![entry, stop].every(Number.isFinite)) return null;
    const r = Math.abs(entry - stop);
    return r > 0 ? r : null;
}

function rr(entry, stop, target) {
    if (![entry, stop, target].every(Number.isFinite)) return null;
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (risk <= 0) return null;
    return reward / risk;
}

function chooseStep({ tickSize, atr, minStep = 0.1, atrFactor = 0.01 }) {
    if (Number.isFinite(tickSize) && tickSize > 0) return tickSize;
    if (Number.isFinite(atr) && atr > 0) return Math.max(minStep, atr * atrFactor);
    return minStep;
}

function clamp01(x) {
    return clamp(x, 0, 1);
}

function pickTfAnchor(anchorLayer, tf) {
    return {
        vol: anchorLayer?.volatility?.atr?.[tf] ?? null,
        swingLast: anchorLayer?.structure?.by_tf?.[tf]?.swing_last ?? null,
        bosLast: anchorLayer?.structure?.by_tf?.[tf]?.bos_last ?? null,
        swingsRaw: anchorLayer?.structure?.by_tf?.[tf]?.swings_last ?? [],
        sweepLast: anchorLayer?.liquidity?.by_tf?.[tf]?.sweep_last ?? null,
    };
}

function nearestTargetsFromSwings(swingsRaw, side, entry) {
    const highs = [];
    const lows = [];
    for (const s of (swingsRaw || [])) {
        if (!s || !Number.isFinite(s.price)) continue;
        if (s.type === "high") highs.push(s.price);
        if (s.type === "low") lows.push(s.price);
    }
    highs.sort((a, b) => a - b);
    lows.sort((a, b) => a - b);

    if (!Number.isFinite(entry)) return { tp1: null, tp2: null };

    if (side === "long") {
        const above = highs.filter((p) => p > entry);
        return { tp1: above[0] ?? null, tp2: above[1] ?? null };
    }

    const below = lows.filter((p) => p < entry);
    const tp1 = below.length ? below[below.length - 1] : null;
    const tp2 = below.length >= 2 ? below[below.length - 2] : null;
    return { tp1, tp2 };
}

function computeParameterReliability({
    atr,
    entryZone,
    entry,
    stop,
    tp1,
    hasSweep,
    sweepQuality,
    nowTs,
    anchorTs,
    frictionPenalty = 0,
}) {
    let pr = 0;
    const warnings = [];

    // 1) Anchor clarity (0..0.35)
    let a = 0;
    if (hasSweep) a += 0.22;

    if (Number.isFinite(anchorTs) && Number.isFinite(nowTs)) {
        const ageMs = nowTs - anchorTs;
        if (ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000) a += 0.08;
        else if (ageMs > 72 * 60 * 60 * 1000) warnings.push("anchor_old");
    }

    if (Number.isFinite(sweepQuality?.penetration) && Number.isFinite(atr) && atr > 0) {
        const penAtr = sweepQuality.penetration / atr;
        if (penAtr >= 0.10) a += 0.05;
        else warnings.push("sweep_shallow");
    }

    a = clamp(a, 0, 0.35);
    pr += a;

    // 2) Volatility sanity (0..0.25)
    let v = 0;
    const r = computeR(entry, stop);

    if (Number.isFinite(atr) && atr > 0 && Number.isFinite(r)) {
        const rAtr = r / atr;
        if (rAtr >= 0.5 && rAtr <= 2.0) v += 0.18;
        else if (rAtr < 0.5) warnings.push("stop_too_tight");
        else warnings.push("stop_too_wide");

        if (Array.isArray(entryZone) && entryZone.length === 2) {
            const w = Math.abs(entryZone[1] - entryZone[0]);
            const wAtr = w / atr;
            if (wAtr >= 0.05 && wAtr <= 0.35) v += 0.07;
            else if (wAtr < 0.05) warnings.push("zone_too_narrow");
            else warnings.push("zone_too_wide");
        }
    } else {
        warnings.push("atr_missing");
    }

    v = clamp(v, 0, 0.25);
    pr += v;

    // 3) Targets availability (0..0.20)
    let t = 0;
    if (Number.isFinite(tp1)) t += 0.12;
    else warnings.push("tp1_missing_level");

    const rr1 = rr(entry, stop, tp1);
    if (Number.isFinite(rr1)) {
        if (rr1 >= 0.8) t += 0.08;
        else warnings.push("rr_low");
    }

    t = clamp(t, 0, 0.20);
    pr += t;

    // 4) Friction penalty (0..0.20) subtract
    const fp = clamp(nz(frictionPenalty, 0), 0, 0.20);
    if (fp > 0.12) warnings.push("market_friction_high");
    pr -= fp;

    pr = clamp01(pr);
    return { parameter_reliability: pr, warnings };
}

function computeIdeaConfidenceV2({
    baseOverall,
    regComposite,
    ofAlignScore = null,
    derivPenalty = 0,
    liqScore = null,
    sweepSideOk = true,
}) {
    let ic = clamp01(baseOverall);

    if (Number.isFinite(regComposite)) {
        ic += 0.08 * (clamp01((regComposite + 1) / 2) - 0.5) * 2;
    }

    if (Number.isFinite(ofAlignScore)) {
        ic += 0.06 * (clamp01(ofAlignScore) - 0.5) * 2;
    }

    if (Number.isFinite(liqScore)) {
        ic += 0.04 * (clamp01(liqScore) - 0.5) * 2;
    }

    ic -= clamp(nz(derivPenalty, 0), -0.10, 0.25);

    if (!sweepSideOk) ic -= 0.10;

    return clamp01(ic);
}

function qualityTier(finalScore) {
    if (finalScore >= 0.80) return "A";
    if (finalScore >= 0.70) return "B";
    if (finalScore >= 0.60) return "C";
    return "D";
}

function buildReversalSweepV2({ snapshot, tf = "60" }) {
    const anchorLayer = snapshot?.unified?.anchor_layer;
    if (!anchorLayer) return null;

    const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";

    const tfFeatures = snapshot?.unified?.features?.timeframes || {};
    const reg = scoreRegime(tfFeatures);

    const scores = snapshot?.unified?.scores || {};
    const s = clamp(nz(scores.overall, 0.55), 0, 1);
    const baseOverall = 0.50 + 0.20 * (s - 0.50);

    const deriv = snapshot?.unified?.features?.derivatives || {};
    const derivSynth = deriv?.derivatives_synthesis || {};
    const fundingLabels = deriv?.funding_labels || {};
    const liqFeat = deriv?.liquidation_features || {};

    const orderflow = snapshot?.unified?.features?.orderflow || {};
    const { ofBest } = selectOrderflow(orderflow, 0.02);

    const { vol: atr, swingsRaw, sweepLast } = pickTfAnchor(anchorLayer, tf);

    if (
        !sweepLast ||
        !Number.isFinite(sweepLast.reclaimed_level) ||
        !Number.isFinite(sweepLast.wick_extreme) ||
        !Number.isFinite(sweepLast.confirm_close)
    ) {
        return null;
    }

    const nowTs = anchorLayer?.market?.now_ts ?? Date.now();
    const tickSize = anchorLayer?.market?.tick_size ?? null;
    const step = chooseStep({ tickSize, atr, minStep: 0.1, atrFactor: 0.01 });

    const side =
        sweepLast.side === "up" ? "short" :
            sweepLast.side === "down" ? "long" : null;
    if (!side) return null;

    const reclaimed = sweepLast.reclaimed_level;
    const confirmClose = sweepLast.confirm_close;
    const wick = sweepLast.wick_extreme;

    // Entry zone around reclaimed, minimum width tied to ATR
    const band = (Number.isFinite(atr) && atr > 0) ? (0.08 * atr) : Math.abs(reclaimed) * 0.0008;
    const minW = (Number.isFinite(atr) && atr > 0) ? (0.05 * atr) : 0.5;
    const w = Math.max(minW, band);

    let entryPreferred = (reclaimed + confirmClose) / 2;
    let entryZone = [reclaimed - w, reclaimed + w];

    // Bias preferred entry: short wants better sell (upper half), long wants better buy (lower half)
    if (side === "short") entryPreferred = reclaimed + 0.35 * w;
    if (side === "long") entryPreferred = reclaimed - 0.35 * w;

    // Stop = wick extreme ± ATR buffer
    const stopBuf = (Number.isFinite(atr) && atr > 0) ? (0.25 * atr) : (Math.abs(reclaimed) * 0.001);
    const stop = side === "short" ? (wick + stopBuf) : (wick - stopBuf);

    // Targets from nearest opposing swings
    const { tp1, tp2 } = nearestTargetsFromSwings(swingsRaw, side, entryPreferred);

    // Rounding
    entryZone = [roundToStep(entryZone[0], step), roundToStep(entryZone[1], step)];
    entryPreferred = roundToStep(entryPreferred, step);
    const stopR = roundToStep(stop, step);
    const tp1R = Number.isFinite(tp1) ? roundToStep(tp1, step) : null;
    const tp2R = Number.isFinite(tp2) ? roundToStep(tp2, step) : null;

    // Idea confidence
    const ofAlign = orderflowAlignment(ofBest || {}, side);
    const derivPen = derivativesPenalty(derivSynth, fundingLabels, side);
    const liqSig = liquidationSignal(liqFeat, side);

    const ic = computeIdeaConfidenceV2({
        baseOverall,
        regComposite: reg.composite,
        ofAlignScore: ofAlign.usable ? ofAlign.score : null,
        derivPenalty: derivPen,
        liqScore: liqSig.usable ? liqSig.score : null,
        sweepSideOk: true,
    });

    // Parameter reliability: friction penalty (optional)
    const frictionPenalty = (() => {
        let fp = 0;
        const ofC = nz(ofBest?.confidence, null);
        if (Number.isFinite(ofC) && ofC < 0.45) fp += 0.06;
        if (liqFeat?.observed && nz(liqFeat.intensity_15m, 0) > 0.15) fp += 0.04;
        return clamp(fp, 0, 0.20);
    })();

    const prRes = computeParameterReliability({
        atr,
        entryZone,
        entry: entryPreferred,
        stop: stopR,
        tp1: tp1R,
        hasSweep: true,
        sweepQuality: sweepLast.quality,
        nowTs,
        anchorTs: sweepLast.confirm_ts ?? sweepLast.sweep_ts ?? null,
        frictionPenalty,
    });

    const pr = prRes.parameter_reliability;
    // Trade quality score: parameters dominate, idea acts as soft bias
    const tradeQuality = clamp01(
        0.65 * pr +
        0.25 * clamp01((rr(entryPreferred, stopR, tp1R) ?? 0) / 3) + // RR >=3 caps
        0.10 * ic
    );

    const finalScore = tradeQuality;


    const trigger = side === "short"
        ? "Up-sweep + reject (close back below reclaimed swing) → reversal short confirmation"
        : "Down-sweep + reclaim (close back above reclaimed swing) → reversal long confirmation";

    const setup = {
        symbol,
        type: "reversal_sweep",
        bias: side === "long" ? "Long" : "Short",
        timeframe: tf,
        trigger,

        entry_zone: entryZone,
        entry_preferred: entryPreferred,
        invalidation: stopR,
        stop: stopR,
        targets: { tp1: tp1R, tp2: tp2R, tp3: null },
        r_multiple: {
            tp1: rr(entryPreferred, stopR, tp1R),
            tp2: rr(entryPreferred, stopR, tp2R),
            tp3: null,
        },

        idea_confidence: ic,
        parameter_reliability: pr,
        final_score: finalScore,
        quality_tier: qualityTier(finalScore),

        anchors: {
            entry_anchor: "reclaimed_level",
            stop_anchor: "wick_extreme+atr_buffer",
            tp_anchors: ["nearest_opposing_swing_levels"],
            sweep: {
                side: sweepLast.side,
                reclaimed_level: reclaimed,
                wick_extreme: wick,
                confirm_close: confirmClose,
                ts: sweepLast.confirm_ts ?? sweepLast.sweep_ts ?? null,
            },
        },
        buffers: {
            atr_tf: atr,
            zone_width: Math.abs(entryZone[1] - entryZone[0]),
            stop_buffer: stopBuf,
            rounding_step: step,
        },
        warnings: prRes.warnings,
        // =======================
        // Execution metrics (trade quality, price-based)
        // =======================
        execution_metrics: {
            atr,
            entry_zone_width: Math.abs(entryZone[1] - entryZone[0]),
            stop_distance: Number.isFinite(entryPreferred) && Number.isFinite(stopR)
                ? Math.abs(entryPreferred - stopR)
                : null,
            risk_over_atr: (Number.isFinite(atr) && atr > 0 && Number.isFinite(entryPreferred) && Number.isFinite(stopR))
                ? Math.abs(entryPreferred - stopR) / atr
                : null,
            reward_tp1: Number.isFinite(tp1R) && Number.isFinite(entryPreferred)
                ? Math.abs(tp1R - entryPreferred)
                : null,
            rr_tp1: rr(entryPreferred, stopR, tp1R),
        },

        // =======================
        // Execution anchors & quality
        // =======================
        execution_anchors: {
            sweep: sweepLast ? {
                side: sweepLast.side,
                reclaimed_level: sweepLast.reclaimed_level,
                wick_extreme: sweepLast.wick_extreme,
                confirm_close: sweepLast.confirm_close,
                ts: sweepLast.confirm_ts ?? sweepLast.sweep_ts ?? null,
                quality: {
                    penetration: sweepLast.quality?.penetration ?? null,
                    penetration_atr: Number.isFinite(atr) && atr > 0 && Number.isFinite(sweepLast.quality?.penetration)
                        ? sweepLast.quality.penetration / atr
                        : null,
                    close_back_distance: sweepLast.quality?.close_back_distance ?? null,
                    speed: sweepLast.quality?.speed ?? null,
                },
            } : null,
        },

        // =======================
        // Signal metrics (context, non-price)
        // =======================
        signal_metrics: {
            regime: {
                label: reg?.regime ?? null,
                composite: reg?.composite ?? null,
                strength: reg?.strength ?? null,
            },
            orderflow: ofAlign?.usable
                ? { score: ofAlign.score, confidence: ofBest?.confidence ?? null }
                : null,
            derivatives: {
                penalty: derivPen,
                funding_labels: deriv?.funding_labels ?? null,
            },
            liquidations: liqSig?.usable
                ? { score: liqSig.score, intensity_15m: liqFeat?.intensity_15m ?? null }
                : null,
        },

        // =======================
        // Scores (final numbers for ranking / filtering)
        // =======================
        scores: {
            execution_quality: pr,          // formerly parameter_reliability
            signal_quality: ic,             // formerly idea_confidence
            final_score: finalScore,
            quality_tier: qualityTier(finalScore),
            warnings: prRes.warnings,
        },

    };

    return { setup, reg };
}

export function buildSetupsV2(snapshot, opts = {}) {
    const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
    const anchorLayer = snapshot?.unified?.anchor_layer;

    if (!anchorLayer) {
        return {
            version: "2.0",
            symbol,
            regime: null,
            primary: null,
            alternative: null,
            top_candidates: [],
            notes: ["anchor_layer_missing"],
        };
    }

    const preferTf = String(opts.prefer_tf || "60");
    const tfs = Array.from(new Set([preferTf, "15", "60", "240"])).filter(
        (x) => anchorLayer?.structure?.by_tf?.[x]
    );

    const candidates = [];
    let regOut = null;

    for (const tf of tfs) {
        const rs = buildReversalSweepV2({ snapshot, tf });
        if (rs?.setup) {
            candidates.push(rs.setup);
            regOut = regOut || rs.reg;
        }
    }

    candidates.sort((a, b) => {
        const fa = nz(a.final_score, 0);
        const fb = nz(b.final_score, 0);
        if (fb !== fa) return fb - fa;
        const pa = nz(a.parameter_reliability, 0);
        const pb = nz(b.parameter_reliability, 0);
        return pb - pa;
    });

    const primary = candidates[0] || null;
    const alternative = candidates[1] || null;

    return {
        version: "2.0",
        symbol,
        regime: regOut
            ? { label: regOut.regime, composite: regOut.composite, strength: regOut.strength, per_tf: regOut.dirs }
            : null,
        primary,
        alternative,
        top_candidates: candidates.slice(0, 6),
        notes: [],
    };
}
