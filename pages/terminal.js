import { useMemo, useState } from "react";
import TopBar from "../components/terminal/TopBar";
import OutlookPanel from "../components/terminal/OutlookPanel";
import SetupCard from "../components/terminal/SetupCard";
import CandidatesGrid from "../components/terminal/CandidatesGrid";
import { useAnalysisEngine } from "../hooks/useAnalysisEngine";

function normalizeSymbol(s) {
  return (s || "").toUpperCase().replace(/\s+/g, "").trim();
}

export default function TerminalPage() {
  // input field state (user typing)
  const [inputSymbol, setInputSymbol] = useState("BTCUSDT");

  // committed symbol for analysis
  const [activeSymbol, setActiveSymbol] = useState("");

  // prevent auto fetch until user clicks Analyze
  const enabled = Boolean(activeSymbol);

  const { data, error, isLoading, mutate } = useAnalysisEngine({
    symbol: activeSymbol,
    preferExchange: "bybit",
    preferTf: "60",
    enabled,
  });

  const canAnalyze = useMemo(() => normalizeSymbol(inputSymbol).length >= 6, [inputSymbol]);

  const onAnalyze = async () => {
    const sym = normalizeSymbol(inputSymbol);
    if (!sym) return;

    // commit symbol => SWR runs
    setActiveSymbol(sym);

    // optionally force immediate fetch (in case already analyzed same symbol before)
    // mutate triggers revalidate
    // await mutate();
  };

  const onRefresh = async () => {
    // manual refresh snapshot
    if (!activeSymbol) return;
    await mutate();
  };

  return (
    <div className="terminal-theme min-h-screen px-4 py-6">
      <div className="max-w-[1400px] mx-auto space-y-5">
        <TopBar
          symbol={activeSymbol || normalizeSymbol(inputSymbol) || "—"}
          subtitle="Client-only snapshot · deterministic engines · hi-tech terminal UI"
        />

        {/* Controls */}
        <div className="glass rounded-2xl p-4 border border-slate-700/30">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3 justify-between">
            <div className="text-sm text-slate-400">
              Nhập symbol (futures format):{" "}
              <span className="text-slate-200 font-semibold">{normalizeSymbol(inputSymbol) || "—"}</span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
              <input
                value={inputSymbol}
                onChange={(e) => setInputSymbol(e.target.value)}
                className="glass px-3 py-2 rounded-xl border border-slate-700/40 text-slate-100 outline-none w-full sm:w-56"
                placeholder="BTCUSDT"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onAnalyze();
                }}
              />

              <button
                onClick={onAnalyze}
                disabled={!canAnalyze || isLoading}
                className={`px-4 py-2 rounded-xl font-semibold text-sm border transition
                  ${!canAnalyze || isLoading
                    ? "opacity-50 cursor-not-allowed border-slate-700/40 text-slate-300 glass"
                    : "border-cyan-400/30 text-cyan-200 glass hover:border-cyan-300/50 hover:text-cyan-100 neon-border"
                  }`}
              >
                {isLoading && enabled ? "Đang phân tích…" : "Phân tích"}
              </button>

              <button
                onClick={onRefresh}
                disabled={!enabled || isLoading}
                className={`px-4 py-2 rounded-xl font-semibold text-sm border transition
                  ${!enabled || isLoading
                    ? "opacity-50 cursor-not-allowed border-slate-700/40 text-slate-300 glass"
                    : "border-violet-400/30 text-violet-200 glass hover:border-violet-300/50 hover:text-violet-100"
                  }`}
                title="Fetch snapshot lại"
              >
                Refresh
              </button>

              <div className="text-xs text-slate-400 self-center">
                Chỉ fetch khi bấm “Phân tích”. VPN: tuỳ môi trường.
              </div>
            </div>
          </div>

          {/* status line */}
          <div className="mt-3 text-xs text-slate-400">
            Active symbol:{" "}
            <span className="text-slate-200">{activeSymbol || "— (chưa phân tích)"}</span>
          </div>

          {error ? (
            <div className="mt-3 text-sm text-rose-200">
              Fetch error: {String(error?.message || error)}
            </div>
          ) : null}

          {data?.snapshot?.__client_errors?.length ? (
            <div className="mt-3 text-xs text-amber-200">
              Partial source errors: {data.snapshot.__client_errors.join(" | ")}
            </div>
          ) : null}
        </div>

        {/* Content */}
        {!enabled ? (
          <div className="glass rounded-2xl p-6 border border-slate-700/30 text-slate-300">
            Nhập symbol và bấm <span className="text-slate-100 font-semibold">Phân tích</span> để tạo snapshot và hiển thị dữ liệu.
          </div>
        ) : isLoading ? (
          <div className="glass rounded-2xl p-6 border border-slate-700/30 text-slate-300">
            Đang generate snapshot & phân tích…
          </div>
        ) : (
          <>
            <OutlookPanel outlook={data?.outlook} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <SetupCard title="Primary Setup" setup={data?.setups?.primary} />
              <SetupCard title="Alternative Setup" setup={data?.setups?.alternative} />
            </div>

            <CandidatesGrid setups={data?.setups?.top_candidates || []} />

            <div className="glass rounded-2xl p-5 border border-slate-700/30">
              <div className="text-lg font-semibold neon-text">Debug</div>
              <pre className="mt-4 text-xs overflow-auto max-h-[420px] bg-black/30 border border-slate-700/30 rounded-xl p-4">
                {JSON.stringify({ setups: data?.setups, outlook: data?.outlook }, null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
