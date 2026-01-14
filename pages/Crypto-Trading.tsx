import React, { useCallback, useEffect, useState } from "react";
import { useMultiSymbolScan } from "../hooks/useMultiSymbolScan";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import { TradingView } from "../lib/ui/crypto-trading/CryptoTradingView";
import { Activity, Lock, RefreshCw } from "lucide-react";


/**.
 * Crypto-Trading.tsx (Pages Router)
 * - Frontend-only.
 * - Consumes: useSetupsSnapshot(symbol, paused?)
 * - Presents:
 *   - Symbol input + Analyze
 *   - Data health (DQ grade, feed ok, staleness, partial flags)
 *   - Market context (bias + market structure per TF + key levels)
 *   - Setup queue (ranked by priority_score computed in hook)
 *   - Setup detail (entry/SL/TP/RR/confidence/checklist/blockers + orderflow/cross)
 */

/** ---------- Main Page ---------- */
export default function Page() {
  const [inputSymbol, setInputSymbol] = useLocalStorageState<string>(
    "ct_symbol_input",
    "BTCUSDT",
    { serialize: (v) => String(v), deserialize: (raw) => String(raw || "BTCUSDT") }
  );

  const [symbol, setSymbol] = useState<string>(() => {
    if (typeof window === "undefined") return "BTCUSDT";
    return window.localStorage.getItem("ct_symbol_active") || "BTCUSDT";
  });

  const [paused, setPaused] = useLocalStorageState<boolean>("ct_paused", false, {
    serialize: (v) => (v ? "1" : "0"),
    deserialize: (raw) => raw === "1",
  });

  const [scanEnabled, setScanEnabled] = useLocalStorageState<boolean>(
    "ct_scan_enabled",
    false,
    {
      serialize: (v) => (v ? "1" : "0"),
      deserialize: (raw) => raw === "1",
    }
  );

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const SCAN_TOP_N = 60;
  const SCAN_SETTLE_MS = 2_500;
  const SCAN_DWELL_MS = 18_000;

  const scan = useMultiSymbolScan({
    enabled: scanEnabled,
    topN: SCAN_TOP_N,
    minTurnover24h: 0,
    dwellMs: SCAN_DWELL_MS,
    settleMs: SCAN_SETTLE_MS,
    maxFound: 20,
    universeRefreshMs: 60_000,
  });


  const effectiveSymbol = scanEnabled
    ? (scan.selectedSymbol || scan.live.symbol || symbol)
    : symbol;
  const symbolInputEnabled = !scanEnabled || !!scan.scanPaused;
  const scanCountText =
    hydrated && scanEnabled && scan.state.universeCount
      ? `${Math.min(scan.state.cursor + 1, scan.state.universeCount)}/${scan.state.universeCount}`
      : "";

  const scanPhase =
    !hydrated || !scanEnabled
      ? "IDLE"
      : scan.state.settleLeftMs > 0
        ? "SETTLING"
        : "SCANNING";

  const phaseTotalMs =
    scanPhase === "SETTLING" ? SCAN_SETTLE_MS :
      scanPhase === "SCANNING" ? SCAN_DWELL_MS :
        1;

  const phaseLeftMs =
    scanPhase === "SETTLING" ? scan.state.settleLeftMs :
      scanPhase === "SCANNING" ? scan.state.dwellLeftMs :
        0;

  const phaseProgressPct =
    !hydrated || !scanEnabled
      ? 0
      : Math.max(0, Math.min(100, Math.round((1 - phaseLeftMs / phaseTotalMs) * 100)));

  useEffect(() => {
    // While scanning AND not paused, the symbol input is display-only.
    // Keep it synced to the active scanning symbol so the user always knows what is being scanned.
    if (!scanEnabled) return;
    if (scan.scanPaused) return;

    const liveSym = scan.live?.symbol || "";
    if (!liveSym) return;

    setInputSymbol((prev) => (prev === liveSym ? prev : liveSym));
  }, [scanEnabled, scan.scanPaused, scan.live?.symbol, setInputSymbol]);

  useEffect(() => {
    if (scanEnabled) return;

    setInputSymbol((prev) => (prev ? prev : symbol));
  }, [scanEnabled, symbol, setInputSymbol]);


  useEffect(() => {
    if (scanEnabled) return; // do not persist while scan is switching symbols
    try {
      window.localStorage.setItem("ct_symbol_active", symbol);
    } catch { }
  }, [symbol, scanEnabled]);

  /*
    const onAnalyze = () => {
      const cleaned = String(inputSymbol || "").trim().toUpperCase();
      if (!cleaned) return;
      setSymbol(cleaned);
    };
  */
  const onAnalyze = useCallback(() => {
    const cleaned = String(inputSymbol || "").trim().toUpperCase();
    if (!cleaned) return;
    setSymbol(cleaned);
  }, [inputSymbol]);

  const onEnterInput: React.KeyboardEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      if (e.key === "Enter") onAnalyze();
    },
    [onAnalyze]
  );

  /*Unlock this after testing
    return (
      <TradingView
        key={symbol}
        symbol={symbol}
        paused={paused}
        inputSymbol={inputSymbol}
        setInputSymbol={setInputSymbol}
        setPaused={setPaused}
        onAnalyze={onAnalyze}
        onEnterInput={onEnterInput}
      />
    );
    */
  return (
    <div>
      {/* Scan bar (page-level orchestration, does not touch engine/scoring) */}
      <div className="sticky top-0 z-40 border-b border-zinc-800 bg-black/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${scanEnabled ? "bg-emerald-600/20 text-emerald-200" : "bg-zinc-800 text-zinc-200"
                }`}
              onClick={() => setScanEnabled((v) => !v)}
              title="Multi-symbol scan (attention routing)"
            >
              {scanEnabled ? "Scan: ON" : "Scan: OFF"}
            </button>

            {scanEnabled ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-1 text-xs text-zinc-300 [-webkit-overflow-scrolling:touch]">
                  <div className="rounded-md bg-zinc-900/50 px-2 py-1 ring-1 ring-zinc-800">
                    <span className="text-zinc-500">Universe:</span>{" "}
                    <span className="text-zinc-200">{scan.state.universeCount || "—"}</span>
                  </div>

                  {hydrated ? (
                    <div className="rounded-md bg-zinc-900/50 px-2 py-1 ring-1 ring-zinc-800">
                      <span className="text-zinc-500">Scanned:</span>{" "}
                      <span className="text-zinc-200">{scanCountText || "—"}</span>
                    </div>
                  ) : null}

                  <div className="rounded-md bg-zinc-900/50 px-2 py-1 ring-1 ring-zinc-800">
                    <span className="text-zinc-500">Active:</span>{" "}
                    <span className="text-zinc-200">{scan.state.activeSymbol || "—"}</span>
                  </div>

                  <div className="rounded-md bg-zinc-900/50 px-2 py-1 ring-1 ring-zinc-800">
                    <span className="text-zinc-500">Found:</span>{" "}
                    <span className="text-zinc-200">{scan.state.foundCount}</span>
                  </div>

                  {hydrated ? (
                    <div
                      className={[
                        "rounded-md px-2 py-1 ring-1",
                        scanPhase === "SETTLING"
                          ? "bg-amber-500/10 text-amber-200 ring-amber-500/20"
                          : scanPhase === "SCANNING"
                            ? "bg-sky-500/10 text-sky-200 ring-sky-500/20"
                            : "bg-zinc-900/50 text-zinc-300 ring-zinc-800",
                      ].join(" ")}
                      title={scanPhase === "SETTLING" ? "Settling (warm-up)" : scanPhase === "SCANNING" ? "Scanning (dwell)" : ""}
                    >
                      {scanPhase === "SETTLING" ? "SETTLING" : scanPhase === "SCANNING" ? "SCANNING" : "—"}{" "}
                      <span className="text-zinc-500">{phaseProgressPct}%</span>
                    </div>
                  ) : null}
                </div>
              </div>

            ) : (
              <div className="text-xs text-zinc-500">
                Manual symbol mode (Analyze uses the input below).
              </div>
            )}

          </div>

          {scanEnabled ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              <button
                className={[
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition",
                  scan.scanPaused
                    ? "bg-emerald-600/20 text-emerald-200 ring-emerald-500/30 hover:bg-emerald-600/25"
                    : "bg-zinc-900/60 text-zinc-200 ring-zinc-800 hover:bg-zinc-900",
                ].join(" ")}
                onClick={() => (scan.scanPaused ? scan.resumeScan() : scan.pauseScan())}
                title={scan.scanPaused ? "Resume scanning" : "Pause scanning"}
                disabled={!hydrated}
              >
                {scan.scanPaused ? (
                  <>
                    <Activity className="h-4 w-4" />
                    Resume
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Pause
                  </>
                )}
              </button>

              <button
                className="inline-flex items-center gap-2 rounded-md bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 ring-1 ring-zinc-800 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => scan.refreshUniverse()}
                title="Refresh liquidity universe"
                disabled={!hydrated}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh universe
              </button>
            </div>
          ) : null}

        </div>
        {scanEnabled && hydrated ? (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-zinc-800">
              <div
                className={[
                  "h-full transition-[width] duration-200",
                  scanPhase === "SETTLING" ? "bg-amber-400/60" : "bg-sky-400/60",
                  scan.scanPaused ? "opacity-30" : "opacity-100",
                ].join(" ")}
                style={{ width: `${scan.scanPaused ? 0 : phaseProgressPct}%` }}
              />
            </div>
          </div>
        ) : null}

        {scanEnabled && scan.found.length ? (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <div className="flex max-w-full gap-2 overflow-x-auto py-1 [-webkit-overflow-scrolling:touch]">
              {scan.found.map((f) => {
                const active = f.key === scan.selectedKey;
                return (
                  <button
                    key={f.key}
                    onClick={() => {
                      scan.setSelectedKey(f.key);
                      scan.pauseScan();          // pause scan when user focuses a found setup
                      setInputSymbol(f.symbol);  // reflect selected symbol in the input box
                    }}

                    className={`whitespace-nowrap rounded-md border px-3 py-1 text-xs ${active
                      ? "border-emerald-500/40 bg-emerald-600/15 text-emerald-100"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900"
                      }`}
                    title={f.title || f.symbol}
                  >
                    <span className="text-zinc-500">{f.symbol}</span>
                    <span className="mx-2 text-zinc-700">|</span>
                    <span>{f.title || "Setup"}</span>
                    {f.grade ? <span className="ml-2 text-zinc-500">({f.grade})</span> : null}
                    {typeof f.confidenceScore === "number" ? (
                      <span className="ml-2 text-zinc-500">{Math.round(f.confidenceScore)}%</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <TradingView
        key={effectiveSymbol}
        symbol={effectiveSymbol}
        paused={paused}
        inputSymbol={inputSymbol}
        setInputSymbol={setInputSymbol}
        setPaused={setPaused}
        onAnalyze={onAnalyze}
        onEnterInput={onEnterInput}
        symbolInputEnabled={symbolInputEnabled}
      />
    </div>
  );

}
