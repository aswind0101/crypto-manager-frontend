import React, { useCallback, useMemo, useState } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";
import Button from "../components/snapshot/Button";
import Toast from "../components/snapshot/Toast";

export default function BybitSnapshotV3New() {
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [htf, setHtf] = useState({ snapshot: null, fileName: "" });
  const [ltf, setLtf] = useState({ snapshot: null, fileName: "" });

  const [toast, setToast] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1200);
  };

  const copyText = async (text, key) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      showToast("Copied");
      setTimeout(() => setCopiedKey(null), 1200);
    } catch (e) {
      console.error(e);
      showToast("Copy failed");
    }
  };

  const normalizeSymbols = (input) =>
    (input || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

  const symbols = useMemo(() => normalizeSymbols(symbolsText), [symbolsText]);
  const primarySymbol = symbols[0] || "SYMBOL";

  const macroFULL =
    htf.fileName && ltf.fileName
      ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`
      : "";

  const macroPartIV =
    htf.fileName && ltf.fileName
      ? `${macroFULL}\nchỉ render PHẦN IV`
      : "";

  const macroPartIVSetup1 =
    htf.fileName && ltf.fileName
      ? `${macroFULL}\nchỉ render PHẦN IV, tập trung Setup 1`
      : "";

  const macroSetup1Only = `Kiểm tra Setup 1 ${primarySymbol} theo snapshot mới (không dùng [DASH])`;

  const macroPosition =
    htf.fileName && ltf.fileName
      ? `Mình đang Short ${primarySymbol} @<ENTRY>, SL <SL>\n${macroFULL}`
      : "";

  const handleGenerateBoth = useCallback(async () => {
    setError("");
    if (!symbols.length) {
      setError("Nhập ít nhất 1 symbol (ví dụ: BTCUSDT)");
      return;
    }

    try {
      setLoading(true);
      const [htfSnap, ltfSnap] = await Promise.all([
        buildSnapshotV3(symbols),
        buildLtfSnapshotV3(symbols),
      ]);

      const htfName = `bybit_snapshot_${htfSnap.generated_at}_${primarySymbol}.json`;
      const ltfName = `bybit_ltf_snapshot_${ltfSnap.generated_at}_${primarySymbol}.json`;

      setHtf({ snapshot: htfSnap, fileName: htfName });
      setLtf({ snapshot: ltfSnap, fileName: ltfName });

      showToast("Snapshots created");
    } catch (e) {
      setError(e.message || "Snapshot error");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

  const CopyButton = ({ label, copied, onClick, disabled }) => (
    <Button variant="secondary" onClick={onClick} disabled={disabled}>
      {copied ? "Copied ✓" : label}
    </Button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Toast message={toast} />

      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="text-lg font-semibold">
            Snapshot Console v3 — Copy Commands Ready
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold">Symbols</div>
            <input
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="BTCUSDT, ETHUSDT"
            />
          </div>

          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={handleGenerateBoth} disabled={loading}>
              {loading ? "Generating..." : "Generate HTF + LTF"}
            </Button>
          </div>

          {/* COPY COMMANDS */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-black/20 p-4">
            <div className="text-sm font-semibold">Copy lệnh phân tích</div>

            <div className="mt-4 space-y-4">
              <div>
                <CopyButton
                  label="Copy FULL Dashboard"
                  copied={copiedKey === "full"}
                  onClick={() => copyText(macroFULL, "full")}
                  disabled={!macroFULL}
                />
                <div className="mt-1 text-xs text-slate-400">
                  Phân tích đầy đủ 6 phần, ≥ 3 setup (chuẩn Price Analyzer).
                </div>
              </div>

              <div>
                <CopyButton
                  label="Copy PHẦN IV (Setup Engine)"
                  copied={copiedKey === "iv"}
                  onClick={() => copyText(macroPartIV, "iv")}
                  disabled={!macroPartIV}
                />
                <div className="mt-1 text-xs text-slate-400">
                  Chỉ xem entry / SL / TP, vẫn giữ đúng rule ≥ 3 setup.
                </div>
              </div>

              <div>
                <CopyButton
                  label="Copy PHẦN IV · Setup 1"
                  copied={copiedKey === "iv1"}
                  onClick={() => copyText(macroPartIVSetup1, "iv1")}
                  disabled={!macroPartIVSetup1}
                />
                <div className="mt-1 text-xs text-slate-400">
                  Tập trung Setup 1, setup khác ở BUILD-UP để tránh nhiễu.
                </div>
              </div>

              <div>
                <CopyButton
                  label="Copy Setup 1 only (no DASH)"
                  copied={copiedKey === "s1"}
                  onClick={() => copyText(macroSetup1Only, "s1")}
                />
                <div className="mt-1 text-xs text-slate-400">
                  Chỉ hỏi trạng thái Setup 1, không bị ràng buộc dashboard.
                </div>
              </div>

              <div>
                <CopyButton
                  label="Copy Position Template"
                  copied={copiedKey === "pos"}
                  onClick={() => copyText(macroPosition, "pos")}
                  disabled={!macroPosition}
                />
                <div className="mt-1 text-xs text-slate-400">
                  Dùng khi đã có lệnh (AI sẽ chuyển sang quản lý vị thế).
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 text-sm text-red-400">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
