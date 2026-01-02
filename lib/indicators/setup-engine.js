/* ============================================================================
 * Setup Engine v3.0 (New, Full Engine)
 * - Goal: High-quality setups (selective, traceable, execution-aware)
 * - Inputs: market-snapshot-v4 (multi-exchange + unified + anchor_layer)
 * - Outputs: setups_v3 { primary, alternative, watchlist, regime, diagnostics }
 *
 * Design principles:
 *  1) Anchor-first: setup numbers (entry/stop/tp) come from anchor_layer.
 *  2) Evidence gating: reject weak/noisy setups early (hard gates) to raise quality.
 *  3) Multi-signal scoring: parameter reliability + signal quality + RR quality.
 *  4) Execution-aware: ready/waiting/missed/invalidated + LIMIT/MARKET guidance.
 *  5) Full traceability: every setup includes evidence, penalties, notes, and gates.
 * ========================================================================== */

function clamp(x, a = 0, b = 1) {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}
function nz(x, d = null) {
  return Number.isFinite(x) ? x : d;
}
function sgn(x) {
  return Number.isFinite(x) ? Math.sign(x) : 0;
}
function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean).map(String)));
}
function median(arr) {
  const a = (arr || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(arr) {
  const a = (arr || []).filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}
function safeLogit(p) {
  const eps = 1e-6;
  const pp = clamp(p, eps, 1 - eps);
  return Math.log(pp / (1 - pp));
}
function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function rr(entry, stop, target) {
  if (![entry, stop, target].every(Number.isFinite)) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!(risk > 0)) return null;
  return reward / risk;
}
function riskOverAtr(entry, stop, atr) {
  if (![entry, stop, atr].every(Number.isFinite) || atr <= 0) return null;
  return Math.abs(entry - stop) / atr;
}

function inferDirectionFromTrend(label) {
  if (label === "bull") return 1;
  if (label === "bear") return -1;
  return 0;
}

/* ------------------------------ Regime ---------------------------------- */
function scoreRegime(tfMap) {
  const t15 = tfMap?.["15"];
  const t60 = tfMap?.["60"];
  const t240 = tfMap?.["240"];
  const tD = tfMap?.["D"];

  const d15 = inferDirectionFromTrend(t15?.labels?.trend);
  const d60 = inferDirectionFromTrend(t60?.labels?.trend);
  const d240 = inferDirectionFromTrend(t240?.labels?.trend);
  const dD = inferDirectionFromTrend(tD?.labels?.trend);

  // HTF weighted composite
  const composite = 0.15 * d15 + 0.30 * d60 + 0.35 * d240 + 0.20 * dD;
  const strength = Math.abs(composite);

  let label = "range";
  if (strength >= 0.55) label = composite > 0 ? "bull" : "bear";
  else if (strength >= 0.30) label = composite > 0 ? "bull_weak" : "bear_weak";

  return { label, composite, strength, per_tf: { d15, d60, d240, dD } };
}

/* -------------------------- Data & Tick step ---------------------------- */
function inferTickFromOrderbook(snapshot, preferEx = "bybit") {
  const ob = snapshot?.per_exchange?.[preferEx]?.orderflow?.orderbook || null;
  const bids = ob?.bids || [];
  const asks = ob?.asks || [];
  const ps = []
    .concat(bids.slice(0, 12).map((x) => x?.p))
    .concat(asks.slice(0, 12).map((x) => x?.p))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (ps.length < 8) return null;

  let minDiff = Infinity;
  for (let i = 1; i < ps.length; i++) {
    const d = ps[i] - ps[i - 1];
    if (d > 0 && d < minDiff) minDiff = d;
  }
  if (!Number.isFinite(minDiff) || minDiff === Infinity) return null;

  // Snap to reasonable decimals
  const exp = Math.pow(10, Math.max(0, Math.min(10, Math.ceil(-Math.log10(minDiff)) + 1)));
  const snapped = Math.round(minDiff * exp) / exp;
  return snapped > 0 ? snapped : null;
}
function roundToStep(x, step) {
  if (!Number.isFinite(x) || !Number.isFinite(step) || step <= 0) return x;
  return Math.round(x / step) * step;
}
function chooseStep({ snapshot, atr, minStep = 0.1, atrFactor = 0.01 }) {
  const tickSize = snapshot?.unified?.anchor_layer?.market?.tick_size ?? null;
  const inferred = inferTickFromOrderbook(snapshot, "bybit");
  const ts = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : inferred;

  if (Number.isFinite(ts) && ts > 0) return ts;
  if (Number.isFinite(atr) && atr > 0) return Math.max(minStep, atr * atrFactor);
  return minStep;
}

/* ----------------------------- Orderflow -------------------------------- */
function selectOrderflow(orderflow, tieEps = 0.02) {
  const cands = ["bybit", "binance", "okx"]
    .map((ex) => ({ ex, ...(orderflow?.[ex] || {}) }))
    .filter((x) => Number.isFinite(x?.confidence));

  if (!cands.length) return { best: null, mode: "none", candidates: [] };

  cands.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const top = cands[0];
  const topConf = top.confidence || 0;
  const tied = cands.filter((c) => topConf - (c.confidence || 0) <= tieEps);

  if (tied.length >= 2) {
    let wsum = 0, bi = 0, dn = 0;
    let biOk = false, dnOk = false;

    for (const t of tied) {
      const w = clamp(nz(t.confidence, 0), 0, 1);
      wsum += w;
      if (Number.isFinite(t.book_imbalance)) { bi += w * t.book_imbalance; biOk = true; }
      if (Number.isFinite(t.delta_notional)) { dn += w * t.delta_notional; dnOk = true; }
    }
    return {
      best: {
        ex: "consensus",
        confidence: topConf,
        book_imbalance: biOk && wsum > 0 ? (bi / wsum) : null,
        delta_notional: dnOk && wsum > 0 ? (dn / wsum) : null,
      },
      mode: "consensus",
      candidates: cands
    };
  }
  return { best: top, mode: "best", candidates: cands };
}

function orderflowScore(ofBest, side) {
  // side: "long"|"short"
  if (!ofBest) return { usable: false, score: 0.5, notes: ["of_missing"] };

  const bi = nz(ofBest.book_imbalance, null); // -1..1
  const dn = nz(ofBest.delta_notional, null); // sign only
  let usable = false;
  let s = 0;

  if (Number.isFinite(bi)) {
    usable = true;
    s += (side === "long" ? bi : -bi) * 0.6;
  }
  if (Number.isFinite(dn)) {
    usable = true;
    s += (side === "long" ? Math.sign(dn) : -Math.sign(dn)) * 0.4;
  }

  const score = usable ? clamp((s + 1) / 2, 0, 1) : 0.5;
  const notes = [];
  if (usable) notes.push(`of_mode:${String(ofBest.ex)}`);
  return { usable, score, notes };
}

function orderflowDivergencePenalty(snapshot) {
  // Penalize when high-confidence venues disagree on direction.
  const of = snapshot?.unified?.features?.orderflow || {};
  const cands = ["bybit", "binance", "okx"]
    .map((ex) => ({ ex, ...(of?.[ex] || {}) }))
    .filter((x) => Number.isFinite(x?.confidence) && x.confidence >= 0.50);

  if (cands.length < 2) return { penalty: 0.02, notes: ["of_divergence_insufficient"] };

  const signs = [];
  for (const c of cands) {
    const s1 = Number.isFinite(c.delta_notional) ? Math.sign(c.delta_notional) : 0;
    const s2 = Number.isFinite(c.book_imbalance) ? Math.sign(c.book_imbalance) : 0;
    const s = s1 !== 0 ? s1 : s2;
    if (s !== 0) signs.push(s);
  }
  if (signs.length < 2) return { penalty: 0.02, notes: ["of_divergence_no_signs"] };

  const sum = signs.reduce((a, b) => a + b, 0);
  const disagree = Math.abs(sum) < signs.length; // not unanimous
  if (!disagree) return { penalty: 0, notes: [] };

  return { penalty: 0.08, notes: ["multi_exchange_of_divergence"] };
}

/* ----------------------------- Derivatives ------------------------------ */
function derivativesPenalty(snapshot, side, type) {
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const synth = deriv?.derivatives_synthesis || {};
  const fundingLabels = deriv?.funding_labels || {};
  const lev = synth?.leverage_regime || "neutral";

  let p = 0;
  const posExtreme =
    fundingLabels?.bybit === "positive_extreme" ||
    fundingLabels?.binance === "positive_extreme" ||
    fundingLabels?.okx === "positive_extreme";
  const negExtreme =
    fundingLabels?.bybit === "negative_extreme" ||
    fundingLabels?.binance === "negative_extreme" ||
    fundingLabels?.okx === "negative_extreme";

  // Crowd-risk logic:
  if (lev === "risk_on") {
    if (posExtreme && side === "long") p += 0.10;
    if (posExtreme && side === "short") p -= 0.03;
  }
  if (lev === "risk_off") {
    if (negExtreme && side === "short") p += 0.10;
    if (negExtreme && side === "long") p -= 0.03;
  }

  // Divergence penalties
  const fd = nz(synth?.funding_divergence, 0);
  const pd = nz(synth?.premium_divergence, 0);

  p += clamp(fd * 50, 0, 0.10);
  p += clamp(pd * 20, 0, 0.08);

  // Type sensitivity: reversal suffers more from crowded conditions than continuation
  const typeFactor = (type === "reversal_sweep") ? 1.10 : (type === "breakout" ? 0.95 : 0.85);
  return clamp(p * typeFactor, -0.10, 0.28);
}

/* ----------------------------- Liquidations ----------------------------- */
function liquidationSignal(snapshot, side) {
  const liq = snapshot?.unified?.features?.derivatives?.liquidation_features || null;
  if (!liq?.observed) return { usable: false, score: 0.5, notes: ["liq_unobserved"] };

  const inten = nz(liq.intensity_15m, null);
  const bias = nz(liq.bias, null);
  let strength = 0.60;

  if (Number.isFinite(inten)) {
    if (inten > 0.18) strength = 0.85;
    else if (inten > 0.08) strength = 0.72;
    else strength = 0.62;
  }

  // bias>0 => more SHORT liquidation => bullish edge
  let dirEdge = 0.5;
  if (Number.isFinite(bias)) {
    if (side === "long") dirEdge = clamp(0.5 + 0.5 * bias, 0, 1);
    else dirEdge = clamp(0.5 - 0.5 * bias, 0, 1);
  }

  const score = clamp(0.55 * strength + 0.45 * dirEdge, 0, 1);
  const notes = [];
  if (Number.isFinite(inten)) notes.push(`liq_intensity:${inten.toFixed(3)}`);
  if (Number.isFinite(bias)) notes.push(`liq_bias:${bias.toFixed(3)}`);
  return { usable: true, score, notes };
}

function liquidationFeedQualityPenalty(snapshot) {
  const ex = snapshot?.per_exchange || {};
  let total = 0, missing = 0;

  for (const k of ["bybit", "binance", "okx"]) {
    const lw = ex?.[k]?.derivatives?.liquidations_window;
    if (!lw) continue;
    total += 1;
    const status = String(lw.status || "");
    const ws = !!lw.ws_subscribed;
    const msgs = Number(lw.ws_messages || 0);
    if (!ws || msgs === 0 || status.includes("no_messages")) missing += 1;
  }

  if (!total) return { penalty: 0.05, notes: ["liq_feed_unknown"] };

  const r = missing / total;
  if (r >= 0.67) return { penalty: 0.10, notes: ["liq_feed_mostly_missing"] };
  if (r >= 0.34) return { penalty: 0.06, notes: ["liq_feed_partially_missing"] };
  return { penalty: 0.00, notes: [] };
}

/* ----------------------------- Open Interest ---------------------------- */
function pctChange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (a - b) / b;
}

function computeOiImpulseFromHist(oiHist = [], horizonN = 12) {
  const xs = (oiHist || []).filter((x) => Number.isFinite(x?.oi)).map((x) => x.oi);
  if (xs.length < Math.max(6, horizonN + 1)) return null;

  const last = xs[xs.length - 1];
  const prev = xs[xs.length - 1 - horizonN];
  const ch = pctChange(last, prev);
  if (!Number.isFinite(ch)) return null;

  const diffs = [];
  for (let i = 1; i < xs.length; i++) {
    const dc = pctChange(xs[i], xs[i - 1]);
    diffs.push(Math.abs(dc || 0));
  }
  const scale = median(diffs) || Math.abs(ch) || 1e-6;
  const impulse = ch / Math.max(scale, 1e-6);
  return { pct: ch, impulse };
}

function synthesizeOI(snapshot) {
  const ex = snapshot?.per_exchange || {};
  const impulses = [];
  const pcts = [];
  const per = {};

  for (const k of ["bybit", "binance", "okx"]) {
    const hist = ex?.[k]?.derivatives?.open_interest_hist || [];
    const cur = ex?.[k]?.derivatives?.open_interest?.oi ?? null;
    const res = computeOiImpulseFromHist(hist, 12);
    per[k] = { current_oi: cur, ...(res || {}) };
    if (Number.isFinite(res?.impulse)) impulses.push(res.impulse);
    if (Number.isFinite(res?.pct)) pcts.push(res.pct);
  }
  return {
    per_exchange: per,
    impulse_median: median(impulses),
    pct_median: median(pcts),
  };
}

function oiConfirm({ oiSynth, type }) {
  const imp = oiSynth?.impulse_median;
  if (!Number.isFinite(imp)) return { usable: false, score: 0.5, bonus: 0, penalty: 0.06, notes: ["oi_missing"] };

  // Interpretation:
  // - imp > 0 : OI expanding (participation)
  // - imp < 0 : OI contracting (covering / deleveraging)
  let score = 0.55, bonus = 0, penalty = 0, notes = [];

  if (type === "reversal_sweep") {
    if (imp <= -0.6) { score = 0.80; bonus = 0.07; notes.push("oi_contract_supports_reversal"); }
    else if (imp <= -0.2) { score = 0.68; bonus = 0.03; notes.push("oi_mild_contract_supports_reversal"); }
    else if (imp >= 0.7) { score = 0.32; penalty = 0.12; notes.push("oi_expand_fights_reversal"); }
    else if (imp >= 0.3) { score = 0.42; penalty = 0.07; notes.push("oi_mild_expand_fights_reversal"); }
    else { score = 0.56; notes.push("oi_neutral_reversal"); }
  } else if (type === "breakout" || type === "trend_continuation") {
    if (imp >= 0.7) { score = 0.82; bonus = 0.08; notes.push("oi_expand_supports_trend"); }
    else if (imp >= 0.3) { score = 0.68; bonus = 0.04; notes.push("oi_mild_expand_supports_trend"); }
    else if (imp <= -0.7) { score = 0.32; penalty = 0.12; notes.push("oi_contract_fights_trend"); }
    else if (imp <= -0.3) { score = 0.42; penalty = 0.07; notes.push("oi_mild_contract_fights_trend"); }
    else { score = 0.56; notes.push("oi_neutral_trend"); }
  } else {
    notes.push("oi_type_unknown");
  }

  return { usable: true, score: clamp(score, 0, 1), bonus: clamp(bonus, 0, 0.10), penalty: clamp(penalty, 0, 0.14), notes };
}

/* ---------------------- Parameter reliability & gates -------------------- */
function rrToScore(rr1) {
  if (!Number.isFinite(rr1) || rr1 <= 0) return 0;
  // smooth saturation
  const k = 3;
  return clamp(1 - Math.exp(-rr1 / k), 0, 1);
}

function executionPenaltyFromWarnings(warnings = []) {
  const w = new Set((warnings || []).map(String));
  let p = 0;
  if (w.has("stop_too_tight")) p += 0.12;
  if (w.has("stop_too_wide")) p += 0.08;
  if (w.has("zone_too_wide")) p += 0.06;
  if (w.has("zone_too_narrow")) p += 0.03;
  if (w.has("anchor_weak")) p += 0.05;
  if (w.has("anchor_old")) p += 0.04;
  if (w.has("rr_low")) p += 0.10;
  if (w.has("liq_feed_mostly_missing")) p += 0.06;
  if (w.has("multi_exchange_of_divergence")) p += 0.05;
  return clamp(p, 0, 0.30);
}

function computeParameterReliability({
  atr,
  entryZone,
  entry,
  stop,
  tp1,
  anchorKind = "unknown",
  anchorTs = null,
  nowTs = null,
  anchorStrengthAtr = null,
  frictionPenalty = 0,
}) {
  let pr = 0;
  const warnings = [];

  // (1) Anchor clarity (0..0.32)
  let a = 0;
  if (anchorKind === "sweep") a += 0.18;
  else if (anchorKind === "level") a += 0.16;
  else if (anchorKind === "ema") a += 0.12;
  else warnings.push("anchor_missing");

  if (Number.isFinite(anchorTs) && Number.isFinite(nowTs)) {
    const ageMs = nowTs - anchorTs;
    if (ageMs >= 0 && ageMs <= 12 * 60 * 60 * 1000) a += 0.08;
    else if (ageMs <= 48 * 60 * 60 * 1000) a += 0.05;
    else warnings.push("anchor_old");
  } else {
    warnings.push("anchor_ts_missing");
  }

  if (Number.isFinite(anchorStrengthAtr)) {
    if (anchorStrengthAtr >= 0.12) a += 0.06;
    else warnings.push("anchor_weak");
  } else {
    warnings.push("anchor_strength_missing");
  }

  a = clamp(a, 0, 0.32);
  pr += a;

  // (2) Volatility sanity (0..0.28)
  let v = 0;
  const r = (Number.isFinite(entry) && Number.isFinite(stop)) ? Math.abs(entry - stop) : null;

  if (Number.isFinite(atr) && atr > 0 && Number.isFinite(r)) {
    const rAtr = r / atr;
    if (rAtr >= 0.55 && rAtr <= 2.2) v += 0.18;
    else if (rAtr < 0.55) warnings.push("stop_too_tight");
    else warnings.push("stop_too_wide");

    if (Array.isArray(entryZone) && entryZone.length === 2) {
      const w = Math.abs(entryZone[1] - entryZone[0]);
      const wAtr = w / atr;
      if (wAtr >= 0.06 && wAtr <= 0.38) v += 0.10;
      else if (wAtr < 0.06) warnings.push("zone_too_narrow");
      else warnings.push("zone_too_wide");
    }
  } else {
    warnings.push("atr_missing");
  }

  v = clamp(v, 0, 0.28);
  pr += v;

  // (3) Targets availability (0..0.22)
  let t = 0;
  if (Number.isFinite(tp1)) t += 0.12;
  else warnings.push("tp1_missing_level");

  const rr1 = rr(entry, stop, tp1);
  if (Number.isFinite(rr1)) {
    if (rr1 >= 1.0) t += 0.10;
    else warnings.push("rr_low");
  } else {
    warnings.push("rr_missing");
  }

  t = clamp(t, 0, 0.22);
  pr += t;

  // (4) Friction penalty subtract (0..0.22)
  const fp = clamp(nz(frictionPenalty, 0), 0, 0.22);
  pr -= fp;

  pr = clamp(pr, 0, 1);
  return { parameter_reliability: pr, warnings };
}

/* Hard gates: reject low-quality structures before scoring */
function hardReject({ type, atr, entry, stop, rr1, sweepPenAtr = null }) {
  const reasons = [];

  if (!(Number.isFinite(atr) && atr > 0)) reasons.push("hard_atr_missing");

  const rAtr = riskOverAtr(entry, stop, atr);
  if (!Number.isFinite(rAtr)) reasons.push("hard_risk_missing");
  else {
    if (rAtr < 0.45) reasons.push("hard_stop_too_tight");
    if (rAtr > 2.4) reasons.push("hard_stop_too_wide");
  }

  if (!Number.isFinite(rr1)) reasons.push("hard_rr_missing");
  else {
    if (type === "reversal_sweep" && rr1 < 0.95) reasons.push("hard_rr_too_low");
    if (type === "breakout" && rr1 < 0.95) reasons.push("hard_rr_too_low");
    if (type === "trend_continuation" && rr1 < 0.70) reasons.push("hard_rr_too_low");
  }

  if (type === "reversal_sweep") {
    if (!Number.isFinite(sweepPenAtr)) reasons.push("hard_sweep_strength_missing");
    else if (sweepPenAtr < 0.07) reasons.push("hard_sweep_too_weak");
  }

  return { ok: reasons.length === 0, reasons };
}

/* -------------------------- Targets (swings) ----------------------------- */
function pickTfAnchor(anchorLayer, tf) {
  return {
    atr: anchorLayer?.volatility?.atr?.[tf] ?? null,
    atrPct: anchorLayer?.volatility?.atr_pct?.[tf] ?? null,
    bosLast: anchorLayer?.structure?.by_tf?.[tf]?.bos_last ?? null,
    swingsRaw: anchorLayer?.structure?.by_tf?.[tf]?.swings_last ?? [],
    swingLast: anchorLayer?.structure?.by_tf?.[tf]?.swing_last ?? null,
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
  } else {
    const below = lows.filter((p) => p < entry);
    const tp1 = below.length ? below[below.length - 1] : null;
    const tp2 = below.length >= 2 ? below[below.length - 2] : null;
    return { tp1, tp2 };
  }
}

/* ----------------------------- Signal quality ---------------------------- */
function basePrior(snapshot) {
  // Convert snapshot.unified.scores.overall (strength) into a conservative prior probability.
  const s = clamp(nz(snapshot?.unified?.scores?.overall, 0.55), 0, 1);
  return 0.50 + 0.18 * (s - 0.50); // ~0.41..0.59
}

function computeSignalQuality({
  prior,
  regime,
  side,
  type,
  of,
  liq,
  oi,
  derivPen,
  ofDivPen,
  liqFeedPen,
}) {
  // Produce signal_quality 0..1 using logit aggregation + temperature-like damping.
  const notes = [];

  // Regime compatibility score 0..1
  const dir = side === "long" ? 1 : -1;
  const htfCompat = clamp((dir * nz(regime?.composite, 0) + 1) / 2, 0, 1);

  // Type-specific expectations
  let typeBias = 0; // delta logit
  if (type === "reversal_sweep") {
    // Reversal ok in weak trend/range; penalize strong opposing regime
    if (regime?.label === "bull" && side === "short") typeBias -= 0.18;
    if (regime?.label === "bear" && side === "long") typeBias -= 0.18;
  } else {
    // Continuation/breakout likes aligned regime
    if (htfCompat >= 0.65) typeBias += 0.10;
    if (htfCompat <= 0.40) typeBias -= 0.14;
  }

  // Start from prior
  const z0 = safeLogit(clamp(prior, 0.05, 0.95));

  // Evidence contributions (delta logits)
  const dz = [];

  dz.push({ name: "htf_compat", v: 0.30 * (htfCompat - 0.5) * 2 }); // -0.30..+0.30
  dz.push({ name: "type_bias", v: typeBias });

  if (of?.usable) dz.push({ name: "orderflow", v: 0.22 * (clamp(of.score, 0, 1) - 0.5) * 2 });
  if (liq?.usable) dz.push({ name: "liquidations", v: 0.12 * (clamp(liq.score, 0, 1) - 0.5) * 2 });
  if (oi?.usable) dz.push({ name: "open_interest", v: 0.14 * (clamp(oi.score, 0, 1) - 0.5) * 2 });

  // Penalties: derivatives crowding + divergence + feed issues
  const pen = clamp(nz(derivPen, 0), -0.10, 0.30) + clamp(nz(ofDivPen, 0), 0, 0.12) + clamp(nz(liqFeedPen, 0), 0, 0.12);
  dz.push({ name: "penalties", v: -1.0 * pen });

  // Bonus from OI supportive (kept modest)
  const bonus = clamp(nz(oi?.bonus, 0), 0, 0.10);
  dz.push({ name: "oi_bonus", v: 0.40 * bonus });

  const sum = dz.reduce((s, x) => s + (Number.isFinite(x.v) ? x.v : 0), 0);

  // Temperature damping: more evidence => lower temperature (stronger confidence), but cap.
  // Evidence proxy: htfCompat + of + oi + liq availability
  const evidence =
    0.35 * htfCompat +
    0.25 * (of?.usable ? of.score : 0.5) +
    0.20 * (oi?.usable ? oi.score : 0.5) +
    0.20 * (liq?.usable ? liq.score : 0.5);

  const t = 1.28 - 0.22 * clamp(evidence, 0, 1); // 1.06..1.28

  const z = (z0 + 1.25 * sum) / Math.max(1e-6, t);
  const raw = sigmoid(z);

  // Conservative caps: quality engine should not output “overconfident”
  const cap = (evidence >= 0.78 && pen < 0.08) ? 0.90 : 0.84;
  const signal_quality = Math.min(raw, cap);

  for (const x of dz) {
    if (Number.isFinite(x.v) && Math.abs(x.v) > 0.0001) notes.push(`${x.name}:${x.v.toFixed(3)}`);
  }

  return {
    signal_quality,
    signal_quality_raw: raw,
    signal_quality_cap: cap,
    temperature: t,
    htf_compat: htfCompat,
    notes,
  };
}

/* --------------------------- Execution state ----------------------------- */
function getRefPx(snapshot, preferEx = "bybit", preferField = "mark") {
  const ex = snapshot?.per_exchange?.[preferEx]?.ticker || null;
  const mark = nz(ex?.mark, null);
  const last = nz(ex?.last, null);
  const index = nz(ex?.index, null);

  if (preferField === "mark" && Number.isFinite(mark)) return mark;
  if (preferField === "last" && Number.isFinite(last)) return last;
  if (preferField === "index" && Number.isFinite(index)) return index;

  if (Number.isFinite(mark)) return mark;
  if (Number.isFinite(last)) return last;
  if (Number.isFinite(index)) return index;

  const ex2 = snapshot?.per_exchange || {};
  for (const k of Object.keys(ex2)) {
    const t = ex2[k]?.ticker || {};
    const m = nz(t?.mark, null);
    const l = nz(t?.last, null);
    const i = nz(t?.index, null);
    if (Number.isFinite(m)) return m;
    if (Number.isFinite(l)) return l;
    if (Number.isFinite(i)) return i;
  }
  return null;
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

function annotateExecutionState(setup, snapshot, refPx) {
  const nowTs = snapshot?.unified?.anchor_layer?.market?.now_ts ?? snapshot?.generated_at ?? Date.now();
  const atr = nz(setup?.execution_metrics?.atr, null);
  const ep = nz(setup?.entry_preferred, null);
  const zone = setup?.entry_zone;
  const stop = nz(setup?.stop, null);

  const reasons = [];
  if (!Number.isFinite(refPx)) reasons.push("ref_price_missing");

  const inside = Number.isFinite(refPx) ? inZone(refPx, zone) : false;
  const dz = Number.isFinite(refPx) ? distToZone(refPx, zone) : null;

  const distToEntry = (Number.isFinite(refPx) && Number.isFinite(ep)) ? Math.abs(refPx - ep) : null;
  const distToEntryAtr = (Number.isFinite(distToEntry) && Number.isFinite(atr) && atr > 0) ? distToEntry / atr : null;
  const distToZoneAtr = (Number.isFinite(dz) && Number.isFinite(atr) && atr > 0) ? dz / atr : null;

  // Invalidation
  const side = setup?.bias === "Long" ? "long" : (setup?.bias === "Short" ? "short" : null);
  let invalidated = false;
  if (side && Number.isFinite(refPx) && Number.isFinite(stop)) {
    if (side === "long" && refPx <= stop) invalidated = true;
    if (side === "short" && refPx >= stop) invalidated = true;
  }
  if (invalidated) reasons.push("price_beyond_invalidation");

  // Chase guards
  const type = setup?.type;
  const missedDistAtr = (type === "breakout") ? 0.32 : 0.26;
  const marketMaxDistAtr = 0.10;

  let phase = "waiting";
  let readiness = "no_trade";
  let order = { type: null, price: null, tif: null };

  if (!setup?.eligibility?.tradable) {
    reasons.push("not_tradable");
  } else if (invalidated) {
    phase = "invalidated";
  } else if (!Number.isFinite(refPx)) {
    // keep waiting
  } else if (Number.isFinite(distToZoneAtr) && distToZoneAtr >= missedDistAtr) {
    phase = "missed";
    reasons.push("price_too_far_from_entry_zone");
  } else if (inside) {
    phase = "ready";
    readiness = "limit_ok";
    order = { type: "LIMIT", price: Number.isFinite(ep) ? ep : refPx, tif: "GTC" };
    reasons.push("inside_entry_zone");
  } else {
    // not inside zone, allow MARKET only if extremely close to entry_preferred
    const allowMarket = Number.isFinite(distToEntryAtr) && distToEntryAtr <= marketMaxDistAtr;
    if (allowMarket) {
      phase = "ready";
      readiness = "market_ok";
      order = { type: "MARKET", price: null, tif: "IOC" };
      reasons.push("near_entry_preferred");
    } else {
      reasons.push("waiting_pullback_to_zone");
    }
  }

  setup.execution_state = {
    asof_ts: nowTs,
    ref_px: Number.isFinite(refPx) ? refPx : null,
    phase,
    readiness,
    order,
    proximity: {
      dist_to_entry: Number.isFinite(distToEntry) ? distToEntry : null,
      dist_to_entry_atr: Number.isFinite(distToEntryAtr) ? distToEntryAtr : null,
      inside_entry_zone: !!inside,
      dist_to_zone: Number.isFinite(dz) ? dz : null,
      dist_to_zone_atr: Number.isFinite(distToZoneAtr) ? distToZoneAtr : null,
    },
    reason: uniq(reasons),
  };

  return setup;
}

/* ----------------------------- Eligibility ------------------------------ */
function setEligibility(setup, { tradable = false, status = "rejected", reasons = [] } = {}) {
  setup.eligibility = {
    tradable: !!tradable,
    status: String(status || (tradable ? "tradable" : "rejected")),
    reasons: uniq(reasons),
  };
  return setup;
}

/* ============================== BUILDERS ================================ */

/* ------------ Builder: Reversal Sweep (quality-first) ------------------- */
function buildReversalSweep({ snapshot, tf = "60", oiSynth, regime, ctx }) {
  const al = snapshot?.unified?.anchor_layer;
  const nowTs = al?.market?.now_ts ?? Date.now();
  const { atr, swingsRaw, sweepLast } = pickTfAnchor(al, tf);

  if (!al || !sweepLast) return null;
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const side = sweepLast.side === "up" ? "short" : (sweepLast.side === "down" ? "long" : null);
  if (!side) return null;

  const reclaimed = nz(sweepLast.reclaimed_level, null);
  const wick = nz(sweepLast.wick_extreme, null);
  const confirmClose = nz(sweepLast.confirm_close, null);
  const anchorTs = nz(sweepLast.confirm_ts ?? sweepLast.sweep_ts, null);

  if (![reclaimed, wick, confirmClose].every(Number.isFinite)) return null;

  const step = chooseStep({ snapshot, atr, minStep: 0.1, atrFactor: 0.01 });

  // Entry zone around reclaimed, with ATR-linked width
  const band = Math.max(0.06 * atr, 0.05 * atr);
  const w = Math.max(0.05 * atr, band);

  let entryPreferred = (reclaimed + confirmClose) / 2;
  let entryZone = [reclaimed - w, reclaimed + w];

  // Bias preferred entry
  if (side === "short") entryPreferred = reclaimed + 0.35 * w;
  if (side === "long") entryPreferred = reclaimed - 0.35 * w;

  // Stop beyond wick with buffer
  const stopBuf = 0.25 * atr;
  const stop = side === "short" ? (wick + stopBuf) : (wick - stopBuf);

  // Targets from opposing swings
  const { tp1, tp2 } = nearestTargetsFromSwings(swingsRaw, side, entryPreferred);

  // Rounding
  entryZone = [roundToStep(entryZone[0], step), roundToStep(entryZone[1], step)];
  entryPreferred = roundToStep(entryPreferred, step);
  const stopR = roundToStep(stop, step);
  const tp1R = Number.isFinite(tp1) ? roundToStep(tp1, step) : null;
  const tp2R = Number.isFinite(tp2) ? roundToStep(tp2, step) : null;

  const rr1 = rr(entryPreferred, stopR, tp1R);
  const penAtr = Number.isFinite(sweepLast?.quality?.penetration) ? (sweepLast.quality.penetration / atr) : null;

  // Hard reject
  const hr = hardReject({ type: "reversal_sweep", atr, entry: entryPreferred, stop: stopR, rr1, sweepPenAtr: penAtr });
  if (!hr.ok) {
    return setEligibility({
      symbol: snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN",
      type: "reversal_sweep",
      bias: side === "long" ? "Long" : "Short",
      timeframe: tf,
      trigger: null,
      entry_zone: entryZone,
      entry_preferred: entryPreferred,
      stop: stopR,
      invalidation: stopR,
      targets: { tp1: tp1R, tp2: tp2R, tp3: null },
      r_multiple: { tp1: rr1, tp2: rr(entryPreferred, stopR, tp2R), tp3: null },
      final_score: 0,
      quality_tier: "D",
      warnings: uniq(["hard_reject"].concat(hr.reasons)),
      scores: { hard_reject: hr, warnings: uniq(hr.reasons), final_score: 0, quality_tier: "D" },
      execution_metrics: { atr, rr_tp1: rr1, risk_over_atr: riskOverAtr(entryPreferred, stopR, atr) },
    }, { tradable: false, status: "rejected", reasons: hr.reasons });
  }

  // Context signals
  const ofPack = selectOrderflow(snapshot?.unified?.features?.orderflow, 0.02);
  const of = orderflowScore(ofPack.best, side);
  const ofDiv = orderflowDivergencePenalty(snapshot);

  const liq = liquidationSignal(snapshot, side);
  const liqFeed = liquidationFeedQualityPenalty(snapshot);

  const oi = oiConfirm({ oiSynth, type: "reversal_sweep" });
  const derivPen = derivativesPenalty(snapshot, side, "reversal_sweep");

  // Friction penalty combines quality degraders
  const frictionPenalty = clamp(
    (ofPack.best && Number.isFinite(ofPack.best.confidence) && ofPack.best.confidence < 0.45 ? 0.06 : 0) +
    clamp(liqFeed.penalty, 0, 0.12) +
    clamp(ofDiv.penalty, 0, 0.12) +
    clamp(nz(oi.penalty, 0), 0, 0.14),
    0, 0.22
  );

  // Anchor strength proxy from sweep penetration ATR
  const anchorStrengthAtr = Number.isFinite(penAtr) ? penAtr : null;

  // Parameter reliability
  const prRes = computeParameterReliability({
    atr,
    entryZone,
    entry: entryPreferred,
    stop: stopR,
    tp1: tp1R,
    anchorKind: "sweep",
    anchorTs,
    nowTs,
    anchorStrengthAtr,
    frictionPenalty,
  });

  // Signal quality
  const prior = basePrior(snapshot);
  const sig = computeSignalQuality({
    prior,
    regime,
    side,
    type: "reversal_sweep",
    of,
    liq,
    oi,
    derivPen,
    ofDivPen: ofDiv.penalty,
    liqFeedPen: liqFeed.penalty,
  });

  // Final score
  const rrScore = rrToScore(rr1);
  const execPenalty = executionPenaltyFromWarnings(prRes.warnings.concat(liqFeed.notes || []).concat(ofDiv.notes || []).concat(oi.notes || []));
  const finalScore = clamp(
    0.68 * prRes.parameter_reliability +
    0.20 * rrScore +
    0.12 * sig.signal_quality -
    execPenalty,
    0, 1
  );

  const tier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const trigger = side === "short"
    ? "Up-sweep + reject (close back below reclaimed level) → reversal short"
    : "Down-sweep + reclaim (close back above reclaimed level) → reversal long";

  const warnings = uniq([])
    .concat(prRes.warnings)
    .concat(liqFeed.notes || [])
    .concat(ofDiv.notes || [])
    .concat(oi.notes || []);

  const setup = {
    symbol: snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN",
    type: "reversal_sweep",
    bias: side === "long" ? "Long" : "Short",
    timeframe: tf,
    trigger,

    entry_zone: entryZone,
    entry_preferred: entryPreferred,
    invalidation: stopR,
    stop: stopR,
    targets: { tp1: tp1R, tp2: tp2R, tp3: null },
    r_multiple: { tp1: rr1, tp2: rr(entryPreferred, stopR, tp2R), tp3: null },

    parameter_reliability: prRes.parameter_reliability,
    signal_quality: sig.signal_quality,
    final_score: finalScore,
    quality_tier: tier,

    anchors: {
      kind: "sweep",
      sweep: {
        side: sweepLast.side,
        reclaimed_level: reclaimed,
        wick_extreme: wick,
        confirm_close: confirmClose,
        ts: anchorTs,
        quality: {
          penetration: nz(sweepLast?.quality?.penetration, null),
          penetration_atr: penAtr,
          close_back_distance: nz(sweepLast?.quality?.close_back_distance, null),
          speed: nz(sweepLast?.quality?.speed, null),
        },
      },
    },

    execution_metrics: {
      atr,
      entry_zone_width: Math.abs(entryZone[1] - entryZone[0]),
      stop_distance: Math.abs(entryPreferred - stopR),
      risk_over_atr: riskOverAtr(entryPreferred, stopR, atr),
      rr_tp1: rr1,
      rr_score: rrScore,
    },

    signal_metrics: {
      regime,
      orderflow: of.usable ? { score: of.score, best: ofPack.best, mode: ofPack.mode } : null,
      orderflow_divergence_penalty: ofDiv.penalty,
      derivatives_penalty: derivPen,
      liquidations: liq.usable ? { score: liq.score } : null,
      liq_feed_penalty: liqFeed.penalty,
      open_interest: oi.usable ? { score: oi.score, impulse_median: oiSynth?.impulse_median, pct_median: oiSynth?.pct_median, bonus: oi.bonus, penalty: oi.penalty } : null,
      htf_compat: sig.htf_compat,
    },

    scores: {
      prior,
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: sig.signal_quality,
      signal_quality_raw: sig.signal_quality_raw,
      signal_quality_cap: sig.signal_quality_cap,
      rr_tp1: rr1,
      rr_score: rrScore,
      execution_penalty: execPenalty,
      hard_reject: hr,
      components: {
        friction_penalty: frictionPenalty,
        temperature: sig.temperature,
        signal_notes: sig.notes,
      },
      final_score: finalScore,
      quality_tier: tier,
      warnings,
    },

    warnings,
  };

  // Eligibility: tradable requires tier >= C and final_score >= 0.60 (quality-first)
  const tradable = finalScore >= 0.60 && tier !== "D";
  return setEligibility(setup, {
    tradable,
    status: tradable ? "tradable" : "waiting",
    reasons: tradable ? [] : ["score_below_threshold"],
  });
}

/* ------------ Builder: Breakout (BOS retest, fakeout-filtered) ----------- */
function buildBreakout({ snapshot, tf = "60", oiSynth, regime }) {
  const al = snapshot?.unified?.anchor_layer;
  const nowTs = al?.market?.now_ts ?? Date.now();
  const { atr, atrPct, bosLast, swingsRaw, swingLast } = pickTfAnchor(al, tf);

  if (!al || !bosLast || !Number.isFinite(bosLast.price)) return null;
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const side = bosLast.side === "bull" ? "long" : (bosLast.side === "bear" ? "short" : null);
  if (!side) return null;

  const step = chooseStep({ snapshot, atr, minStep: 0.1, atrFactor: 0.01 });

  const level = bosLast.price;

  // Retest band
  const w = Math.max(0.06 * atr, 0.05 * atr);
  let entryZone = [level - w, level + w];
  let entryPreferred = side === "long" ? (level + 0.25 * w) : (level - 0.25 * w);

  // Stop: prefer opposite swing; else buffer
  const stopBuf = 0.35 * atr;
  let stop = null;
  if (side === "long" && swingLast?.type === "low" && Number.isFinite(swingLast.price)) stop = swingLast.price - stopBuf;
  else if (side === "short" && swingLast?.type === "high" && Number.isFinite(swingLast.price)) stop = swingLast.price + stopBuf;
  else stop = side === "long" ? (level - 0.95 * atr) : (level + 0.95 * atr);

  const { tp1, tp2 } = nearestTargetsFromSwings(swingsRaw, side, entryPreferred);

  // Rounding
  entryZone = [roundToStep(entryZone[0], step), roundToStep(entryZone[1], step)];
  entryPreferred = roundToStep(entryPreferred, step);
  stop = roundToStep(stop, step);
  const tp1R = Number.isFinite(tp1) ? roundToStep(tp1, step) : null;
  const tp2R = Number.isFinite(tp2) ? roundToStep(tp2, step) : null;

  const rr1 = rr(entryPreferred, stop, tp1R);

  // Hard reject
  const hr = hardReject({ type: "breakout", atr, entry: entryPreferred, stop, rr1 });
  if (!hr.ok) return null;

  // Gate: TP must be meaningfully beyond BOS level
  const gateReasons = [];
  let gatePenalty = 0;

  if (!Number.isFinite(tp1R)) return null;
  const margin = 0.10 * atr;
  if (side === "long" && tp1R <= (level + margin)) return null;
  if (side === "short" && tp1R >= (level - margin)) return null;

  // Entry band should straddle BOS level (retest design)
  const lo = Math.min(entryZone[0], entryZone[1]);
  const hi = Math.max(entryZone[0], entryZone[1]);
  if (!(lo <= level && hi >= level)) { gateReasons.push("no_bos_retest_band"); gatePenalty += 0.06; }

  // BOS freshness
  const bosTs = nz(bosLast.ts, null);
  if (Number.isFinite(bosTs)) {
    const ageMs = nowTs - bosTs;
    if (ageMs > 5 * 24 * 60 * 60 * 1000) { gateReasons.push("bos_old"); gatePenalty += 0.08; }
  } else {
    gateReasons.push("bos_ts_missing");
    gatePenalty += 0.04;
  }

  // Context signals
  const ofPack = selectOrderflow(snapshot?.unified?.features?.orderflow, 0.02);
  const of = orderflowScore(ofPack.best, side);
  const ofDiv = orderflowDivergencePenalty(snapshot);

  const liq = liquidationSignal(snapshot, side);
  const liqFeed = liquidationFeedQualityPenalty(snapshot);

  const oi = oiConfirm({ oiSynth, type: "breakout" });
  const derivPen = derivativesPenalty(snapshot, side, "breakout");

  const frictionPenalty = clamp(
    (ofPack.best && Number.isFinite(ofPack.best.confidence) && ofPack.best.confidence < 0.45 ? 0.06 : 0) +
    clamp(liqFeed.penalty, 0, 0.12) +
    clamp(ofDiv.penalty, 0, 0.12) +
    clamp(nz(oi.penalty, 0), 0, 0.14) +
    clamp(gatePenalty, 0, 0.12),
    0, 0.22
  );

  // Anchor strength proxy (level anchors): better if ATR% low (clean), else medium
  const anchorStrengthAtr = Number.isFinite(atrPct) ? (atrPct < 0.01 ? 0.16 : 0.12) : 0.12;

  const prRes = computeParameterReliability({
    atr,
    entryZone,
    entry: entryPreferred,
    stop,
    tp1: tp1R,
    anchorKind: "level",
    anchorTs: bosTs,
    nowTs,
    anchorStrengthAtr,
    frictionPenalty,
  });

  const prior = basePrior(snapshot);
  const sig = computeSignalQuality({
    prior,
    regime,
    side,
    type: "breakout",
    of,
    liq,
    oi,
    derivPen,
    ofDivPen: ofDiv.penalty,
    liqFeedPen: liqFeed.penalty,
  });

  const rrScore = rrToScore(rr1);
  const warnings = uniq([])
    .concat(prRes.warnings)
    .concat(liqFeed.notes || [])
    .concat(ofDiv.notes || [])
    .concat(oi.notes || [])
    .concat(gateReasons);

  const execPenalty = executionPenaltyFromWarnings(warnings);

  const finalScore = clamp(
    0.68 * prRes.parameter_reliability +
    0.20 * rrScore +
    0.12 * sig.signal_quality -
    execPenalty,
    0, 1
  );

  const tier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const trigger = side === "long"
    ? "BOS_UP confirmed → retest band around BOS level → breakout continuation long"
    : "BOS_DOWN confirmed → retest band around BOS level → breakout continuation short";

  const setup = {
    symbol: snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN",
    type: "breakout",
    bias: side === "long" ? "Long" : "Short",
    timeframe: tf,
    trigger,

    entry_zone: entryZone,
    entry_preferred: entryPreferred,
    invalidation: stop,
    stop,
    targets: { tp1: tp1R, tp2: tp2R, tp3: null },
    r_multiple: { tp1: rr1, tp2: rr(entryPreferred, stop, tp2R), tp3: null },

    parameter_reliability: prRes.parameter_reliability,
    signal_quality: sig.signal_quality,
    final_score: finalScore,
    quality_tier: tier,

    anchors: {
      kind: "level",
      bos: { side: bosLast.side, price: level, ts: bosTs },
    },

    execution_metrics: {
      atr,
      entry_zone_width: Math.abs(entryZone[1] - entryZone[0]),
      stop_distance: Math.abs(entryPreferred - stop),
      risk_over_atr: riskOverAtr(entryPreferred, stop, atr),
      rr_tp1: rr1,
      rr_score: rrScore,
    },

    signal_metrics: {
      regime,
      orderflow: of.usable ? { score: of.score, best: ofPack.best, mode: ofPack.mode } : null,
      orderflow_divergence_penalty: ofDiv.penalty,
      derivatives_penalty: derivPen,
      liquidations: liq.usable ? { score: liq.score } : null,
      liq_feed_penalty: liqFeed.penalty,
      open_interest: oi.usable ? { score: oi.score, impulse_median: oiSynth?.impulse_median, pct_median: oiSynth?.pct_median, bonus: oi.bonus, penalty: oi.penalty } : null,
      htf_compat: sig.htf_compat,
    },

    scores: {
      prior,
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: sig.signal_quality,
      rr_tp1: rr1,
      rr_score: rrScore,
      hard_reject: hr,
      gates: { breakout_quality: { ok: true, reasons: gateReasons, penalty: gatePenalty } },
      execution_penalty: execPenalty,
      final_score: finalScore,
      quality_tier: tier,
      warnings,
    },

    warnings,
  };

  const tradable = finalScore >= 0.60 && tier !== "D";
  return setEligibility(setup, {
    tradable,
    status: tradable ? "tradable" : "waiting",
    reasons: tradable ? [] : ["score_below_threshold"],
  });
}

/* ---------- Builder: Trend Continuation (EMA pullback) ------------------- */
function buildTrendContinuation({ snapshot, tf = "60", oiSynth, regime }) {
  const al = snapshot?.unified?.anchor_layer;
  const nowTs = al?.market?.now_ts ?? Date.now();
  const tfFeat = snapshot?.unified?.features?.timeframes?.[tf];
  const { atr, atrPct, swingsRaw, swingLast } = pickTfAnchor(al, tf);

  if (!al || !tfFeat?.last) return null;
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const trendLabel = tfFeat?.labels?.trend || "range";
  const side = trendLabel === "bull" ? "long" : (trendLabel === "bear" ? "short" : null);
  if (!side) return null;

  // Gate: regime conflict hard
  if (side === "long" && regime?.composite < -0.6) return null;
  if (side === "short" && regime?.composite > 0.6) return null;

  const ema20 = nz(tfFeat.last.ema20, null);
  const ema50 = nz(tfFeat.last.ema50, null);
  const ema100 = nz(tfFeat.last.ema100, null);
  const ema200 = nz(tfFeat.last.ema200, null);
  if (![ema20, ema50].every(Number.isFinite)) return null;

  // EMA stack quality
  const hasStack = [ema20, ema50, ema100, ema200].every(Number.isFinite);
  if (hasStack) {
    const bullStack = ema20 > ema50 && ema50 > ema100 && ema100 > ema200;
    const bearStack = ema20 < ema50 && ema50 < ema100 && ema100 < ema200;
    if (side === "long" && !bullStack) return null;
    if (side === "short" && !bearStack) return null;
  }

  // RSI quality gate (soft)
  const rsi = nz(tfFeat.last.rsi14, null);
  if (Number.isFinite(rsi)) {
    if (side === "long" && rsi < 45) return null;
    if (side === "short" && rsi > 55) return null;
  }

  // ATR% sanity: too low or too high => noisy / violent
  if (Number.isFinite(atrPct)) {
    if (atrPct < 0.003) return null;
    if (atrPct > 0.030) return null;
  }

  const step = chooseStep({ snapshot, atr, minStep: 0.1, atrFactor: 0.01 });

  // Entry zone: EMA band with ATR padding
  const lo = Math.min(ema20, ema50);
  const hi = Math.max(ema20, ema50);
  const pad = Math.max(0.06 * atr, 0.05 * atr);
  let entryZone = [lo - pad, hi + pad];

  let entryPreferred = side === "long"
    ? (lo + 0.60 * (hi - lo))
    : (hi - 0.60 * (hi - lo));

  // Stop: recent swing + buffer, else zone edge
  const stopBuf = 0.35 * atr;
  let stop = null;
  if (side === "long" && swingLast?.type === "low" && Number.isFinite(swingLast.price)) stop = swingLast.price - stopBuf;
  else if (side === "short" && swingLast?.type === "high" && Number.isFinite(swingLast.price)) stop = swingLast.price + stopBuf;
  else stop = side === "long" ? (entryZone[0] - 0.60 * atr) : (entryZone[1] + 0.60 * atr);

  const { tp1, tp2 } = nearestTargetsFromSwings(swingsRaw, side, entryPreferred);

  // Rounding
  entryZone = [roundToStep(entryZone[0], step), roundToStep(entryZone[1], step)];
  entryPreferred = roundToStep(entryPreferred, step);
  stop = roundToStep(stop, step);
  const tp1R = Number.isFinite(tp1) ? roundToStep(tp1, step) : null;
  const tp2R = Number.isFinite(tp2) ? roundToStep(tp2, step) : null;

  const rr1 = rr(entryPreferred, stop, tp1R);

  // Hard reject
  const hr = hardReject({ type: "trend_continuation", atr, entry: entryPreferred, stop, rr1 });
  if (!hr.ok) return null;

  // Context signals
  const ofPack = selectOrderflow(snapshot?.unified?.features?.orderflow, 0.02);
  const of = orderflowScore(ofPack.best, side);
  const ofDiv = orderflowDivergencePenalty(snapshot);

  const liq = liquidationSignal(snapshot, side);
  const liqFeed = liquidationFeedQualityPenalty(snapshot);

  const oi = oiConfirm({ oiSynth, type: "trend_continuation" });
  const derivPen = derivativesPenalty(snapshot, side, "trend_continuation");

  const frictionPenalty = clamp(
    (ofPack.best && Number.isFinite(ofPack.best.confidence) && ofPack.best.confidence < 0.45 ? 0.06 : 0) +
    clamp(liqFeed.penalty, 0, 0.12) +
    clamp(ofDiv.penalty, 0, 0.12) +
    clamp(nz(oi.penalty, 0), 0, 0.14),
    0, 0.22
  );

  const anchorStrengthAtr = Number.isFinite(atrPct) && atrPct < 0.01 ? 0.14 : 0.11;

  const prRes = computeParameterReliability({
    atr,
    entryZone,
    entry: entryPreferred,
    stop,
    tp1: tp1R,
    anchorKind: "ema",
    anchorTs: nowTs,
    nowTs,
    anchorStrengthAtr,
    frictionPenalty,
  });

  const prior = basePrior(snapshot);
  const sig = computeSignalQuality({
    prior,
    regime,
    side,
    type: "trend_continuation",
    of,
    liq,
    oi,
    derivPen,
    ofDivPen: ofDiv.penalty,
    liqFeedPen: liqFeed.penalty,
  });

  const rrScore = rrToScore(rr1);
  const warnings = uniq([])
    .concat(prRes.warnings)
    .concat(liqFeed.notes || [])
    .concat(ofDiv.notes || [])
    .concat(oi.notes || []);

  const execPenalty = executionPenaltyFromWarnings(warnings);

  const finalScore = clamp(
    0.68 * prRes.parameter_reliability +
    0.20 * rrScore +
    0.12 * sig.signal_quality -
    execPenalty,
    0, 1
  );

  const tier = finalScore >= 0.80 ? "A" : finalScore >= 0.70 ? "B" : finalScore >= 0.60 ? "C" : "D";

  const trigger = side === "long"
    ? "Bull trend (EMA stack) → pullback into EMA band → continuation long"
    : "Bear trend (EMA stack) → pullback into EMA band → continuation short";

  const setup = {
    symbol: snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN",
    type: "trend_continuation",
    bias: side === "long" ? "Long" : "Short",
    timeframe: tf,
    trigger,

    entry_zone: entryZone,
    entry_preferred: entryPreferred,
    invalidation: stop,
    stop,
    targets: { tp1: tp1R, tp2: tp2R, tp3: null },
    r_multiple: { tp1: rr1, tp2: rr(entryPreferred, stop, tp2R), tp3: null },

    parameter_reliability: prRes.parameter_reliability,
    signal_quality: sig.signal_quality,
    final_score: finalScore,
    quality_tier: tier,

    anchors: {
      kind: "ema",
      ema_band: { ema20, ema50, tf },
    },

    execution_metrics: {
      atr,
      entry_zone_width: Math.abs(entryZone[1] - entryZone[0]),
      stop_distance: Math.abs(entryPreferred - stop),
      risk_over_atr: riskOverAtr(entryPreferred, stop, atr),
      rr_tp1: rr1,
      rr_score: rrScore,
    },

    signal_metrics: {
      regime,
      trend_label: trendLabel,
      orderflow: of.usable ? { score: of.score, best: ofPack.best, mode: ofPack.mode } : null,
      orderflow_divergence_penalty: ofDiv.penalty,
      derivatives_penalty: derivPen,
      liquidations: liq.usable ? { score: liq.score } : null,
      liq_feed_penalty: liqFeed.penalty,
      open_interest: oi.usable ? { score: oi.score, impulse_median: oiSynth?.impulse_median, pct_median: oiSynth?.pct_median, bonus: oi.bonus, penalty: oi.penalty } : null,
      htf_compat: sig.htf_compat,
    },

    scores: {
      prior,
      parameter_reliability: prRes.parameter_reliability,
      signal_quality: sig.signal_quality,
      rr_tp1: rr1,
      rr_score: rrScore,
      hard_reject: hr,
      execution_penalty: execPenalty,
      final_score: finalScore,
      quality_tier: tier,
      warnings,
    },

    warnings,
  };

  const tradable = finalScore >= 0.60 && tier !== "D";
  return setEligibility(setup, {
    tradable,
    status: tradable ? "tradable" : "waiting",
    reasons: tradable ? [] : ["score_below_threshold"],
  });
}

/* ============================= MAIN API ================================= */
export function buildSetupsV3(snapshot, opts = {}) {
  const symbol = snapshot?.symbol || snapshot?.request?.symbol || "UNKNOWN";
  const al = snapshot?.unified?.anchor_layer;

  const diagnostics = {
    version: "3.0",
    symbol,
    generated_at: snapshot?.generated_at ?? null,
    notes: [],
    data_quality: snapshot?.unified?.data_quality ?? null,
  };

  if (!al) {
    diagnostics.notes.push("anchor_layer_missing");
    return {
      version: "3.0",
      symbol,
      regime: null,
      primary: null,
      alternative: null,
      watchlist: [],
      diagnostics,
    };
  }

  const tfMap = snapshot?.unified?.features?.timeframes || {};
  const regime = scoreRegime(tfMap);

  const oiSynth = synthesizeOI(snapshot);

  // Candidate timeframes:
  const preferTf = String(opts.prefer_tf || "60");
  const tfs = Array.from(new Set([preferTf, "15", "60", "240"]))
    .filter((tf) => al?.structure?.by_tf?.[tf] || al?.liquidity?.by_tf?.[tf]);

  const candidates = [];

  for (const tf of tfs) {
    const rs = buildReversalSweep({ snapshot, tf, oiSynth, regime, ctx: {} });
    if (rs) candidates.push(rs);

    const bo = buildBreakout({ snapshot, tf, oiSynth, regime });
    if (bo) candidates.push(bo);

    const tc = buildTrendContinuation({ snapshot, tf, oiSynth, regime });
    if (tc) candidates.push(tc);
  }

  // Attach execution state (ref price)
  const refPx = getRefPx(snapshot, String(opts.prefer_exchange || "bybit"), "mark");
  for (const s of candidates) annotateExecutionState(s, snapshot, refPx);

  // Filter & rank:
  // - Primary goal: quality, so prioritize final_score then parameter_reliability, then rr_score.
  const tradable = candidates.filter((s) => !!s?.eligibility?.tradable);

  const rank = (a, b) => {
    const fa = nz(a?.final_score, 0);
    const fb = nz(b?.final_score, 0);
    if (fb !== fa) return fb - fa;

    const pa = nz(a?.parameter_reliability, 0);
    const pb = nz(b?.parameter_reliability, 0);
    if (pb !== pa) return pb - pa;

    const ra = nz(a?.execution_metrics?.rr_score, 0);
    const rb = nz(b?.execution_metrics?.rr_score, 0);
    return rb - ra;
  };

  tradable.sort(rank);

  // Primary selection: best tradable
  const primary = tradable[0] || null;

  // Alternative selection: prefer different TYPE, then different BIAS, then next best
  let alternative = null;
  if (primary) {
    alternative = tradable.find((s) => s && s.type !== primary.type) || null;
    if (!alternative) alternative = tradable.find((s) => s && s.bias !== primary.bias) || null;
    if (!alternative) alternative = tradable[1] || null;
  } else {
    alternative = tradable[1] || null;
  }

  // Watchlist: include tradable + high-potential waiting (tier C/D but close)
  const waiting = candidates
    .filter((s) => s && !s.eligibility?.tradable)
    .filter((s) => nz(s.final_score, 0) >= 0.52) // near-threshold monitors
    .sort(rank);

  const watchlist = []
    .concat(tradable.slice(0, 8))
    .concat(waiting.slice(0, 6))
    .slice(0, 12);

  if (!primary) diagnostics.notes.push("no_tradable_setups");
  if (!Number.isFinite(refPx)) diagnostics.notes.push("ref_price_missing");

  return {
    version: "3.0",
    symbol,
    regime,
    primary,
    alternative,
    watchlist,
    diagnostics,
  };
}
