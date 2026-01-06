import { useEffect, useMemo, useRef, useState } from "react";

import { BybitWsClient } from "../lib/feeds/bybit/wsClient";
import { BybitFeedStore } from "../lib/feeds/bybit/store";
import {
  BYBIT_PUBLIC_WS,
  bybitKlineTopic,
  bybitOrderbookTopic,
  bybitTradeTopic,
} from "../lib/feeds/bybit/topics";

import { BinanceWsClient } from "../lib/feeds/binance/wsClient";
import { BinanceFeedStore } from "../lib/feeds/binance/store";
import {
  BINANCE_FUTURES_WS,
  binanceAggTradeStream,
  binanceKlineStream,
  binanceSubscribeMsg,
} from "../lib/feeds/binance/streams";

import type { Candle, Tf } from "../lib/feeds/core/types";
import type { UnifiedSnapshot } from "../lib/feeds/snapshot/unifiedTypes";
import { buildUnifiedSnapshotFromBybitBinance } from "../lib/feeds/snapshot/builder";

const TFS: Tf[] = ["1m", "3m", "5m", "15m", "1h", "4h", "1D"];

export function useBybitUnifiedSnapshot(symbol: string) {
  const bybitStoreRef = useRef<BybitFeedStore | null>(null);
  const bybitWsRef = useRef<BybitWsClient | null>(null);

  const binanceStoreRef = useRef<BinanceFeedStore | null>(null);
  const binanceWsRef = useRef<BinanceWsClient | null>(null);

  const [snapshot, setSnapshot] = useState<UnifiedSnapshot | null>(null);

  // Task 1/2: clockSkewMs có thể để 0; sau này bạn đo server time (Task 3)
  const [clockSkewMs] = useState<number>(0);

  const bybitStore = useMemo(() => {
    if (!bybitStoreRef.current) bybitStoreRef.current = new BybitFeedStore();
    return bybitStoreRef.current;
  }, []);

  const binanceStore = useMemo(() => {
    if (!binanceStoreRef.current) binanceStoreRef.current = new BinanceFeedStore();
    return binanceStoreRef.current;
  }, []);

  useEffect(() => {
    if (!symbol) return;

    // reset stores
    bybitStore.setSymbol(symbol, 200);

    binanceStore.setSymbol();
    // -----------------------------
    // ✅ REST backfill to warm up klines (required for indicators/levels/setups)
    // -----------------------------
    function tfToBybitInterval(tf: Tf) {
      switch (tf) {
        case "1m": return "1";
        case "3m": return "3";
        case "5m": return "5";
        case "15m": return "15";
        case "1h": return "60";
        case "4h": return "240";
        case "1D": return "D";
        default: return null;
      }
    }

    async function fetchBybitKlines(args: {
      symbol: string;
      tf: Tf;
      limit: number;
      signal: AbortSignal;
      end?: number; // optional: fetch klines ending before this timestamp (ms)
    }): Promise<Candle[]> {
      const { symbol, tf, limit, signal, end } = args;
      const interval = tfToBybitInterval(tf);
      if (!interval) return [];

      let url =
        `https://api.bybit.com/v5/market/kline` +
        `?category=linear&symbol=${encodeURIComponent(symbol)}` +
        `&interval=${encodeURIComponent(interval)}` +
        `&limit=${encodeURIComponent(String(limit))}`;

      if (Number.isFinite(end)) {
        url += `&endTime=${encodeURIComponent(String(end))}`;
      }

      const res = await fetch(url, { method: "GET", cache: "no-store", signal });
      if (!res.ok) return [];

      const json = await res.json().catch(() => null);
      const list = json?.result?.list;
      if (!Array.isArray(list)) return [];

      // Bybit returns newest-first; normalize to oldest-first
      const out: Candle[] = [];
      for (const row of list) {
        // Common format: [startTime, open, high, low, close, volume, turnover]
        if (!Array.isArray(row) || row.length < 6) continue;

        const ts = Number(row[0]);
        const o = Number(row[1]);
        const h = Number(row[2]);
        const l = Number(row[3]);
        const c = Number(row[4]);
        const v = Number(row[5]);

        if (!Number.isFinite(ts) || !Number.isFinite(o) || !Number.isFinite(h) ||
          !Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(v)) {
          continue;
        }

        // If Candle has other fields (e.g., confirm), extra fields are harmless.
        out.push({ ts, o, h, l, c, v } as Candle);
      }

      out.sort((a, b) => a.ts - b.ts);
      return out;
    }

    const backfillAbort = new AbortController();
    async function fetchBybitKlinesPaged(args: {
      symbol: string;
      tf: Tf;
      need: number;
      signal: AbortSignal;
    }): Promise<Candle[]> {
      const { symbol, tf, need, signal } = args;

      const PAGE = 200; // Bybit cap
      let end: number | undefined = undefined;
      let acc: Candle[] = [];

      while (acc.length < need) {
        const batch = await fetchBybitKlines({
          symbol,
          tf,
          limit: Math.min(PAGE, need), // still capped by 200
          end,
          signal,
        });

        if (!batch.length) break;

        // batch is oldest-first
        // We are paging backwards, so prepend older batch
        acc = [...batch, ...acc];

        // next page should end before the oldest candle we just got
        end = batch[0].ts - 1;

        // if API returned fewer than cap, no more history
        if (batch.length < PAGE) break;
      }

      // De-dup by ts just in case
      const map = new Map<number, Candle>();
      for (const c of acc) map.set(c.ts, c);

      return Array.from(map.values())
        .sort((a, b) => a.ts - b.ts)
        .slice(-need);
    }

    async function backfillWarmup() {
      // Minimum set needed for your engine/features path:
      // - engine derives px from 15m/1h
      // - HTF bias commonly uses 1h/4h
      const plan: Array<{ tf: Tf; need: number }> = [
        { tf: "5m", need: 300 },
        { tf: "15m", need: 300 },
        { tf: "1h", need: 300 },
        { tf: "4h", need: 300 },
        // optional (khuyến nghị nếu bạn hiển thị 1d outlook / bias sau này):
        // { tf: "1d", need: 300 },
      ];


      const results = await Promise.allSettled(
        plan.map(async (p) => {
          const candles = await fetchBybitKlinesPaged({
            symbol,
            tf: p.tf,
            need: p.need,
            signal: backfillAbort.signal,
          });
          return { tf: p.tf, candles };
        })
      );

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { tf, candles } = r.value;
        if (!candles || candles.length === 0) continue;

        // seedKlines is added in store.ts patch
        (bybitStore as any).seedKlines?.(tf, candles);
      }
    }

    // Fire-and-forget warmup; WS continues in parallel
    backfillWarmup().catch(() => { });

    // -----------------------------
    // Bybit WS
    // -----------------------------
    const byWs = new BybitWsClient(BYBIT_PUBLIC_WS, {
      onOpen: () => {
        bybitStore.onWsState(true);
        const topics = [
          bybitOrderbookTopic(symbol, 200),
          bybitTradeTopic(symbol),
          ...TFS.map((tf) => bybitKlineTopic(tf, symbol)),
        ];
        byWs.subscribe(topics);
      },
      onClose: () => bybitStore.onWsState(false),
      onError: () => bybitStore.onWsState(false),
      onMessage: (data) => bybitStore.onWsMessage(data),
    });

    bybitWsRef.current = byWs;
    byWs.connect();

    // -----------------------------
    // Binance WS
    // -----------------------------
    const biWs = new BinanceWsClient(BINANCE_FUTURES_WS, {
      onOpen: () => {
        binanceStore.onWsState(true);
        const streams = [
          binanceAggTradeStream(symbol),
          ...TFS.map((tf) => binanceKlineStream(tf, symbol)),
        ];
        biWs.send(binanceSubscribeMsg(streams));
      },
      onClose: () => binanceStore.onWsState(false),
      onError: () => binanceStore.onWsState(false),
      onMessage: (data) => binanceStore.onWsMessage(data),
    });

    binanceWsRef.current = biWs;
    biWs.connect();

    // -----------------------------
    // ✅ Bybit REST probe (hard truth)
    // -----------------------------
    async function probeBybitOnce(timeoutMs = 2000) {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const res = await fetch("https://api.bybit.com/v5/market/time", {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        window.clearTimeout(t);
      }
    }

    // probe ngay 1 lần
    (async () => {
      const ok = await probeBybitOnce();
      // BybitFeedStore phải có setProbeAlive(ok)
      (bybitStore as any).setProbeAlive?.(ok);
    })();

    // probe định kỳ
    const probeId = window.setInterval(async () => {
      const ok = await probeBybitOnce();
      (bybitStore as any).setProbeAlive?.(ok);
    }, 5000);

    // -----------------------------
    // Snapshot scheduling (Bybit + Binance events)
    // -----------------------------
    let scheduled = false;

    const build = () =>
      buildUnifiedSnapshotFromBybitBinance({
        canon: symbol,
        clockSkewMs,
        bybit: bybitStore,
        binance: binanceStore,
      });

    const unsubBybit = bybitStore.events.on(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        setSnapshot(build());
      });
    });

    const unsubBinance = binanceStore.events.on(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        setSnapshot(build());
      });
    });

    // ✅ Periodic recompute tick (để DQ tụt khi WS im lặng)
    const intervalId = window.setInterval(() => {
      setSnapshot(build());
    }, 1000);

    // Initial snapshot
    setSnapshot(build());

    return () => {
      backfillAbort.abort();
      unsubBybit();
      unsubBinance();

      window.clearInterval(intervalId);
      window.clearInterval(probeId);

      byWs.close();
      bybitWsRef.current = null;

      biWs.close();
      binanceWsRef.current = null;
    };
  }, [symbol, bybitStore, binanceStore, clockSkewMs]);

  return snapshot;
}
