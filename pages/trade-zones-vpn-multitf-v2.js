// crypto-manager-frontend/pages/trade-zones-vpn-multitf-v2.js
import { useMemo, useState } from "react";
import { fetchBybitKlines, fetchMarketContext } from "../lib/bybitBrowserFetch.js";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

function fmt(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function Card({ title, children }) {
    return (
        <div
            style={{
                border: "1px solid #e5e5e5",
                borderRadius: 12,
                padding: 14,
                background: "white",
                color: "#111", // FIX
            }}
        >

            <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
            {children}
        </div>
    );
}

function KV({ k, v }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
            <div style={{ opacity: 0.75 }}>{k}</div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{v}</div>
        </div>
    );
}

function SetupCard({ s, isBest }) {
    const z = s.entry?.zone || {};
    const tp = s.risk?.tp || [];
    return (
        <div
            style={{
                border: isBest ? "2px solid #111" : "1px solid #eee",
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
                background: isBest ? "#fff" : "transparent",
                boxShadow: isBest ? "0 6px 18px rgba(0,0,0,0.08)" : "none",
            }}
        >
            <div
                data-best={isBest ? "1" : "0"}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                    {isBest ? (
                        <span
                            style={{
                                fontSize: 12,
                                fontWeight: 800,
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: "1px solid #111",
                                background: "#111",
                                color: "#fff",
                            }}
                        >
                            BEST
                        </span>
                    ) : null}
                </div>

                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    TF {s.timeframe} | {s.state} | {s.entry_validity}
                </div>
            </div>


            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Card title="Entry">
                    <KV k="Direction" v={s.direction} />
                    <KV k="Zone" v={`${fmt(z.low)} → ${fmt(z.high)}`} />
                    <KV k="Order" v={s.entry?.plan?.order_type || "—"} />
                    <KV k="Suggested" v={fmt(s.entry?.plan?.suggested_entry)} />
                    <div style={{ opacity: 0.8, marginTop: 8 }}>{s.entry?.plan?.note}</div>
                </Card>

                <Card title="Risk">
                    <KV k="SL" v={fmt(s.risk?.sl)} />
                    <KV k="TP1 / TP2 / TP3" v={`${fmt(tp[0])} / ${fmt(tp[1])} / ${fmt(tp[2])}`} />
                    <KV k="RR (vs TP2)" v={fmt(s.risk?.rr)} />
                    <KV k="Confidence" v={s.confidence?.score ?? "—"} />
                </Card>
            </div>

            <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer" }}>Why / Facts</summary>
                <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 6 }}>
                        {(s.why?.bullets || []).map((b, i) => (
                            <div key={i} style={{ opacity: 0.9 }}>- {b}</div>
                        ))}
                    </div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, background: "#fafafa", padding: 10, borderRadius: 8 }}>
                        {JSON.stringify(s.why?.facts || {}, null, 2)}
                    </div>
                    {(s.why?.missing_fields || []).length ? (
                        <div style={{ marginTop: 8, color: "crimson" }}>
                            Missing/Guards: {(s.why.missing_fields || []).join(", ")}
                        </div>
                    ) : null}
                </div>
            </details>
        </div>
    );
}

export default function TradeZonesVpnMultiTFv2() {
    const [symbol, setSymbol] = useState("ETHUSDT");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [resp, setResp] = useState(null);
    const bestId = resp?.actionSummary?.best?.id || null;
    const actionReason = resp?.actionSummary?.reason || null;
    const meta = resp?.meta || {};
    const uiBlocks = resp?.uiBlocks || [];
    const setups = resp?.setups || [];
    const dashboard = resp?.dashboard || {};
    const markdown = resp?.rendered_markdown_vi || "";

    async function load() {
        setLoading(true);
        setErr("");
        try {
            const s = symbol.trim().toUpperCase();

            // Fetch raw klines
            const [m5, m15, h1, h4, d1] = await Promise.all([
                fetchBybitKlines({ symbol: s, interval: "5", limit: 60 }),     // M5: 40–60 bars
                fetchBybitKlines({ symbol: s, interval: "15", limit: 260 }),   // FULL
                fetchBybitKlines({ symbol: s, interval: "60", limit: 260 }),   // FULL
                fetchBybitKlines({ symbol: s, interval: "240", limit: 260 }),  // FULL
                fetchBybitKlines({ symbol: s, interval: "D", limit: 220 }),    // FULL
            ]);


            // Market context (ticker/funding/OI/orderbook...)
            const raw = await fetchMarketContext({ symbol: s });

            const body = {
                symbol: s,
                receivedAt: Date.now(),
                raw,
                klinesByTF: { "5": m5, "15": m15, "60": h1, "240": h4, "D": d1 },
            };

            const res = await fetch(`${BACKEND_URL}/api/trade-zones-client-multitf-v2`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(`Backend HTTP ${res.status}: ${t || "request failed"}`);
            }

            const json = await res.json();
            setResp(json);
            setTimeout(() => {
                const el = document.querySelector('[data-best="1"]');
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 50);
        } catch (e) {
            setErr(e?.message || String(e));
            setResp(null);
        } finally {
            setLoading(false);
        }
    }

    const dq = dashboard?.data_quality || resp?.snapshot?.data_quality;

    return (
        <div
            style={{
                padding: 20,
                maxWidth: 1200,
                margin: "0 auto",
                background: "#f7f7f7",
                minHeight: "100vh",
                color: "#111", // FIX: force text color
            }}
        >

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <h1 style={{ margin: 0 }}>SPEC Pipeline — Multi-TF</h1>
                <div style={{ opacity: 0.8 }}>
                    Backend: {BACKEND_URL} | Generated: {meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : "—"}
                </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, marginBottom: 14 }}>
                <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    style={{
                        padding: 10,
                        width: 220,
                        borderRadius: 10,
                        border: "1px solid #ddd",
                        color: "#111",        // FIX
                        background: "#fff",   // FIX
                    }}
                />

                <button onClick={load} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white" }} disabled={loading}>
                    {loading ? "Loading..." : "Refresh"}
                </button>
                {err ? <span style={{ color: "crimson" }}>{err}</span> : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card title="Data Quality">
                    <KV k="Grade" v={dq?.grade || "—"} />
                    <KV k="Snapshot" v={meta.snapshotVersion || resp?.snapshot?.snapshot_version || "—"} />
                    <KV k="AsOf" v={resp?.snapshot?.asof_ts ? new Date(resp.snapshot.asof_ts).toLocaleString() : "—"} />
                    {(dq?.issues || []).slice(0, 6).map((it, i) => (
                        <div key={i} style={{ marginTop: 6, color: "#7a3" }}>
                            - {it.code} ({it.tf}): {it.details}
                        </div>
                    ))}
                </Card>

                <Card title="Market">
                    <KV k="Last" v={fmt(resp?.snapshot?.market?.price?.last)} />
                    <KV k="Mark" v={fmt(resp?.snapshot?.market?.price?.mark)} />
                    <KV k="Index" v={fmt(resp?.snapshot?.market?.price?.index)} />
                    <KV k="Spread (bps)" v={fmt(resp?.snapshot?.market?.price?.spread_bps)} />
                    <KV k="Funding" v={fmt(resp?.snapshot?.market?.derivatives?.funding?.rate)} />
                    <KV k="OI" v={fmt(resp?.snapshot?.market?.derivatives?.open_interest?.value)} />
                </Card>
            </div>

            <div style={{ marginTop: 14 }}>
                <Card title="Action Summary">
                    {resp?.actionSummary?.best ? (
                        <>
                            <KV k="Best Setup" v={resp.actionSummary.best.name} />
                            <KV k="TF" v={resp.actionSummary.best.timeframe} />
                            <KV k="State" v={resp.actionSummary.best.state} />
                            <KV k="Entry Validity" v={resp.actionSummary.best.entry_validity} />
                            <KV k="Direction" v={resp.actionSummary.best.direction} />
                            <KV k="Confidence" v={resp.actionSummary.best.confidence?.score ?? "—"} />
                            <div style={{ marginTop: 8, opacity: 0.8 }}>
                                Reason: {actionReason || "—"}
                            </div>
                        </>
                    ) : (
                        <div style={{ opacity: 0.8 }}>
                            Không có setup nào actionable. Reason: {actionReason || "—"}
                        </div>
                    )}
                </Card>

                <div style={{ height: 12 }} />

                <Card title="Setups">
                    {setups.length ? (
                        setups.map((s) => (
                            <SetupCard key={s.id} s={s} isBest={bestId === s.id} />
                        ))
                    ) : (
                        <div>Chưa có dữ liệu.</div>
                    )}
                </Card>
            </div>


            <div style={{ marginTop: 14 }}>
                <Card title="Rendered Markdown (optional audit)">
                    <textarea
                        value={markdown}
                        readOnly
                        style={{
                            width: "100%",
                            minHeight: 260,
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            color: "#111",       // FIX
                            background: "#fff",  // FIX
                        }}
                    />

                </Card>
            </div>

            <div style={{ marginTop: 14 }}>
                <Card title="Snapshot (evidence)">
                    <details>
                        <summary style={{ cursor: "pointer" }}>View full snapshot JSON</summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fafafa", padding: 12, borderRadius: 10 }}>
                            {resp?.snapshot ? JSON.stringify(resp.snapshot, null, 2) : "—"}
                        </pre>
                    </details>
                </Card>
            </div>
        </div>
    );
}
