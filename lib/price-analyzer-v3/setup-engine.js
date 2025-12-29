// /lib/price-analyzer-v3/setup-engine.js
import { pick } from "./context";
import {
  getClosedCandleProofHTF,
  getClosedCandleProofLTF,
  assertIndicatorLastIsClosed,
  normalizeOHLC,
} from "./closed-candle";
import { rr } from "./math";

/**
 * SPEC v3.3-full-ai-core (Core engine – deterministic, fail-fast)
 * - Core paths thiếu => BUILD-UP + ENTRY_WAIT, cấm trigger confirm & cấm numeric SL/TP/RR.
 * - LTF gate: actionable=false => ENTRY_WAIT (hard blocker).
 */

export function buildSetups(snapshot, ctx, runCtx) {
  const setups = [];

  const lastPrice = pick(snapshot, ctx, ["ticker.lastPrice"]).value; // NOT core
  const atrH1 = pick(snapshot, ctx, ['indicators["60"].atr14']).value; // core
  const h4Trend = pick(snapshot, ctx, ["price_structure.H4.trend_label"]).value; // core
  const h1Trend = pick(snapshot, ctx, ["price_structure.H1.trend_label"]).value; // core

  const ltfGate = runCtx?.ltfGate || null;

  setups.push(
    buildSetup1(snapshot, ctx, { lastPrice, atrH1, h4Trend, h1Trend, ltfGate })
  );
  setups.push(
    buildSetup2(snapshot, ctx, { lastPrice, atrH1, h4Trend, h1Trend, ltfGate })
  );
  setups.push(
    buildSetup3(snapshot, ctx, { lastPrice, atrH1, h4Trend, h1Trend, ltfGate })
  );

  return { setups, engine_missing: [] };
}

/* =========================
   Shared helpers
========================= */

function baseSetupTemplate(id, title) {
  return {
    id,
    title,
    direction: "LONG",
    SETUP_STATE: "BUILD-UP",
    ENTRY_VALIDITY: "ENTRY_WAIT",
    ENTRY_BLOCKER: "",
    WAIT_REASON: "",
    WAIT_SOURCE_PATH: "",
    CONFIDENCE: 0,
    ENTRY_ZONE: null,
    ENTRY_TRIGGER: {
      type: "",
      timeframe: "",
      candle: null,
      proof: null,
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

function applyWait(setup, waitReason, waitSourcePath, entryBlocker) {
  setup.ENTRY_VALIDITY = "ENTRY_WAIT";
  setup.WAIT_REASON = waitReason;
  setup.WAIT_SOURCE_PATH = waitSourcePath;
  setup.ENTRY_BLOCKER = entryBlocker;
}

function uniquePush(arr, v) {
  if (!v) return;
  if (!arr.includes(v)) arr.push(v);
}

function requirePick(snapshot, ctx, candidates, missing, canonicalForMissing) {
  const p = pick(snapshot, ctx, candidates);
  if (p.value === null || p.value === undefined) {
    uniquePush(missing, canonicalForMissing || candidates?.[0] || "UNKNOWN_PATH");
    return { value: null, pathUsed: p.pathUsed || "" };
  }
  return p; // { value, pathUsed }
}

/**
 * Core paths required (per SPEC 4.5.14.1(A)).
 * Nếu thiếu bất kỳ core path => fail-fast.
 */
function enforceCorePaths(snapshot, ctx, setup, inp) {
  const missing = setup.WHY.missing_fields;

  // Core: H4 trend
  if (inp.h4Trend == null) uniquePush(missing, "price_structure.H4.trend_label");
  // Core: H1 trend
  if (inp.h1Trend == null) uniquePush(missing, "price_structure.H1.trend_label");
  // Core: ATR(H1)
  if (!Number.isFinite(Number(inp.atrH1))) uniquePush(missing, 'indicators["60"].atr14');

  // Core: H1 last candle (ts + OHLC)
  const h1LastP = requirePick(
    snapshot,
    ctx,
    ['indicators["60"].last'],
    missing,
    'indicators["60"].last'
  );

  // Core: key levels PD + Daily
  const pdHighP = requirePick(
    snapshot,
    ctx,
    ["key_levels.previous_day.high"],
    missing,
    "key_levels.previous_day.high"
  );
  const pdLowP = requirePick(
    snapshot,
    ctx,
    ["key_levels.previous_day.low"],
    missing,
    "key_levels.previous_day.low"
  );
  const dHighP = requirePick(
    snapshot,
    ctx,
    ["key_levels.daily.high"],
    missing,
    "key_levels.daily.high"
  );
  const dLowP = requirePick(
    snapshot,
    ctx,
    ["key_levels.daily.low"],
    missing,
    "key_levels.daily.low"
  );

  const coreOk = missing.length === 0;

  if (!coreOk) {
    setup.SETUP_STATE = "BUILD-UP";
    applyWait(
      setup,
      "MISSING_FIELD",
      missing[0] || "",
      `DATA_INCOMPLETE: missing core path(s)`
    );
    setup.CONFIDENCE = 0;

    // WHY bullets must clearly state missing (SPEC)
    for (const p of missing) {
      setup.WHY.bullets.push(`MISSING FIELD: ${p}`);
      setup.WHY.paths.push(p);
    }
  }

  return {
    coreOk,
    core: {
      h1LastP,
      pdHighP,
      pdLowP,
      dHighP,
      dLowP,
    },
  };
}

function applyLtfGateIfBlocked(setup, inp) {
  if (inp?.ltfGate?.actionable === false) {
    const b = inp.ltfGate?.blocker;
    applyWait(
      setup,
      b?.wait_reason || "OTHER",
      b?.wait_source_path || "",
      b?.entry_blocker || "LTF gate blocked"
    );
    // Setup can still be "ALMOST_READY" if trigger/zone is ready.
    return true;
  }
  return false;
}

function evalEntryValidityByZone(setup, lastPrice, atrH1 /* for ENTRY_LATE optionally */) {
  const px = Number(lastPrice);
  if (!Number.isFinite(px)) {
    applyWait(setup, "MISSING_FIELD", "ticker.lastPrice", "DATA_INCOMPLETE: missing lastPrice");
    return;
  }
  if (!setup.ENTRY_ZONE) {
    applyWait(setup, "OTHER", "ENTRY_ZONE", "DATA_INCOMPLETE: missing ENTRY_ZONE");
    return;
  }

  const inZone = px >= setup.ENTRY_ZONE.low && px <= setup.ENTRY_ZONE.high;

  // Basic rule: OK if inZone, else WAIT
  setup.ENTRY_VALIDITY = inZone ? "ENTRY_OK" : "ENTRY_WAIT";
  if (!inZone) setup.ENTRY_BLOCKER = "PRICE_NOT_IN_ENTRY_ZONE";

  // Optional ENTRY_LATE rule (conservative): only if setup READY and has ATR
  const a = Number(atrH1);
  if (setup.SETUP_STATE === "READY" && Number.isFinite(a) && !inZone) {
    const lateBuffer = 0.25 * a;
    // if price moved away beyond lateBuffer on the "wrong" side -> ENTRY_LATE
    const away =
      setup.direction === "LONG" ? px > setup.ENTRY_ZONE.high + lateBuffer : px < setup.ENTRY_ZONE.low - lateBuffer;
    if (away) {
      setup.ENTRY_VALIDITY = "ENTRY_LATE";
      setup.ENTRY_BLOCKER = "PRICE_MOVED_AWAY_FROM_ZONE";
    }
  }
}

function fillRR(setup, entryAvg, sl, tp, label) {
  const r = rr({ direction: setup.direction, entryAvg, sl, tp });
  setup.RR[label] = r?.rr ?? null;
  setup.TP[label].RR = r?.rr ?? null;

  if (r?.invalid) {
    setup.SETUP_STATE = "INVALID";
    setup.ENTRY_VALIDITY = "ENTRY_OFF";
    setup.ENTRY_BLOCKER = "INVALID_RISK (SL wrong side)";
    return { ok: false };
  }

  if (Number.isFinite(r?.rr) && r.rr < 1.5) {
    setup.ENTRY_VALIDITY = "ENTRY_OFF";
    setup.ENTRY_BLOCKER = `RR(${label})<1.5`;
  }
  return { ok: true };
}

/* =========================
   SETUP #1 — Primary Trend Pullback
========================= */

function buildSetup1(snapshot, ctx, inp) {
  const s = baseSetupTemplate(1, "SETUP #1 — Primary Trend Pullback");

  // FAIL-FAST core paths
  const { coreOk, core } = enforceCorePaths(snapshot, ctx, s, inp);
  if (!coreOk) return s;

  const atrH1 = Number(inp.atrH1);
  const h4Trend = String(inp.h4Trend || "").toLowerCase();

  // Direction follows H4 bias (simple deterministic)
  if (h4Trend.includes("down")) s.direction = "SHORT";
  else if (h4Trend.includes("up")) s.direction = "LONG";
  else s.direction = "LONG";

  s.WHY.bullets.push(`HTF bias (H4) = ${inp.h4Trend}`);
  s.WHY.paths.push("price_structure.H4.trend_label");
  s.WHY.bullets.push(`H1 context = ${inp.h1Trend}`);
  s.WHY.paths.push("price_structure.H1.trend_label");

  // Zone: EMA20/EMA50 (H4)
  const ema20P = requirePick(snapshot, ctx, ['indicators["240"].ema.ema20'], s.WHY.missing_fields, 'indicators["240"].ema.ema20');
  const ema50P = requirePick(snapshot, ctx, ['indicators["240"].ema.ema50'], s.WHY.missing_fields, 'indicators["240"].ema.ema50');

  // EMA is not in Core list, but required for this setup’s zone.
  if (ema20P.value == null || ema50P.value == null) {
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", 'indicators["240"].ema', "DATA_INCOMPLETE: missing EMA band (H4)");
    s.WHY.bullets.push(`MISSING FIELD: indicators["240"].ema.ema20/ema50`);
    s.WHY.paths.push('indicators["240"].ema.ema20');
    s.WHY.paths.push('indicators["240"].ema.ema50');
    return s;
  }

  const ema20 = Number(ema20P.value);
  const ema50 = Number(ema50P.value);

  s.ENTRY_ZONE = {
    low: Math.min(ema20, ema50),
    high: Math.max(ema20, ema50),
    source_paths: [
      ema20P.pathUsed || 'indicators["240"].ema.ema20',
      ema50P.pathUsed || 'indicators["240"].ema.ema50',
    ],
    note: "EMA band (H4)",
  };

  s.WHY.bullets.push(`ENTRY_ZONE = EMA20/EMA50 band (H4)`);
  s.WHY.paths.push('indicators["240"].ema.ema20');
  s.WHY.paths.push('indicators["240"].ema.ema50');

  // Trigger: H1 closed candle proof + indicator alignment
  const proof = getClosedCandleProofHTF(snapshot, ctx.symbol, "60");
  if (!proof.ok) {
    // proof missing => cannot confirm trigger
    for (const p of proof.missingPaths || []) uniquePush(s.WHY.missing_fields, p);
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", (proof.missingPaths && proof.missingPaths[0]) || "", "DATA_INCOMPLETE: missing closed-candle proof (H1)");
    s.WHY.bullets.push(`MISSING FIELD: closed-candle proof (H1)`);
    return s;
  }

  const last = core.h1LastP.value;
  if (!assertIndicatorLastIsClosed(last, proof.lastClosedTs)) {
    // MISALIGNED => wait
    s.SETUP_STATE = "ALMOST_READY";
    applyWait(
      s,
      "OTHER",
      'indicators["60"].last.ts',
      `ENTRY_WAIT: indicator ts mismatch vs last_closed_ts (${proof.proofPathUsed})`
    );
    s.ENTRY_TRIGGER = {
      type: "H1 trigger (closed candle only)",
      timeframe: "H1",
      candle: null,
      proof: { last_closed_ts: proof.lastClosedTs, path: proof.proofPathUsed },
      status: "UNCONFIRMED",
      notes: "Indicator last.ts not aligned with last_closed_ts",
    };
    s.WHY.bullets.push(`Trigger not confirmed: indicator ts mismatch`);
    s.WHY.paths.push('indicators["60"].last');
    return s;
  }

  const ohlc = normalizeOHLC(last);
  if (!ohlc) {
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", 'indicators["60"].last', "DATA_INCOMPLETE: missing OHLC for H1 last");
    uniquePush(s.WHY.missing_fields, 'indicators["60"].last.(o/h/l/c)');
    s.WHY.bullets.push(`MISSING FIELD: indicators["60"].last.(o/h/l/c)`);
    return s;
  }

  s.ENTRY_TRIGGER = {
    type: "H1 trigger (closed candle only)",
    timeframe: "H1",
    candle: { tf: "60", ts: Number(last.ts), ...ohlc },
    proof: { last_closed_ts: proof.lastClosedTs, path: proof.proofPathUsed },
    status: "CONFIRMED",
    notes: "",
  };

  s.WHY.bullets.push(`Trigger confirmed (H1 closed)`);
  s.WHY.paths.push('indicators["60"].last');

  // If LTF gate blocks execution => WAIT (hard blocker), but keep readiness state
  if (applyLtfGateIfBlocked(s, inp)) {
    s.SETUP_STATE = "ALMOST_READY";
    s.CONFIDENCE = 55;
    return s;
  }

  // Now allowed to compute numeric SL/TP/RR (core ok + trigger confirmed)
  s.SETUP_STATE = "READY";
  s.CONFIDENCE = 65;

  // Entry validity depends on zone + lastPrice
  evalEntryValidityByZone(s, inp.lastPrice, atrH1);

  // TP/SL using PD levels (core ensured present)
  const pdHigh = Number(core.pdHighP.value);
  const pdLow = Number(core.pdLowP.value);

  const buffer = 0.25 * atrH1;
  if (s.direction === "LONG") {
    s.SL.price = s.ENTRY_ZONE.low - buffer;
    s.SL.rule = "min(zone_low) - 0.25*ATR(H1)";
    s.SL.source_paths = ['indicators["60"].atr14', 'indicators["240"].ema.ema20/ema50'];
    s.TP.TP1.price = pdHigh;
    s.TP.TP1.source_paths = [core.pdHighP.pathUsed || "key_levels.previous_day.high"];
  } else {
    s.SL.price = s.ENTRY_ZONE.high + buffer;
    s.SL.rule = "max(zone_high) + 0.25*ATR(H1)";
    s.SL.source_paths = ['indicators["60"].atr14', 'indicators["240"].ema.ema20/ema50'];
    s.TP.TP1.price = pdLow;
    s.TP.TP1.source_paths = [core.pdLowP.pathUsed || "key_levels.previous_day.low"];
  }

  const entryAvg = (s.ENTRY_ZONE.low + s.ENTRY_ZONE.high) / 2;
  if (s.SL.price != null && s.TP.TP1.price != null) {
    fillRR(s, entryAvg, s.SL.price, s.TP.TP1.price, "TP1");
  }

  return s;
}

/* =========================
   SETUP #2 — Opposite / Breakout / Continuation
========================= */

function buildSetup2(snapshot, ctx, inp) {
  const s = baseSetupTemplate(2, "SETUP #2 — Opposite / Breakout / Continuation");

  // FAIL-FAST core paths
  const { coreOk, core } = enforceCorePaths(snapshot, ctx, s, inp);
  if (!coreOk) return s;

  const atrH1 = Number(inp.atrH1);
  const pdHigh = Number(core.pdHighP.value);
  const pdLow = Number(core.pdLowP.value);

  // Trigger candle must be H1 closed
  const proof = getClosedCandleProofHTF(snapshot, ctx.symbol, "60");
  if (!proof.ok) {
    for (const p of proof.missingPaths || []) uniquePush(s.WHY.missing_fields, p);
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", (proof.missingPaths && proof.missingPaths[0]) || "", "DATA_INCOMPLETE: missing closed-candle proof (H1)");
    s.WHY.bullets.push(`MISSING FIELD: closed-candle proof (H1)`);
    return s;
  }

  const last = core.coreOk ? core.h1LastP.value : null;
  if (!assertIndicatorLastIsClosed(last, proof.lastClosedTs)) {
    s.SETUP_STATE = "ALMOST_READY";
    applyWait(
      s,
      "OTHER",
      'indicators["60"].last.ts',
      `ENTRY_WAIT: indicator ts mismatch vs last_closed_ts (${proof.proofPathUsed})`
    );
    return s;
  }

  const ohlc = normalizeOHLC(last);
  if (!ohlc) {
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", 'indicators["60"].last', "DATA_INCOMPLETE: missing OHLC for H1 last");
    uniquePush(s.WHY.missing_fields, 'indicators["60"].last.(o/h/l/c)');
    return s;
  }

  // Decide direction primarily by breakout level relative to close
  const close = Number(ohlc.c);
  const above = close > pdHigh;
  const below = close < pdLow;

  if (above) s.direction = "LONG";
  else if (below) s.direction = "SHORT";
  else {
    // fallback: opposite of H4 bias (simple deterministic)
    const h4 = String(inp.h4Trend || "").toLowerCase();
    s.direction = h4.includes("down") ? "LONG" : "SHORT";
  }

  s.WHY.bullets.push(`Breakout check: close(H1)=${close}, PD.high=${pdHigh}, PD.low=${pdLow}`);
  s.WHY.paths.push("key_levels.previous_day.high");
  s.WHY.paths.push("key_levels.previous_day.low");
  s.WHY.paths.push('indicators["60"].last');

  // Confirmed trigger if distance beyond 0.1*ATR(H1) outside level
  const level = s.direction === "LONG" ? pdHigh : pdLow;
  const dist = s.direction === "LONG" ? close - level : level - close;
  const confirmed = dist >= 0.1 * atrH1;

  s.ENTRY_TRIGGER = {
    type: "Breakout acceptance (H1 close)",
    timeframe: "H1",
    candle: { tf: "60", ts: Number(last.ts), ...ohlc },
    proof: { last_closed_ts: proof.lastClosedTs, path: proof.proofPathUsed },
    status: confirmed ? "CONFIRMED" : "UNCONFIRMED",
    notes: confirmed ? "" : "distance < 0.1*ATR(H1)",
  };

  if (!confirmed) {
    s.SETUP_STATE = "ALMOST_READY";
    applyWait(s, "OTHER", 'indicators["60"].last.c', "WAIT: distance < 0.1*ATR(H1)");
    s.CONFIDENCE = 45;
    return s;
  }

  // LTF gate (hard blocker)
  if (applyLtfGateIfBlocked(s, inp)) {
    s.SETUP_STATE = "ALMOST_READY";
    s.CONFIDENCE = 50;
    return s;
  }

  // Now allowed numeric zone/SL/TP/RR
  s.SETUP_STATE = "READY";
  s.CONFIDENCE = 60;

  // Entry zone around breakout level
  const buf = 0.35 * atrH1;
  s.ENTRY_ZONE = {
    low: level - buf,
    high: level + buf,
    source_paths: ["key_levels.previous_day.high/low"],
    note: "level ± 0.35*ATR(H1)",
  };

  evalEntryValidityByZone(s, inp.lastPrice, atrH1);

  // SL minimum distance from level
  const slMin = 0.35 * atrH1;
  s.SL.price = s.direction === "LONG" ? level - slMin : level + slMin;
  s.SL.rule = "sanity min stop = 0.35*ATR(H1) from breakout level";
  s.SL.source_paths = ['indicators["60"].atr14', "key_levels.previous_day.high/low"];

  // TP1: extension by 2*ATR(H1)
  const tp1 = s.direction === "LONG" ? level + 2 * atrH1 : level - 2 * atrH1;
  s.TP.TP1.price = tp1;
  s.TP.TP1.source_paths = ['indicators["60"].atr14', "key_levels.previous_day.high/low"];

  const entryAvg = (s.ENTRY_ZONE.low + s.ENTRY_ZONE.high) / 2;
  fillRR(s, entryAvg, s.SL.price, tp1, "TP1");

  return s;
}

/* =========================
   SETUP #3 — Range / Liquidity / Mean-Reversion
========================= */

function buildSetup3(snapshot, ctx, inp) {
  const s = baseSetupTemplate(3, "SETUP #3 — Range / Liquidity / Mean-Reversion");

  // FAIL-FAST core paths (range still needs boundaries)
  const { coreOk, core } = enforceCorePaths(snapshot, ctx, s, inp);
  if (!coreOk) return s;

  const atrH1 = Number(inp.atrH1);
  const pdHigh = Number(core.pdHighP.value);
  const pdLow = Number(core.pdLowP.value);

  // Setup #3 is LTF-triggered (M15 sweep+reclaim), but still must respect closed-candle proof M15
  const proof15 = getClosedCandleProofLTF(snapshot, ctx.symbol, "15");
  if (!proof15.ok) {
    for (const p of proof15.missingPaths || []) uniquePush(s.WHY.missing_fields, p);
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", (proof15.missingPaths && proof15.missingPaths[0]) || "", "DATA_INCOMPLETE: missing closed-candle proof (M15)");
    s.WHY.bullets.push(`MISSING FIELD: closed-candle proof (M15)`);
    return s;
  }

  // M15 last candle path is explicitly in spec as full LTF path;
  // using pick() may work if your context tries LTF, but we stay explicit/deterministic here.
  const ltfLastPath = `per_exchange_ltf.bybit.symbols[${ctx.symbol}].indicators_ltf["15"].last`;
  const last15P = pick(snapshot, ctx, [ltfLastPath, 'indicators_ltf["15"].last']);
  const last15 = last15P.value;

  if (!last15) {
    uniquePush(s.WHY.missing_fields, ltfLastPath);
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", ltfLastPath, "DATA_INCOMPLETE: missing M15 last candle");
    s.WHY.bullets.push(`MISSING FIELD: ${ltfLastPath}`);
    return s;
  }

  if (!assertIndicatorLastIsClosed(last15, proof15.lastClosedTs)) {
    s.SETUP_STATE = "ALMOST_READY";
    applyWait(
      s,
      "OTHER",
      `${ltfLastPath}.ts`,
      `ENTRY_WAIT: M15 indicator ts mismatch vs last_closed_ts (${proof15.proofPathUsed})`
    );
    return s;
  }

  const ohlc15 = normalizeOHLC(last15);
  if (!ohlc15) {
    uniquePush(s.WHY.missing_fields, `${ltfLastPath}.(o/h/l/c)`);
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "MISSING_FIELD", ltfLastPath, "DATA_INCOMPLETE: missing OHLC (M15)");
    return s;
  }

  // Sweep + reclaim logic using PD boundaries
  const sweptUp = Number(ohlc15.h) > pdHigh;
  const sweptDown = Number(ohlc15.l) < pdLow;
  const reclaimed = Number(ohlc15.c) <= pdHigh && Number(ohlc15.c) >= pdLow;
  const confirmed = reclaimed && (sweptUp || sweptDown);

  s.ENTRY_TRIGGER = {
    type: "Sweep + Reclaim (M15)",
    timeframe: "M15",
    candle: { tf: "15", ts: Number(last15.ts), ...ohlc15 },
    proof: { last_closed_ts: proof15.lastClosedTs, path: proof15.proofPathUsed },
    status: confirmed ? "CONFIRMED" : "UNCONFIRMED",
    notes: confirmed ? "" : "need sweep + reclaim within PD range",
  };

  s.WHY.bullets.push(`Range boundary (PD): high=${pdHigh}, low=${pdLow}`);
  s.WHY.paths.push("key_levels.previous_day.high");
  s.WHY.paths.push("key_levels.previous_day.low");
  s.WHY.paths.push(ltfLastPath);

  if (!confirmed) {
    s.SETUP_STATE = "BUILD-UP";
    applyWait(s, "OTHER", ltfLastPath, "WAIT: missing sweep+reclaim (M15)");
    s.CONFIDENCE = 35;
    return s;
  }

  // Direction: sweep high => SHORT, sweep low => LONG
  s.direction = sweptUp ? "SHORT" : "LONG";

  // LTF gate (hard blocker)
  if (applyLtfGateIfBlocked(s, inp)) {
    s.SETUP_STATE = "ALMOST_READY";
    s.CONFIDENCE = 50;
    return s;
  }

  // Now allowed numeric zone/SL/TP/RR
  s.SETUP_STATE = "READY";
  s.CONFIDENCE = 58;

  const boundary = sweptUp ? pdHigh : pdLow;

  // Entry zone around boundary (ATR(H1)-scaled)
  const buf = 0.35 * atrH1;
  s.ENTRY_ZONE = {
    low: boundary - buf,
    high: boundary + buf,
    source_paths: ["key_levels.previous_day.high/low"],
    note: "boundary ± 0.35*ATR(H1)",
  };

  evalEntryValidityByZone(s, inp.lastPrice, atrH1);

  // SL anchored to sweep candle (only after trigger confirmed)
  const slBuf = 0.25 * atrH1;
  if (s.direction === "SHORT") {
    s.SL.price = Number(ohlc15.h) + slBuf;
    s.SL.rule = "sweep high + 0.25*ATR(H1)";
    s.SL.source_paths = [ltfLastPath, 'indicators["60"].atr14'];
  } else {
    s.SL.price = Number(ohlc15.l) - slBuf;
    s.SL.rule = "sweep low - 0.25*ATR(H1)";
    s.SL.source_paths = [ltfLastPath, 'indicators["60"].atr14'];
  }

  // TP1: opposite PD boundary
  const tp1 = s.direction === "SHORT" ? pdLow : pdHigh;
  s.TP.TP1.price = tp1;
  s.TP.TP1.source_paths = [
    s.direction === "SHORT"
      ? core.pdLowP.pathUsed || "key_levels.previous_day.low"
      : core.pdHighP.pathUsed || "key_levels.previous_day.high",
  ];

  const entryAvg = (s.ENTRY_ZONE.low + s.ENTRY_ZONE.high) / 2;
  fillRR(s, entryAvg, s.SL.price, tp1, "TP1");

  return s;
}
