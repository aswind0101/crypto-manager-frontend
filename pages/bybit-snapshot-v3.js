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

  // per-button copied state
  const [copiedKey, setCopiedKey] = useState("");
  const COPIED_RESET_MS = 1200;

  /* =======================
     UI STATE
  ======================= */
  const [openCommands, setOpenCommands] = useState(false);
  const [cmdTab, setCmdTab] = useState("quick"); // quick | trading | position

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

      if (key) {
        setCopiedKey(key);
        setTimeout(() => {
          setCopiedKey((prev) => (prev === key ? "" : prev));
        }, COPIED_RESET_MS);
      }

      showToast(okMsg || "Copied.");
      // IMPORTANT: Không auto-close Copy Commands theo yêu cầu
    } catch (e) {
      console.error(e);
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
  const macroFULL = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const macroPartIV = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const macroPartIVSetup1 = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV, tập trung Setup 1`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const macroPartIandII = useMemo(() => {
    if (htf.fileName) {
      return `[DASH] FILE=${htf.fileName}\nchỉ render PHẦN I và PHẦN II`;
    }
    return "";
  }, [htf.fileName]);

  // Non-DASH (always usable; doesn't require files)
  const macroSetup1Only = useMemo(() => {
    return `Kiểm tra Setup 1 ${primarySymbol} theo snapshot mới (không dùng [DASH])`;
  }, [primarySymbol]);

  // Position template (requires files)
  const macroPositionShort = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `Mình đang Short ${primarySymbol} @<ENTRY>, SL <SL>\n[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName, primarySymbol]);

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

      // Keep naming predictable (same as current logic baseline)
      const htfTs = htfSnap?.generated_at || Date.now();
      const ltfTs = ltfSnap?.generated_at || Date.now();

      const htfName = `bybit_snapshot_${htfTs}_${primarySymbol}.json`;
      const ltfName = `bybit_ltf_snapshot_${ltfTs}_${primarySymbol}.json`;

      setHtf({ snapshot: htfSnap, fileName: htfName });
      setLtf({ snapshot: ltfSnap, fileName: ltfName });

      showToast("HTF + LTF snapshots created.");
    } catch (e) {
      console.error(e);
      setError("Có lỗi khi tạo snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

  /* =======================
     DOWNLOAD
  ======================= */
  const downloadJson = (obj, name) => {
    if (!obj) return;

    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name || "snapshot.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };

  const downloadBoth = () => {
    if (!htf.snapshot || !ltf.snapshot) return;

    downloadJson(htf.snapshot, htf.fileName);
    setTimeout(() => downloadJson(ltf.snapshot, ltf.fileName), 150);
  };

  /* =======================
     UI COMPONENTS
  ======================= */
  const TabBtn = ({ id, label }) => (
    <button
      type="button"
      onClick={() => setCmdTab(id)}
      className={[
        "rounded-xl px-3 py-2 text-sm transition",
        cmdTab === id
          ? "bg-slate-200 text-slate-950"
          : "bg-black/20 text-slate-200 hover:bg-black/30",
      ].join(" ")}
    >
      {label}
    </button>
  );

  const CommandButton = ({ title, subtitle, text, copyKey, disabled }) => {
    const isCopied = copiedKey === copyKey;

    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => copyText(text, `Copied: ${title}`, copyKey)}
        className={[
          "w-full rounded-2xl border px-4 py-3 text-left transition",
          disabled
            ? "cursor-not-allowed border-slate-800 bg-black/10 opacity-60"
            : "border-slate-800 bg-black/20 hover:bg-black/30 active:scale-[0.99]",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">{title}</div>
            {subtitle ? (
              <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
            ) : null}
          </div>

          <div className="shrink-0">
            {isCopied ? (
              <span className="rounded-full border border-emerald-800/60 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-200">
                Copied ✓
              </span>
            ) : (
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                Copy
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  /* =======================
     RENDER
  ======================= */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Toast message={toast} />

      <div className="mx-auto max-w-3xl px-3 pb-28 pt-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-950">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 py-4">
            <div>
              <div className="text-lg font-semibold tracking-tight">
                Snapshot Console v3
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Mobile-first · Tabs · Command hints · Per-button copied state
              </div>
            </div>

            <span
              className={[
                "shrink-0 rounded-full px-3 py-1 text-xs",
                ready
                  ? "border border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
                  : "border border-slate-700 bg-slate-900 text-slate-300",
              ].join(" ")}
            >
              {ready ? "Ready" : "No files"}
            </span>
          </div>

          <div className="border-t border-slate-800" />

          {/* Symbols */}
          <div className="p-4">
            <div className="text-sm font-semibold">Symbols</div>
            <div className="mt-1 text-xs text-slate-400">
              Nhập nhiều symbol bằng dấu phẩy hoặc khoảng trắng. Primary:{" "}
              <span className="text-slate-200">{primarySymbol}</span>
            </div>

            <input
              className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-slate-600"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="BTCUSDT, ETHUSDT"
              disabled={loading}
              inputMode="text"
              autoCapitalize="characters"
            />
          </div>

          {/* File names */}
          <div className="px-4 pb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400">HTF file</div>
              <div className="mt-1 break-all text-sm">
                {htf.fileName || "—"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400">LTF file</div>
              <div className="mt-1 break-all text-sm">
                {ltf.fileName || "—"}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="px-4 pb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="primary" onClick={handleGenerateBoth} disabled={loading}>
              {loading ? "Generating..." : "Generate (HTF + LTF)"}
            </Button>

            <Button
              variant="secondary"
              onClick={downloadBoth}
              disabled={!htf.snapshot || !ltf.snapshot}
            >
              Download HTF + LTF
            </Button>

            <Button
              variant="secondary"
              disabled={!macroFULL}
              onClick={() => copyText(macroFULL, "Copied FULL macro", "quick_full")}
            >
              {copiedKey === "quick_full" ? "Copied ✓" : "Copy FULL Macro"}
            </Button>
          </div>

          {/* Copy Commands */}
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => setOpenCommands((v) => !v)}
              className="w-full rounded-2xl border border-slate-800 bg-black/20 px-3 py-3 text-left text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">Copy Commands</span>
                <span className="text-xs text-slate-400">
                  {openCommands ? "Ẩn ▲" : "Mở ▼"}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Mỗi lệnh có chú thích; bấm 1 lần để copy.
              </div>
            </button>

            {openCommands && (
              <div className="mt-3 space-y-3">
                {/* Tabs */}
                <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-2">
                  <TabBtn id="quick" label="Quick" />
                  <TabBtn id="trading" label="Trading" />
                  <TabBtn id="position" label="Position" />
                </div>

                {/* Tab content */}
                {cmdTab === "quick" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="FULL Macro"
                      subtitle="Kích hoạt dashboard theo SPEC: dùng cả 2 file HTF + LTF (1 dòng). замен"
                      text={macroFULL}
                      copyKey="cmd_full"
                      disabled={!macroFULL}
                    />

                    <CommandButton
                      title="Setup 1 only (no DASH)"
                      subtitle="Hỏi riêng Setup 1 mà không bật dashboard (không bị rule ≥ 3 setup)."
                      text={macroSetup1Only}
                      copyKey="cmd_setup1"
                      disabled={false}
                    />

                    <CommandButton
                      title="PHẦN I + II (Bias/Trend)"
                      subtitle="Chỉ render Market Mode + Trend Radar để quyết định ưu tiên Long/Short."
                      text={macroPartIandII}
                      copyKey="cmd_i_ii"
                      disabled={!macroPartIandII}
                    />
                  </div>
                )}

                {cmdTab === "trading" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="PHẦN IV (Trade Zone)"
                      subtitle="Chỉ render Trade Zone Terminal để xem entry/SL/TP nhanh (vẫn đúng rule ≥ 3 setup)."
                      text={macroPartIV}
                      copyKey="cmd_iv"
                      disabled={!macroPartIV}
                    />

                    <CommandButton
                      title="PHẦN IV · Focus Setup 1"
                      subtitle="Tập trung Setup 1; setup 2 & 3 vẫn xuất tối giản để hợp lệ SPEC."
                      text={macroPartIVSetup1}
                      copyKey="cmd_iv_s1"
                      disabled={!macroPartIVSetup1}
                    />
                  </div>
                )}

                {cmdTab === "position" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="Position Template (Short)"
                      subtitle="Dùng khi bạn đang có lệnh: điền ENTRY/SL để AI ưu tiên quản lý vị thế theo snapshot."
                      text={macroPositionShort}
                      copyKey="cmd_pos"
                      disabled={!macroPositionShort}
                    />
                  </div>
                )}

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
                  FULL macro format:&nbsp;
                  <span className="text-slate-300">
                    [DASH] FILE=HTF FILE=LTF
                  </span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-4 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom actions (mobile) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/90 backdrop-blur sm:hidden">
        <div className="mx-auto max-w-3xl px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              onClick={handleGenerateBoth}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate"}
            </Button>

            <Button
              variant="secondary"
              disabled={!macroFULL}
              onClick={() => copyText(macroFULL, "Copied FULL macro", "sticky_full")}
            >
              {copiedKey === "sticky_full" ? "Copied ✓" : "Copy FULL"}
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">
              {ready ? "Ready: HTF + LTF files" : "Chưa có đủ HTF + LTF"}
            </span>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setOpenCommands(true)}
            >
              Commands
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
