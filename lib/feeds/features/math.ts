export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function mean(xs: number[]) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) {
    const d = x - m;
    v += d * d;
  }
  v /= (xs.length - 1);
  return Math.sqrt(v);
}

export function safeDiv(a: number, b: number, fallback = 0) {
  return b === 0 ? fallback : a / b;
}
