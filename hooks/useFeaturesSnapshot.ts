import { useEffect, useMemo, useRef, useState } from "react";
import type { UnifiedSnapshot } from "../lib/feeds/snapshot/unifiedTypes";
import type { FeaturesSnapshot, FeatureEngineInput } from "../lib/feeds/features/types";
import { computeFeatures } from "../lib/feeds/features/engine";
import { useBybitUnifiedSnapshot } from "./useBybitUnifiedSnapshot";

// Helper: lấy candles theo tf từ snapshot.timeframes
function extractCandles(snap: UnifiedSnapshot, tf: any, src: "bybit" | "binance") {
  const tfNode: any = snap.timeframes.find((x: any) => x.tf === tf);
  if (!tfNode) return undefined;

  if (src === "bybit") {
    return tfNode?.candles?.ohlcv;
  }

  if (src === "binance") {
    return tfNode?.candles_binance?.ohlcv;
  }

  return undefined;
}

export function useFeaturesSnapshot(symbol: string) {
  const snap = useBybitUnifiedSnapshot(symbol);
  const [features, setFeatures] = useState<FeaturesSnapshot | null>(null);

  // cache key để không compute nặng liên tục
  const lastKeyRef = useRef<string>("");

  const input = useMemo<FeatureEngineInput | null>(() => {
    if (!snap) return null;

    const bybitOk = !!snap.availability.bybit?.ok;
    const binanceOk = !!snap.availability.binance?.ok;

    // Bybit candles (5m/15m/1h/4h) từ timeframes
    const c5 = extractCandles(snap, "5m", "bybit");
    const c15 = extractCandles(snap, "15m", "bybit");
    const c1h = extractCandles(snap, "1h", "bybit");
    const c4h = extractCandles(snap, "4h", "bybit");

    // ✅ Binance candles (5m/15m) từ timeframes (Task 3.1.1)
    const b5 = extractCandles(snap, "5m", "binance");
    const b15 = extractCandles(snap, "15m", "binance");

    // Orderflow from 1m
    const t1m: any = snap.timeframes.find((x: any) => x.tf === "1m");
    const orderbook = t1m?.orderflow?.orderbook;
    const trades1m = t1m?.orderflow?.trades;

    // Cross from snapshot
    const dev_bps = (snap as any).cross_exchange?.deviation_bps?.bybit_binance;
    const lead_lag = (snap as any).cross_exchange?.lead_lag;

    return {
      canon: snap.canon,
      ts: snap.ts_generated,
      dq: snap.data_quality,
      bybitOk,
      binanceOk,

      candles: {
        "5m": { bybit: c5, binance: b5 },
        "15m": { bybit: c15, binance: b15 },
        "1h": { bybit: c1h },
        "4h": { bybit: c4h },
      },

      orderbook: orderbook ? { bids: orderbook.bids, asks: orderbook.asks } : undefined,
      trades1m: Array.isArray(trades1m) ? trades1m : undefined,

      cross: {
        dev_bps,
        lead_lag,
      },
    };
  }, [snap]);

  useEffect(() => {
    if (!input) return;

    //. key dựa trên ts của các TF quan trọng + orderbook ts để cache
    const k5 = input.candles["5m"]?.bybit?.slice(-1)?.[0]?.ts ?? 0;
    const k15 = input.candles["15m"]?.bybit?.slice(-1)?.[0]?.ts ?? 0;
    const k1h = input.candles["1h"]?.bybit?.slice(-1)?.[0]?.ts ?? 0;
    const k4h = input.candles["4h"]?.bybit?.slice(-1)?.[0]?.ts ?? 0;

    const bk5 = input.candles["5m"]?.binance?.slice(-1)?.[0]?.ts ?? 0;
    const bk15 = input.candles["15m"]?.binance?.slice(-1)?.[0]?.ts ?? 0;

    const obKey = input.orderbook?.bids?.[0]?.[0] ?? 0; // top bid price proxy

    const key = `${k5}|${k15}|${k1h}|${k4h}|${bk5}|${bk15}|${obKey}`;

    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      setFeatures(computeFeatures(input));
    }
  }, [input]);

  return { snap, features };
}