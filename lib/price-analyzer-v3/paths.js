// /lib/price-analyzer-v3/paths.js

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function get(obj, path) {
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

function has(obj, path) {
  return get(obj, path) !== undefined && get(obj, path) !== null;
}

// symbols có thể là object-map hoặc array [{symbol,...}]
function getSymbolBlock(maybeSymbols, symbol) {
  if (!maybeSymbols) return null;
  if (!Array.isArray(maybeSymbols)) return maybeSymbols?.[symbol] || null;
  return maybeSymbols.find((x) => (x?.symbol || x?.name) === symbol) || null;
}

function pushMissing(missing, path) {
  if (path && !missing.includes(path)) missing.push(path);
}

module.exports = { get, has, getSymbolBlock, pushMissing, isObject };
