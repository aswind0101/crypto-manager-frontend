// crypto-manager-frontend/pages/trade-zones.js
import { useEffect, useMemo, useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:5000"; // chỉnh theo môi trường của bạn

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function TradeZonesPage() {
  const [symbol, setSymbol] = useState("ETHUSDT");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const url = useMemo(() => {
    const s = encodeURIComponent((symbol || "ETHUSDT").trim().toUpperCase());
    return `${BACKEND_URL}/api/trade-zones?symbol=${s}`;
  }, [symbol]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setData(json);
    } catch (e) {
      setData(null);
      setErr(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zones = data?.tradeZones || [];
  const meta = data?.meta || {};

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Trade Zones (Balanced)</h1>
      <div style={{ opacity: 0.8, marginBottom: 18 }}>
        Source: {meta.venue || "—"} | Symbol: {meta.symbol || "—"} | Generated:{" "}
        {meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : "—"}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="ETHUSDT"
          style={{ padding: 10, width: 220 }}
        />
        <button onClick={load} style={{ padding: "10px 14px" }} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        {err ? <span style={{ color: "crimson" }}>{err}</span> : null}
      </div>

      {meta?.regimes ? (
        <div style={{ marginBottom: 18, padding: 12, border: "1px solid #ddd" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Regimes</div>
          <div>H4: {meta.regimes?.H4 || "—"} | M15: {meta.regimes?.M15 || "—"}</div>
        </div>
      ) : null}

      {zones.length === 0 ? (
        <div style={{ padding: 14, border: "1px solid #ddd" }}>
          No trade zones (insufficient data / RR guard / strict filters).
        </div>
      ) : (
        zones.map((z) => (
          <div
            key={z.id}
            style={{
              border: "1px solid #ddd",
              padding: 14,
              marginBottom: 12,
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 700 }}>
                {z.direction.toUpperCase()} — {z.type} — {z.tf}
              </div>
              <div>
                Confidence: <b>{fmt(z.confidence)}</b> | Risk: <b>{z.risk?.tier}</b>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <b>Zone:</b> {fmt(z.zone?.low)} → {fmt(z.zone?.high)}
            </div>

            <div style={{ marginTop: 6 }}>
              <b>Invalidation:</b> {z.invalidation?.type} @ {fmt(z.invalidation?.level)}{" "}
              <span style={{ opacity: 0.8 }}>({z.invalidation?.rule})</span>
            </div>

            <div style={{ marginTop: 6 }}>
              <b>Triggers:</b>
              <ul style={{ marginTop: 6 }}>
                {(z.triggers || []).map((t, i) => (
                  <li key={i}>
                    <code>{t.type}</code> — {t.rule}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginTop: 6 }}>
              <b>Targets:</b>{" "}
              {(z.targets || []).map((t, i) => (
                <span key={i} style={{ marginRight: 10 }}>
                  <b>{t.label}</b>: {fmt(t.level)} <span style={{ opacity: 0.7 }}>({t.basis})</span>
                </span>
              ))}
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Rationale:</b>
              <ul style={{ marginTop: 6 }}>
                {(z.rationale?.bullets || []).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>

            <details style={{ marginTop: 8 }}>
              <summary>Facts</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(z.rationale?.facts || {}, null, 2)}
              </pre>
            </details>
          </div>
        ))
      )}
    </div>
  );
}
