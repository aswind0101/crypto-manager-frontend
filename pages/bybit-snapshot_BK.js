// pages/bybit-snapshot-v3.js
// Next.js pages router – React client page sử dụng buildSnapshotV3
// Output: JSON snapshot version 3 với UI chuyên nghiệp, có copy/download + macro [DASH] FILE=...

import React, { useState, useCallback } from "react";
import { buildSnapshotV3 } from "../lib/snapshot-v3";

function BybitSnapshotV3Page() {
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [fileName, setFileName] = useState("");
  const [dashMacro, setDashMacro] = useState("");
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedMacro, setCopiedMacro] = useState(false);


  const handleGenerate = useCallback(async () => {
    setError("");
    setSnapshot(null);
    setFileName("");
    setDashMacro("");

    const raw = symbolsText || "";
    const symbols = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);

      const result = await buildSnapshotV3(symbols);

      if (!result || typeof result !== "object") {
        throw new Error("Snapshot trả về không hợp lệ.");
      }

      // Snapshot v3: version, generated_at, per_exchange.bybit.symbols
      const ts = result.generated_at || Date.now();
      const firstSymbol =
        result?.per_exchange?.bybit?.symbols?.[0]?.symbol ||
        symbols[0] ||
        "SYMBOL";

      const name = `bybit_snapshot_${ts}_${firstSymbol}.json`;
      const macro = `[DASH] FILE=${name}`;

      setSnapshot(result);
      setFileName(name);
      setDashMacro(macro);
    } catch (e) {
      console.error("buildSnapshotV3 error:", e);
      setError(e?.message || "Có lỗi xảy ra khi tạo snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbolsText]);

  const handleCopyJSON = useCallback(() => {
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);

    const markCopied = () => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(markCopied)
        .catch((err) => {
          console.error("Copy JSON failed:", err);
        });
    } else {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      markCopied();
    }
  }, [snapshot]);

  const handleCopyMacro = useCallback(() => {
    if (!dashMacro) return;

    const markCopied = () => {
      setCopiedMacro(true);
      setTimeout(() => setCopiedMacro(false), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(dashMacro)
        .then(markCopied)
        .catch((err) => {
          console.error("Copy macro failed:", err);
        });
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = dashMacro;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      markCopied();
    }
  }, [dashMacro]);

  const handleDownloadJSON = useCallback(() => {
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "snapshot_v3.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [snapshot, fileName]);

  const versionLabel =
    snapshot && snapshot.version ? `v${snapshot.version}` : "chưa có";

  const generatedAtLabel =
    snapshot && snapshot.generated_at
      ? new Date(snapshot.generated_at).toLocaleString()
      : "";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#050816",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <header
          style={{
            marginBottom: 24,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            Bybit Snapshot v3 – JSON Export
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#9ca3af",
              maxWidth: 640,
            }}
          >
            Tạo snapshot phiên bản 3 (H1–H4–Daily, derivatives Bybit/Binance/OKX)
            để sử dụng cho Price Analyzer v3.0. Bao gồm JSON, macro{" "}
            <code>[DASH] FILE=</code>, copy và download.
          </p>
        </header>

        {/* Input card */}
        <section
          style={{
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(236,72,153,0.08))",
            borderRadius: 12,
            padding: 16,
            border: "1px solid rgba(148,163,184,0.25)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <label
              htmlFor="symbols"
              style={{
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Symbols (phân tách bởi dấu phẩy hoặc khoảng trắng)
            </label>
            <input
              id="symbols"
              type="text"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="Ví dụ: BTCUSDT, ETHUSDT"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #4b5563",
                backgroundColor: "#020617",
                color: "#e5e7eb",
                fontSize: 14,
              }}
            />

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "none",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? "default" : "pointer",
                  background:
                    "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)",
                  color: "#f9fafb",
                  opacity: loading ? 0.6 : 1,
                  boxShadow:
                    "0 8px 20px rgba(59,130,246,0.35), 0 0 0 1px rgba(15,23,42,0.8) inset",
                }}
              >
                {loading ? "Đang tạo snapshot v3..." : "Generate Snapshot v3"}
              </button>

              {snapshot && (
                <span
                  style={{
                    fontSize: 12,
                    color: "#9ca3af",
                  }}
                >
                  Version: <strong>{versionLabel}</strong>
                  {generatedAtLabel && (
                    <>
                      {" "}
                      · Generated at: <strong>{generatedAtLabel}</strong>
                    </>
                  )}
                </span>
              )}
            </div>

            {error && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "#fecaca",
                  backgroundColor: "rgba(127,29,29,0.35)",
                  border: "1px solid rgba(248,113,113,0.5)",
                }}
              >
                {error}
              </div>
            )}
          </div>
        </section>

        {/* Macro + actions */}
        {snapshot && (
          <section
            style={{
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              border: "1px solid rgba(148,163,184,0.4)",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    File name
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#9ca3af",
                      marginTop: 2,
                    }}
                  >
                    {fileName || "(chưa có)"}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleCopyJSON}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #4b5563",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {copiedJson ? "Đã copy" : "Copy JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadJSON}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #4b5563",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Download JSON
                  </button>
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  Macro dùng cho Price Analyzer
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="text"
                    readOnly
                    value={dashMacro}
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #4b5563",
                      backgroundColor: "#020617",
                      color: "#f9fafb",
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCopyMacro}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #4b5563",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {copiedMacro ? "Đã copy" : "Copy macro"}
                  </button>

                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#6b7280",
                    marginTop: 4,
                  }}
                >
                  Dán macro này trực tiếp vào ChatGPT:{" "}
                  <code>[DASH] FILE={fileName || "your_snapshot.json"}</code>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* JSON viewer */}
        {snapshot && (
          <section
            style={{
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              border: "1px solid rgba(31,41,55,0.9)",
              marginBottom: 32,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Snapshot JSON (version 3)
            </div>
            <div
              style={{
                borderRadius: 8,
                backgroundColor: "#020617",
                border: "1px solid #4b5563",
                maxHeight: "480px",
                overflow: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
                fontSize: 12,
                padding: 10,
                lineHeight: 1.5,
              }}
            >
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre",
                }}
              >
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default BybitSnapshotV3Page;
