export function clamp(x: number, lo: number, hi: number) {
  // Hardening: prevent NaN/Infinity from poisoning downstream features
  if (!Number.isFinite(x)) return lo;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return x;

  return Math.max(lo, Math.min(hi, x));
}

export function mean(xs: number[]) {
  if (!xs.length) return 0;
  let s = 0;
  let n = 0;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    s += x;
    n++;
  }
  return n === 0 ? 0 : s / n;
}

export function stdev(xs: number[]) {
  // Sample stdev; ignore non-finite values
  const finite: number[] = [];
  for (const x of xs) if (Number.isFinite(x)) finite.push(x);

  if (finite.length < 2) return 0;

  const m = mean(finite);
  let v = 0;
  for (const x of finite) {
    const d = x - m;
    v += d * d;
  }
  v /= (finite.length - 1);
  return Math.sqrt(v);
}

export function safeDiv(a: number, b: number, fallback = 0) {
  // Hardening: treat non-finite inputs as invalid
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  const v = a / b;
  return Number.isFinite(v) ? v : fallback;
}
