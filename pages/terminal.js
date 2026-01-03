import { useState } from "react";
import TopBar from "../components/terminal/TopBar";
import OutlookPanel from "../components/terminal/OutlookPanel";
import SetupCard from "../components/terminal/SetupCard";
import CandidatesGrid from "../components/terminal/CandidatesGrid";
import { useAnalysisEngine } from "../hooks/useAnalysisEngine";

export default function TerminalPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");

  const { data, error, isLoading } = useAnalysisEngine({
    symbol,
    preferExchange: "bybit",
    preferTf: "60",
  });

 return (
  <div className="terminal-theme min-h-screen px-4 py-6">
      <div className="max-w-[1400px] mx-auto space-y-5">
        <TopBar
          symbol={symbol}
          subtitle="Client-only data · deterministic engines · hi-tech terminal UI"
        />

        <div className="glass rounded-2xl p-4 border border-slate-700/30">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-3 justify-between">
            <div className="text-sm text-slate-400">
              Symbol format: <span className="text-slate-200 font-semibold">{symbol}</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().trim())}
                className="glass px-3 py-2 rounded-xl border border-slate-700/40 text-slate-100 outline-none w-44"
                placeholder="BTCUSDT"
              />
              <div className="text-xs text-slate-400">Refresh: 25s · VPN as needed</div>
            </div>
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

        {isLoading ? (
          <div className="glass rounded-2xl p-6 border border-slate-700/30 text-slate-300">
            Loading snapshot & analysis…
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
