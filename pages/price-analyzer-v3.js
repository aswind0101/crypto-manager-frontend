// pages/price-analyzer-v3.js
import React, { useMemo, useState } from "react";
import { analyzeSnapshot } from "../lib/price-analyzer-v3";
import { buildClientMiniSnapshot } from "../lib/client/snapshot-mini";

export default function PriceAnalyzerV3() {
  const [primarySymbol, setPrimarySymbol] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [snapshot, setSnapshot] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  const ltfGate = useMemo(() => {
    if (!snapshot) return null;
    const sym = String(primarySymbol || "").toUpperCase();
    return snapshot?.per_exchange_ltf?.bybit?.symbols?.[sym]?.ltf_trigger_state || null;
  }, [snapshot, primarySymbol]);

  function downloadJson(obj, name) {
    if (!obj) return;
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function buildSnapshotClient() {
    setErr("");
    setAnalysis(null);

    const sym = String(primarySymbol || "").trim().toUpperCase();
    if (!sym) {
      setErr("Primary symbol không hợp lệ.");
      return;
    }

    setLoading(true);
    try {
      const snap = await buildClientMiniSnapshot({ symbol: sym });
      setSnapshot(snap);
    } catch (e) {
      setErr(e?.message || "Client snapshot build failed (VPN/CORS/403?)");
    } finally {
      setLoading(false);
    }
  }

  function runAnalyze() {
    setErr("");
    if (!snapshot) {
      setErr("Chưa có snapshot. Bấm Build Snapshot (Client) trước.");
      return;
    }
    const sym = String(primarySymbol || "").toUpperCase();
    try {
      const out = analyzeSnapshot(snapshot, sym, { timezone: "America/Los_Angeles" });
      setAnalysis(out);
    } catch (e) {
      console.error(e);
      setErr("Core engine crashed khi analyzeSnapshot().");
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="text-2xl font-semibold">Price Analyzer V3 — Client Snapshot</div>
        <div className="mt-1 text-sm text-slate-400">VPN on → browser fetch Bybit → build snapshot → analyze → download JSON.</div>

        {err ? (
          <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold">Controls</div>

              <div className="mt-3">
                <div className="text-xs font-medium text-slate-300">Primary Symbol</div>
                <input
                  value={primarySymbol}
                  onChange={(e) => setPrimarySymbol(e.target.value.toUpperCase())}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm outline-none focus:border-slate-600"
                  placeholder="BTCUSDT"
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={buildSnapshotClient}
                  disabled={loading}
                  className={[
                    "rounded-xl px-3 py-2 text-sm font-semibold",
                    loading
                      ? "cursor-not-allowed border border-slate-800 bg-slate-900/30 text-slate-500"
                      : "border border-slate-700 bg-slate-200 text-slate-950 hover:bg-white",
                  ].join(" ")}
                >
                  {loading ? "Building..." : "Build Snapshot (Client)"}
                </button>

                <button
                  type="button"
                  onClick={runAnalyze}
                  disabled={!snapshot}
                  className={[
                    "rounded-xl px-3 py-2 text-sm font-semibold",
                    snapshot
                      ? "border border-slate-700 bg-slate-200 text-slate-950 hover:bg-white"
                      : "cursor-not-allowed border border-slate-800 bg-slate-900/30 text-slate-500",
                  ].join(" ")}
                >
                  Run analyzeSnapshot()
                </button>

                <button
                  type="button"
                  onClick={() => downloadJson(snapshot, `snapshot_${snapshot?.generated_at || Date.now()}_${primarySymbol}.json`)}
                  disabled={!snapshot}
                  className={[
                    "rounded-xl px-3 py-2 text-sm",
                    snapshot ? "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30" : "cursor-not-allowed border border-slate-800 bg-black/10 text-slate-600",
                  ].join(" ")}
                >
                  Download Snapshot
                </button>

                <button
                  type="button"
                  onClick={() => downloadJson(analysis, `analysis_${analysis?.meta?.generated_at || Date.now()}_${primarySymbol}.json`)}
                  disabled={!analysis}
                  className={[
                    "rounded-xl px-3 py-2 text-sm",
                    analysis ? "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30" : "cursor-not-allowed border border-slate-800 bg-black/10 text-slate-600",
                  ].join(" ")}
                >
                  Download Analysis
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold">LTF Gate</div>
              {!ltfGate ? (
                <div className="mt-2 text-sm text-slate-400">—</div>
              ) : (
                <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-sm">
                  <div><span className="text-slate-400">state:</span> {ltfGate.state}</div>
                  <div>
                    <span className="text-slate-400">actionable:</span>{" "}
                    <span className={ltfGate.actionable ? "text-emerald-300" : "text-rose-300"}>
                      {String(ltfGate.actionable)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {ltfGate.reason_code} — {ltfGate.reason_detail}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-8">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold">Result</div>

              {!analysis ? (
                <div className="mt-3 text-sm text-slate-400">Chưa có analysis. Build snapshot rồi Run.</div>
              ) : (
                <>
                  <div className="mt-2 text-xs text-slate-500">
                    missing_fields: {analysis?.missing_fields?.length || 0}
                  </div>

                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                    <div className="text-sm font-semibold">IV_SETUPS</div>
                    <div className="mt-2 space-y-2">
                      {(analysis?.sections?.IV_SETUPS || []).map((s, idx) => (
                        <div key={`${s?.id ?? "s"}-${idx}`} className="rounded-xl border border-slate-800 bg-black/20 p-3">
                          <div className="text-sm font-semibold">
                            #{s.id} — {s.title} ({s.direction})
                          </div>
                          <div className="mt-1 text-xs text-slate-300">
                            STATE={s.SETUP_STATE} · ENTRY={s.ENTRY_VALIDITY} · CONF={s.CONFIDENCE}
                          </div>
                          {s.ENTRY_BLOCKER ? (
                            <div className="mt-1 text-xs text-amber-200">ENTRY_BLOCKER: {s.ENTRY_BLOCKER}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <details className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">Raw analysis JSON</summary>
                    <pre className="mt-2 max-h-[420px] overflow-auto text-xs text-slate-200">
{JSON.stringify(analysis, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
