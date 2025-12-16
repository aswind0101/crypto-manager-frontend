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

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1400);
  };

  const copyText = async (text, okMsg) => {
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
   * SPEC: FULL dashboard macro
   * MUST be ONE line with 2 files
   */
  const macroFULL = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const handleGenerateHTF = useCallback(async () => {
    setError("");
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);

      const result = await buildSnapshotV3(symbols);
      if (!result || typeof result !== "object") {
        throw new Error("Snapshot HTF trả về không hợp lệ.");
      }

      const ts = result.generated_at || Date.now();
      const firstSymbol =
        result?.per_exchange?.bybit?.symbols?.[0]?.symbol || primarySymbol;

      const name = `bybit_snapshot_${ts}_${firstSymbol}.json`;

      setHtf({
        snapshot: result,
        fileName: name,
        generatedAt: ts,
      });

      showToast("HTF snapshot created.");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Có lỗi khi tạo HTF snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

  const handleGenerateLTF = useCallback(async () => {
    setError("");
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);

      const result = await buildLtfSnapshotV3(symbols);
      if (!result || typeof result !== "object") {
        throw new Error("Snapshot LTF trả về không hợp lệ.");
      }

      const ts = result.generated_at || Date.now();
      const name = `bybit_ltf_snapshot_${ts}_${primarySymbol}.json`;

      setLtf({
        snapshot: result,
        fileName: name,
        generatedAt: ts,
      });

      showToast("LTF snapshot created.");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Có lỗi khi tạo LTF snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

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

    // Browser sẽ tải 2 file liên tiếp (1 click)
    downloadJson(htf.snapshot, htf.fileName);
    setTimeout(() => {
      downloadJson(ltf.snapshot, ltf.fileName);
    }, 150);
  };

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
                Generate HTF / LTF · Download 2 files · Copy FULL macro
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

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={handleGenerateHTF}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate HTF"}
            </Button>

            <Button
              variant="gold"
              onClick={handleGenerateLTF}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate LTF"}
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
              onClick={() =>
                copyText(macroFULL, "Copied FULL macro")
              }
              disabled={!macroFULL}
            >
              Copy FULL Macro
            </Button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-3 text-xs text-slate-500">
            FULL macro format:&nbsp;
            <span className="text-slate-300">
              [DASH] FILE=HTF FILE=LTF
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
