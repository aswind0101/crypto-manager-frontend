// crypto-manager-frontend/pages/trade-zones-vpn-multitf.js
import { useEffect, useMemo, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const BYBIT_BASE = "https://api.bybit.com";

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function mapBybitKlineRow(r) {
  return { t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) };
}

async function fetchBybitKlines({ symbol, interval, limit }) {
  const url = new URL("/v5/market/kline", BYBIT_BASE);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bybit HTTP ${res.status}: ${text || "request failed"}`);
  }
  const json = await res.json();
  if (json?.retCode !== 0) throw new Error(`Bybit retCode ${json?.retCode}: ${json?.retMsg}`);

  const list = json?.result?.list || [];
  return list.map(mapBybitKlineRow).sort((a, b) => a.t - b.t);
}

export default function TradeZonesVPNMultiTFPage() {
  const [symbol, setSymbol] = useState("ETHUSDT");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const postUrl = useMemo(() => `${BACKEND_URL}/api/trade-zones-client-multitf`, []);

  async function load() {
    setLoading(true);
    setErr("");
    setData(null);

    try {
      const sym = (symbol || "ETHUSDT").trim().toUpperCase();

      // Client (VPN) fetch multi-TF from Bybit
      const [M5, M15, H1, H4, D1] = await Promise.all([
        fetchBybitKlines({ symbol: sym, interval: "5", limit: 520 }),
        fetchBybitKlines({ symbol: sym, interval: "15", limit: 420 }),
        fetchBybitKlines({ symbol: sym, interval: "60", limit: 420 }),
        fetchBybitKlines({ symbol: sym, interval: "240", limit: 320 }),
        fetchBybitKlines({ symbol: sym, interval: "D", limit: 220 }),
      ]);

      // Send to backend for analysis
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: sym,
          receivedAt: Date.now(),
          klinesByTF: { M5, M15, H1, H4, D1 },
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Analyze request failed");
      setData(json);
    } catch (e) {
      setErr(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = data?.meta || {};
  const report = data?.report || null;
  const zones = data?.tradeZones || [];

  return (
    <div style={{ padding: 20, maxWidth: 1150, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Trade Zones (Balanced) — SPEC Multi-TF (Client VPN)</h1>
      <div style={{ opacity: 0.8, marginBottom: 18 }}>
        Backend: {BACKEND_URL} | Symbol: {meta.symbol || "—"} | Generated:{" "}
        {meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : "—"}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} style={{ padding: 10, width: 220 }} />
        <button onClick={load} style={{ padding: "10px 14px" }} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        {err ? <span style={{ color: "crimson" }}>{err}</span> : null}
      </div>

      {meta?.warnings?.length ? (
        <div style={{ marginBottom: 14, padding: 12, border: "1px solid #ddd" }}>
          <b>Warnings:</b> {meta.warnings.join(", ")}
        </div>
      ) : null}

      {report ? (
        <div style={{ marginBottom: 18, padding: 12, border: "1px solid #ddd" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Context</div>
          <div>
            HTF: <b>{report.htf?.tf}</b> regime=<b>{report.htf?.regime}</b> rsi={fmt(report.htf?.rsi)} stack={report.htf?.emaStack}
          </div>
          <div style={{ marginTop: 6 }}>
            Contexts: H1=<b>{report.contexts?.H1}</b>, M15=<b>{report.contexts?.M15}</b>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary>TF states</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(report.tf, null, 2)}</pre>
          </details>
        </div>
      ) : null}

      {zones.length === 0 ? (
        <div style={{ padding: 14, border: "1px solid #ddd" }}>
          No trade zones (RR guard / strict filters / insufficient data).
        </div>
      ) : (
        zones.map((z) => (
          <div key={z.id} style={{ border: "1px solid #ddd", padding: 14, marginBottom: 12, borderRadius: 6 }}>
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
              <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(z.rationale?.facts || {}, null, 2)}</pre>
            </details>
          </div>
        ))
      )}
    </div>
  );
}
