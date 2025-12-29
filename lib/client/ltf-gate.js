// lib/client/ltf-gate.js
function tfMs(tf) {
  const n = Number(tf);
  if (!Number.isFinite(n)) return null;
  return n * 60 * 1000;
}

export function computeLtfGate({ tf, lastCandle, now = Date.now() }) {
  const ms = tfMs(tf);
  if (!ms) {
    return { primary_tf: tf, state: "INVALIDATED", actionable: false, reason_code: "BAD_TF", reason_detail: "tf invalid" };
  }
  if (!lastCandle?.ts) {
    return { primary_tf: tf, state: "INVALIDATED", actionable: false, reason_code: "NO_CANDLE", reason_detail: "missing last candle" };
  }

  const lastClosedTs = Math.floor(now / ms) * ms - ms;

  // MISALIGNED if candle ts not equal lastClosedTs
  if (Number(lastCandle.ts) !== Number(lastClosedTs)) {
    return {
      primary_tf: tf,
      state: "MISALIGNED",
      actionable: false,
      reason_code: "TS_MISMATCH",
      reason_detail: `last.ts=${lastCandle.ts} vs last_closed_ts=${lastClosedTs}`,
      last_closed_ts: lastClosedTs,
    };
  }

  // If too old (stale) — > 2 candles behind
  if (now - lastClosedTs > 2 * ms) {
    return {
      primary_tf: tf,
      state: "STALE",
      actionable: false,
      reason_code: "STALE",
      reason_detail: `now-last_closed_ts>${2 * ms}ms`,
      last_closed_ts: lastClosedTs,
    };
  }

  return {
    primary_tf: tf,
    state: "READY",
    actionable: true,
    reason_code: "OK",
    reason_detail: "",
    last_closed_ts: lastClosedTs,
  };
}
