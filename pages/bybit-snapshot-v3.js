import React, { useCallback, useMemo, useState } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";
import Button from "../components/snapshot/Button";
import Toast from "../components/snapshot/Toast";

export default function BybitSnapshotV3New() {
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [htf, setHtf] = useState({
    snapshot: null,
    fileName: "",
    generatedAt: 0,
  });

  const [ltf, setLtf] = useState({
    snapshot: null,
    fileName: "",
    generatedAt: 0,
  });

  const [toast, setToast] = useState("");

  // per-button "Copied ✓"
  const [copiedKey, setCopiedKey] = useState("");
  const COPIED_RESET_MS = 1200;

  // UI state (new)
  const [openCommands, setOpenCommands] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1400);
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

      if (key) {
        setCopiedKey(key);
        setTimeout(() => {
          setCopiedKey((prev) => (prev === key ? "" : prev));
        }, COPIED_RESET_MS);
      }

      showToast(okMsg || "Copied.");
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

  /**
   * SPEC: FULL dashboard macro MUST be one line with 2 files
   */
  const macroFULL = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  // --- canned copy macros (ready-to-paste commands) ---
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

  const CopyBtn = ({ copyKey, label, onClick, disabled }) => (
    <Button variant="secondary" onClick={onClick} disabled={disabled}>
      {copiedKey === copyKey ? "Copied ✓" : label}
    </Button>
  );

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
    setTimeout(() => {
      downloadJson(ltf.snapshot, ltf.fileName);
    }, 150);
  };

  /**
   * One button generates BOTH HTF + LTF
   */
  const handleGenerateBoth = useCallback(async () => {
    setError("");
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);

      const [htfSnap, ltfSnap] = await Promise.all([
        buildSnapshotV3(symbols),
        buildLtfSnapshotV3(symbols),
      ]);

      if (!htfSnap || typeof htfSnap !== "object") {
        throw new Error("Snapshot HTF trả về không hợp lệ.");
      }
      if (!ltfSnap || typeof ltfSnap !== "object") {
        throw new Error("Snapshot LTF trả về không hợp lệ.");
      }

      // HTF filename: keep symbol pulled from HTF snapshot when possible
      const htfTs = htfSnap.generated_at || Date.now();
      const htfSymbol =
        htfSnap?.per_exchange?.bybit?.symbols?.[0]?.symbol || primarySymbol;
      const htfName = `bybit_snapshot_${htfTs}_${htfSymbol}.json`;

      // LTF filename: keep primary symbol (the input) for consistency
      const ltfTs = ltfSnap.generated_at || Date.now();
      const ltfName = `bybit_ltf_snapshot_${ltfTs}_${primarySymbol}.json`;

      setHtf({ snapshot: htfSnap, fileName: htfName, generatedAt: htfTs });
      setLtf({ snapshot: ltfSnap, fileName: ltfName, generatedAt: ltfTs });

      showToast("HTF + LTF snapshots created.");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Có lỗi khi tạo snapshots.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

  // Small helper: chip-like status
  const StatusChip = () => (
    <div
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
        ready
          ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
          : "border-slate-700 bg-slate-900 text-slate-300",
      ].join(" ")}
      title={ready ? "Đã sẵn sàng (có đủ 2 file)" : "Chưa có đủ file"}
    >
      <span
        className={[
          "h-2 w-2 rounded-full",
          ready ? "bg-emerald-400" : "bg-slate-500",
        ].join(" ")}
      />
      {ready ? "Ready" : "No files"}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Toast message={toast} />

      {/* Page container */}
      <div className="mx-auto max-w-3xl px-3 pb-28 pt-5 sm:px-4 sm:pb-8 sm:pt-8">
        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950">
          {/* Header (more compact) */}
          <div className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="text-base font-semibold tracking-tight sm:text-lg">
                  Snapshot Console v3
                </div>
                <div className="text-xs text-slate-500">Mobile-first</div>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                1-click Generate · Download 2 files · Copy macros
              </div>
            </div>
            <div className="shrink-0">
              <StatusChip />
            </div>
          </div>

          <div className="border-t border-slate-800" />

          {/* Content */}
          <div className="px-4 py-4 sm:px-5">
            {/* Symbols input */}
            <div className="rounded-2xl border border-slate-800 bg-black/20 p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Symbols</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Phân tách bằng dấu phẩy hoặc khoảng trắng
                  </div>
                </div>
                <div className="hidden sm:block text-xs text-slate-500">
                  Primary:{" "}
                  <span className="text-slate-300">{primarySymbol}</span>
                </div>
              </div>

              <input
                className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-slate-600"
                value={symbolsText}
                onChange={(e) => setSymbolsText(e.target.value)}
                placeholder="Ví dụ: BTCUSDT, ETHUSDT"
                disabled={loading}
                inputMode="text"
                autoCapitalize="characters"
              />

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:hidden">
                Primary: <span className="text-slate-300">{primarySymbol}</span>
              </div>
            </div>

            {/* File names (tight + readable on mobile) */}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
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

            {/* Quick actions (compact, mobile-friendly) */}
            <div className="mt-4 rounded-2xl border border-slate-800 bg-black/20 p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Quick Actions</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Tối ưu cho thao tác nhanh (phone/iPad)
                  </div>
                </div>
                <div className="hidden sm:block text-xs text-slate-500">
                  FULL format:{" "}
                  <span className="text-slate-300">
                    [DASH] FILE=HTF FILE=LTF
                  </span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  variant="primary"
                  onClick={handleGenerateBoth}
                  disabled={loading}
                >
                  {loading ? "Generating..." : "Generate (HTF + LTF)"}
                </Button>

                <CopyBtn
                  copyKey="copy_full_macro"
                  label="Copy FULL Macro"
                  disabled={!macroFULL}
                  onClick={() =>
                    copyText(macroFULL, "Copied FULL macro", "copy_full_macro")
                  }
                />

                <Button
                  variant="secondary"
                  onClick={downloadBoth}
                  disabled={!htf.snapshot || !ltf.snapshot}
                >
                  Download HTF + LTF
                </Button>
              </div>

              {/* Mobile helper note (short) */}
              <div className="mt-3 text-xs text-slate-500 sm:hidden">
                Tip: “Copy FULL Macro” để dán nhanh vào ChatGPT.
              </div>
            </div>

            {/* Accordion: Copy Commands */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setOpenCommands((v) => !v)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-black/20 px-3 py-3 text-left"
              >
                <div>
                  <div className="text-sm font-semibold">Copy Commands</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Nâng cao · mở khi cần
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {openCommands ? "Ẩn ▲" : "Mở ▼"}
                </div>
              </button>

              {openCommands && (
                <div className="mt-2 rounded-2xl border border-slate-800 bg-black/20 p-3 sm:p-4">
                  <div className="text-xs text-slate-400">
                    Copy–paste trực tiếp vào ChatGPT. Lệnh có{" "}
                    <span className="text-slate-300">[DASH]</span> sẽ kích hoạt
                    dashboard; “no DASH” dùng để hỏi riêng setup.
                  </div>

                  {/* Group: Quick */}
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-slate-300">
                      QUICK
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <CopyBtn
                        copyKey="copy_setup1_only"
                        label="Setup 1 only (no DASH)"
                        disabled={false}
                        onClick={() =>
                          copyText(
                            macroSetup1Only,
                            "Copied: Setup 1 only",
                            "copy_setup1_only"
                          )
                        }
                      />
                      <CopyBtn
                        copyKey="copy_part_i_ii"
                        label="PHẦN I + II (Bias/Trend)"
                        disabled={!macroPartIandII}
                        onClick={() =>
                          copyText(
                            macroPartIandII,
                            "Copied: PHẦN I+II",
                            "copy_part_i_ii"
                          )
                        }
                      />
                    </div>

                    <div className="mt-2 hidden text-xs text-slate-500 sm:block">
                      Setup 1 (no DASH) không bị rule ≥ 3 setup. PHẦN I+II để
                      quyết định ưu tiên Long/Short trước.
                    </div>
                  </div>

                  {/* Group: Trading */}
                  <div className="mt-5">
                    <div className="text-xs font-semibold text-slate-300">
                      TRADING
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <CopyBtn
                        copyKey="copy_part_iv"
                        label="PHẦN IV (Trade Zone)"
                        disabled={!macroPartIV}
                        onClick={() =>
                          copyText(macroPartIV, "Copied: PHẦN IV", "copy_part_iv")
                        }
                      />

                      <CopyBtn
                        copyKey="copy_part_iv_setup1"
                        label="PHẦN IV · Focus Setup 1"
                        disabled={!macroPartIVSetup1}
                        onClick={() =>
                          copyText(
                            macroPartIVSetup1,
                            "Copied: PHẦN IV (Setup 1)",
                            "copy_part_iv_setup1"
                          )
                        }
                      />
                    </div>

                    <div className="mt-2 hidden text-xs text-slate-500 sm:block">
                      PHẦN IV để xem entry/SL/TP nhanh; bản “Focus Setup 1” vẫn
                      giữ output tối giản cho setup 2 & 3 để hợp lệ SPEC.
                    </div>
                  </div>

                  {/* Group: Position */}
                  <div className="mt-5">
                    <div className="text-xs font-semibold text-slate-300">
                      POSITION
                    </div>
                    <div className="mt-2">
                      <CopyBtn
                        copyKey="copy_position_template"
                        label="Position Template (Short)"
                        disabled={!macroPositionShort}
                        onClick={() =>
                          copyText(
                            macroPositionShort,
                            "Copied: Position template",
                            "copy_position_template"
                          )
                        }
                      />
                      <div className="mt-2 hidden text-xs text-slate-500 sm:block">
                        Điền ENTRY/SL để AI tập trung quản lý vị thế theo snapshot.
                      </div>
                    </div>
                  </div>

                  {/* Footer note */}
                  <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
                    FULL macro format:&nbsp;
                    <span className="text-slate-300">
                      [DASH] FILE=HTF FILE=LTF
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky bottom actions (mobile-first) */}
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

            <CopyBtn
              copyKey="copy_full_macro_sticky"
              label="Copy FULL"
              disabled={!macroFULL}
              onClick={() =>
                copyText(
                  macroFULL,
                  "Copied FULL macro",
                  "copy_full_macro_sticky"
                )
              }
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">
              {ready ? "Ready: HTF + LTF files" : "Chưa có đủ HTF + LTF"}
            </span>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                if (!openCommands) setOpenCommands(true);
                // scroll a bit up so user sees the accordion content
                window.scrollTo({ top: 999999, behavior: "smooth" });
              }}
            >
              Commands
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
