import { useEffect, useMemo, useRef, useState } from "react";
import { BybitWsClient } from "../lib/feeds/bybit/wsClient";
import { BybitFeedStore } from "../lib/feeds/bybit/store";
import { BYBIT_PUBLIC_WS, bybitKlineTopic, bybitOrderbookTopic, bybitTradeTopic } from "../lib/feeds/bybit/topics";
import type { Tf } from "../lib/feeds/core/types";
import { buildUnifiedSnapshotFromBybit } from "../lib/feeds/snapshot/builder";
import type { UnifiedSnapshot } from "../lib/feeds/snapshot/unifiedTypes";

const TFS: Tf[] = ["1m","3m","5m","15m","1h","4h","1D"];

export function useBybitUnifiedSnapshot(symbol: string) {
  const storeRef = useRef<BybitFeedStore | null>(null);
  const wsRef = useRef<BybitWsClient | null>(null);

  const [snapshot, setSnapshot] = useState<UnifiedSnapshot | null>(null);
  const [clockSkewMs] = useState<number>(0); // Task 1 có thể để 0; Task 2/3 đo server time

  const store = useMemo(() => {
    if (!storeRef.current) storeRef.current = new BybitFeedStore();
    return storeRef.current;
  }, []);

  useEffect(() => {
    if (!symbol) return;
    store.setSymbol(symbol, 200);

    const ws = new BybitWsClient(BYBIT_PUBLIC_WS, {
      onOpen: () => {
        store.onWsState(true);
        const topics = [
          bybitOrderbookTopic(symbol, 200),
          bybitTradeTopic(symbol),
          ...TFS.map(tf => bybitKlineTopic(tf, symbol)),
        ];
        ws.subscribe(topics);
      },
      onClose: () => store.onWsState(false),
      onError: () => store.onWsState(false),
      onMessage: (data) => store.onWsMessage(data),
    });

    wsRef.current = ws;
    ws.connect();

    // Event-driven snapshot updates (throttle nhẹ)
    let scheduled = false;
    const unsub = store.events.on(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const snap = buildUnifiedSnapshotFromBybit({ canon: symbol, clockSkewMs, bybit: store });
        setSnapshot(snap);
      });
    });

    // Initial snapshot
    setSnapshot(buildUnifiedSnapshotFromBybit({ canon: symbol, clockSkewMs, bybit: store }));

    return () => {
      unsub();
      ws.close();
      wsRef.current = null;
    };
  }, [symbol, store, clockSkewMs]);

  return snapshot;
}
