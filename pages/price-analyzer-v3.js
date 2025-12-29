// pages/price-analyzer-v3.js
import React, { useMemo, useState } from "react";
import { analyzeSnapshot } from "../lib/price-analyzer-v3";

export default function PriceAnalyzerV3() {
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [primarySymbol, setPrimarySymbol] = useState("BTCUSDT");
  const [buildMode, setBuildMode] = useState("FULL"); // FULL | COMPACT | ENTRY_LTF

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [snapshot, setSnapshot] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  const symbols = useMemo(() => {
    return (symbolsText || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }, [symbolsText]);

  const availableSymbols = useMemo(() => {
    const m = snapshot?.per_exchange?.bybit?.symbols;
    if (!m) return [];
    if (Array.isArray(m)) {
      return m
        .map((x) => (x?.symbol || x?.name || "").toUpperCase())
        .filter(Boolean);
    }
    return Object.keys(m).map((s) => String(s).toUpperCase());
  }, [snapshot]);

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

  async function buildSnapshot() {
    setErr("");
    setAnalysis(null);

    if (!symbols.length) {
      setErr("Bạn chưa nhập symbols.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/snapshot-v3", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbols,
          mode: buildMode,
          anchorRef: null,
        }),
      });

      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Snapshot build failed");

      setSnapshot(j.snapshot);

      // auto-pick primary symbol if not present
      const p0 = symbols[0];
      setPrimarySymbol((prev) => (prev ? String(prev).toUpperCase() : p0));
    } catch (e) {
      setErr(e?.message || "Build snapshot error");
    } finally {
      setLoading(false);
    }
  }

  function runAnalyze() {
    setErr("");
    if (!snapshot) {
      setErr("Chưa có snapshot. Hãy bấm Build Snapshot trước.");
      return;
    }
    const sym = String(primarySymbol || "").toUpperCase();
    if (!sym) {
      setErr("Primary symbol không hợp lệ.");
      return;
    }
    try {
      const out = analyzeSnapshot(snapshot, sym, { timezone: "America/Los_Angeles" });
      setAnalysis(out);
    } catch (e) {
      console.error(e);
      setErr("Core engine crashed khi analyzeSnapshot(). Kiểm tra console log.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="text-2xl font-semibold">Price Analyzer V3 — New UI</div>
        <div className="mt-1 text-sm text-slate-400">
          Build snapshot server-side → analyze → render setups + LTF gate + download JSON.
        </div>

        {err ? (
          <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-12">
          {/* Left */}
          <div className="md:col-span-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold">Build Snapshot</div>

              <div className="mt-3">
                <div className="text-xs font-medium text-slate-300">Symbols (comma-separated)</div>
                <input
                  value={symbolsText}
                  onChange={(e) => setSymbolsText(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm outline-none focus:border-slate-600"
                  placeholder="BTCUSDT, ETHUSDT"
                />
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-slate-300">Mode</div>
                <div className="mt-2 flex gap-2">
                  {["FULL", "COMPACT", "ENTRY_LTF"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBuildMode(m)}
                      className={[
                        "rounded-xl px-3 py-2 text-sm",
                        buildMode === m
                          ? "bg-slate-200 text-slate-950"
                          : "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30",
                      ].join(" ")}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={buildSnapshot}
                  disabled={loading}
                  className={[
                    "rounded-xl px-3 py-2 text-sm font-semibold",
                    loading
                      ? "cursor-not-allowed border border-slate-800 bg-slate-900/30 text-slate-500"
                      : "border border-slate-700 bg-slate-200 text-slate-950 hover:bg-white",
                  ].join(" ")}
                >
                  {loading ? "Building..." : "Build Snapshot"}
                </button>

                <button
                  type="button"
                  disabled={!snapshot}
                  onClick={() => downloadJson(snapshot, `snapshot_${snapshot?.generated_at || Date.now()}.json`)}
                  className={[
                    "rounded-xl px-3 py-2 text-sm",
                    snapshot
                      ? "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30"
                      : "cursor-not-allowed border border-slate-800 bg-black/10 text-slate-600",
                  ].join(" ")}
                >
                  Download Snapshot
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold">Analyze</div>

              <div className="mt-3">
                <div className="text-xs font-medium text-slate-300">Primary Symbol</div>
                <input
                  value={primarySymbol}
                  onChange={(e) => setPrimarySymbol(e.target.value.toUpperCase())}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm outline-none focus:border-slate-600"
                  placeholder="BTCUSDT"
                />

                {availableSymbols.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {availableSymbols.slice(0, 12).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPrimarySymbol(s)}
                        className={[
                          "rounded-full border px-2 py-1 text-xs",
                          String(primarySymbol).toUpperCase() === String(s).toUpperCase()
                            ? "border-slate-500 bg-slate-200 text-slate-950"
                            : "border-slate-800 bg-slate-950/30 text-slate-300 hover:bg-slate-900/40",
                        ].join(" ")}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={!snapshot}
                  onClick={runAnalyze}
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
                  disabled={!analysis}
                  onClick={() =>
                    downloadJson(
                      analysis,
                      `analysis_${analysis?.meta?.generated_at || Date.now()}_${analysis?.meta?.symbol || "SYMBOL"}.json`
                    )
                  }
                  className={[
                    "rounded-xl px-3 py-2 text-sm",
                    analysis
                      ? "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30"
                      : "cursor-not-allowed border border-slate-800 bg-black/10 text-slate-600",
                  ].join(" ")}
                >
                  Download Analysis
                </button>
              </div>
            </div>
          </div>

          {/* Right */}
          <div className="md:col-span-8">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold">LTF Gate</div>

              {!snapshot ? (
                <div className="mt-3 text-sm text-slate-400">Chưa có snapshot.</div>
              ) : !ltfGate ? (
                <div className="mt-3 text-sm text-amber-200">
                  Không tìm thấy ltf_trigger_state ở per_exchange_ltf.bybit.symbols[{String(primarySymbol).toUpperCase()}].ltf_trigger_state
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-sm">
                  <div>
                    <span className="text-slate-400">primary_tf:</span> {String(ltfGate.primary_tf || "—")}
                  </div>
                  <div>
                    <span className="text-slate-400">state:</span> {String(ltfGate.state || "—")}
                  </div>
                  <div>
                    <span className="text-slate-400">actionable:</span>{" "}
                    <span className={ltfGate.actionable ? "text-emerald-300" : "text-rose-300"}>
                      {String(ltfGate.actionable)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="text-slate-400">reason:</span>{" "}
                    {String(ltfGate.reason_code || "—")} — {String(ltfGate.reason_detail || "")}
                  </div>
                </div>
              )}
            </div>

            {analysis ? (
              <>
                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
                  <div className="text-sm font-semibold">Missing Fields</div>
                  {analysis?.missing_fields?.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-slate-200">
                      {analysis.missing_fields.slice(0, 60).map((m) => (
                        <li key={m} className="break-all">
                          <span className="text-amber-300">MISSING FIELD:</span> {m}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm text-emerald-200">Không thiếu field bắt buộc.</div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
                  <div className="text-sm font-semibold">IV_SETUPS</div>
                  <div className="mt-3 space-y-3">
                    {(analysis?.sections?.IV_SETUPS || []).map((s, idx) => (
                      <div
                        key={`${s?.id ?? "setup"}-${idx}`}
                        className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"
                      >
                        <div className="text-sm font-semibold">
                          #{s?.id} — {s?.title} ({s?.direction})
                        </div>
                        <div className="mt-2 text-xs text-slate-300">
                          STATE={s?.SETUP_STATE} · ENTRY={s?.ENTRY_VALIDITY} · CONF={s?.CONFIDENCE}
                        </div>
                        {s?.ENTRY_BLOCKER ? (
                          <div className="mt-2 text-xs text-amber-200">ENTRY_BLOCKER: {s.ENTRY_BLOCKER}</div>
                        ) : null}
                        {s?.WAIT_SOURCE_PATH ? (
                          <div className="mt-1 break-all text-xs text-slate-400">
                            WAIT_SOURCE_PATH: {s.WAIT_SOURCE_PATH}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/20 p-4 text-sm text-slate-400">
                Build snapshot xong → chọn primary symbol → Run analyzeSnapshot().
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
