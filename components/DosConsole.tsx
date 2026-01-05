import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";

type AnyObj = any;

const mono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

function fmt(n: any, dp = 2) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toFixed(dp);
}
function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}
function bar(pct01: number, width = 10) {
    const filled = clamp(Math.round(pct01 * width), 0, width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}
function typeShort(t: string) {
    if (t === "LIQUIDITY_SWEEP_REVERSAL") return "LSR";
    if (t === "RANGE_MEAN_REVERT") return "RMR";
    if (t === "TREND_PULLBACK") return "TPB";
    if (t === "BREAKOUT") return "BRK";
    if (t === "FAILED_SWEEP_CONTINUATION") return "FSC";
    return (t || "—").slice(0, 6).toUpperCase();
}
function triggerProgress(s: AnyObj) {
    const checklist = Array.isArray(s?.entry?.trigger?.checklist) ? s.entry.trigger.checklist : [];
    const total = checklist.length || 0;
    const ok = checklist.filter((x: AnyObj) => x?.ok === true).length;
    return { ok, total, pct: total ? ok / total : 0, checklist };
}
function actionLabel(s: AnyObj) {
    const status = String(s?.status ?? "");
    const mode = String(s?.entry?.mode ?? "");
    const checklist = Array.isArray(s?.entry?.trigger?.checklist) ? s.entry.trigger.checklist : [];
    const hasClose = checklist.some((x: AnyObj) => String(x?.key ?? "") === "close_confirm");
    const closeOk = checklist.find((x: AnyObj) => String(x?.key ?? "") === "close_confirm")?.ok === true;

    if (status === "INVALIDATED") return "INVALID";
    if (status === "EXPIRED") return "EXPIRED";
    if (status === "TRIGGERED") return mode === "MARKET" ? "ENTER NOW" : "CONFIRMED";
    if (status === "READY") {
        if (hasClose && !closeOk) return "WAIT CLOSE";
        return mode === "LIMIT" ? "PLACE LIMIT" : "ARMED";
    }
    const next = checklist.find((x: AnyObj) => x && x.ok === false);
    if (next?.key) {
        const k = String(next.key);
        if (k === "retest") return "WAIT RETEST";
        if (k === "close_confirm") return "WAIT CLOSE";
        return `WAIT ${k.toUpperCase()}`;
    }
    return "WATCH";
}
function distanceBps(px: number, z: AnyObj) {
    if (!Number.isFinite(px) || !z) return NaN;
    const lo = Number(z.lo);
    const hi = Number(z.hi);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return NaN;
    if (px >= lo && px <= hi) return 0;
    const dist = px > hi ? px - hi : lo - px;
    const ref = px || hi || lo;
    return (dist / ref) * 10000;
}
function marketScan(features: AnyObj, tf: string) {
    const ms = features?.market_structure?.[tf];
    const trend = String(ms?.trend ?? "—");
    const sH = ms?.lastSwingHigh?.price ?? ms?.lastSwingHigh;
    const sL = ms?.lastSwingLow?.price ?? ms?.lastSwingLow;
    const bos = ms?.lastBOS ? `${ms.lastBOS.dir} @ ${fmt(ms.lastBOS.price ?? ms.lastBOS.level, 2)}` : "—";
    const choch = ms?.lastCHOCH ? `${ms.lastCHOCH.dir} @ ${fmt(ms.lastCHOCH.price ?? ms.lastCHOCH.level, 2)}` : "—";
    const sweep = ms?.lastSweep ? `${ms.lastSweep.dir} @ ${fmt(ms.lastSweep.price ?? ms.lastSweep.level, 2)}` : "—";
    const flags = ms?.flags ?? {};
    const fl: string[] = [];
    if (flags.bosUp) fl.push("BOS↑");
    if (flags.bosDown) fl.push("BOS↓");
    if (flags.sweepUp) fl.push("SWP↑");
    if (flags.sweepDown) fl.push("SWP↓");
    return { trend, sH, sL, bos, choch, sweep, fl: fl.length ? fl.join(" ") : "—" };
}

async function copyText(text: string) {
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { }
    // Fallback
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

function buildTicketText(s: AnyObj) {
    const side = String(s?.side ?? "—");
    const type = String(s?.type ?? "—");
    const status = String(s?.status ?? "—");
    const tf = `${String(s?.bias_tf ?? "—")}→${String(s?.entry_tf ?? "—")}→${String(s?.trigger_tf ?? "—")}`;
    const mode = String(s?.entry?.mode ?? "—");
    const z = s?.entry?.zone;
    const entry =
        mode === "LIMIT" && z ? `[${fmt(z.lo, 2)}–${fmt(z.hi, 2)}]` : mode === "MARKET" ? "MARKET" : "—";
    const sl = `${fmt(s?.stop?.price, 2)} (${String(s?.stop?.basis ?? "—")})`;
    const tps = Array.isArray(s?.tp) && s.tp.length ? s.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ") : "—";
    const rr = `RRmin ${fmt(s?.rr_min, 2)}  RRest ${fmt(s?.rr_est, 2)}`;
    const act = actionLabel(s);

    return [
        `SYMBOL: ${String(s?.canon ?? "")}`,
        `SIDE: ${side}  TYPE: ${type}  STATUS: ${status}`,
        `TF: ${tf}`,
        `ENTRY (${mode}): ${entry}`,
        `SL: ${sl}`,
        `TP: ${tps}`,
        rr,
        `ACTION: ${act}`,
        `ID: ${String(s?.id ?? "")}`,
    ].join("\n");
}

function Pipeline({ stage }: { stage: number }) {
    const steps = [
        { name: "FETCH", idx: 1 },
        { name: "NORMALIZE", idx: 2 },
        { name: "FEATURES", idx: 3 },
        { name: "SETUPS", idx: 4 },
        { name: "DONE", idx: 5 },
    ];
    return (
        <div className="dos-chip dos-dim">
            <span>PIPELINE</span>
            <span className="dos-mono">
                {steps
                    .map((s) => {
                        const pct = stage >= s.idx ? 1 : stage === s.idx - 1 ? 0.55 : 0.1;
                        return `${s.name}[${bar(pct, 6)}]`;
                    })
                    .join(" ")}
            </span>
        </div>
    );
}
function SystemStatusBar({
    paused,
    stage,
    dq,
    dqOk,
    bybitOk,
    binanceOk,
    mid,
    dev,
    lastTs,
    setupsCount,
    preferredId,
}: {
    paused: boolean;
    stage: number;
    dq: string;
    dqOk: boolean;
    bybitOk: boolean;
    binanceOk: boolean;
    mid: number;
    dev: any;
    lastTs?: number;
    setupsCount: number;
    preferredId?: string;
}) {
    const now = Date.now();
    const staleMs = lastTs ? Math.max(0, now - lastTs) : NaN;

    const stageName =
        stage <= 1 ? "FETCH" : stage === 2 ? "NORMALIZE" : stage === 3 ? "FEATURES" : stage === 4 ? "SETUPS" : "DONE";

    const warm = !Number.isFinite(mid);

    const health =
        !bybitOk ? "BYBIT DOWN" : !binanceOk ? "BINANCE DEGRADED" : !dqOk ? "DQ GATED" : warm ? "WARMING UP" : "OK";

    const healthCls =
        health === "OK" ? "dos-ok" : health === "WARMING UP" || health.includes("DEGRADED") ? "dos-warn" : "dos-bad";
    const pipeStr =
        stage <= 1
            ? `FETCH[${bar(0.7, 6)}] NORMALIZE[${bar(0.1, 6)}] FEATURES[${bar(0.1, 6)}] SETUPS[${bar(0.1, 6)}] DONE[${bar(0.1, 6)}]`
            : stage === 2
                ? `FETCH[${bar(1, 6)}] NORMALIZE[${bar(0.7, 6)}] FEATURES[${bar(0.1, 6)}] SETUPS[${bar(0.1, 6)}] DONE[${bar(0.1, 6)}]`
                : stage === 3
                    ? `FETCH[${bar(1, 6)}] NORMALIZE[${bar(1, 6)}] FEATURES[${bar(0.7, 6)}] SETUPS[${bar(0.1, 6)}] DONE[${bar(0.1, 6)}]`
                    : stage === 4
                        ? `FETCH[${bar(1, 6)}] NORMALIZE[${bar(1, 6)}] FEATURES[${bar(1, 6)}] SETUPS[${bar(0.7, 6)}] DONE[${bar(0.1, 6)}]`
                        : `FETCH[${bar(1, 6)}] NORMALIZE[${bar(1, 6)}] FEATURES[${bar(1, 6)}] SETUPS[${bar(1, 6)}] DONE[${bar(1, 6)}]`;

    return (
        <div className="dos-sysbar">
            <div className="dos-sys-left">
                <span className={`dos-pill ${paused ? "dos-pill-warn" : "dos-pill-ok"}`}>
                    {paused ? "FROZEN" : "LIVE"}
                </span>

                <span className={`dos-pill ${healthCls}`}>HEALTH: {health}</span>

                <span className="dos-pill dos-dim">
                    STAGE: <span className="dos-strong">{stageName}</span>
                </span>

                <span className="dos-pill dos-dim">
                    PIPE: <span className="dos-mono">{pipeStr}</span>
                </span>

                <span className="dos-pill dos-dim">
                    DQ: <span className="dos-strong">{dq}</span> {dqOk ? "" : "(GATED)"}
                </span>

                <span className="dos-pill dos-dim">
                    MID: <span className="dos-strong">{Number.isFinite(mid) ? fmt(mid, 2) : "—"}</span>
                    {warm ? <span className="dos-warn"> (warm)</span> : null}
                </span>

                <span className="dos-pill dos-dim">
                    DEV: <span className="dos-strong">{Number.isFinite(Number(dev)) ? `${Number(dev).toFixed(1)}bps` : "—"}</span>
                </span>
            </div>

            <div className="dos-sys-right">
                <span className="dos-pill dos-dim">
                    FEEDS:{" "}
                    <span className={bybitOk ? "dos-ok" : "dos-bad"}>BYBIT</span>{" "}
                    <span className={binanceOk ? "dos-ok" : "dos-warn"}>BINANCE</span>
                </span>

                <span className="dos-pill dos-dim">
                    SETUPS: <span className="dos-strong">{setupsCount}</span>
                    {preferredId ? <span className="dos-dim"> pref={preferredId}</span> : null}
                </span>

                <span className="dos-pill dos-dim">
                    STALE:{" "}
                    <span className={Number.isFinite(staleMs) && staleMs < 1500 ? "dos-ok" : "dos-warn"}>
                        {Number.isFinite(staleMs) ? `${(staleMs / 1000).toFixed(1)}s` : "—"}
                    </span>
                </span>
            </div>
        </div>
    );
}

function AnalysisSession({
    symbol,
    paused,
}: {
    symbol: string;
    paused: boolean;
}) {
    const { snap, features, setups } = useSetupsSnapshot(symbol);

    // Freeze view when paused
    const [frozen, setFrozen] = useState<{ snap: AnyObj | null; features: AnyObj | null; setups: AnyObj | null }>({
        snap: null,
        features: null,
        setups: null,
    });

    useEffect(() => {
        if (paused) return;
        setFrozen({ snap: snap ?? null, features: features ?? null, setups: setups ?? null });
    }, [paused, snap, features, setups]);

    const vSnap = paused ? frozen.snap : snap;
    const vFeat = paused ? frozen.features : features;
    const vSet = paused ? frozen.setups : setups;

    const dq = String(vFeat?.quality?.dq_grade ?? "—");
    const dqOk = Boolean(vSet?.dq_ok ?? vFeat?.quality?.dq_ok);
    const bybitOk = Boolean(vFeat?.quality?.bybit_ok);
    const binanceOk = Boolean(vFeat?.quality?.binance_ok);

    const mid = Number(vSnap?.price?.mid ?? vSnap?.price?.last);
    const dev = vFeat?.cross?.deviation_bps ?? vFeat?.cross?.dev_bps;

    // Pipeline stage heuristic
    const stage = !vSnap ? 1 : !vFeat ? 2 : !vSet ? 3 : Array.isArray(vSet?.setups) ? 5 : 4;

    const rows: AnyObj[] = useMemo(() => {
        const arr = (vSet?.setups ?? []) as AnyObj[];
        return [...arr].sort((a, b) => {
            const pa = Number(a?.priority_score ?? -1);
            const pb = Number(b?.priority_score ?? -1);
            if (pb !== pa) return pb - pa;
            const ca = Number(a?.confidence?.score ?? -1);
            const cb = Number(b?.confidence?.score ?? -1);
            return cb - ca;
        });
    }, [vSet]);

    const preferredId = vSet?.preferred_id;

    // Selection + expand (touch-friendly)
    const [idx, setIdx] = useState(0);
    const [expanded, setExpanded] = useState(true);
    const selected = rows[idx] ?? null;

    useEffect(() => {
        setIdx((cur) => clamp(cur, 0, Math.max(0, rows.length - 1)));
    }, [rows.length]);

    // Keyboard navigation (works with iPad keyboard; harmless on touch)
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const ae = document.activeElement as HTMLElement | null;
            if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((x) => clamp(x + 1, 0, Math.max(0, rows.length - 1)));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((x) => clamp(x - 1, 0, Math.max(0, rows.length - 1)));
            } else if (e.key === "Enter") {
                e.preventDefault();
                setExpanded((x) => !x);
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [rows.length]);

    const scan15 = marketScan(vFeat, "15m");
    const scan1h = marketScan(vFeat, "1h");
    const scan4h = marketScan(vFeat, "4h");
    const scan1d = marketScan(vFeat, "1d");

    const touchPrev = () => setIdx((x) => clamp(x - 1, 0, Math.max(0, rows.length - 1)));
    const touchNext = () => setIdx((x) => clamp(x + 1, 0, Math.max(0, rows.length - 1)));
    const touchExpand = () => setExpanded((x) => !x);
    const touchCopy = async () => {
        if (!selected) return;
        await copyText(buildTicketText(selected));
    };

    return (
        <>
            <div className="dos-row dos-gap">
                <SystemStatusBar
                    paused={paused}
                    stage={stage}
                    dq={dq}
                    dqOk={dqOk}
                    bybitOk={bybitOk}
                    binanceOk={binanceOk}
                    mid={mid}
                    dev={dev}
                    lastTs={vSnap?.ts ?? vSnap?.generatedTs ?? vSnap?.generated_at ?? null}
                    setupsCount={rows.length}
                    preferredId={preferredId}
                />
            </div>

            <div className="dos-grid">
                {/* LEFT: outlook */}
                <div className="dos-panel">
                    <div className="dos-panel-head">MARKET OUTLOOK (SCAN)</div>
                    <div className="dos-panel-body">
                        <div className="dos-small">
                            <div className="dos-line">
                                <span className="dos-k">15m</span>
                                <span className="dos-v">{scan15.trend} | H {fmt(scan15.sH, 2)} L {fmt(scan15.sL, 2)}</span>
                            </div>
                            <div className="dos-line">
                                <span className="dos-k">1h</span>
                                <span className="dos-v">{scan1h.trend} | {scan1h.fl}</span>
                            </div>
                            <div className="dos-line">
                                <span className="dos-k">4h</span>
                                <span className="dos-v">{scan4h.trend} | {scan4h.fl}</span>
                            </div>
                            <div className="dos-line">
                                <span className="dos-k">1d</span>
                                <span className="dos-v">{scan1d.trend} | {scan1d.fl}</span>
                            </div>
                        </div>

                        <div className="dos-hr" />

                        <div className="dos-small">
                            <div className="dos-strong" style={{ marginBottom: 6 }}>Key Signals</div>
                            <pre className="dos-pre">{`15m BOS:   ${scan15.bos}
15m CHOCH: ${scan15.choch}
15m SWEEP: ${scan15.sweep}

1h  BOS:   ${scan1h.bos}
1h  CHOCH: ${scan1h.choch}
1h  SWEEP: ${scan1h.sweep}`}</pre>
                        </div>
                    </div>
                </div>

                {/* RIGHT: feed + details */}
                <div className="dos-right">
                    <div className="dos-list">
                        <div className="dos-list-head">
                            <div className="dos-strong">SETUP FEED (SORT=P)</div>
                            <div className="dos-touchbar">
                                <button className="dos-btn" onClick={touchPrev} disabled={!rows.length} aria-label="Previous setup">
                                    Prev
                                </button>
                                <button className="dos-btn" onClick={touchNext} disabled={!rows.length} aria-label="Next setup">
                                    Next
                                </button>
                                <button className="dos-btn" onClick={touchExpand} disabled={!rows.length} aria-label="Expand details">
                                    {expanded ? "Collapse" : "Expand"}
                                </button>
                                <button className="dos-btn" onClick={touchCopy} disabled={!selected} aria-label="Copy ticket">
                                    Copy Ticket
                                </button>
                            </div>
                        </div>

                        {rows.length === 0 ? (
                            <div className="dos-pad">
                                {dqOk ? (
                                    <div className="dos-pad">
                                        <div className="dos-strong">NO SETUPS (valid)</div>
                                        <div className="dos-dim" style={{ marginTop: 6 }}>
                                            Filters blocked candidates due to RR / structure / retest requirements, or insufficient context.
                                        </div>

                                        <div className="dos-hr" />

                                        <pre className="dos-pre">{`Context snapshot:
15m: ${scan15.trend}   H ${fmt(scan15.sH, 2)}   L ${fmt(scan15.sL, 2)}
1h : ${scan1h.trend}   flags: ${scan1h.fl}
DQ : ${dq} ${dqOk ? "" : "(GATED)"}
MID: ${Number.isFinite(mid) ? fmt(mid, 2) : "— (warming)"}
DEV: ${Number.isFinite(Number(dev)) ? `${Number(dev).toFixed(1)}bps` : "—"}

Wait for:
• A fresh SWEEP at range edges, or
• BOS/CHOCH confirmation on close, or
• Retest into an entry zone with RR >= threshold`}</pre>
                                    </div>

                                ) : (
                                    <>DQ GATED. Fix feeds/liveness before trusting setups.</>
                                )}
                            </div>
                        ) : (
                            rows.map((s, i) => {
                                const id = String(s?.id ?? "");
                                const isPreferred = preferredId && id === preferredId;
                                const isSelected = i === idx;
                                const dead = s?.status === "INVALIDATED" || s?.status === "EXPIRED";

                                const p = Number(s?.priority_score ?? 0);
                                const c = Number(s?.confidence?.score ?? 0);
                                const g = String(s?.confidence?.grade ?? "—");
                                const { ok, total } = triggerProgress(s);

                                const z = s?.entry?.zone;
                                const dist = Number.isFinite(mid) ? distanceBps(mid, z) : NaN;
                                const distLabel = !Number.isFinite(dist) ? "—" : dist === 0 ? "IN" : `${dist.toFixed(0)}bps`;

                                const tf = `${String(s?.bias_tf ?? "—")}→${String(s?.entry_tf ?? "—")}→${String(s?.trigger_tf ?? "—")}`;
                                const act = actionLabel(s);

                                return (
                                    <div
                                        key={id || i}
                                        className={[
                                            "dos-rowitem",
                                            isPreferred ? "dos-preferred" : "",
                                            isSelected ? "dos-selected" : "",
                                            dead ? "dos-dimrow" : "",
                                        ].join(" ")}
                                        onClick={() => setIdx(i)}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div className="dos-marker">{isPreferred ? ">" : " "}</div>
                                        <div className="dos-mono">
                                            {String(i + 1).padStart(2, " ")}{" "}
                                            <span className={s?.side === "LONG" ? "dos-ok" : "dos-bad"}>
                                                {String(s?.side ?? "").padEnd(5, " ")}
                                            </span>{" "}
                                            <span className="dos-strong">{typeShort(String(s?.type ?? ""))}</span>{" "}
                                            <span className="dos-reverse">{String(s?.status ?? "").padEnd(9, " ")}</span>{" "}
                                            P{String(Math.round(p)).padStart(2, "0")}{" "}
                                            C{String(Math.round(c)).padStart(2, "0")}({g}){" "}
                                            T{ok}/{total}{" "}
                                            {tf}{" "}
                                            Δ{distLabel}{" "}
                                            RR{fmt(s?.rr_min, 2)}{" "}
                                            <span className="dos-strong">{act}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <div className="dos-panel dos-mt">
                        <div className="dos-panel-head">SELECTED SETUP DETAILS</div>
                        <div className="dos-panel-body">
                            {!selected ? (
                                <div className="dos-dim">No setup selected.</div>
                            ) : (
                                <>
                                    <div className="dos-small">
                                        <div className="dos-line">
                                            <span className="dos-k">ID</span>
                                            <span className="dos-v">{String(selected.id ?? "—")}</span>
                                        </div>
                                        <div className="dos-line">
                                            <span className="dos-k">TYPE</span>
                                            <span className="dos-v">{String(selected.type ?? "—")}</span>
                                        </div>
                                        <div className="dos-line">
                                            <span className="dos-k">TF</span>
                                            <span className="dos-v">
                                                {String(selected.bias_tf ?? "—")}→{String(selected.entry_tf ?? "—")}→{String(selected.trigger_tf ?? "—")}
                                            </span>
                                        </div>
                                        <div className="dos-line">
                                            <span className="dos-k">STATUS</span>
                                            <span className="dos-v">
                                                {String(selected.status ?? "—")}{" "}
                                                CONFIRMED:{" "}
                                                <span className={selected?.entry?.trigger?.confirmed ? "dos-ok" : "dos-warn"}>
                                                    {selected?.entry?.trigger?.confirmed ? "YES" : "NO"}
                                                </span>{" "}
                                                ACTION: <span className="dos-strong">{actionLabel(selected)}</span>
                                            </span>
                                        </div>
                                    </div>

                                    <div className="dos-hr" />

                                    <div className="dos-small">
                                        <div className="dos-strong" style={{ marginBottom: 6 }}>EXECUTION TICKET</div>
                                        <pre className="dos-pre">{`ENTRY (${String(selected?.entry?.mode ?? "—")}): ${selected?.entry?.mode === "LIMIT" && selected?.entry?.zone
                                            ? `[${fmt(selected.entry.zone.lo, 2)}–${fmt(selected.entry.zone.hi, 2)}]`
                                            : selected?.entry?.mode === "MARKET"
                                                ? "MARKET"
                                                : "—"
                                            }
SL: ${fmt(selected?.stop?.price, 2)} (${String(selected?.stop?.basis ?? "—")})
TP: ${(Array.isArray(selected?.tp) && selected.tp.length)
                                                ? selected.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ")
                                                : "—"}
RR(min): ${fmt(selected?.rr_min, 2)}   RR(est): ${fmt(selected?.rr_est, 2)}
PRIORITY: ${Number(selected?.priority_score ?? 0).toFixed(0)}   CONF: ${Number(selected?.confidence?.score ?? 0).toFixed(0)} (${String(selected?.confidence?.grade ?? "—")})`}</pre>
                                    </div>

                                    <div className="dos-hr" />

                                    <div className="dos-small">
                                        <div className="dos-strong" style={{ marginBottom: 6 }}>
                                            TRIGGER CHECKLIST {expanded ? "(expanded)" : "(collapsed)"}
                                        </div>
                                        {expanded ? (
                                            <div className="dos-stack">
                                                {triggerProgress(selected).checklist.length ? (
                                                    triggerProgress(selected).checklist.map((it: AnyObj, i: number) => (
                                                        <div key={String(it?.key ?? i)} className="dos-itemline">
                                                            <span className={it?.ok ? "dos-ok" : "dos-warn"}>
                                                                [{it?.ok ? "OK" : "WAIT"}]
                                                            </span>
                                                            <span className="dos-key">{String(it?.key ?? "")}</span>
                                                            <span className="dos-note">{String(it?.note ?? "")}</span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="dos-dim">No checklist.</div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="dos-dim">Tap Expand to view checklist + confluence.</div>
                                        )}
                                    </div>

                                    {expanded ? (
                                        <>
                                            <div className="dos-hr" />
                                            <div className="dos-small">
                                                <div className="dos-strong" style={{ marginBottom: 6 }}>WHY (CONFLUENCE)</div>
                                                {(selected?.confidence?.reasons ?? []).length ? (
                                                    <pre className="dos-pre">
                                                        {(selected.confidence.reasons as AnyObj[]).slice(0, 12).map((r: AnyObj) => `• ${String(r)}`).join("\n")}
                                                    </pre>
                                                ) : (
                                                    <div className="dos-dim">No reasons provided.</div>
                                                )}
                                            </div>
                                        </>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export function DosConsole() {
    // draft vs committed: only Analyze commits
    const [draftSymbol, setDraftSymbol] = useState("BTCUSDT");
    const [symbol, setSymbol] = useState("BTCUSDT");

    // remount to simulate fresh load (reset pipeline)
    const [sessionKey, setSessionKey] = useState(1);

    // freeze view
    const [paused, setPaused] = useState(false);

    const inputRef = useRef<HTMLInputElement | null>(null);

    const commitAnalyze = () => {
        const clean = String(draftSymbol ?? "").trim().toUpperCase();
        if (!clean) return;
        setPaused(false);
        setSymbol(clean);
        setDraftSymbol(clean);
        setSessionKey((k) => k + 1);
    };

    const stopToggle = () => setPaused((p) => !p);

    const resetAll = () => {
        setPaused(false);
        setDraftSymbol("BTCUSDT");
        setSymbol("BTCUSDT");
        setSessionKey((k) => k + 1);
        inputRef.current?.focus();
    };

    // Global controls hotkeys (iPad keyboard / desktop)
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const ae = document.activeElement as HTMLElement | null;
            const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");

            if (!typing && (e.key === "a" || e.key === "A")) {
                e.preventDefault();
                commitAnalyze();
            }
            if (!typing && (e.key === "s" || e.key === "S")) {
                e.preventDefault();
                stopToggle();
            }
            if (!typing && (e.key === "r" || e.key === "R")) {
                e.preventDefault();
                resetAll();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [draftSymbol]);

    return (
        <div className="dos-screen">
            <style>{`
        .dos-screen{
          background:#050505; color:#cfe9cf; font-family:${mono};
          min-height:100dvh;
          padding: calc(env(safe-area-inset-top) + 12px) calc(env(safe-area-inset-right) + 12px) calc(env(safe-area-inset-bottom) + 12px) calc(env(safe-area-inset-left) + 12px);
        }
        .dos-frame{
          border:1px solid #1f3b1f; border-radius:12px; overflow:hidden;
          box-shadow: 0 0 0 1px #0a140a inset;
          background:#050705;
        }
        .dos-header{
          position: sticky; top: 0; z-index: 5;
          padding:10px 12px; border-bottom:1px solid #1f3b1f; background:#070a07;
          display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;
        }
        .dos-title{ font-weight:900; letter-spacing:0.6px; }
        .dos-left,.dos-right{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .dos-input{
          width:150px; padding:10px 10px; border-radius:10px;
          border:1px solid #2a532a; background:#020302; color:#cfe9cf; outline:none;
          font-family:${mono}; font-size:16px; /* iOS zoom prevention */
        }
        .dos-btn{
          min-height:44px; padding:10px 12px; border-radius:10px;
          border:1px solid #2a532a; background:#081008; color:#cfe9cf; cursor:pointer;
          font-family:${mono}; font-weight:900;
        }
        .dos-btn:disabled{ opacity:0.5; cursor:not-allowed; }
        .dos-btn-danger{ border-color:#6b2b2b; background:#140808; }
        .dos-btn-active{ background:#0c1b0c; box-shadow:0 0 0 1px #2a532a inset; }
        .dos-chip{
          padding:4px 10px; border:1px solid #2a532a; border-radius:999px;
          background:#020302; font-size:12px; display:inline-flex; gap:8px; align-items:center; white-space:nowrap;
          min-height:30px;
        }
        .dos-mono{ font-family:${mono}; }
        .dos-strong{ font-weight:900; }
        .dos-dim{ opacity:0.8; }
        .dos-ok{ color:#86efac; }
        .dos-warn{ color:#fde68a; }
        .dos-bad{ color:#fca5a5; }
        .dos-row{ display:flex; flex-wrap:wrap; align-items:center; }
        .dos-gap{ gap:10px; }
        .dos-grid{
          display:grid; gap:10px; padding:12px;
          grid-template-columns: 420px 1fr;
          align-items:start;
        }
        .dos-panel{ border:1px solid #1f3b1f; border-radius:12px; overflow:hidden; background:#050705; }
        .dos-panel-head{ padding:9px 10px; border-bottom:1px solid #1f3b1f; background:#070a07; font-weight:900; }
        .dos-panel-body{ padding:10px; }
        .dos-hr{ border-top:1px dashed #1f3b1f; margin:10px 0; }
        .dos-small{ font-size:12px; opacity:0.95; }
        .dos-line{ display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        .dos-k{ opacity:0.85; }
        .dos-v{ font-weight:900; }
        .dos-pre{ margin:0; white-space:pre-wrap; word-break:break-word; font-family:${mono}; font-size:12px; line-height:1.45; }
        .dos-list{ border:1px solid #1f3b1f; border-radius:12px; overflow:hidden; background:#040604; }
        .dos-list-head{
          padding:9px 10px; border-bottom:1px solid #1f3b1f; background:#070a07;
          display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
        }
        .dos-touchbar{ display:flex; gap:8px; flex-wrap:wrap; }
        .dos-pad{ padding:12px; opacity:0.9; }
        .dos-rowitem{
          padding:12px 10px; border-bottom:1px solid #0d170d;
          display:grid; grid-template-columns: 24px 1fr; gap:8px; align-items:baseline;
          cursor:pointer;
        }
          .dos-sysbar{
  border:1px solid #1f3b1f;
  border-radius:12px;
  padding:10px;
  background:#050705;
  display:flex;
  justify-content:space-between;
  gap:10px;
  flex-wrap:wrap;
}
.dos-sys-left, .dos-sys-right{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  align-items:center;
}
.dos-pill{
  border:1px solid #2a532a;
  background:#020302;
  border-radius:999px;
  padding:6px 10px;
  font-size:12px;
  display:inline-flex;
  gap:6px;
  align-items:center;
  min-height:32px;
  white-space:nowrap;
}
.dos-pill-ok{ border-color:#2a532a; }
.dos-pill-warn{ border-color:#7a6a2a; }

        .dos-rowitem:last-child{ border-bottom:none; }
        .dos-marker{ font-weight:900; }
        .dos-selected{ background:#0b170b; }
        .dos-preferred{ background:#102010; }
        .dos-dimrow{ opacity:0.6; }
        .dos-reverse{ background:#cfe9cf; color:#061006; padding:0 6px; border-radius:6px; font-weight:900; }
        .dos-right{ min-width:0; }
        .dos-mt{ margin-top:10px; }
        .dos-stack{ display:grid; gap:6px; }
        .dos-itemline{ display:flex; gap:10px; flex-wrap:wrap; }
        .dos-key{ min-width:120px; }
        .dos-note{ opacity:0.9; }
        @media (max-width: 980px){
          .dos-grid{ grid-template-columns: 1fr; }
        }
      `}</style>

            <div className="dos-frame">
                <div className="dos-header">
                    <div className="dos-left">
                        <span className="dos-title">DOS TRADING CONSOLE</span>

                        <input
                            ref={inputRef}
                            className="dos-input"
                            value={draftSymbol}
                            onChange={(e) => setDraftSymbol(String(e.target.value).toUpperCase())}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitAnalyze();
                                }
                            }}
                            placeholder="BTCUSDT"
                            spellCheck={false}
                        />

                        <button className="dos-btn" onClick={commitAnalyze} title="Analyze (A / Enter)">
                            ANALYZE
                        </button>

                        <button
                            className={`dos-btn dos-btn-danger ${paused ? "dos-btn-active" : ""}`}
                            onClick={stopToggle}
                            title="Stop/Resume (S)"
                        >
                            {paused ? "RESUME" : "STOP"}
                        </button>

                        <button className="dos-btn" onClick={resetAll} title="Reset (R)">
                            RESET
                        </button>

                        <span className="dos-chip dos-dim">
                            <span>SESSION</span>
                            <span className="dos-mono">#{sessionKey}</span>
                        </span>
                    </div>

                    <div className="dos-right">
                        <span className="dos-chip dos-dim">
                            <span>MODE</span>
                            <span className="dos-mono">{paused ? "FROZEN" : "LIVE"}</span>
                        </span>
                        <span className="dos-chip dos-dim">
                            <span>HOTKEYS</span>
                            <span className="dos-mono">↑↓ select • Enter expand • A analyze • S stop • R reset</span>
                        </span>
                    </div>
                </div>

                <div style={{ padding: 12 }}>
                    <AnalysisSession key={`${symbol}:${sessionKey}`} symbol={symbol} paused={paused} />
                </div>
            </div>
        </div>
    );
}
