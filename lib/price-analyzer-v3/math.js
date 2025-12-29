// /lib/price-analyzer-v3/math.js
export function rr({ direction, entryAvg, sl, tp }) {
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
