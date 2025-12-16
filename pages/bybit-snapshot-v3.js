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

  // NEW: track which copy button is currently showing "Copied ✓"
  const [copiedKey, setCopiedKey] = useState("");
  const COPIED_RESET_MS = 1200;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1400);
  };

  // NEW: copy + set per-button copied state
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

      // per-button feedback
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

  // NEW: helper to render a copy button with inline "Copied ✓"
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

    // 1 click → browser sẽ tải 2 file liên tiếp (có thể cần allow multiple downloads lần đầu)
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Toast message={toast} />

      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold tracking-tight">
                Snapshot Console v3 — Minimal
              </div>
              <div className="mt-1 text-xs text-slate-400">
                1-click Generate (HTF+LTF) · Download 2 files · Copy macros
              </div>
            </div>

            <div className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
              {htf.fileName && ltf.fileName ? "Ready" : "No files"}
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold">Symbols</div>
            <div className="text-xs text-slate-400">
              Phân tách bằng dấu phẩy hoặc khoảng trắng
            </div>
            <input
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-600"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="Ví dụ: BTCUSDT, ETHUSDT"
              disabled={loading}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400">HTF file</div>
              <div className="mt-1 break-all text-sm">{htf.fileName || "—"}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400">LTF file</div>
              <div className="mt-1 break-all text-sm">{ltf.fileName || "—"}</div>
            </div>
          </div>

          {/* Primary action buttons (KEEP download button) */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={handleGenerateBoth}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate (HTF + LTF)"}
            </Button>

            <Button
              variant="secondary"
              onClick={downloadBoth}
              disabled={!htf.snapshot || !ltf.snapshot}
            >
              Download HTF + LTF
            </Button>

            {/* Copy button with inline status */}
            <CopyBtn
              copyKey="copy_full_macro"
              label="Copy FULL Macro"
              disabled={!macroFULL}
              onClick={() =>
                copyText(macroFULL, "Copied FULL macro", "copy_full_macro")
              }
            />
          </div>

          {/* NEW: Copy Commands panel with explanations */}
          <div className="mt-3 rounded-2xl border border-slate-800 bg-black/20 p-3">
            <div className="text-sm font-semibold">Copy Commands</div>
            <div className="mt-1 text-xs text-slate-400">
              Copy–paste trực tiếp vào ChatGPT. Mỗi nút tạo một “câu lệnh chuẩn”
              cho đúng mode phân tích. Các lệnh có [DASH] sẽ kích hoạt dashboard
              theo SPEC; lệnh “no DASH” chỉ dùng để hỏi riêng setup.
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="flex flex-col gap-1">
                <CopyBtn
                  copyKey="copy_part_iv"
                  label="Copy PHẦN IV"
                  disabled={!macroPartIV}
                  onClick={() =>
                    copyText(macroPartIV, "Copied: PHẦN IV", "copy_part_iv")
                  }
                />
                <div className="text-xs text-slate-400">
                  Chỉ render **PHẦN IV (Trade Zone Terminal)** để xem entry/SL/TP
                  nhanh. Vẫn giữ đúng rule ≥ 3 setup.
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <CopyBtn
                  copyKey="copy_part_iv_setup1"
                  label="Copy PHẦN IV · Setup 1"
                  disabled={!macroPartIVSetup1}
                  onClick={() =>
                    copyText(
                      macroPartIVSetup1,
                      "Copied: PHẦN IV (Setup 1)",
                      "copy_part_iv_setup1"
                    )
                  }
                />
                <div className="text-xs text-slate-400">
                  Chỉ render PHẦN IV và yêu cầu AI **tập trung Setup 1** (setup 2
                  & 3 vẫn xuất tối giản để hợp lệ theo SPEC).
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <CopyBtn
                  copyKey="copy_part_i_ii"
                  label="Copy PHẦN I + II"
                  disabled={!macroPartIandII}
                  onClick={() =>
                    copyText(
                      macroPartIandII,
                      "Copied: PHẦN I+II",
                      "copy_part_i_ii"
                    )
                  }
                />
                <div className="text-xs text-slate-400">
                  Chỉ xem **Market Mode + Trend Radar** (bias & trend) để quyết
                  định ưu tiên Long/Short trước khi vào chi tiết setup.
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <CopyBtn
                  copyKey="copy_setup1_only"
                  label="Copy Setup 1 only (no DASH)"
                  disabled={false}
                  onClick={() =>
                    copyText(
                      macroSetup1Only,
                      "Copied: Setup 1 only",
                      "copy_setup1_only"
                    )
                  }
                />
                <div className="text-xs text-slate-400">
                  Hỏi riêng **Setup 1** mà **không kích hoạt dashboard** (không
                  bị rule ≥ 3 setup). Dùng khi bạn chỉ muốn biết READY/INVALID.
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <CopyBtn
                  copyKey="copy_position_template"
                  label="Copy Position Template"
                  disabled={!macroPositionShort}
                  onClick={() =>
                    copyText(
                      macroPositionShort,
                      "Copied: Position template",
                      "copy_position_template"
                    )
                  }
                />
                <div className="text-xs text-slate-400">
                  Template để bạn điền **ENTRY/SL** khi đang có lệnh. AI sẽ chuyển
                  trọng tâm sang **quản lý vị thế** theo snapshot.
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-3 text-xs text-slate-500">
            FULL macro format:&nbsp;
            <span className="text-slate-300">[DASH] FILE=HTF FILE=LTF</span>
          </div>
        </div>
      </div>
    </div>
  );
}
