import React, { useMemo, useState } from "react";
import { buildMarketSnapshotV4 } from "../lib/snapshot/market-snapshot-v4";

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MarketSnapshotV4Page() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastMeta, setLastMeta] = useState(null);

  const safeSymbol = useMemo(() => String(symbol || "").toUpperCase().trim(), [symbol]);

  const onGenerate = async () => {
    setErr("");
    setLoading(true);
    try {
      const snap = await buildMarketSnapshotV4(safeSymbol, { tz: "America/Los_Angeles" });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `market-snapshot-v4_${safeSymbol}_${ts}.json`;
      downloadJson(snap, name);

      setLastMeta({
        symbol: safeSymbol,
        generated_at: snap.generated_at,
        quality: snap?.unified?.data_quality,
        errors: snap?.diagnostics?.errors?.length || 0,
      });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Market Snapshot v4 (Bybit + Binance + OKX)</h1>
      <p style={{ color: "#666" }}>
        Client-only. Generate 1 symbol / 1 JSON file. Timeframes: 5m, 15m, 1h, 4h, 1D.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="BTCUSDT"
          style={{ padding: 10, width: 240, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <button
          onClick={onGenerate}
          disabled={loading || !safeSymbol}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #111",
            background: loading ? "#eee" : "#111",
            color: loading ? "#333" : "#fff",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Generating..." : "Generate JSON"}
        </button>
      </div>

      {err ? (
        <div style={{ marginTop: 14, color: "#b00020", whiteSpace: "pre-wrap" }}>{err}</div>
      ) : null}

      {lastMeta ? (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
          <div><b>Last</b>: {lastMeta.symbol}</div>
          <div><b>Quality</b>: {lastMeta.quality}</div>
          <div><b>Errors</b>: {lastMeta.errors}</div>
          <div style={{ color: "#666" }}><b>Generated</b>: {new Date(lastMeta.generated_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 18, color: "#666" }}>
        Lưu ý: Nếu Binance bị chặn do CORS/geo, JSON vẫn tạo được nhưng sẽ có <code>data_quality: partial</code> và diagnostics.errors.
      </div>
    </div>
  );
}
