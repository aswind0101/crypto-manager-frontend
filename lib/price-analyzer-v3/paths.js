// /lib/price-analyzer-v3/paths.js

export function get(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path
    .replace(/\[(.+?)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function has(obj, path) {
  const v = get(obj, path);
  return v !== undefined && v !== null;
}

// symbols có thể là object-map hoặc array [{symbol,...}]
export function getSymbolBlock(maybeSymbols, symbol) {
  if (!maybeSymbols) return null;
  if (!Array.isArray(maybeSymbols)) return maybeSymbols?.[symbol] || null;
  return maybeSymbols.find((x) => (x?.symbol || x?.name) === symbol) || null;
}

export function pushMissing(missing, path) {
  if (path && !missing.includes(path)) missing.push(path);
}
