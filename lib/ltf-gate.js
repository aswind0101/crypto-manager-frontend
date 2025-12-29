// /lib/price-analyzer-v3/ltf-gate.js
const { get, pushMissing } = require("./paths");

function evaluateLtfGate(snapshot, symbol) {
  const missing = [];
  const p = `per_exchange_ltf.bybit.symbols[${symbol}].ltf_trigger_state`;

  const state = get(snapshot, `${p}.state`);
  const actionable = get(snapshot, `${p}.actionable`);
  const reasonCode = get(snapshot, `${p}.reason_code`);
  const reasonDetail = get(snapshot, `${p}.reason_detail`);

  if (state == null) pushMissing(missing, `${p}.state`);
  if (actionable == null) pushMissing(missing, `${p}.actionable`);

  if (missing.length) {
    return {
      ok: false,
      actionable: false,
      state: "INVALIDATED",
      blocker: {
        entry_validity: "ENTRY_WAIT",
        wait_reason: "MISSING_FIELD",
        wait_source_path: p,
        entry_blocker: `DATA_INCOMPLETE: missing ltf_trigger_state (${p})`,
      },
      missing,
    };
  }

  if (actionable === false) {
    return {
      ok: true,
      actionable: false,
      state: String(state || "UNKNOWN"),
      blocker: {
        entry_validity: "ENTRY_WAIT",
        wait_reason: mapWaitReason(state),
        wait_source_path: p,
        entry_blocker: `LTF_BLOCKED: ${state} / ${reasonCode || "NO_CODE"} (${p})`,
        reason_detail: reasonDetail || "",
      },
      missing: [],
    };
  }

  return {
    ok: true,
    actionable: true,
    state: String(state || "READY"),
    blocker: null,
    missing: [],
  };
}

function mapWaitReason(state) {
  const s = String(state || "").toUpperCase();
  if (s === "WAITING_CLOSE") return "LTF_WAITING_CLOSE";
  if (s === "STALE") return "LTF_STALE";
  if (s === "MISALIGNED") return "LTF_MISALIGNED";
  if (s === "INVALIDATED") return "OTHER";
  return "OTHER";
}

module.exports = { evaluateLtfGate };
