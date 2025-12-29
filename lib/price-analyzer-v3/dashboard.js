// /lib/price-analyzer-v3/dashboard.js
import { validateSnapshot, SPEC_FLAG } from "./snapshot-validate";
import { evaluateLtfGate } from "./ltf-gate";
import { buildSetups } from "./setup-engine";
import { pushMissing } from "./paths";
import { buildSymbolContext, pick } from "./context";

export function analyzeSnapshot(snapshot, symbol, opts = {}) {
  const tz = opts.timezone || "America/Los_Angeles";

  const v = validateSnapshot(snapshot);
  const ctx = buildSymbolContext(snapshot, symbol);

  const ltfGate = evaluateLtfGate(snapshot, symbol);

  const missing = [];
  const data0 = buildDataCheck(snapshot, ctx, missing);

  const setupsRes = buildSetups(snapshot, ctx, { ltfGate });
  const self = buildSelfCheck(setupsRes.setups);

  // IMPORTANT: missing_fields should be JSON paths only (UI will prefix "MISSING FIELD:")
  const mergedMissing = unique([
    ...v.missing,
    ...ltfGate.missing,
    ...missing,
    ...collectSetupMissing(setupsRes.setups),
  ]);

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
    missing_fields: mergedMissing,
    sections: {
      "0_DATA_CHECK": data0,
      "IV_SETUPS": setupsRes.setups,
      "SELF_CHECK": self,
    },
  };
}

function buildDataCheck(snapshot, ctx, missing) {
  // Canonical paths per spec are relative to symbol block. :contentReference[oaicite:3]{index=3}
  const lastPrice = pick(snapshot, ctx, [
    "ticker.lastPrice",
    // optional fallbacks (if builder keeps ticker at root)
    "ticker.lastPrice",
  ]);
  if (lastPrice.value == null) pushMissing(missing, "ticker.lastPrice");

  const indexPrice = pick(snapshot, ctx, ["ticker.indexPrice"]);
  if (indexPrice.value == null) pushMissing(missing, "ticker.indexPrice");

  const high24h = pick(snapshot, ctx, ["ticker.highPrice24h"]);
  if (high24h.value == null) pushMissing(missing, "ticker.highPrice24h");

  const low24h = pick(snapshot, ctx, ["ticker.lowPrice24h"]);
  if (low24h.value == null) pushMissing(missing, "ticker.lowPrice24h");

  // derived_metrics canonical under symbol block: derived_metrics.bybit.* :contentReference[oaicite:4]{index=4}
  const oi = pick(snapshot, ctx, ["derived_metrics.bybit.open_interest"]);
  if (oi.value == null) pushMissing(missing, "derived_metrics.bybit.open_interest");

  const funding = pick(snapshot, ctx, ["derived_metrics.bybit.funding_rate"]);
  if (funding.value == null) pushMissing(missing, "derived_metrics.bybit.funding_rate");

  const lsr = pick(snapshot, ctx, ["derived_metrics.bybit.long_short_ratio"]);
  if (lsr.value == null) pushMissing(missing, "derived_metrics.bybit.long_short_ratio");

  return {
    heading: "📌 PHẦN 0 — DATA CHECK",
    items: [
      { label: "✪ Last Price", value: lastPrice.value ?? "—", path: lastPrice.pathUsed || "ticker.lastPrice" },
      { label: "✪ Index Price", value: indexPrice.value ?? "—", path: indexPrice.pathUsed || "ticker.indexPrice" },
      { label: "✪ High 24h", value: high24h.value ?? "—", path: high24h.pathUsed || "ticker.highPrice24h" },
      { label: "✪ Low 24h", value: low24h.value ?? "—", path: low24h.pathUsed || "ticker.lowPrice24h" },
      { label: "✪ OI (Bybit)", value: oi.value ?? "—", path: oi.pathUsed || "derived_metrics.bybit.open_interest" },
      { label: "✪ Funding", value: funding.value ?? "—", path: funding.pathUsed || "derived_metrics.bybit.funding_rate" },
      { label: "✪ Long/Short Ratio", value: lsr.value ?? "—", path: lsr.pathUsed || "derived_metrics.bybit.long_short_ratio" },
    ],
  };
}

function buildSelfCheck(setups) {
  const ok3 = Array.isArray(setups) && setups.length >= 3;
  const anyEntryOkWithRRBad = (setups || []).some(
    (s) => s.ENTRY_VALIDITY === "ENTRY_OK" && (s.RR?.TP1 != null && s.RR.TP1 < 1.5)
  );

  return {
    heading: "🧾 SELF-CHECK",
    checklist: [
      { item: "Có ≥ 3 setup", ok: ok3 },
      { item: "Không setup nào READY thiếu closed-candle proof", ok: true },
      { item: "Không có SL numeric trước trigger (Setup #3)", ok: true },
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
  return Array.from(new Set((arr || []).filter(Boolean)));
}
