// /lib/price-analyzer-v3/setup-engine.js
const { get, pushMissing } = require("./paths");
const {
  getClosedCandleProofHTF,
  getClosedCandleProofLTF,
  assertIndicatorLastIsClosed,
  normalizeOHLC,
} = require("./closed-candle");
const { rr } = require("./math");

function buildSetups(snapshot, symbol, ctx) {
  const missing = [];
  const setups = [];

  // Common fields we will need
  const lastPrice = get(snapshot, "ticker.lastPrice");
  if (lastPrice == null) pushMissing(missing, "ticker.lastPrice");

  const atrH1 = get(snapshot, `per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`);
  if (atrH1 == null) pushMissing(missing, `per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`);

  const h4Trend = get(snapshot, `per_exchange.bybit.symbols[${symbol}].price_structure.H4.trend_label`)
    ?? get(snapshot, `price_structure.H4.trend_label`); // some snapshots keep symbol-less
  if (h4Trend == null) pushMissing(missing, `per_exchange.bybit.symbols[${symbol}].price_structure.H4.trend_label`);

  // LTF gate (execution/data gate)
  const ltfGate = ctx.ltfGate; // produced by dashboard pipeline

  setups.push(buildSetup1(snapshot, symbol, { lastPrice, atrH1, h4Trend, ltfGate }));
  setups.push(buildSetup2(snapshot, symbol, { lastPrice, atrH1, h4Trend, ltfGate }));
  setups.push(buildSetup3(snapshot, symbol, { lastPrice, atrH1, h4Trend, ltfGate }));

  return { setups, engine_missing: missing };
}

function baseSetupTemplate(id, title) {
  return {
    id,
    title,
    direction: "LONG", // default, override per setup
    SETUP_STATE: "BUILD-UP",
    ENTRY_VALIDITY: "ENTRY_WAIT",
    ENTRY_BLOCKER: "",
    WAIT_REASON: "",
    WAIT_SOURCE_PATH: "",
    CONFIDENCE: 0,
    ENTRY_ZONE: null, // { low, high, source_paths[] }
    ENTRY_TRIGGER: {
      type: "",
      timeframe: "",
      candle: null, // { tf, ts, o,h,l,c }
      proof: null,  // { last_closed_ts, path }
      status: "UNCONFIRMED",
      notes: "",
    },
    SL: { price: null, rule: "", source_paths: [] },
    TP: {
      TP1: { price: null, source_paths: [], RR: null },
      TP2: { price: null, source_paths: [], RR: null },
      TP3: { price: null, source_paths: [], RR: null },
    },
    RR: { TP1: null, TP2: null, TP3: null },
    RISK: { level: "HIGH", drivers: [], mitigation: [] },
    WHY: { bullets: [], paths: [], missing_fields: [] },
  };
}

/**
 * Setup #1 — Primary Trend Pullback
 * Mapping per SPEC uses:
 * - HTF: price_structure.H4.trend_label, htf_trend_context.alignment/dominant_tf
 * - Trigger H1 closed: indicators["60"].last + closed proof meta.last_closed_kline_ts["60"]
 * - LTF trigger M15 closed + closed proof
 * - LTF gate: ltf_trigger_state actionable
 */
function buildSetup1(snapshot, symbol, inp) {
  const s = baseSetupTemplate(1, "SETUP #1 — Primary Trend Pullback");
  const missing = s.WHY.missing_fields;

  // Direction from H4 trend_label
  const trend = String(inp.h4Trend || "").toLowerCase();
  if (!trend) missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].price_structure.H4.trend_label`);
  if (trend.includes("down")) s.direction = "SHORT";
  else if (trend.includes("up")) s.direction = "LONG";
  else s.direction = "LONG"; // range/choppy -> default, but will not READY

  s.WHY.bullets.push(`• HTF trend (H4): ${inp.h4Trend ?? "—"}`);
  s.WHY.paths.push(`price_structure.H4.trend_label`);

  // ENTRY_ZONE (minimal, SPEC: must use ATR(H1) and valid sources; if missing ATR -> WAIT)
  // Here we attempt EMA band source (H4 ema20/ema50) if exists.
  const ema20 = get(snapshot, `per_exchange.bybit.symbols[${symbol}].indicators["240"].ema.ema20`);
  const ema50 = get(snapshot, `per_exchange.bybit.symbols[${symbol}].indicators["240"].ema.ema50`);
  const atrH1 = Number(inp.atrH1);

  if (!Number.isFinite(atrH1)) {
    missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`);
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`,
      "DATA_INCOMPLETE: missing ATR(H1) for ENTRY_ZONE");
    return s;
  }

  if (ema20 != null && ema50 != null) {
    const low = Math.min(Number(ema20), Number(ema50));
    const high = Math.max(Number(ema20), Number(ema50));
    s.ENTRY_ZONE = {
      low,
      high,
      source_paths: [
        `per_exchange.bybit.symbols[${symbol}].indicators["240"].ema.ema20`,
        `per_exchange.bybit.symbols[${symbol}].indicators["240"].ema.ema50`,
      ],
      note: "EMA band (H4)",
    };
  } else {
    missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].indicators["240"].ema.ema20/ema50`);
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["240"].ema`,
      "DATA_INCOMPLETE: missing EMA band for zone (Setup #1)");
    return s;
  }

  // Trigger: H1 indicators["60"].last must be closed (proof)
  const proof = getClosedCandleProofHTF(snapshot, symbol, "60");
  if (!proof.ok) {
    proof.missingPaths.forEach((p) => missing.push(`MISSING FIELD: ${p}`));
    applyWait(s, "MISSING_FIELD", proof.missingPaths[0] || "per_exchange...meta",
      "DATA_INCOMPLETE: missing closed-candle proof (H1)");
    return s;
  }

  const last = get(snapshot, `per_exchange.bybit.symbols[${symbol}].indicators["60"].last`);
  if (!last) {
    missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].indicators["60"].last`);
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].last`,
      "DATA_INCOMPLETE: missing trigger candle (H1 last)");
    return s;
  }

  if (!assertIndicatorLastIsClosed(last, proof.lastClosedTs)) {
    // Spec: mismatch => candle not valid to confirm trigger
    applyWait(s, "OTHER", `per_exchange.bybit.symbols[${symbol}].indicators["60"].last.ts`,
      `ENTRY_BLOCKED: indicator last.ts != last_closed_ts (${proof.proofPathUsed})`);
    s.ENTRY_TRIGGER.timeframe = "H1";
    s.ENTRY_TRIGGER.status = "UNCONFIRMED";
    s.ENTRY_TRIGGER.proof = { last_closed_ts: proof.lastClosedTs, path: proof.proofPathUsed };
    return s;
  }

  const ohlc = normalizeOHLC(last);
  if (!ohlc) {
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].last.(o/h/l/c)`,
      "DATA_INCOMPLETE: missing OHLC for trigger candle");
    return s;
  }

  s.ENTRY_TRIGGER.timeframe = "H1";
  s.ENTRY_TRIGGER.candle = { tf: "60", ts: Number(last.ts), ...ohlc };
  s.ENTRY_TRIGGER.proof = { last_closed_ts: proof.lastClosedTs, path: proof.proofPathUsed };

  // LTF Gate MUST pass for ENTRY_OK (even if trigger confirmed)
  if (!inp.ltfGate?.actionable) {
    const b = inp.ltfGate?.blocker;
    applyWait(s, b?.wait_reason || "OTHER", b?.wait_source_path || "",
      b?.entry_blocker || "LTF gate blocked");
    s.ENTRY_TRIGGER.status = "CONFIRMED"; // trigger can be confirmed, but execution blocked
    s.SETUP_STATE = "ALMOST_READY";
    s.CONFIDENCE = 55; // placeholder baseline
    return s;
  }

  // If current price inside zone => ENTRY_OK else WAIT/LATE; minimal implementation:
  const px = Number(inp.lastPrice);
  if (!Number.isFinite(px)) {
    applyWait(s, "MISSING_FIELD", "ticker.lastPrice", "DATA_INCOMPLETE: missing lastPrice");
    s.ENTRY_TRIGGER.status = "CONFIRMED";
    s.SETUP_STATE = "READY";
    s.CONFIDENCE = 60;
    return s;
  }

  const inZone = px >= s.ENTRY_ZONE.low && px <= s.ENTRY_ZONE.high;
  s.ENTRY_TRIGGER.status = "CONFIRMED";
  s.SETUP_STATE = "READY";
  s.CONFIDENCE = 65;

  if (inZone) {
    s.ENTRY_VALIDITY = "ENTRY_OK";
    s.ENTRY_BLOCKER = "";
  } else {
    s.ENTRY_VALIDITY = "ENTRY_WAIT";
    s.WAIT_REASON = "OTHER";
    s.WAIT_SOURCE_PATH = "ticker.lastPrice";
    s.ENTRY_BLOCKER = "PRICE_NOT_IN_ENTRY_ZONE";
  }

  // SL/TP/RR: placeholder if key levels exist; if missing => keep WAIT safe
  // TP1 must have RR >= 1.5 if computed, else ENTRY_OFF (SPEC)
  const prevHigh = get(snapshot, `per_exchange.bybit.symbols[${symbol}].key_levels.previous_day.high`)
    ?? get(snapshot, "key_levels.previous_day.high");
  const prevLow = get(snapshot, `per_exchange.bybit.symbols[${symbol}].key_levels.previous_day.low`)
    ?? get(snapshot, "key_levels.previous_day.low");

  // Simple: SL below/above zone with 0.25*ATR(H1)
  const buffer = 0.25 * atrH1;
  if (s.direction === "LONG") {
    s.SL.price = s.ENTRY_ZONE.low - buffer;
    s.SL.rule = "min(zone_low) - 0.25*ATR(H1)";
    if (prevHigh != null) s.TP.TP1.price = Number(prevHigh);
  } else {
    s.SL.price = s.ENTRY_ZONE.high + buffer;
    s.SL.rule = "max(zone_high) + 0.25*ATR(H1)";
    if (prevLow != null) s.TP.TP1.price = Number(prevLow);
  }

  const entryAvg = (s.ENTRY_ZONE.low + s.ENTRY_ZONE.high) / 2;
  const tp1 = s.TP.TP1.price;

  if (tp1 != null && s.SL.price != null) {
    const r = rr({ direction: s.direction, entryAvg, sl: s.SL.price, tp: tp1 });
    s.RR.TP1 = r?.rr ?? null;
    s.TP.TP1.RR = r?.rr ?? null;

    if (r?.invalid) {
      s.SETUP_STATE = "INVALID";
      s.ENTRY_VALIDITY = "ENTRY_OFF";
      s.ENTRY_BLOCKER = "INVALID_RISK (SL wrong side)";
      return s;
    }
    if (Number.isFinite(r?.rr) && r.rr < 1.5) {
      s.ENTRY_VALIDITY = "ENTRY_OFF";
      s.ENTRY_BLOCKER = "RR(TP1)<1.5";
    }
  } else {
    // Missing TP1 sources is not necessarily blocker for WAIT, but for ENTRY_OK should be execution-grade.
    s.WHY.missing_fields.push(`MISSING FIELD: key_levels.previous_day.(high/low) for TP1`);
  }

  return s;
}

function buildSetup2(snapshot, symbol, inp) {
  const s = baseSetupTemplate(2, "SETUP #2 — Opposite / Breakout / Continuation");
  const missing = s.WHY.missing_fields;

  // Needs key_levels (SPEC)
  const pdHigh = get(snapshot, `per_exchange.bybit.symbols[${symbol}].key_levels.previous_day.high`) ?? get(snapshot, "key_levels.previous_day.high");
  const pdLow = get(snapshot, `per_exchange.bybit.symbols[${symbol}].key_levels.previous_day.low`) ?? get(snapshot, "key_levels.previous_day.low");
  if (pdHigh == null) missing.push(`MISSING FIELD: key_levels.previous_day.high`);
  if (pdLow == null) missing.push(`MISSING FIELD: key_levels.previous_day.low`);

  // If missing critical => WAIT
  if (pdHigh == null || pdLow == null) {
    applyWait(s, "MISSING_FIELD", "key_levels.previous_day", "DATA_INCOMPLETE: missing breakout levels");
    return s;
  }

  // Minimal direction heuristic: if H4 downtrend => breakout opposite LONG, else SHORT (but NOT READY without proof)
  const trend = String(inp.h4Trend || "").toLowerCase();
  s.direction = trend.includes("down") ? "LONG" : "SHORT";

  // Trigger candle: allow H1 last with closed proof (SPEC)
  const proof = getClosedCandleProofHTF(snapshot, symbol, "60");
  if (!proof.ok) {
    proof.missingPaths.forEach((p) => missing.push(`MISSING FIELD: ${p}`));
    applyWait(s, "MISSING_FIELD", proof.missingPaths[0] || "per_exchange...meta",
      "DATA_INCOMPLETE: missing closed-candle proof (H1) for breakout");
    return s;
  }

  const last = get(snapshot, `per_exchange.bybit.symbols[${symbol}].indicators["60"].last`);
  if (!last) {
    missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].indicators["60"].last`);
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].last`,
      "DATA_INCOMPLETE: missing trigger candle (H1 last)");
    return s;
  }

  if (!assertIndicatorLastIsClosed(last, proof.lastClosedTs)) {
    applyWait(s, "OTHER", `per_exchange.bybit.symbols[${symbol}].indicators["60"].last.ts`,
      `ENTRY_BLOCKED: indicator last.ts != last_closed_ts (${proof.proofPathUsed})`);
    return s;
  }

  const ohlc = normalizeOHLC(last);
  if (!ohlc) {
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].last.(o/h/l/c)`,
      "DATA_INCOMPLETE: missing OHLC for trigger candle");
    return s;
  }

  // Define breakout level and minimal acceptance rule (distance ≥ 0.1*ATR(H1))
  const atrH1 = Number(inp.atrH1);
  if (!Number.isFinite(atrH1)) {
    missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`);
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`,
      "DATA_INCOMPLETE: missing ATR(H1)");
    return s;
  }

  const close = ohlc.c;
  const level = s.direction === "LONG" ? Number(pdHigh) : Number(pdLow);
  const dist = s.direction === "LONG" ? (close - level) : (level - close);

  s.ENTRY_TRIGGER = {
    type: "Breakout acceptance (H1 close)",
    timeframe: "H1",
    candle: { tf: "60", ts: Number(last.ts), ...ohlc },
    proof: { last_closed_ts: proof.lastClosedTs, path: proof.proofPathUsed },
    status: "UNCONFIRMED",
    notes: "",
  };

  if (dist >= 0.1 * atrH1) {
    s.ENTRY_TRIGGER.status = "CONFIRMED";
    s.SETUP_STATE = "READY";
    s.CONFIDENCE = 60;
  } else {
    s.SETUP_STATE = "ALMOST_READY";
    applyWait(s, "OTHER", "indicators[60].last.close",
      "WAIT: breakout acceptance not met (distance < 0.1*ATR(H1))");
    return s;
  }

  // LTF gate
  if (!inp.ltfGate?.actionable) {
    const b = inp.ltfGate?.blocker;
    applyWait(s, b?.wait_reason || "OTHER", b?.wait_source_path || "",
      b?.entry_blocker || "LTF gate blocked");
    return s;
  }

  // ENTRY_ZONE = level ± buffer (simple)
  const buf = 0.35 * atrH1;
  s.ENTRY_ZONE = { low: level - buf, high: level + buf, source_paths: ["key_levels.previous_day"], note: "level ± 0.35*ATR(H1)" };

  const px = Number(inp.lastPrice);
  if (!Number.isFinite(px)) {
    applyWait(s, "MISSING_FIELD", "ticker.lastPrice", "DATA_INCOMPLETE: missing lastPrice");
    return s;
  }

  const inZone = px >= s.ENTRY_ZONE.low && px <= s.ENTRY_ZONE.high;
  s.ENTRY_VALIDITY = inZone ? "ENTRY_OK" : "ENTRY_WAIT";
  if (!inZone) s.ENTRY_BLOCKER = "PRICE_NOT_IN_ENTRY_ZONE";

  // SL sanity locked (SPEC requires min distances; here minimal)
  const slMin = 0.35 * atrH1;
  if (s.direction === "LONG") s.SL.price = level - slMin;
  else s.SL.price = level + slMin;
  s.SL.rule = "sanity min stop = 0.35*ATR(H1) from level";

  // TP1: opposite key level as placeholder
  const tp1 = s.direction === "LONG" ? Number(pdHigh) + 2 * atrH1 : Number(pdLow) - 2 * atrH1;
  s.TP.TP1.price = tp1;

  const entryAvg = (s.ENTRY_ZONE.low + s.ENTRY_ZONE.high) / 2;
  const r = rr({ direction: s.direction, entryAvg, sl: s.SL.price, tp: tp1 });
  s.RR.TP1 = r?.rr ?? null;
  s.TP.TP1.RR = r?.rr ?? null;
  if (Number.isFinite(r?.rr) && r.rr < 1.5) {
    s.ENTRY_VALIDITY = "ENTRY_OFF";
    s.ENTRY_BLOCKER = "RR(TP1)<1.5";
  }

  return s;
}

function buildSetup3(snapshot, symbol, inp) {
  const s = baseSetupTemplate(3, "SETUP #3 — Range / Liquidity / Mean-Reversion");
  const missing = s.WHY.missing_fields;

  // Requires boundaries (SPEC)
  const pdHigh = get(snapshot, `per_exchange.bybit.symbols[${symbol}].key_levels.previous_day.high`) ?? get(snapshot, "key_levels.previous_day.high");
  const pdLow = get(snapshot, `per_exchange.bybit.symbols[${symbol}].key_levels.previous_day.low`) ?? get(snapshot, "key_levels.previous_day.low");
  if (pdHigh == null) missing.push(`MISSING FIELD: key_levels.previous_day.high`);
  if (pdLow == null) missing.push(`MISSING FIELD: key_levels.previous_day.low`);

  if (pdHigh == null || pdLow == null) {
    applyWait(s, "MISSING_FIELD", "key_levels.previous_day", "DATA_INCOMPLETE: missing range boundaries");
    return s;
  }

  // Setup3 is range/mean-revert: do NOT provide numeric SL until trigger confirmed (SPEC)
  s.SL.price = null;
  s.SL.rule = "TBD until sweep+reclaim trigger confirmed";

  // Trigger on M15 closed (SPEC)
  const proof15 = getClosedCandleProofLTF(snapshot, symbol, "15");
  if (!proof15.ok) {
    proof15.missingPaths.forEach((p) => missing.push(`MISSING FIELD: ${p}`));
    applyWait(s, "MISSING_FIELD", proof15.missingPaths[0] || "",
      "DATA_INCOMPLETE: missing closed-candle proof (M15) for sweep/reclaim");
    return s;
  }

  const last15 = get(snapshot, `per_exchange_ltf.bybit.symbols[${symbol}].indicators_ltf["15"].last`);
  if (!last15) {
    missing.push(`MISSING FIELD: per_exchange_ltf.bybit.symbols[${symbol}].indicators_ltf["15"].last`);
    applyWait(s, "MISSING_FIELD", `per_exchange_ltf.bybit.symbols[${symbol}].indicators_ltf["15"].last`,
      "DATA_INCOMPLETE: missing M15 last candle");
    return s;
  }

  if (!assertIndicatorLastIsClosed(last15, proof15.lastClosedTs)) {
    applyWait(s, "OTHER", `per_exchange_ltf.bybit.symbols[${symbol}].indicators_ltf["15"].last.ts`,
      `ENTRY_BLOCKED: M15 last.ts != last_closed_ts (${proof15.proofPathUsed})`);
    return s;
  }

  const ohlc = normalizeOHLC(last15);
  if (!ohlc) {
    applyWait(s, "MISSING_FIELD", `per_exchange_ltf.bybit.symbols[${symbol}].indicators_ltf["15"].last.(o/h/l/c)`,
      "DATA_INCOMPLETE: missing OHLC for trigger candle (M15)");
    return s;
  }

  // Check sweep+reclaim minimal (not full 4/4 with orderflow yet)
  // Sweep: high > pdHigh OR low < pdLow ; reclaim: close inside [pdLow, pdHigh]
  const sweptUp = ohlc.h > Number(pdHigh);
  const sweptDown = ohlc.l < Number(pdLow);
  const reclaimed = ohlc.c <= Number(pdHigh) && ohlc.c >= Number(pdLow);

  s.ENTRY_TRIGGER = {
    type: "Sweep + Reclaim (M15)",
    timeframe: "M15",
    candle: { tf: "15", ts: Number(last15.ts), ...ohlc },
    proof: { last_closed_ts: proof15.lastClosedTs, path: proof15.proofPathUsed },
    status: "UNCONFIRMED",
    notes: "",
  };

  if (!(reclaimed && (sweptUp || sweptDown))) {
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "OTHER", `per_exchange_ltf...indicators_ltf["15"].last`,
      "WAIT: missing sweep+reclaim conditions");
    return s;
  }

  // Direction: fade the sweep
  s.direction = sweptUp ? "SHORT" : "LONG";
  s.ENTRY_TRIGGER.status = "CONFIRMED";
  s.SETUP_STATE = "READY";
  s.CONFIDENCE = 58;

  // LTF gate still blocks execution
  if (!inp.ltfGate?.actionable) {
    const b = inp.ltfGate?.blocker;
    applyWait(s, b?.wait_reason || "OTHER", b?.wait_source_path || "",
      b?.entry_blocker || "LTF gate blocked");
    // Spec: Setup #3 numeric SL forbidden before trigger confirmed; here trigger confirmed,
    // but execution blocked => we still can keep SL TBD to be conservative.
    return s;
  }

  // ENTRY_ZONE: boundary area (simple)
  const atrH1 = Number(inp.atrH1);
  if (!Number.isFinite(atrH1)) {
    missing.push(`MISSING FIELD: per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`);
    applyWait(s, "MISSING_FIELD", `per_exchange.bybit.symbols[${symbol}].indicators["60"].atr14`,
      "DATA_INCOMPLETE: missing ATR(H1)");
    return s;
  }
  const buf = 0.35 * atrH1;
  const boundary = sweptUp ? Number(pdHigh) : Number(pdLow);
  s.ENTRY_ZONE = { low: boundary - buf, high: boundary + buf, source_paths: ["key_levels.previous_day"], note: "boundary ± 0.35*ATR(H1)" };

  const px = Number(inp.lastPrice);
  if (!Number.isFinite(px)) {
    applyWait(s, "MISSING_FIELD", "ticker.lastPrice", "DATA_INCOMPLETE: missing lastPrice");
    return s;
  }

  const inZone = px >= s.ENTRY_ZONE.low && px <= s.ENTRY_ZONE.high;
  s.ENTRY_VALIDITY = inZone ? "ENTRY_OK" : "ENTRY_WAIT";
  if (!inZone) s.ENTRY_BLOCKER = "PRICE_NOT_IN_ENTRY_ZONE";

  // After trigger confirmed, we may set numeric SL per SPEC (outside sweep extreme + buffer)
  const slBuf = 0.25 * atrH1;
  if (s.direction === "SHORT") {
    s.SL.price = ohlc.h + slBuf;
    s.SL.rule = "sweep high + 0.25*ATR(H1)";
  } else {
    s.SL.price = ohlc.l - slBuf;
    s.SL.rule = "sweep low - 0.25*ATR(H1)";
  }

  // TP ladder placeholder (range mid not guaranteed in snapshot). We set TP1 to opposing boundary.
  const tp1 = s.direction === "SHORT" ? Number(pdLow) : Number(pdHigh);
  s.TP.TP1.price = tp1;

  const entryAvg = (s.ENTRY_ZONE.low + s.ENTRY_ZONE.high) / 2;
  const r = rr({ direction: s.direction, entryAvg, sl: s.SL.price, tp: tp1 });
  s.RR.TP1 = r?.rr ?? null;
  s.TP.TP1.RR = r?.rr ?? null;
  if (Number.isFinite(r?.rr) && r.rr < 1.5) {
    s.ENTRY_VALIDITY = "ENTRY_OFF";
    s.ENTRY_BLOCKER = "RR(TP1)<1.5";
  }

  return s;
}

function applyWait(setup, waitReason, waitSourcePath, entryBlocker) {
  setup.ENTRY_VALIDITY = "ENTRY_WAIT";
  setup.WAIT_REASON = waitReason;
  setup.WAIT_SOURCE_PATH = waitSourcePath;
  setup.ENTRY_BLOCKER = entryBlocker;
}

module.exports = { buildSetups };
