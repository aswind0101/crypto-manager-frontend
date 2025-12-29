// /lib/price-analyzer-v3/context.js
import { get } from "./paths";

// Copy logic tương tự page: symbols có thể là object-map hoặc array
function getSymbolBlock(maybeSymbols, symbol) {
  if (!maybeSymbols) return null;
  if (!Array.isArray(maybeSymbols)) return maybeSymbols?.[symbol] || null;
  return maybeSymbols.find((x) => (x?.symbol || x?.name) === symbol) || null;
}

/**
 * Build context anchored to symbol blocks:
 * - htf: per_exchange.bybit.symbols[SYMBOL]
 * - ltf: per_exchange_ltf.bybit.symbols[SYMBOL]
 */
export function buildSymbolContext(snapshot, symbol) {
  const htfSymbols = get(snapshot, "per_exchange.bybit.symbols");
  const ltfSymbols = get(snapshot, "per_exchange_ltf.bybit.symbols");

  const htf = getSymbolBlock(htfSymbols, symbol);
  const ltf = getSymbolBlock(ltfSymbols, symbol);

  return {
    symbol,
    htf,
    ltf,
    // for audit/debug (full paths)
    paths: {
      htf: `per_exchange.bybit.symbols[${symbol}]`,
      ltf: `per_exchange_ltf.bybit.symbols[${symbol}]`,
    },
  };
}

/**
 * pick(): try multiple candidate paths, return { value, pathUsed }.
 * Paths can be:
 * - canonical: "price_structure.H4.trend_label" (resolved under ctx.htf)
 * - full: "per_exchange.bybit.symbols[BTCUSDT].price_structure...."
 */
export function pick(snapshot, ctx, candidates) {
  for (const c of candidates) {
    if (!c) continue;

    // 1) If it looks like a full path, read from snapshot directly
    if (c.startsWith("per_exchange") || c.startsWith("per_exchange_ltf") || c.startsWith("ticker.")) {
      const v = get(snapshot, c);
      if (v !== undefined && v !== null) return { value: v, pathUsed: c };
      continue;
    }

    // 2) canonical under HTF block by default
    if (ctx?.htf) {
      const v = get(ctx.htf, c);
      if (v !== undefined && v !== null) return { value: v, pathUsed: `${ctx.paths.htf}.${c}` };
    }

    // 3) also try under LTF (some metrics might land there)
    if (ctx?.ltf) {
      const v = get(ctx.ltf, c);
      if (v !== undefined && v !== null) return { value: v, pathUsed: `${ctx.paths.ltf}.${c}` };
    }
  }
  return { value: null, pathUsed: "" };
}
