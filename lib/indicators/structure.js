// lib/indicators/structure.js

export function findSwings(klines, left = 2, right = 2) {
  // trả về swings: [{i, type:"high|low", price}]
  const swings = [];
  for (let i = left; i < klines.length - right; i++) {
    const h = klines[i]?.h, l = klines[i]?.l;
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;

    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const hj = klines[j]?.h, lj = klines[j]?.l;
      if (Number.isFinite(hj) && hj >= h) isHigh = false;
      if (Number.isFinite(lj) && lj <= l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ i, type: "high", price: h });
    if (isLow) swings.push({ i, type: "low", price: l });
  }
  return swings.sort((a,b) => a.i - b.i);
}

export function detectBosChoch(klines, swings) {
  // logic nhẹ: BOS khi close phá swing gần nhất cùng phía; CHOCH khi phá swing ngược chiều sau 1 chuỗi
  // trả về recent event
  const closes = klines.map(k => k?.c);
  let lastSwingHigh = null;
  let lastSwingLow = null;

  const events = [];

  for (const s of swings) {
    if (s.type === "high") lastSwingHigh = s;
    if (s.type === "low") lastSwingLow = s;

    const c = closes[s.i];
    if (!Number.isFinite(c)) continue;

    // phá lên swing high gần nhất
    if (lastSwingHigh && s.i > lastSwingHigh.i) {
      const prevHigh = lastSwingHigh.price;
      if (Number.isFinite(prevHigh) && c > prevHigh) {
        events.push({ i: s.i, type: "BOS_UP", level: prevHigh });
      }
    }
    // phá xuống swing low gần nhất
    if (lastSwingLow && s.i > lastSwingLow.i) {
      const prevLow = lastSwingLow.price;
      if (Number.isFinite(prevLow) && c < prevLow) {
        events.push({ i: s.i, type: "BOS_DOWN", level: prevLow });
      }
    }
  }

  const last = events.length ? events[events.length - 1] : null;
  return { events: events.slice(-10), last };
}

export function detectLiquidityGrab(klines, swings, lookback = 50) {
  // “grab” đơn giản: wick vượt swing nhưng close quay lại dưới/ trên swing
  const n = klines.length;
  const start = Math.max(0, n - lookback);
  const recentSwings = swings.filter(s => s.i >= start);

  let lastGrab = null;
  for (let i = start; i < n; i++) {
    const k = klines[i];
    if (!k) continue;
    const { h, l, c } = k;

    for (const s of recentSwings) {
      if (s.type === "high") {
        if (Number.isFinite(h) && Number.isFinite(c) && h > s.price && c < s.price) {
          lastGrab = { i, type: "grab_up_wick_reject", swing: s.price };
        }
      } else {
        if (Number.isFinite(l) && Number.isFinite(c) && l < s.price && c > s.price) {
          lastGrab = { i, type: "grab_down_wick_reclaim", swing: s.price };
        }
      }
    }
  }
  return lastGrab;
}
