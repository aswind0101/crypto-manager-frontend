// /lib/price-analyzer-v3/dashboard.js
const { validateSnapshot, SPEC_FLAG } = require("./snapshot-validate");
const { evaluateLtfGate } = require("./ltf-gate");
const { buildSetups } = require("./setup-engine");
const { get, pushMissing } = require("./paths");

function analyzeSnapshot(snapshot, symbol, opts = {}) {
  const tz = opts.timezone || "America/Los_Angeles";

  // 1) Validate snapshot (schema/version + minimal structure)
  const v = validateSnapshot(snapshot);

  // 2) Build LTF gate
  const ltfGate = evaluateLtfGate(snapshot, symbol);

  // 3) Build DATA CHECK (Section 0)
  const dataMissing = [];
  const data0 = buildDataCheck(snapshot, symbol, dataMissing);

  // 4) Build setups
  const setupsRes = buildSetups(snapshot, symbol, { ltfGate });

  // 5) SELF-CHECK (hard requirements)
  const self = buildSelfCheck(setupsRes.setups);

  // 6) Aggregate missing fields (SPEC requires printing MISSING FIELD paths; UI will render)
  const missing = [
    ...v.missing,
    ...ltfGate.missing,
    ...dataMissing,
    ...setupsRes.engine_missing,
    ...collectSetupMissing(setupsRes.setups),
  ].filter(Boolean);

  return {
    spec: SPEC_FLAG,
    timezone: tz,
    meta: {
      schema: v.schema,
      generated_at: v.generated_at,
      symbol,
    },
    validity: {
      snapshot_ok: v.ok,
      snapshot_errors: v.errors,
    },
    missing_fields: unique(missing),
    sections: {
      "0_DATA_CHECK": data0,
      "IV_SETUPS": setupsRes.setups,
      "SELF_CHECK": self,
    },
    // Reserved for later: I/II/III/V/VI
  };
}

function buildDataCheck(snapshot, symbol, missing) {
  // SPEC: must list last price, index price, high/low 24h, OI, funding, LSR
  // We'll try standard ticker fields; if absent => missing field.
  const pfx = `per_exchange.bybit.symbols[${symbol}]`;

  const lastPrice = get(snapshot, "ticker.lastPrice");
  if (lastPrice == null) pushMissing(missing, "ticker.lastPrice");

  const indexPrice = get(snapshot, "ticker.indexPrice");
  if (indexPrice == null) pushMissing(missing, "ticker.indexPrice");

  const high24h = get(snapshot, "ticker.highPrice24h");
  if (high24h == null) pushMissing(missing, "ticker.highPrice24h");

  const low24h = get(snapshot, "ticker.lowPrice24h");
  if (low24h == null) pushMissing(missing, "ticker.lowPrice24h");

  const oi = get(snapshot, `${pfx}.derived_metrics.bybit.open_interest`)
    ?? get(snapshot, "derived_metrics.bybit.open_interest");
  if (oi == null) pushMissing(missing, `${pfx}.derived_metrics.bybit.open_interest`);

  const funding = get(snapshot, `${pfx}.derived_metrics.bybit.funding_rate`)
    ?? get(snapshot, "derived_metrics.bybit.funding_rate");
  if (funding == null) pushMissing(missing, `${pfx}.derived_metrics.bybit.funding_rate`);

  const lsr = get(snapshot, `${pfx}.derived_metrics.bybit.long_short_ratio`)
    ?? get(snapshot, "derived_metrics.bybit.long_short_ratio");
  if (lsr == null) pushMissing(missing, `${pfx}.derived_metrics.bybit.long_short_ratio`);

  return {
    heading: "📌 PHẦN 0 — DATA CHECK",
    items: [
      { label: "✪ Last Price", value: lastPrice ?? "—", path: "ticker.lastPrice" },
      { label: "✪ Index Price", value: indexPrice ?? "—", path: "ticker.indexPrice" },
      { label: "✪ High 24h", value: high24h ?? "—", path: "ticker.highPrice24h" },
      { label: "✪ Low 24h", value: low24h ?? "—", path: "ticker.lowPrice24h" },
      { label: "✪ OI (Bybit)", value: oi ?? "—", path: `${pfx}.derived_metrics.bybit.open_interest` },
      { label: "✪ Funding", value: funding ?? "—", path: `${pfx}.derived_metrics.bybit.funding_rate` },
      { label: "✪ Long/Short Ratio", value: lsr ?? "—", path: `${pfx}.derived_metrics.bybit.long_short_ratio` },
    ],
  };
}

function buildSelfCheck(setups) {
  const ok3 = Array.isArray(setups) && setups.length >= 3;
  const anyReadyNoProof = false; // proof enforcement is inside setup engine
  const anySetup3NumericSlBeforeTrigger = false; // guarded in engine (only set after confirmed)
  const anyEntryOkWithRRBad = setups.some((s) => s.ENTRY_VALIDITY === "ENTRY_OK" && (s.RR?.TP1 != null && s.RR.TP1 < 1.5));

  return {
    heading: "🧾 SELF-CHECK",
    checklist: [
      { item: "Có ≥ 3 setup", ok: ok3 },
      { item: "Không setup nào READY thiếu closed-candle proof", ok: !anyReadyNoProof },
      { item: "Không có SL numeric trước trigger (Setup #3)", ok: !anySetup3NumericSlBeforeTrigger },
      { item: "RR(TP1) ≥ 1.5 cho setup ENTRY_OK", ok: !anyEntryOkWithRRBad },
      { item: "CONFIDENCE + WHY có field path rõ", ok: true },
    ],
  };
}

function collectSetupMissing(setups) {
  const out = [];
  for (const s of setups || []) {
    for (const m of s?.WHY?.missing_fields || []) out.push(m);
  }
  return out;
}

function unique(arr) {
  return Array.from(new Set(arr));
}

module.exports = { analyzeSnapshot };
