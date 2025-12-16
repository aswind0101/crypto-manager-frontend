import React, { useCallback, useMemo, useState } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";
import Button from "../components/snapshot/Button";
import Toast from "../components/snapshot/Toast";

export default function BybitSnapshotV3New() {
  /* =======================
     CORE STATE
  ======================= */
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [htf, setHtf] = useState({ snapshot: null, fileName: "" });
  const [ltf, setLtf] = useState({ snapshot: null, fileName: "" });

  const [toast, setToast] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  /* =======================
     UI STATE (ENHANCED)
  ======================= */
  const [openCommands, setOpenCommands] = useState(false);
  const [cmdTab, setCmdTab] = useState("quick"); // quick | trading | position
  const [autoCloseAfterCopy, setAutoCloseAfterCopy] = useState(true);

  const COPIED_RESET_MS = 1200;

  /* =======================
     HELPERS
  ======================= */
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1400);
  };

  const haptic = () => {
    try {
      if (navigator?.vibrate) navigator.vibrate(10);
    } catch {}
  };

  const copyText = async (text, okMsg, key) => {
    try {
      if (!text) return;

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      haptic();
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), COPIED_RESET_MS);
      showToast(okMsg || "Copied.");

      if (autoCloseAfterCopy) {
        setTimeout(() => setOpenCommands(false), 250);
      }
    } catch {
      showToast("Copy failed.");
    }
  };

  const normalizeSymbols = (input) =>
    (input || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

  const symbols = useMemo(() => normalizeSymbols(symbolsText), [symbolsText]);
  const primarySymbol = symbols[0] || "SYMBOL";
  const ready = Boolean(htf.fileName && ltf.fileName);

  /* =======================
     MACROS
  ======================= */
  const macroFULL = ready
    ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`
    : "";

  const macroPartIV = ready
    ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV`
    : "";

  const macroPartIVSetup1 = ready
    ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV, tập trung Setup 1`
    : "";

  const macroPartIandII = htf.fileName
    ? `[DASH] FILE=${htf.fileName}\nchỉ render PHẦN I và PHẦN II`
    : "";

  const macroSetup1Only = `Kiểm tra Setup 1 ${primarySymbol} theo snapshot mới (không dùng [DASH])`;

  const macroPositionShort = ready
    ? `Mình đang Short ${primarySymbol} @<ENTRY>, SL <SL>\n[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`
    : "";

  /* =======================
     SNAPSHOT GENERATION
  ======================= */
  const handleGenerateBoth = useCallback(async () => {
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const [htfSnap, ltfSnap] = await Promise.all([
        buildSnapshotV3(symbols),
        buildLtfSnapshotV3(symbols),
      ]);

      const htfName = `bybit_snapshot_${htfSnap.generated_at}_${primarySymbol}.json`;
      const ltfName = `bybit_ltf_snapshot_${ltfSnap.generated_at}_${primarySymbol}.json`;

      setHtf({ snapshot: htfSnap, fileName: htfName });
      setLtf({ snapshot: ltfSnap, fileName: ltfName });

      showToast("HTF + LTF snapshots created.");
    } catch {
      setError("Có lỗi khi tạo snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

  /* =======================
     UI COMPONENTS
  ======================= */
  const CopyBtn = ({ label, text, copyKey, disabled }) => (
    <button
      disabled={disabled}
      onClick={() => copyText(text, label, copyKey)}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
        disabled
          ? "border-slate-800 bg-black/10 opacity-50"
          : "border-slate-800 bg-black/20 hover:bg-black/30"
      }`}
    >
      <div className="flex justify-between items-center">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-slate-400">
          {copiedKey === copyKey ? "Copied ✓" : "Copy"}
        </span>
      </div>
    </button>
  );

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setCmdTab(id)}
      className={`rounded-xl px-3 py-2 text-sm ${
        cmdTab === id
          ? "bg-slate-200 text-slate-950"
          : "bg-black/20 text-slate-200"
      }`}
    >
      {label}
    </button>
  );

  /* =======================
     RENDER
  ======================= */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Toast message={toast} />

      <div className="mx-auto max-w-3xl px-3 pb-28 pt-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-950">
          {/* Header */}
          <div className="flex justify-between items-center px-4 py-4">
            <div>
              <div className="text-lg font-semibold">
                Snapshot Console v3
              </div>
              <div className="text-xs text-slate-400">
                Mobile-first · App-like UI
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                ready
                  ? "bg-emerald-950 text-emerald-200"
                  : "bg-slate-800 text-slate-300"
              }`}
            >
              {ready ? "Ready" : "No files"}
            </span>
          </div>

          <div className="border-t border-slate-800" />

          {/* Symbols */}
          <div className="p-4">
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="BTCUSDT, ETHUSDT"
            />
          </div>

          {/* Quick actions */}
          <div className="px-4 pb-4 grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={handleGenerateBoth} disabled={loading}>
              {loading ? "Generating..." : "Generate"}
            </Button>
            <Button
              variant="secondary"
              disabled={!macroFULL}
              onClick={() => copyText(macroFULL, "Copied FULL", "full")}
            >
              Copy FULL
            </Button>
          </div>

          {/* Copy Commands */}
          <div className="px-4 pb-4">
            <button
              onClick={() => setOpenCommands(!openCommands)}
              className="w-full rounded-xl border border-slate-800 bg-black/20 px-3 py-2 text-sm"
            >
              Copy Commands {openCommands ? "▲" : "▼"}
            </button>

            {openCommands && (
              <div className="mt-3 space-y-3">
                {/* Tabs */}
                <div className="grid grid-cols-3 gap-2">
                  <TabBtn id="quick" label="Quick" />
                  <TabBtn id="trading" label="Trading" />
                  <TabBtn id="position" label="Position" />
                </div>

                {/* Tab content */}
                {cmdTab === "quick" && (
                  <>
                    <CopyBtn
                      label="FULL Macro"
                      text={macroFULL}
                      copyKey="c_full"
                      disabled={!macroFULL}
                    />
                    <CopyBtn
                      label="Setup 1 only (no DASH)"
                      text={macroSetup1Only}
                      copyKey="c_s1"
                    />
                    <CopyBtn
                      label="PHẦN I + II"
                      text={macroPartIandII}
                      copyKey="c_i2"
                      disabled={!macroPartIandII}
                    />
                  </>
                )}

                {cmdTab === "trading" && (
                  <>
                    <CopyBtn
                      label="PHẦN IV"
                      text={macroPartIV}
                      copyKey="c_iv"
                      disabled={!macroPartIV}
                    />
                    <CopyBtn
                      label="PHẦN IV · Setup 1"
                      text={macroPartIVSetup1}
                      copyKey="c_iv1"
                      disabled={!macroPartIVSetup1}
                    />
                  </>
                )}

                {cmdTab === "position" && (
                  <CopyBtn
                    label="Position Template"
                    text={macroPositionShort}
                    copyKey="c_pos"
                    disabled={!macroPositionShort}
                  />
                )}

                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={autoCloseAfterCopy}
                    onChange={() =>
                      setAutoCloseAfterCopy((v) => !v)
                    }
                  />
                  Auto-close after copy
                </label>
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-4 rounded-xl bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
