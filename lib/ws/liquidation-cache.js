// lib/ws/liquidation-cache.js
import { collectBybitLiquidations, collectBinanceLiquidations } from "./liquidations";

const state = {
  running: false,
  symbol: null,
  last: {
    bybit: null,
    binance: null,
    updated_at: null,
    window_ms: null,
  },
};

export async function warmupLiquidations(symbol, { seconds = 180 } = {}) {
  const sym = String(symbol || "").toUpperCase().trim();
  if (!sym) return state.last;

  // Nếu đang warmup cùng symbol thì không chạy lại
  if (state.running && state.symbol === sym) return state.last;

  state.running = true;
  state.symbol = sym;

  const windowMs = Math.max(30, seconds) * 1000;

  try {
    // Thu thập song song (best-effort)
    const [bybit, binance] = await Promise.allSettled([
      collectBybitLiquidations(sym, { windowMs }),
      collectBinanceLiquidations(sym, { windowMs }),
    ]);

    state.last = {
      bybit: bybit.status === "fulfilled" ? bybit.value : null,
      binance: binance.status === "fulfilled" ? binance.value : null,
      updated_at: Date.now(),
      window_ms: windowMs,
    };

    return state.last;
  } finally {
    state.running = false;
  }
}

export function getLiquidationCache() {
  return state.last;
}

export function getLiquidationCacheMeta() {
  return {
    running: state.running,
    symbol: state.symbol,
    updated_at: state.last.updated_at,
    window_ms: state.last.window_ms,
  };
}

export function clearLiquidationCache() {
  state.last = { bybit: null, binance: null, updated_at: null, window_ms: null };
  state.symbol = null;
  state.running = false;
}
