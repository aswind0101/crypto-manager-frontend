// /lib/price-analyzer-v3/math.js
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function rr({ direction, entryAvg, sl, tp }) {
  const E = Number(entryAvg);
  const SL = Number(sl);
  const TP = Number(tp);
  if (![E, SL, TP].every(Number.isFinite)) return null;

  let risk, reward;
  if (direction === "LONG") {
    risk = E - SL;
    reward = TP - E;
  } else {
    risk = SL - E;
    reward = E - TP;
  }
  if (!(risk > 0)) return { risk, reward, rr: null, invalid: true };
  return { risk, reward, rr: reward / risk, invalid: false };
}

module.exports = { clamp, rr };
