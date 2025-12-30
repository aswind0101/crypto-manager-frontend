// lib/indicators/core.js

export function toNum(x, d = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

export function sma(values, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    sum += v;
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
    else out.push(null);
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;

  const k = 2 / (period + 1);
  let prev = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = prev;
      continue;
    }
    if (prev === null) {
      prev = v;
      out[i] = v;
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
  }
  return out;
}

export function atr(klines, period = 14) {
  // kline: { h,l,c }
  const tr = new Array(klines.length).fill(null);
  for (let i = 0; i < klines.length; i++) {
    const h = klines[i]?.h;
    const l = klines[i]?.l;
    const cPrev = i > 0 ? klines[i - 1]?.c : null;
    if (![h, l].every(Number.isFinite)) continue;

    if (i === 0 || !Number.isFinite(cPrev)) {
      tr[i] = h - l;
      continue;
    }
    const a = h - l;
    const b = Math.abs(h - cPrev);
    const c = Math.abs(l - cPrev);
    tr[i] = Math.max(a, b, c);
  }
  return ema(tr.map(x => (Number.isFinite(x) ? x : null)), period);
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) => {
    const a = emaFast[i], b = emaSlow[i];
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
  });
  const sig = ema(line.map(v => (Number.isFinite(v) ? v : null)), signal);
  const hist = line.map((v, i) => {
    const s = sig[i];
    return Number.isFinite(v) && Number.isFinite(s) ? v - s : null;
  });
  return { line, signal: sig, hist };
}

export function labelEmaStack(lastE20, lastE50, lastE100, lastE200) {
  if (![lastE20,lastE50,lastE100,lastE200].every(Number.isFinite)) return "unknown";
  if (lastE20 > lastE50 && lastE50 > lastE100 && lastE100 > lastE200) return "bull_stack";
  if (lastE20 < lastE50 && lastE50 < lastE100 && lastE100 < lastE200) return "bear_stack";
  return "mixed";
}

export function labelRsiBias(lastRsi) {
  if (!Number.isFinite(lastRsi)) return "unknown";
  if (lastRsi >= 60) return "bull";
  if (lastRsi <= 40) return "bear";
  return "neutral";
}
