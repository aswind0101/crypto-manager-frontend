// pages/price-analyzer-v3.js
import React, { useEffect, useMemo, useRef, useState } from "react";

// IMPORTANT: chỉnh đường dẫn import này theo project của bạn.
// Ví dụ nếu bạn có /lib/price-analyzer-v3/index.js export analyzeSnapshot:
import { analyzeSnapshot } from "../lib/price-analyzer-v3";

/**
 * Price Analyzer V3 — New UI Page
 * - Upload / Paste snapshot JSON
 * - Pick symbol
 * - Run core engine: analyzeSnapshot(snapshot, symbol)
 * - Render: PHẦN 0 (DATA CHECK) + IV_SETUPS (>=3) + SELF_CHECK + MISSING_FIELDS
 * - Download analysis JSON
 */

export default function PriceAnalyzerV3Page() {
  /* =======================
     INPUT STATE
  ======================= */
  const [mode, setMode] = useState("FULL"); // FULL | SETUPS_SUMMARY (UI only)
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [rawText, setRawText] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotName, setSnapshotName] = useState("");
  const [error, setError] = useState("");
  const [parseInfo, setParseInfo] = useState("");

  /* =======================
     OUTPUT STATE
  ======================= */
  const [analysis, setAnalysis] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(0);

  const fileRef = useRef(null);

  /* =======================
     HELPERS
  ======================= */
  const safeJsonParse = (text) => {
    try {
      const v = JSON.parse(text);
      return { ok: true, value: v, err: "" };
    } catch (e) {
      return { ok: false, value: null, err: e?.message || "JSON parse error" };
    }
  };

  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadJson = (obj, name) => {
    if (!obj) return;
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    downloadBlob(blob, name);
  };

  const prettyTs = (ts) => {
    if (!Number.isFinite(Number(ts))) return "—";
    const d = new Date(Number(ts));
    return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  };

  const fmtNum = (v, dp = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(dp);
  };

  const badgeClass = (kind) => {
    switch (kind) {
      case "READY":
        return "bg-emerald-500/15 text-emerald-200 border-emerald-500/25";
      case "ALMOST_READY":
        return "bg-amber-500/15 text-amber-200 border-amber-500/25";
      case "BUILD-UP":
        return "bg-sky-500/15 text-sky-200 border-sky-500/25";
      case "INVALID":
        return "bg-rose-500/15 text-rose-200 border-rose-500/25";
      default:
        return "bg-slate-500/15 text-slate-200 border-slate-500/25";
    }
  };

  const validityClass = (kind) => {
    switch (kind) {
      case "ENTRY_OK":
        return "bg-emerald-500/15 text-emerald-200 border-emerald-500/25";
      case "ENTRY_WAIT":
        return "bg-amber-500/15 text-amber-200 border-amber-500/25";
      case "ENTRY_OFF":
        return "bg-rose-500/15 text-rose-200 border-rose-500/25";
      case "ENTRY_LATE":
        return "bg-orange-500/15 text-orange-200 border-orange-500/25";
      default:
        return "bg-slate-500/15 text-slate-200 border-slate-500/25";
    }
  };

  const chip = (text, cls) => (
    <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs", cls].join(" ")}>
      {text}
    </span>
  );

  /* =======================
     PARSE SNAPSHOT
  ======================= */
  const onParseFromText = () => {
    setError("");
    setParseInfo("");
    const t = (rawText || "").trim();
    if (!t) {
      setError("Bạn chưa dán snapshot JSON.");
      return;
    }
    const p = safeJsonParse(t);
    if (!p.ok) {
      setError(`JSON không hợp lệ: ${p.err}`);
      return;
    }
    setSnapshot(p.value);
    setSnapshotName("pasted_snapshot.json");
    const genAt = p.value?.generated_at;
    setParseInfo(`Loaded snapshot from paste. generated_at=${genAt ? prettyTs(genAt) : "—"}`);
  };

  const onFilePick = async (f) => {
    setError("");
    setParseInfo("");
    setAnalysis(null);

    if (!f) return;
    setSnapshotName(f.name || "snapshot.json");

    try {
      const text = await f.text();
      const p = safeJsonParse(text);
      if (!p.ok) {
        setError(`File JSON không hợp lệ: ${p.err}`);
        return;
      }
      setSnapshot(p.value);
      setRawText(text);
      const genAt = p.value?.generated_at;
      setParseInfo(`Loaded snapshot from file. generated_at=${genAt ? prettyTs(genAt) : "—"}`);
    } catch (e) {
      setError("Không đọc được file JSON.");
    }
  };

  /* =======================
     AUTO: infer symbol list
  ======================= */
  const availableSymbols = useMemo(() => {
    const m = snapshot?.per_exchange?.bybit?.symbols;
    if (!m) return [];
    if (Array.isArray(m)) {
      return m
        .map((x) => x?.symbol || x?.name)
        .filter(Boolean)
        .map((s) => String(s).toUpperCase());
    }
    return Object.keys(m).map((s) => String(s).toUpperCase());
  }, [snapshot]);

  useEffect(() => {
    if (!availableSymbols.length) return;
    // if current symbol not in list, auto pick first
    const s = String(symbol || "").toUpperCase();
    if (s && availableSymbols.includes(s)) return;
    setSymbol(availableSymbols[0]);
  }, [availableSymbols]); // eslint-disable-line react-hooks/exhaustive-deps

  /* =======================
     RUN ANALYSIS
  ======================= */
  const onRun = () => {
    setError("");
    if (!snapshot) {
      setError("Chưa có snapshot. Hãy upload hoặc paste JSON trước.");
      return;
    }
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) {
      setError("Symbol không hợp lệ.");
      return;
    }

    try {
      const out = analyzeSnapshot(snapshot, sym, { timezone: "America/Los_Angeles" });
      setAnalysis(out);
      setLastRunAt(Date.now());
    } catch (e) {
      console.error(e);
      setError("Core engine crashed khi analyze snapshot. Kiểm tra console log.");
    }
  };

  const canDownloadAnalysis = Boolean(analysis);
  const analysisFileName = useMemo(() => {
    if (!analysis) return "";
    const ts = analysis?.meta?.generated_at || Date.now();
    const sym = analysis?.meta?.symbol || "SYMBOL";
    return `price_analyzer_${ts}_${sym}.json`;
  }, [analysis]);

  /* =======================
     UI DERIVED
  ======================= */
  const snapMeta = useMemo(() => {
    const s = snapshot;
    if (!s) return null;
    return {
      schemaName: s?.schema?.name || "—",
      schemaVersion: s?.schema?.version || "—",
      generatedAt: s?.generated_at || null,
      hasBybit: Boolean(s?.per_exchange?.bybit),
      hasLtf: Boolean(s?.per_exchange_ltf?.bybit),
    };
  }, [snapshot]);

  const setups = analysis?.sections?.IV_SETUPS || [];
  const dataCheck = analysis?.sections?.["0_DATA_CHECK"] || null;
  const selfCheck = analysis?.sections?.SELF_CHECK || null;
  const missingFields = analysis?.missing_fields || [];

  /* =======================
     RENDER
  ======================= */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight">📊 Price Analyzer V3 — Dashboard</div>
            <div className="mt-1 text-sm text-slate-400">
              Upload / Paste snapshot → chạy Core Engine → render setup execution fields + missing fields.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSnapshot(null);
                setAnalysis(null);
                setRawText("");
                setSnapshotName("");
                setParseInfo("");
                setError("");
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/60"
            >
              Reset
            </button>

            <button
              type="button"
              disabled={!canDownloadAnalysis}
              onClick={() => downloadJson(analysis, analysisFileName)}
              className={[
                "rounded-xl px-3 py-2 text-sm transition",
                canDownloadAnalysis
                  ? "border border-slate-700 bg-slate-200 text-slate-950 hover:bg-white"
                  : "cursor-not-allowed border border-slate-800 bg-slate-900/20 text-slate-500",
              ].join(" ")}
            >
              Download Analysis JSON
            </button>
          </div>
        </div>

        {/* Main grid */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-12">
          {/* Left panel: inputs */}
          <div className="md:col-span-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold text-slate-100">INPUT</div>
              <div className="mt-3 space-y-3">
                {/* Mode */}
                <div>
                  <div className="text-xs font-medium text-slate-300">UI Mode</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMode("FULL")}
                      className={[
                        "rounded-xl px-3 py-2 text-sm transition",
                        mode === "FULL"
                          ? "bg-slate-200 text-slate-950"
                          : "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30",
                      ].join(" ")}
                    >
                      FULL
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("SETUPS_SUMMARY")}
                      className={[
                        "rounded-xl px-3 py-2 text-sm transition",
                        mode === "SETUPS_SUMMARY"
                          ? "bg-slate-200 text-slate-950"
                          : "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30",
                      ].join(" ")}
                    >
                      SETUPS SUMMARY
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Chỉ thay đổi phạm vi hiển thị UI. Logic setup luôn lấy từ cùng core output.
                  </div>
                </div>

                {/* Symbol */}
                <div>
                  <div className="text-xs font-medium text-slate-300">Primary Symbol</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                      placeholder="BTCUSDT"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
                    />
                    <button
                      type="button"
                      onClick={onRun}
                      className="rounded-xl border border-slate-700 bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-white"
                    >
                      Run
                    </button>
                  </div>

                  {availableSymbols.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {availableSymbols.slice(0, 10).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSymbol(s)}
                          className={[
                            "rounded-full border px-2 py-1 text-xs",
                            String(symbol).toUpperCase() === s
                              ? "border-slate-500 bg-slate-200 text-slate-950"
                              : "border-slate-800 bg-slate-950/30 text-slate-300 hover:bg-slate-900/40",
                          ].join(" ")}
                        >
                          {s}
                        </button>
                      ))}
                      {availableSymbols.length > 10 && (
                        <span className="text-xs text-slate-500">+{availableSymbols.length - 10} more</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Upload */}
                <div>
                  <div className="text-xs font-medium text-slate-300">Upload Snapshot JSON</div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json"
                    onChange={(e) => onFilePick(e.target.files?.[0])}
                    className="mt-2 block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:file:bg-white"
                  />
                  {snapshotName && (
                    <div className="mt-2 text-xs text-slate-400">
                      Loaded: <span className="text-slate-200">{snapshotName}</span>
                    </div>
                  )}
                </div>

                {/* Paste */}
                <div>
                  <div className="text-xs font-medium text-slate-300">Paste Snapshot JSON</div>
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder='{"schema": {...}, "generated_at": ..., "per_exchange": {...}}'
                    className="mt-2 h-40 w-full resize-y rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-slate-100 outline-none focus:border-slate-600"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={onParseFromText}
                      className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2 text-sm text-slate-200 hover:bg-black/30"
                    >
                      Parse from paste
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRawText("");
                        setSnapshot(null);
                        setAnalysis(null);
                        setParseInfo("");
                        setError("");
                      }}
                      className="rounded-xl border border-slate-800 bg-black/10 px-3 py-2 text-sm text-slate-400 hover:bg-black/20"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Snapshot meta */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-slate-400">
                  <div className="font-semibold text-slate-200">Snapshot Meta</div>
                  <div className="mt-1">schema.name: {snapMeta?.schemaName || "—"}</div>
                  <div>schema.version: {snapMeta?.schemaVersion || "—"}</div>
                  <div>generated_at: {snapMeta?.generatedAt ? prettyTs(snapMeta.generatedAt) : "—"}</div>
                  <div className="mt-1">
                    bybit blocks:{" "}
                    {snapMeta?.hasBybit ? (
                      <span className="text-emerald-300">HTF OK</span>
                    ) : (
                      <span className="text-rose-300">HTF MISSING</span>
                    )}
                    {" · "}
                    {snapMeta?.hasLtf ? (
                      <span className="text-emerald-300">LTF OK</span>
                    ) : (
                      <span className="text-rose-300">LTF MISSING</span>
                    )}
                  </div>
                </div>

                {/* parse info + error */}
                {parseInfo && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-slate-300">
                    {parseInfo}
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="text-sm font-semibold text-slate-100">ACTIONS</div>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <button
                  type="button"
                  disabled={!analysis}
                  onClick={() => {
                    if (!analysis) return;
                    const mini = {
                      spec: analysis.spec,
                      timezone: analysis.timezone,
                      meta: analysis.meta,
                      validity: analysis.validity,
                      missing_fields: analysis.missing_fields,
                      sections: {
                        "0_DATA_CHECK": analysis.sections?.["0_DATA_CHECK"] || null,
                        IV_SETUPS: analysis.sections?.IV_SETUPS || [],
                        SELF_CHECK: analysis.sections?.SELF_CHECK || null,
                      },
                    };
                    downloadJson(mini, analysisFileName.replace(".json", "_summary.json"));
                  }}
                  className={[
                    "w-full rounded-xl px-3 py-2 text-left transition",
                    analysis
                      ? "border border-slate-800 bg-black/20 text-slate-200 hover:bg-black/30"
                      : "cursor-not-allowed border border-slate-800 bg-black/10 text-slate-600",
                  ].join(" ")}
                >
                  📋 Download Setups Summary JSON
                </button>

                <div className="text-xs text-slate-500">
                  Lưu ý: UI này chỉ render kết quả từ core output (không tính lại logic).
                </div>
              </div>
            </div>
          </div>

          {/* Right panel: output */}
          <div className="md:col-span-8">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">OUTPUT</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {analysis ? (
                      <>
                        spec={analysis.spec} · symbol={analysis?.meta?.symbol} · generated_at={prettyTs(analysis?.meta?.generated_at)} ·
                        last_run={prettyTs(lastRunAt)}
                      </>
                    ) : (
                      "Chưa có output. Upload/Paste snapshot và bấm Run."
                    )}
                  </div>
                </div>

                {analysis && (
                  <div className="flex flex-wrap gap-2">
                    {chip(`snapshot_ok=${analysis?.validity?.snapshot_ok ? "true" : "false"}`, "border-slate-700 bg-slate-950/30 text-slate-200")}
                    {missingFields.length ? chip(`missing=${missingFields.length}`, "border-amber-500/25 bg-amber-500/10 text-amber-200") : chip("missing=0", "border-emerald-500/25 bg-emerald-500/10 text-emerald-200")}
                  </div>
                )}
              </div>

              {/* Missing fields */}
              {analysis && (
                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                  <div className="text-sm font-semibold text-slate-100">⚠️ MISSING FIELDS</div>
                  {missingFields.length === 0 ? (
                    <div className="mt-2 text-sm text-emerald-200">Không thiếu field bắt buộc.</div>
                  ) : (
                    <ul className="mt-2 space-y-1 text-xs text-slate-200">
                      {missingFields.slice(0, 80).map((m) => (
                        <li key={m} className="flex gap-2">
                          <span className="text-amber-300">MISSING FIELD:</span>
                          <span className="break-all text-slate-200">{m}</span>
                        </li>
                      ))}
                      {missingFields.length > 80 && (
                        <li className="text-xs text-slate-500">+ {missingFields.length - 80} more…</li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              {/* PHẦN 0 */}
              {analysis && dataCheck && (
                <SectionCard title="📌 PHẦN 0 — DATA CHECK" subtitle="Snapshot data sanity check">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-slate-400">
                        <tr>
                          <th className="py-2">Item</th>
                          <th className="py-2">Value</th>
                          <th className="py-2">Path</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm text-slate-100">
                        {(dataCheck?.items || []).map((it) => (
                          <tr key={it.label} className="border-t border-slate-800/60">
                            <td className="py-2 pr-3">{it.label}</td>
                            <td className="py-2 pr-3">{String(it.value)}</td>
                            <td className="py-2 text-xs text-slate-400 break-all">{it.path}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              {/* SETUPS */}
              {analysis && (
                <div className="mt-4">
                  <div className="mb-2 text-sm font-semibold text-slate-100">🧩 PHẦN IV — TRADE ZONE TERMINAL (SETUPS)</div>
                  <div className="space-y-3">
                    {(setups || []).slice(0, mode === "SETUPS_SUMMARY" ? 3 : 10).map((s) => (
                      <SetupCard key={String(s.id)} setup={s} badgeClass={badgeClass} validityClass={validityClass} fmtNum={fmtNum} />
                    ))}
                    {(!setups || setups.length < 3) && (
                      <div className="rounded-2xl border border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-200">
                        SPEC yêu cầu ≥ 3 setup. Hiện engine trả về {setups?.length || 0}.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SELF CHECK */}
              {analysis && selfCheck && (
                <SectionCard title="🧾 SELF-CHECK" subtitle="Consistency checks">
                  <div className="space-y-2">
                    {(selfCheck?.checklist || []).map((c) => (
                      <div key={c.item} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2">
                        <div className="text-sm text-slate-200">{c.item}</div>
                        <div className={c.ok ? "text-emerald-300" : "text-rose-300"}>{c.ok ? "OK" : "FAIL"}</div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* Raw JSON viewer */}
              {analysis && (
                <div className="mt-4">
                  <details className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-100">Raw analysis JSON</summary>
                    <pre className="mt-3 max-h-[520px] overflow-auto rounded-xl border border-slate-800 bg-black/30 p-3 text-xs text-slate-200">
{JSON.stringify(analysis, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-xs text-slate-600">
          Gợi ý: dùng snapshot FULL (không compact) để giảm missing fields và đảm bảo closed-candle proof.
        </div>
      </div>
    </div>
  );
}

/* =======================
   UI subcomponents
======================= */

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SetupCard({ setup, badgeClass, validityClass, fmtNum }) {
  const dir = setup?.direction || "—";
  const st = setup?.SETUP_STATE || "—";
  const ev = setup?.ENTRY_VALIDITY || "—";
  const conf = Number.isFinite(Number(setup?.CONFIDENCE)) ? Number(setup.CONFIDENCE) : null;

  const zone = setup?.ENTRY_ZONE;
  const zLow = zone?.low;
  const zHigh = zone?.high;

  const trig = setup?.ENTRY_TRIGGER || {};
  const candle = trig?.candle;

  const sl = setup?.SL?.price;
  const tp1 = setup?.TP?.TP1?.price;
  const rr1 = setup?.RR?.TP1;

  const blocker = setup?.ENTRY_BLOCKER || "";
  const waitReason = setup?.WAIT_REASON || "";
  const waitPath = setup?.WAIT_SOURCE_PATH || "";

  const risk = setup?.RISK?.level || "—";
  const whyBullets = setup?.WHY?.bullets || [];
  const missing = setup?.WHY?.missing_fields || [];

  const goNoGo = useMemo(() => {
    // deterministic UI rule: GO only if READY + ENTRY_OK + not blocked
    const isGo = st === "READY" && ev === "ENTRY_OK" && !String(blocker || "").includes("BLOCKED");
    return isGo ? "GO" : "NO-GO";
  }, [st, ev, blocker]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100">
            SETUP #{setup?.id} — {setup?.title} <span className="text-slate-400">(DIRECTION: {dir})</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs", badgeClass(st)].join(" ")}>
              SETUP_STATE: {st}
            </span>
            <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs", validityClass(ev)].join(" ")}>
              ENTRY_VALIDITY: {ev}
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/30 px-2 py-0.5 text-xs text-slate-200">
              CONFIDENCE: {conf == null ? "—" : conf}
            </span>
            <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs", goNoGo === "GO" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-rose-500/25 bg-rose-500/10 text-rose-200"].join(" ")}>
              {goNoGo}
            </span>
          </div>

          {(blocker || waitReason || waitPath) && (
            <div className="mt-2 rounded-xl border border-slate-800 bg-black/20 px-3 py-2 text-xs text-slate-200">
              {blocker && (
                <div>
                  <span className="text-slate-400">ENTRY_BLOCKER:</span> <span className="text-slate-100">{blocker}</span>
                </div>
              )}
              {(waitReason || waitPath) && (
                <div className="mt-1 text-slate-400">
                  WAIT: {waitReason || "—"} · path=<span className="break-all">{waitPath || "—"}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2 text-xs text-slate-200">
            <div className="text-slate-400">ENTRY_ZONE</div>
            <div className="mt-1">
              {zLow == null || zHigh == null ? "—" : `${fmtNum(zLow, 2)} – ${fmtNum(zHigh, 2)}`}
            </div>
            {Array.isArray(zone?.source_paths) && zone.source_paths.length > 0 && (
              <div className="mt-1 break-all text-[11px] text-slate-500">
                source: {zone.source_paths.join(", ")}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2 text-xs text-slate-200">
            <div className="text-slate-400">Execution</div>
            <div className="mt-1">SL: {sl == null ? "—" : fmtNum(sl, 2)}</div>
            <div>TP1: {tp1 == null ? "—" : fmtNum(tp1, 2)}</div>
            <div>RR1: {rr1 == null ? "—" : fmtNum(rr1, 2)}</div>
          </div>
        </div>
      </div>

      {/* Trigger */}
      <div className="mt-3 rounded-2xl border border-slate-800 bg-black/20 p-3">
        <div className="text-xs font-semibold text-slate-200">ENTRY_TRIGGER</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="text-xs text-slate-200">
            <div>
              <span className="text-slate-400">type:</span> {trig?.type || "—"}
            </div>
            <div>
              <span className="text-slate-400">tf:</span> {trig?.timeframe || "—"}
            </div>
            <div>
              <span className="text-slate-400">status:</span> {trig?.status || "—"}
            </div>
          </div>
          <div className="text-xs text-slate-200">
            <div className="text-slate-400">candle</div>
            {candle ? (
              <div className="mt-1 break-all text-slate-200">
                ts={candle.ts} · O/H/L/C={candle.o}/{candle.h}/{candle.l}/{candle.c}
              </div>
            ) : (
              <div className="mt-1 text-slate-500">—</div>
            )}
            <div className="mt-1 break-all text-[11px] text-slate-500">
              proof={trig?.proof?.last_closed_ts ?? "—"} · {trig?.proof?.path ?? ""}
            </div>
          </div>
        </div>
      </div>

      {/* Risk */}
      <div className="mt-3 rounded-2xl border border-slate-800 bg-black/20 p-3">
        <div className="text-xs font-semibold text-slate-200">RISK</div>
        <div className="mt-1 text-sm text-slate-100">Level: {risk}</div>
        {Array.isArray(setup?.RISK?.drivers) && setup.RISK.drivers.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-200">
            {setup.RISK.drivers.slice(0, 8).map((d, i) => (
              <li key={i} className="break-words">{d}</li>
            ))}
          </ul>
        )}
        {Array.isArray(setup?.RISK?.mitigation) && setup.RISK.mitigation.length > 0 && (
          <div className="mt-2 text-xs text-slate-300">
            <span className="text-slate-400">Mitigation:</span> {setup.RISK.mitigation.join(" · ")}
          </div>
        )}
      </div>

      {/* WHY */}
      <div className="mt-3 rounded-2xl border border-slate-800 bg-black/20 p-3">
        <div className="text-xs font-semibold text-slate-200">WHY (audit trail)</div>

        {missing.length > 0 && (
          <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <div className="font-semibold">Missing fields for this setup</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {missing.slice(0, 12).map((m) => (
                <li key={m} className="break-all">MISSING FIELD: {m}</li>
              ))}
            </ul>
          </div>
        )}

        {whyBullets.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-200">
            {whyBullets.slice(0, 12).map((b, i) => (
              <li key={i} className="break-words">{b}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-xs text-slate-500">—</div>
        )}
      </div>
    </div>
  );
}
