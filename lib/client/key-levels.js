// lib/client/key-levels.js
function dayStartUtcMs(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function computeKeyLevelsFromKlines(klines1hOr15m) {
  // Dựa theo UTC day. Nếu bạn muốn LA timezone thì đổi logic theo TZ.
  if (!Array.isArray(klines1hOr15m) || klines1hOr15m.length < 10) return null;

  const byDay = new Map();
  for (const k of klines1hOr15m) {
    const ds = dayStartUtcMs(k.startTime);
    const cur = byDay.get(ds) || { high: -Infinity, low: Infinity };
    cur.high = Math.max(cur.high, k.high);
    cur.low = Math.min(cur.low, k.low);
    byDay.set(ds, cur);
  }

  const days = Array.from(byDay.keys()).sort((a, b) => a - b);
  if (days.length < 2) return null;

  const today = days[days.length - 1];
  const prev = days[days.length - 2];

  return {
    daily: { high: byDay.get(today).high, low: byDay.get(today).low },
    previous_day: { high: byDay.get(prev).high, low: byDay.get(prev).low },
  };
}
