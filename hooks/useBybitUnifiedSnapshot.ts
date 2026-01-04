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

import type { Tf } from "../lib/feeds/core/types";
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
