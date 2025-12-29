// /lib/price-analyzer-v3/closed-candle.js
import { get, pushMissing } from "./paths";

export function tfToMs(tf) {
  const s = String(tf);
  if (s === "D") return 24 * 60 * 60 * 1000;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n * 60 * 1000 : null;
}

export function getClosedCandleProofHTF(snapshot, symbol, tf) {
  const missing = [];
  const base = `per_exchange.bybit.symbols[${symbol}].meta`;
  const p1 = `${base}.last_closed_kline_ts[${tf}]`;
  const p2 = `${base}.candle_status[${tf}].last_closed_ts`;
  const p2b = `${base}.candle_status[${tf}].is_last_closed`;

  const v1 = get(snapshot, p1);
  if (v1 != null) {
    return { ok: true, lastClosedTs: Number(v1), proofPathUsed: p1, missingPaths: [] };
  }

  const v2 = get(snapshot, p2);
  const isClosed = get(snapshot, p2b);
  if (v2 == null) pushMissing(missing, p2);
  if (isClosed == null) pushMissing(missing, p2b);

  if (v2 != null) {
    return {
      ok: true,
      lastClosedTs: Number(v2),
      proofPathUsed: p2,
      missingPaths: missing,
    };
  }

  return {
    ok: false,
    lastClosedTs: null,
    proofPathUsed: null,
    reason: "MISSING_CLOSED_CANDLE_PROOF_HTF",
    missingPaths: missing.length ? missing : [p1, p2],
  };
}

export function getClosedCandleProofLTF(snapshot, symbol, tf) {
  const missing = [];
  const base = `per_exchange_ltf.bybit.symbols[${symbol}].meta.candle_status[${tf}]`;
  const p = `${base}.last_closed_ts`;
  const isClosedP = `${base}.is_last_closed`;

  const v = get(snapshot, p);
  const isClosed = get(snapshot, isClosedP);
  if (v == null) pushMissing(missing, p);
  if (isClosed == null) pushMissing(missing, isClosedP);

  if (v != null) {
    return { ok: true, lastClosedTs: Number(v), proofPathUsed: p, missingPaths: missing };
  }
  return {
    ok: false,
    lastClosedTs: null,
    proofPathUsed: null,
    reason: "MISSING_CLOSED_CANDLE_PROOF_LTF",
    missingPaths: missing.length ? missing : [p],
  };
}

export function assertIndicatorLastIsClosed(indicatorLast, lastClosedTs) {
  const ts = Number(indicatorLast?.ts);
  if (!Number.isFinite(ts) || !Number.isFinite(lastClosedTs)) return false;
  return ts === Number(lastClosedTs);
}

export function normalizeOHLC(last) {
  if (!last) return null;
  const o = last.open ?? last.o;
  const h = last.high ?? last.h;
  const l = last.low ?? last.l;
  const c = last.close ?? last.c;
  if ([o, h, l, c].some((v) => v === undefined || v === null)) return null;
  return { o: Number(o), h: Number(h), l: Number(l), c: Number(c) };
}
