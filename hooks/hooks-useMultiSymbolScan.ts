// hooks/useMultiSymbolScan.ts

import { useEffect, useMemo, useRef, useState } from "react";
import { useBybitLiquidityUniverse } from "./useBybitLiquidityUniverse";
import { useSetupsSnapshot } from "./useSetupsSnapshot";

export type ScanFound = {
    key: string; // `${symbol}::${canonOrId}`
    symbol: string;
    foundTs: number;
    status?: string;
    confidenceScore?: number;
    grade?: string;
    title?: string;

    payload: {
        snap: any;
        features: any;
        setups: any;
    };
};

function safeNum(x: any): number | undefined {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
}

function inferTitle(setup: any): string | undefined {
    const side = String(setup?.side ?? "");
    const type = String(setup?.type ?? "");
    const tf = String(setup?.bias_tf ?? setup?.status_tf ?? "");
    const parts = [type, side, tf].filter(Boolean);
    return parts.length ? parts.join(" · ") : undefined;
}

export function useMultiSymbolScan(args?: {
    enabled?: boolean;

    topN?: number;
    minTurnover24h?: number;
    universeRefreshMs?: number;

    dwellMs?: number;
    settleMs?: number;
    maxFound?: number;
}) {
    const enabled = args?.enabled ?? true;

    const topN = args?.topN ?? 60;
    const minTurnover24h = args?.minTurnover24h ?? 0;
    const dwellMs = Math.max(5_000, args?.dwellMs ?? 18_000);
    const settleMs = Math.max(0, args?.settleMs ?? 2_500);
    const maxFound = Math.max(1, args?.maxFound ?? 20);

    const { items: universe, loading: uniLoading, error: uniError, refreshedAt, refresh } =
        useBybitLiquidityUniverse({
            enabled,
            topN,
            minTurnover24h,
            refreshMs: args?.universeRefreshMs,
        });

    const symbols = useMemo(() => universe.map((x) => x.symbol), [universe]);

    const [cursor, setCursor] = useState(0);
    const activeSymbol = symbols.length ? symbols[Math.min(cursor, symbols.length - 1)] : "";

    // Run the existing pipeline for exactly 1 symbol at a time.
    const { snap, features, setups } = useSetupsSnapshot(activeSymbol, !enabled);

    const [found, setFound] = useState<ScanFound[]>([]);
    const [selectedKey, setSelectedKey] = useState<string>("");
    const [scanPaused, setScanPaused] = useState(false);

    const pauseScan = () => setScanPaused(true);
    const resumeScan = () => setScanPaused(false);


    const phaseRef = useRef<{
        symbol: string;
        settleUntil: number;
        dwellUntil: number;
    } | null>(null);

    const seenRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!enabled) {
            setScanPaused(false);
            return;
        }
        if (cursor >= symbols.length && symbols.length > 0) setCursor(0);
    }, [enabled, symbols.length, cursor]);


    useEffect(() => {
        if (!enabled) return;
        if (!activeSymbol) return;

        const now = Date.now();
        phaseRef.current = {
            symbol: activeSymbol,
            settleUntil: now + settleMs,
            dwellUntil: now + settleMs + dwellMs,
        };
    }, [enabled, activeSymbol, settleMs, dwellMs]);

    useEffect(() => {
        if (!enabled) return;
        if (scanPaused) return;
        if (!activeSymbol) return;

        const phase = phaseRef.current;
        if (!phase || phase.symbol !== activeSymbol) return;

        const now = Date.now();
        if (now < phase.settleUntil) return;

        const arr: any[] = Array.isArray(setups?.setups) ? setups.setups : [];
        if (arr.length === 0) return;

        const s0 = arr[0];
        const canonOrId = String(s0?.canon ?? s0?.id ?? "");
        if (!canonOrId) return;

        const key = `${activeSymbol}::${canonOrId}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);

        const st = String(s0?.status ?? "");
        const conf = safeNum(s0?.confidence?.score);
        const grade = String(s0?.confidence?.grade ?? "");
        const title = inferTitle(s0);

        const item: ScanFound = {
            key,
            symbol: activeSymbol,
            foundTs: now,
            status: st || undefined,
            confidenceScore: conf,
            grade: grade || undefined,
            title,
            payload: { snap, features, setups },
        };

        setFound((prev) => (prev.length >= maxFound ? prev : [item, ...prev]));
        setSelectedKey((prev) => prev || key); // auto-select first found
    }, [enabled, activeSymbol, setups, snap, features, maxFound]);

    useEffect(() => {
        if (!enabled) return;
        if (scanPaused) return;
        if (!activeSymbol) return;
        if (symbols.length <= 1) return;

        const t = setInterval(() => {
            const phase = phaseRef.current;
            if (!phase || phase.symbol !== activeSymbol) return;

            const now = Date.now();
            if (now < phase.dwellUntil) return;

            setCursor((c) => ((c + 1) % symbols.length));
        }, 250);

        return () => clearInterval(t);
     }, [enabled, scanPaused, activeSymbol, symbols.length]);

    const selected = useMemo(() => {
        if (!selectedKey) return null;
        return found.find((x) => x.key === selectedKey) ?? null;
    }, [found, selectedKey]);

    const selectedSymbol = selected?.symbol || activeSymbol;

    const state = useMemo(() => {
        const phase = phaseRef.current;
        const now = Date.now();
        const settleLeftMs = phase ? Math.max(0, phase.settleUntil - now) : 0;
        const dwellLeftMs = phase ? Math.max(0, phase.dwellUntil - now) : 0;

        return {
            enabled,
            scanPaused,
            universeLoading: uniLoading,
            universeError: uniError,
            universeRefreshedAt: refreshedAt,
            universeCount: symbols.length,

            activeSymbol,
            cursor,
            settleLeftMs,
            dwellLeftMs,

            foundCount: found.length,
            selectedKey,
            selectedSymbol,
        };
      }, [enabled, scanPaused, uniLoading, uniError, refreshedAt, symbols.length, activeSymbol, cursor, found.length, selectedKey, selectedSymbol]);

    return {
        universe,
        refreshUniverse: refresh,

        state,
        found,
        selected,
        selectedKey,
        setSelectedKey,
        selectedSymbol,
        scanPaused,
        pauseScan,
        resumeScan,
        live: { symbol: activeSymbol, snap, features, setups },
    };
}
