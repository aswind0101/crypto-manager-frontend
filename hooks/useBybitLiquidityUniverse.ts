// hooks/useBybitLiquidityUniverse.ts

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBybitTopUniverse, type BybitUniverseItem } from "../lib/feeds/bybit/universe";

export function useBybitLiquidityUniverse(args?: {
  enabled?: boolean;
  topN?: number;
  minTurnover24h?: number;
  refreshMs?: number;
}) {
  const enabled = args?.enabled ?? true;
  const topN = args?.topN ?? 60;
  const minTurnover24h = args?.minTurnover24h ?? 0;
  const refreshMs = args?.refreshMs;

  const [items, setItems] = useState<BybitUniverseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    try {
      const out = await fetchBybitTopUniverse({
        limit: topN,
        minTurnover24h,
        signal: ac.signal,
      });
      setItems(out);
      setRefreshedAt(Date.now());
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "unknown error");
      if (!msg.toLowerCase().includes("aborted")) setError(msg);
    } finally {
      setLoading(false);
    }
  }, [enabled, topN, minTurnover24h]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, topN, minTurnover24h]);

  useEffect(() => {
    if (!enabled) return;
    if (!refreshMs || refreshMs < 10_000) return;
    const t = setInterval(() => refresh(), refreshMs);
    return () => clearInterval(t);
  }, [enabled, refreshMs, refresh]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { items, loading, error, refreshedAt, refresh };
}
