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
function showFlags(fl?: string) {
    const s = String(fl ?? "").trim();
    if (!s || s === "—" || s === "-") return "";
    return s;
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
    const pct = total ? ok / total : 0;
    const next = checklist.find((x: AnyObj) => x && x.ok === false) ?? null;
    return { ok, total, pct, checklist, next };
}
function actionLabel(s: AnyObj) {
    const status = String(s?.status ?? "");
    const mode = String(s?.entry?.mode ?? "");
    const checklist = Array.isArray(s?.entry?.trigger?.checklist) ? s.entry.trigger.checklist : [];

    const closeItem = checklist.find((x: AnyObj) => String(x?.key ?? "") === "close_confirm");
    const hasClose = Boolean(closeItem);
    const closeOk = closeItem?.ok === true;

    // Terminal states
    if (status === "INVALIDATED") return "INVALIDATED";
    if (status === "EXPIRED") return "EXPIRED";

    // Triggered state (close-confirm already satisfied)
    if (status === "TRIGGERED") {
        // Clarify execution intent
        return mode === "MARKET" ? "ENTER MARKET (CONFIRMED)" : "TRIGGERED (WAIT EXEC)";
    }

    // Ready state: eligible but may require close_confirm depending on trigger checklist
    if (status === "READY") {
        if (hasClose && !closeOk) return "WAIT CLOSE (CONFIRM)";
        return mode === "LIMIT" ? "PLACE LIMIT (ARMED)" : "READY (ARMED)";
    }

    // Forming / other states: show next required condition if available
    const next = checklist.find((x: AnyObj) => x && x.ok === false);
    if (next?.key) {
        const k = String(next.key);
        if (k === "retest") return "WAIT RETEST";
        if (k === "close_confirm") return "WAIT CLOSE (CONFIRM)";
        return `WAIT ${k.toUpperCase()}`;
    }

    return "NO ACTION";
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
function distLabelFor(mid: number, z: AnyObj, mode?: string) {
    const dist = Number.isFinite(mid) ? distanceBps(mid, z) : NaN;
    if (!Number.isFinite(dist)) return "—";
    if (dist === 0) return String(mode ?? "") === "LIMIT" ? "IN (MID)" : "IN";
    return `${dist.toFixed(0)}bps`;
}

function resolveMS(features: AnyObj, tf: string) {
    const msRoot = features?.market_structure;
    if (!msRoot) return null;

    // Case 1: object keyed by tf (ideal)
    if (typeof msRoot === "object" && !Array.isArray(msRoot) && msRoot[tf]) return msRoot[tf];

    // Case 2: array of { tf, ... }
    if (Array.isArray(msRoot)) {
        const hit = msRoot.find((x: AnyObj) => String(x?.tf ?? "") === tf);
        if (hit) return hit;
    }

    // Case 3: alternative keys (common mismatches)
    const aliases: Record<string, string[]> = {
        "15m": ["15m", "15", "M15", "15min"],
        "1h": ["1h", "60m", "60", "H1", "1H", "1hr", "1hour"],
        "4h": ["4h", "240m", "240", "H4", "4H"],
        "1d": ["1d", "D1", "1D", "24h", "1440m", "1440"],
    };

    const keys = aliases[tf] ?? [tf];
    for (const k of keys) {
        if (typeof msRoot === "object" && !Array.isArray(msRoot) && msRoot[k]) return msRoot[k];
        if (Array.isArray(msRoot)) {
            const hit = msRoot.find((x: AnyObj) => String(x?.tf ?? "") === k);
            if (hit) return hit;
        }
    }

    return null;
}

function marketScan(features: AnyObj, tf: string) {
    const ms = resolveMS(features, tf);

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
    const tps =
        Array.isArray(s?.tp) && s.tp.length ? s.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ") : "—";
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

function useIsNarrow(breakpoint = 980) {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width:${breakpoint}px)`);
        const on = () => setNarrow(Boolean(mq.matches));
        on();
        mq.addEventListener?.("change", on);
        return () => mq.removeEventListener?.("change", on);
    }, [breakpoint]);
    return narrow;
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
    useEffect(() => {
        const t = setTimeout(onDone, 1300);
        return () => clearTimeout(t);
    }, [onDone]);
    return <div className="dos-toast">{msg}</div>;
}
function tap(fn: () => void) {
    return {
        onPointerUp: (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
        },
        onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
        },
    };
}

function SystemStatusBar({
    paused,
    dq,
    dqOk,
    bybitOk,
    binanceOk,
    mid,
    dev,
    lastTs,
    staleSec,
    setupsCount,
    preferredId,
}: {
    paused: boolean;
    dq: string;
    dqOk: boolean;
    bybitOk: boolean;
    binanceOk: boolean;
    mid: number;
    dev: any;
    lastTs?: number;
    staleSec?: number;
    setupsCount: number;
    preferredId?: string;
}) {
    const now = Date.now();
    const staleMs =
        staleSec != null && Number.isFinite(staleSec)
            ? Math.max(0, staleSec * 1000)
            : lastTs
                ? Math.max(0, now - lastTs)
                : NaN;
    const warm = !Number.isFinite(mid);
    const health =
        !bybitOk ? "BYBIT DOWN" : !binanceOk ? "BINANCE DEGRADED" : !dqOk ? "DQ GATED" : warm ? "WARMING UP" : "OK";
    const healthCls = health === "OK" ? "dos-ok" : health.includes("WARM") || health.includes("DEGRADED") ? "dos-warn" : "dos-bad";

    const staleCls =
        !Number.isFinite(staleMs) ? "dos-warn" : staleMs < 1500 ? "dos-ok" : staleMs < 5000 ? "dos-warn" : "dos-bad";

    return (
        <div className="dos-sysbar">
            <span className={`dos-pill ${paused ? "dos-pill-warn" : "dos-pill-ok"}`}>{paused ? "FROZEN" : "LIVE"}</span>
            <span className={`dos-pill ${healthCls}`}>HEALTH: {health}</span>

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

            <span className="dos-pill dos-dim">
                FEEDS: <span className={bybitOk ? "dos-ok" : "dos-bad"}>BYBIT</span>{" "}
                <span className={binanceOk ? "dos-ok" : "dos-warn"}>BINANCE</span>
            </span>

            <span className="dos-pill dos-dim">
                SETUPS: <span className="dos-strong">{setupsCount}</span>
                {preferredId ? <span className="dos-dim"> pref</span> : null}
            </span>

            <span className="dos-pill dos-dim">
                STALE: <span className={staleCls}>{Number.isFinite(staleMs) ? `${(staleMs / 1000).toFixed(1)}s` : "—"}</span>
            </span>
        </div>
    );
}
function scanStatusModel(opts: {
    mid: number;
    dqOk: boolean;
    dq: string;
    bybitOk: boolean;
    binanceOk: boolean;
    rowsCount: number;
    staleSec?: number;
}) {
    const { mid, dqOk, dq, bybitOk, binanceOk, rowsCount, staleSec } = opts;

    if (!Number.isFinite(mid)) {
        return {
            title: "SCAN: CONNECTING",
            cls: "dos-warn",
            detail: "Connecting feeds / warming up market data.",
            evidence: [],
        };
    }

    if (!dqOk) {
        return {
            title: "SCAN: PAUSED (DQ GATED)",
            cls: "dos-bad",
            detail: "Analysis suppressed due to insufficient data quality.",
            evidence: [
                `DQ=${dq}`,
                `BYBIT=${bybitOk ? "OK" : "DOWN"}`,
                `BINANCE=${binanceOk ? "OK" : "DEGRADED"}`,
            ],
        };
    }

    if (rowsCount === 0) {
        return {
            title: "SCAN: LIVE",
            cls: "dos-ok",
            detail: "Scanning market structure & waiting for close-confirm triggers.",
            evidence: [
                `DQ=${dq}`,
                staleSec != null ? `STALE=${staleSec.toFixed(1)}s` : null,
                `SETUPS=0 (valid)`,
            ].filter(Boolean) as string[],
        };
    }

    return {
        title: "SCAN: LIVE",
        cls: "dos-ok",
        detail: "Active setups detected and ranked by priority.",
        evidence: [`SETUPS=${rowsCount}`],
    };
}
function stalePct(staleSec?: number) {
    if (staleSec == null || !Number.isFinite(staleSec)) return 0;
    // map 0..5s to 1..0 (fresh -> full bar)
    const x = clamp(1 - staleSec / 5, 0, 1);
    return x;
}

function ScanPulse({
    title,
    cls,
    dq,
    bybitOk,
    binanceOk,
    staleSec,
    pulse,
}: {
    title: string;
    cls: string; // dos-ok / dos-warn / dos-bad
    dq: string;
    bybitOk: boolean;
    binanceOk: boolean;
    staleSec?: number;
    pulse: number; // increments on new data tick
}) {
    const pct = stalePct(staleSec);
    const staleLabel = staleSec == null || !Number.isFinite(staleSec) ? "—" : `${staleSec.toFixed(1)}s`;

    // "pulse" creates a brief visual bump without fake progress
    const bump = pulse % 2 === 0;

    const staleCls = pct > 0.7 ? "dos-ok" : pct > 0.3 ? "dos-warn" : "dos-bad";

    return (
        <div className="dos-scanbar">
            <div className="dos-scanbar-top">
                <span className={`dos-strong ${cls}`}>{title}</span>

                <span className="dos-dim dos-small">
                    DQ <span className="dos-strong">{dq}</span> • FEEDS{" "}
                    <span className={bybitOk ? "dos-ok" : "dos-bad"}>BYBIT</span>{" "}
                    <span className={binanceOk ? "dos-ok" : "dos-warn"}>BINANCE</span> • STALE{" "}
                    <span className={staleCls}>{staleLabel}</span>
                </span>
            </div>

            <div className="dos-scanbar-meter" aria-label="scan activity">
                <div
                    className={`dos-scanbar-fill ${bump ? "dos-scanbar-bump" : ""}`}
                    style={{
                        width: `${Math.round(pct * 100)}%`,
                        animation: bump ? "scan-pulse 320ms ease-out" : undefined,
                    }}
                />

            </div>
        </div>
    );
}

function AnalysisSession({ symbol, paused }: { symbol: string; paused: boolean }) {
    const { snap, features, setups } = useSetupsSnapshot(symbol, paused);
    const isNarrow = useIsNarrow(980);

    // Freeze when paused
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

    const mid = Number.isFinite(Number(vSnap?.price?.mid))
        ? Number(vSnap.price.mid)
        : (Number.isFinite(Number(vSnap?.price?.bid)) &&
            Number.isFinite(Number(vSnap?.price?.ask)))
            ? (Number(vSnap.price.bid) + Number(vSnap.price.ask)) / 2
            : NaN;
    const dev = vFeat?.cross?.deviation_bps ?? vFeat?.cross?.dev_bps;
    const preferredId = vSet?.preferred_id;

    const scan15 = marketScan(vFeat, "15m");
    const scan1h = marketScan(vFeat, "1h");
    const scan4h = marketScan(vFeat, "4h");
    const scan1d = marketScan(vFeat, "1d");

    const allRows: AnyObj[] = useMemo(() => {
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

    // UX state
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [expandedChecklist, setExpandedChecklist] = useState(true);
    const [expandedReasons, setExpandedReasons] = useState(false);

    // Filters / pinned
    const [statusFilter, setStatusFilter] = useState<"ALL" | "FORMING" | "READY" | "TRIGGERED" | "DEAD">("ALL");
    const [showPinnedOnly, setShowPinnedOnly] = useState(false);
    const [pinned, setPinned] = useState<Record<string, boolean>>({});
    const [pulse, setPulse] = useState(0);
    const lastTickRef = useRef<number | null>(null);

    const rows = useMemo(() => {
        let r = allRows;

        if (showPinnedOnly) {
            r = r.filter((x) => pinned[String(x?.id ?? "")]);
        }

        if (statusFilter !== "ALL") {
            r = r.filter((x) => {
                const st = String(x?.status ?? "");
                if (statusFilter === "DEAD") return st === "INVALIDATED" || st === "EXPIRED";
                return st === statusFilter;
            });
        }

        // Pinned bubble up
        r = [...r].sort((a, b) => {
            const ida = String(a?.id ?? "");
            const idb = String(b?.id ?? "");
            const pa = pinned[ida] ? 1 : 0;
            const pb = pinned[idb] ? 1 : 0;
            if (pb !== pa) return pb - pa;
            return 0;
        });

        return r;
    }, [allRows, pinned, statusFilter, showPinnedOnly]);
    const now = Date.now();

    // Prefer feed timestamp if present, otherwise use an internal activity clock.
    // Tick detection: any meaningful mid/last change (or ts change if available).
    const tickKey = String(
        vSnap?.ts ??
        vSnap?.generatedTs ??
        vSnap?.generated_at ??
        vSnap?.price?.mid ??
        vSnap?.price?.last ??
        ""
    );

    // Activity clock: last time we observed a tick (ms)
    const lastActivityMsRef = useRef<number | null>(null);

    // Derive staleSec
    const baseTs = Number(vSnap?.ts ?? vSnap?.generatedTs ?? vSnap?.generated_at ?? NaN);
    const staleSec = Number.isFinite(baseTs)
        ? (now - baseTs) / 1000
        : lastActivityMsRef.current != null
            ? (now - lastActivityMsRef.current) / 1000
            : undefined;

    // Pulse on tick
    useEffect(() => {
        if (paused) return;

        // If we don't even have a mid/last yet, don't start pulsing.
        const px = Number(vSnap?.price?.mid ?? vSnap?.price?.last);
        if (!Number.isFinite(px) && !tickKey) return;

        // Update internal activity clock and pulse
        lastActivityMsRef.current = Date.now();
        setPulse((p) => p + 1);
    }, [paused, tickKey]);



    const scanStatus = scanStatusModel({
        mid,
        dqOk,
        dq,
        bybitOk,
        binanceOk,
        rowsCount: rows.length,
        staleSec,
    });

    const selected = useMemo(() => {
        if (!rows.length) return null;
        if (selectedId) return rows.find((x) => String(x?.id ?? "") === selectedId) ?? rows[0];
        return rows[0];
    }, [rows, selectedId]);

    useEffect(() => {
        if (!selected) return;
        setSelectedId(String(selected.id ?? ""));
    }, [rows.length]); // keep selection stable-ish

    // Toast
    const [toast, setToast] = useState<string | null>(null);

    // Navigation helpers
    const selectedIndex = useMemo(() => {
        if (!selected) return 0;
        const id = String(selected.id ?? "");
        const i = rows.findIndex((x) => String(x?.id ?? "") === id);
        return i >= 0 ? i : 0;
    }, [rows, selected]);

    const prev = () => {
        if (!rows.length) return;
        const i = clamp(selectedIndex - 1, 0, rows.length - 1);
        setSelectedId(String(rows[i]?.id ?? ""));
        if (isNarrow) setDrawerOpen(true);
    };
    const next = () => {
        if (!rows.length) return;
        const i = clamp(selectedIndex + 1, 0, rows.length - 1);
        setSelectedId(String(rows[i]?.id ?? ""));
        if (isNarrow) setDrawerOpen(true);
    };

    const togglePin = () => {
        if (!selected) return;
        const id = String(selected.id ?? "");
        setPinned((p) => ({ ...p, [id]: !p[id] }));
    };

    const copyTicket = async () => {
        if (!selected) return;
        const ok = await copyText(buildTicketText(selected));
        setToast(ok ? "COPIED TICKET" : "COPY FAILED");
    };

    const pick = (s: AnyObj) => {
        const id = String(s?.id ?? "");
        setSelectedId(id);
        if (isNarrow) setDrawerOpen(true);
    };

    const action = selected ? actionLabel(selected) : "—";
    const z = selected?.entry?.zone;
    const distLabel = distLabelFor(mid, z, String(selected?.entry?.mode ?? ""));

    const prog = selected ? triggerProgress(selected) : { ok: 0, total: 0, pct: 0, checklist: [], next: null };

    const renderDetails = (inDrawer: boolean) => {
        if (!selected) {
            return (
                <div className="dos-panel">
                    <div className="dos-panel-head">DETAILS</div>
                    <div className="dos-panel-body dos-dim">No setup selected.</div>
                </div>
            );
        }

        const id = String(selected?.id ?? "");
        const isPinned = Boolean(pinned[id]);

        const mode = String(selected?.entry?.mode ?? "—");
        const entry =
            mode === "LIMIT" && selected?.entry?.zone
                ? `[${fmt(selected.entry.zone.lo, 2)}–${fmt(selected.entry.zone.hi, 2)}]`
                : mode === "MARKET"
                    ? "MARKET"
                    : "—";

        return (
            <div className={`dos-panel ${inDrawer ? "dos-drawer-panel" : ""}`}>
                <div className="dos-panel-head dos-panel-head-row">
                    <div className="dos-strong">DETAILS</div>
                    {inDrawer ? (
                        <button className="dos-btn dos-btn-sm" {...tap(() => setDrawerOpen(false))}>
                            CLOSE
                        </button>
                    ) : null}
                </div>

                <div className="dos-panel-body">
                    {/* Primary summary */}
                    <div className="dos-summary">
                        <div className="dos-summary-left">
                            <div className="dos-summary-title">
                                <span className={selected?.side === "LONG" ? "dos-ok" : "dos-bad"}>
                                    {String(selected?.side ?? "—")}
                                </span>{" "}
                                <span className="dos-strong">{typeShort(String(selected?.type ?? ""))}</span>{" "}
                                <span className="dos-reverse">{String(selected?.status ?? "—")}</span>
                            </div>
                            <div className="dos-small dos-dim">
                                TF {String(selected?.bias_tf ?? "—")}→{String(selected?.entry_tf ?? "—")}→{String(selected?.trigger_tf ?? "—")} •
                                Δ {distLabel} • RR {fmt(selected?.rr_min, 2)} • P {Math.round(Number(selected?.priority_score ?? 0))} •
                                C {Math.round(Number(selected?.confidence?.score ?? 0))}({String(selected?.confidence?.grade ?? "—")})
                            </div>
                        </div>

                        <div className="dos-summary-right">
                            <button className={`dos-btn dos-btn-sm ${isPinned ? "dos-btn-active" : ""}`} {...tap(togglePin)}>
                                {isPinned ? "PINNED" : "PIN"}
                            </button>
                            <button className="dos-btn dos-btn-sm" {...tap(copyTicket)}>
                                COPY
                            </button>
                        </div>
                    </div>

                    {/* Primary action */}
                    {/* Setup lifecycle vs execution intent (separate states) */}
                    <div className="dos-actionline">
                        <span className="dos-pill dos-dim">
                            SETUP: <span className="dos-strong">{String(selected?.status ?? "—")}</span>
                        </span>

                        <span className="dos-pill dos-dim dos-pill-wrap">
                            EXEC: <span className="dos-strong">{action}</span>
                            {selected?.execution?.reason ? (
                                <span className="dos-dim"> • {String(selected.execution.reason)}</span>
                            ) : null}
                            {Array.isArray(selected?.execution?.blockers) && selected.execution.blockers.length ? (
                                <span className="dos-warn dos-break"> • blockers={selected.execution.blockers.join(",")}</span>
                            ) : null}
                        </span>

                        <span className="dos-pill dos-dim">
                            TRIGGER: {prog.ok}/{prog.total} <span className="dos-mono">{bar(prog.pct, 10)}</span>
                            {prog.next?.key ? <span className="dos-warn"> next={String(prog.next.key)}</span> : null}
                        </span>
                    </div>

                    <div className="dos-hr" />

                    {/* Ticket */}
                    <div className="dos-blockhead">EXECUTION</div>
                    <pre className="dos-pre">{`ENTRY (${mode}): ${entry}
SL: ${fmt(selected?.stop?.price, 2)} (${String(selected?.stop?.basis ?? "—")})
TP: ${(Array.isArray(selected?.tp) && selected.tp.length) ? selected.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ") : "—"}
RR(min): ${fmt(selected?.rr_min, 2)}   RR(est): ${fmt(selected?.rr_est, 2)}`}</pre>

                    <div className="dos-hr" />

                    {/* Checklist */}
                    <div className="dos-blockhead-row">
                        <div className="dos-blockhead">CHECKLIST</div>
                        <button className="dos-btn dos-btn-sm" {...tap(() => setExpandedChecklist((x) => !x))}>
                            {expandedChecklist ? "HIDE" : "SHOW"}
                        </button>
                    </div>

                    {expandedChecklist ? (
                        <div className="dos-stack">
                            {prog.checklist.length ? (
                                prog.checklist.map((it: AnyObj, i: number) => {
                                    const key = String(it?.key ?? i);
                                    const ok = Boolean(it?.ok);
                                    const isNext = prog.next && String(prog.next?.key ?? "") === key;
                                    return (
                                        <div key={key} className={`dos-itemline ${isNext ? "dos-next" : ""}`}>
                                            <span className={ok ? "dos-ok" : "dos-warn"}>[{ok ? "OK" : "WAIT"}]</span>
                                            <span className="dos-key">{key}</span>
                                            <span className="dos-note">{String(it?.note ?? "")}</span>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="dos-dim">No checklist.</div>
                            )}
                        </div>
                    ) : (
                        <div className="dos-dim">Hidden.</div>
                    )}

                    <div className="dos-hr" />

                    {/* Reasons */}
                    <div className="dos-blockhead-row">
                        <div className="dos-blockhead">CONFLUENCE</div>
                        <button className="dos-btn dos-btn-sm" {...tap(() => setExpandedReasons((x) => !x))}>
                            {expandedReasons ? "HIDE" : "SHOW"}
                        </button>
                    </div>

                    {expandedReasons ? (
                        (selected?.confidence?.reasons ?? []).length ? (
                            <pre className="dos-pre">
                                {(selected.confidence.reasons as AnyObj[]).slice(0, 14).map((r: AnyObj) => `• ${String(r)}`).join("\n")}
                            </pre>
                        ) : (
                            <div className="dos-dim">No reasons provided.</div>
                        )
                    ) : (
                        <div className="dos-dim">Hidden.</div>
                    )}
                </div>
            </div>
        );
    };
    function htfBiasLabel(features: AnyObj) {
        const htf = features?.htf;
        if (!htf) return "—";

        const bias = String(htf.bias ?? "").toUpperCase();
        const regime = String(htf.regime ?? "").toUpperCase();

        if (!bias) return "—";
        return regime ? `${bias} (${regime})` : bias;
    }

    function invalidationLabel(ms: AnyObj) {
        if (!ms) return "—";
        if (ms.trend === "UP") return fmt(ms.lastSwingLow?.price, 2);
        if (ms.trend === "DOWN") return fmt(ms.lastSwingHigh?.price, 2);
        return "—";
    }

    function eventsLabel(ms: AnyObj) {
        if (!ms) return "—";
        const ev: string[] = [];

        if (ms.lastBOS) ev.push(`BOS${ms.lastBOS.dir === "UP" ? "↑" : "↓"}`);
        if (ms.lastCHOCH) ev.push(`CHOCH${ms.lastCHOCH.dir === "UP" ? "↑" : "↓"}`);
        if (ms.lastSweep) ev.push(`SWP${ms.lastSweep.dir === "UP" ? "↑" : "↓"}`);

        return ev.length ? ev.slice(0, 2).join(" ") : "—";
    }


    return (
        <>
            <SystemStatusBar
                paused={paused}
                dq={dq}
                dqOk={dqOk}
                bybitOk={bybitOk}
                binanceOk={binanceOk}
                mid={mid}
                dev={dev}
                lastTs={vSnap?.ts ?? vSnap?.generatedTs ?? vSnap?.generated_at ?? null}
                staleSec={staleSec}
                setupsCount={rows.length}
                preferredId={preferredId}
            />

            <ScanPulse
                title={scanStatus.title}
                cls={scanStatus.cls}
                dq={dq}
                bybitOk={bybitOk}
                binanceOk={binanceOk}
                staleSec={staleSec}
                pulse={pulse}
            />
            <div className="dos-grid">
                {/* LEFT */}
                <div className="dos-panel">
                    <div className="dos-panel-head">MARKET OUTLOOK (SCAN)</div>
                    <div className="dos-panel-body">
                        <div className="dos-small">
                            <div className="dos-mo-grid" role="table" aria-label="market outlook">
                                <div className="dos-mo-row dos-mo-head" role="row">
                                    <div className="dos-mo-row dos-mo-head" role="row">
                                        <div className="dos-mo-cell" role="columnheader">TF</div>
                                        <div className="dos-mo-cell" role="columnheader">TREND</div>
                                        <div className="dos-mo-cell" role="columnheader">HTF BIAS</div>
                                        <div className="dos-mo-cell" role="columnheader">INVALID</div>
                                        <div className="dos-mo-cell" role="columnheader">EVENTS</div>
                                    </div>
                                </div>

                                {[
                                    "15m",
                                    "1h",
                                    "4h",
                                    "1d",
                                ].map((tf) => {
                                    const ms = resolveMS(vFeat, tf);
                                    const htfBias = htfBiasLabel(vFeat);
                                    const inval = invalidationLabel(ms);
                                    const events = eventsLabel(ms);

                                    return (
                                        <div className="dos-mo-row" role="row" key={tf}>
                                            <div className="dos-mo-cell dos-mo-tf" role="cell">{tf}</div>
                                            <div className="dos-mo-cell" role="cell">{String(ms?.trend ?? "—")}</div>
                                            <div className="dos-mo-cell" role="cell">{htfBias}</div>
                                            <div className="dos-mo-cell" role="cell">{inval}</div>
                                            <div className="dos-mo-cell" role="cell">{events}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="dos-hr" />

                        <div className="dos-small">
                            <div className="dos-subhead">Key Signals</div>
                            <div className="dos-ks-grid" role="table" aria-label="key signals">
                                <div className="dos-ks-row dos-ks-head" role="row">
                                    <div className="dos-ks-cell" role="columnheader">TF</div>
                                    <div className="dos-ks-cell" role="columnheader">BOS</div>
                                    <div className="dos-ks-cell" role="columnheader">CHOCH</div>
                                    <div className="dos-ks-cell" role="columnheader">SWEEP</div>
                                </div>

                                {[
                                    ["15m", scan15],
                                    ["1h", scan1h],
                                    ["4h", scan4h],
                                    ["1d", scan1d],
                                ].map(([tf, s]: any) => (
                                    <div className="dos-ks-row" role="row" key={tf}>
                                        <div className="dos-ks-cell dos-ks-tf" role="cell">{tf}</div>
                                        <div className="dos-ks-cell" role="cell">{s?.bos ?? "—"}</div>
                                        <div className="dos-ks-cell" role="cell">{s?.choch ?? "—"}</div>
                                        <div className="dos-ks-cell" role="cell">{s?.sweep ?? "—"}</div>
                                    </div>
                                ))}
                            </div>

                        </div>
                    </div>
                </div>

                {/* RIGHT */}
                <div className="dos-right">
                    <div className="dos-rightgrid">
                        {/* Feed */}
                        <div className="dos-list">
                            <div className="dos-list-head dos-list-head-row">
                                <div className="dos-strong">SETUP FEED</div>

                                <div className="dos-filters">
                                    <button className={`dos-tab ${statusFilter === "ALL" ? "dos-tab-on" : ""}`} onClick={() => setStatusFilter("ALL")}>
                                        ALL
                                    </button>
                                    <button className={`dos-tab ${statusFilter === "FORMING" ? "dos-tab-on" : ""}`} onClick={() => setStatusFilter("FORMING")}>
                                        FORMING
                                    </button>
                                    <button className={`dos-tab ${statusFilter === "READY" ? "dos-tab-on" : ""}`} onClick={() => setStatusFilter("READY")}>
                                        READY
                                    </button>
                                    <button className={`dos-tab ${statusFilter === "TRIGGERED" ? "dos-tab-on" : ""}`} onClick={() => setStatusFilter("TRIGGERED")}>
                                        TRIGGERED
                                    </button>
                                    <button className={`dos-tab ${statusFilter === "DEAD" ? "dos-tab-on" : ""}`} onClick={() => setStatusFilter("DEAD")}>
                                        DEAD
                                    </button>

                                    <button className={`dos-tab ${showPinnedOnly ? "dos-tab-on" : ""}`} onClick={() => setShowPinnedOnly((x) => !x)}>
                                        PINNED
                                    </button>
                                </div>
                            </div>


                            {rows.length === 0 ? (
                                <div className="dos-pad">
                                    {dqOk ? (
                                        <>
                                            <div className="dos-strong">NO SETUPS (valid)</div>
                                            <div className="dos-dim" style={{ marginTop: 6 }}>
                                                Filters blocked candidates due to RR / structure / retest requirements.
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="dos-strong dos-bad">DQ GATED</div>
                                            <div className="dos-dim" style={{ marginTop: 6 }}>
                                                Fix feeds/liveness before trusting setups.
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : (
                                rows.map((s, i) => {
                                    const id = String(s?.id ?? "");
                                    const isPreferred = preferredId && id === preferredId;
                                    const isSelected = selectedId ? id === selectedId : i === 0;
                                    const dead = s?.status === "INVALIDATED" || s?.status === "EXPIRED";
                                    const p = Number(s?.priority_score ?? 0);
                                    const c = Number(s?.confidence?.score ?? 0);
                                    const g = String(s?.confidence?.grade ?? "—");
                                    const prog = triggerProgress(s);

                                    const z = s?.entry?.zone;
                                    const distLabel = distLabelFor(mid, z, String(s?.entry?.mode ?? ""));

                                    const act = actionLabel(s);
                                    const pin = Boolean(pinned[id]);

                                    return (
                                        <div
                                            key={id || i}
                                            className={[
                                                "dos-rowitem",
                                                isPreferred ? "dos-preferred" : "",
                                                isSelected ? "dos-selected" : "",
                                                dead ? "dos-dimrow" : "",
                                            ].join(" ")}
                                            {...tap(() => pick(s))}
                                            role="button"
                                            tabIndex={0}
                                        >

                                            <div className="dos-marker">{isPreferred ? ">" : pin ? "★" : " "}</div>
                                            <div className="dos-rowline">
                                                <div className="dos-rowtop">
                                                    <div className="dos-mono">
                                                        <span className={s?.side === "LONG" ? "dos-ok" : "dos-bad"}>
                                                            {String(s?.side ?? "").padEnd(5, " ")}
                                                        </span>{" "}
                                                        <span className="dos-strong">{typeShort(String(s?.type ?? ""))}</span>{" "}
                                                        <span className="dos-reverse">{String(s?.status ?? "").padEnd(9, " ")}</span>{" "}
                                                        <span className="dos-dim">Δ{distLabel}</span>{" "}
                                                        <span className="dos-dim">RR{fmt(s?.rr_min, 2)}</span>
                                                    </div>

                                                    <div className="dos-badges">
                                                        <span className="dos-mini">P{String(Math.round(p)).padStart(2, "0")}</span>
                                                        <span className="dos-mini">C{String(Math.round(c)).padStart(2, "0")}({g})</span>
                                                    </div>
                                                </div>

                                                <div className="dos-rowbot">
                                                    <span className="dos-dim dos-mono">
                                                        T {prog.ok}/{prog.total} {bar(prog.pct, 10)}
                                                    </span>
                                                    <span className="dos-dim dos-mono">
                                                        S:{String(s?.status ?? "—")} | E:{act}
                                                    </span>
                                                </div>

                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Details (always visible on iPad landscape) */}
                        <div className="dos-details-wrap">{renderDetails(false)}</div>
                    </div>
                </div>
            </div>

            {/* Drawer for narrow screens */}
            {isNarrow ? (
                <div className={`dos-drawer ${drawerOpen ? "dos-drawer-on" : ""}`}>
                    <div className="dos-drawer-scrim" {...tap(() => setDrawerOpen(false))} />
                    <div className="dos-drawer-sheet">{renderDetails(true)}</div>
                </div>
            ) : null}

            {/* Bottom command bar: always reachable */}
            <div className="dos-commandbar">
                <button className="dos-btn dos-btn-sm" {...tap(prev)} disabled={!rows.length}>
                    Prev
                </button>

                <button className="dos-btn dos-btn-sm" {...tap(next)} disabled={!rows.length}>
                    Next
                </button>

                <button
                    className={`dos-btn dos-btn-sm ${selected && pinned[String(selected?.id ?? "")] ? "dos-btn-active" : ""
                        }`}
                    {...tap(togglePin)}
                    disabled={!selected}
                >
                    Pin
                </button>

                <button className="dos-btn dos-btn-sm" {...tap(copyTicket)} disabled={!selected}>
                    Copy
                </button>

                <button
                    className="dos-btn dos-btn-sm"
                    {...tap(() => setExpandedChecklist((x) => !x))}
                    disabled={!selected}
                >
                    Checklist
                </button>

                <button
                    className="dos-btn dos-btn-sm"
                    {...tap(() => setExpandedReasons((x) => !x))}
                    disabled={!selected}
                >
                    Reasons
                </button>

                {isNarrow ? (
                    <button
                        className="dos-btn dos-btn-sm"
                        {...tap(() => setDrawerOpen(true))}
                        disabled={!selected}
                    >
                        Details
                    </button>
                ) : null}
            </div>


            {toast ? <Toast msg={toast} onDone={() => setToast(null)} /> : null}
        </>
    );
}

export function DosOpsDashboard() {
    const [draftSymbol, setDraftSymbol] = useState("BTCUSDT");
    const [symbol, setSymbol] = useState("BTCUSDT");
    const [sessionKey, setSessionKey] = useState(1);
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

    return (
        <div className="dos-screen">
            <style>{`
        .dos-screen{
          background:#050505; color:#cfe9cf; font-family:${mono};
          min-height:100dvh;
          padding: calc(env(safe-area-inset-top) + 12px) calc(env(safe-area-inset-right) + 12px) calc(env(safe-area-inset-bottom) + 86px) calc(env(safe-area-inset-left) + 12px);
        }
        .dos-frame{
          border:1px solid #1f3b1f; border-radius:12px; overflow:hidden;
          box-shadow: 0 0 0 1px #0a140a inset;
          background:#050705;
        }
        .dos-header{
          position: sticky; top: 0; z-index: 10;
          padding:10px 12px; border-bottom:1px solid #1f3b1f; background:#070a07;
          display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;
        }
        .dos-title{ font-weight:900; letter-spacing:0.6px; }
        .dos-left,.dos-right{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }

        .dos-input{
          width:170px; padding:10px 10px; border-radius:10px;
          border:1px solid #2a532a; background:#020302; color:#cfe9cf; outline:none;
          font-family:${mono}; font-size:16px;
        }

        .dos-btn{
          min-height:44px; padding:10px 12px; border-radius:10px;
          border:1px solid #2a532a; background:#081008; color:#cfe9cf; cursor:pointer;
          font-family:${mono}; font-weight:900;
        }
        .dos-btn:disabled{ opacity:0.5; cursor:not-allowed; }
        .dos-btn-danger{ border-color:#6b2b2b; background:#140808; }
        .dos-btn-active{ background:#0c1b0c; box-shadow:0 0 0 1px #2a532a inset; }
        .dos-btn-sm{ min-height:38px; padding:8px 10px; border-radius:10px; }

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

        .dos-sysbar{
          margin: 12px;
          border:1px solid #1f3b1f;
          border-radius:12px;
          padding:10px;
          background:#050705;
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
.dos-btn, .dos-rowitem, .dos-tab, .dos-drawer-scrim{
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.dos-scanbar{
  padding:10px 12px;
  border-bottom:1px solid #0d170d;
  background:#050705;
}
.dos-scanbar-top{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:flex-end;
  flex-wrap:wrap;
}
.dos-scanbar-meter{
  margin-top:8px;
  height:8px;
  border-radius:999px;
  overflow:hidden;
  background:#020302;
  border:1px solid #1f3b1f;
}
.dos-scanbar-fill{
  height:100%;
  background:#2a532a;
  transition: width 220ms ease;
}
.dos-scanbar-bump{
  filter: brightness(1.35);
}
@keyframes scan-pulse {
  0%   { box-shadow: 0 0 0 rgba(134,239,172,0); }
  40%  { box-shadow: 0 0 6px rgba(134,239,172,0.65); }
  100% { box-shadow: 0 0 0 rgba(134,239,172,0); }
}

        .dos-grid{
          display:grid; gap:10px; padding:12px;
          grid-template-columns: 420px 1fr;
          align-items:start;
        }
        @media (max-width: 980px){
          .dos-grid{ grid-template-columns: 1fr; }
        }

        .dos-panel{ border:1px solid #1f3b1f; border-radius:12px; overflow:hidden; background:#050705; }
        .dos-panel-head{ padding:9px 10px; border-bottom:1px solid #1f3b1f; background:#070a07; font-weight:900; }
        .dos-panel-head-row{ display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
        .dos-panel-body{ padding:10px; }
        .dos-hr{ border-top:1px dashed #1f3b1f; margin:10px 0; }
        .dos-small{ font-size:12px; opacity:0.95; }
        .dos-line{ display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        .dos-k{ opacity:0.85; }
        .dos-v{ font-weight:900; }
        .dos-pre{ margin:0; white-space:pre-wrap; word-break:break-word; font-family:${mono}; font-size:12px; line-height:1.45; }

        .dos-right{ min-width:0; }

        .dos-rightgrid{
          display:grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap:10px;
          align-items:start;
          min-width:0;
        }
        .dos-rightgrid > *{ min-width:0; }
        @media (max-width: 980px){
          .dos-rightgrid{ grid-template-columns: 1fr; }
          .dos-details-wrap{ display:none; } /* details move to drawer */
        }

        .dos-list{ border:1px solid #1f3b1f; border-radius:12px; overflow:hidden; background:#040604; }
        .dos-list-head{
          padding:9px 10px; border-bottom:1px solid #1f3b1f; background:#070a07;
          display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
        }
        .dos-list-head-row{ align-items:flex-start; }
        .dos-filters{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
        .dos-tab{
          min-height:34px; padding:6px 10px; border-radius:10px;
          border:1px solid #2a532a; background:#020302; color:#cfe9cf; cursor:pointer;
          font-family:${mono}; font-weight:900; font-size:12px;
        }
        .dos-tab-on{ background:#0c1b0c; box-shadow:0 0 0 1px #2a532a inset; }

        .dos-pad{ padding:12px; opacity:0.92; }

        .dos-rowitem{
          padding:12px 10px; border-bottom:1px solid #0d170d;
          display:grid; grid-template-columns: 24px 1fr; gap:8px;
          cursor:pointer;
        }
        .dos-rowitem:last-child{ border-bottom:none; }
        .dos-marker{ font-weight:900; width:24px; }
        .dos-selected{ background:#0b170b; }
        .dos-preferred{ background:#102010; }
        .dos-dimrow{ opacity:0.6; }
        .dos-reverse{ background:#cfe9cf; color:#061006; padding:0 6px; border-radius:6px; font-weight:900; }

        .dos-rowline{ display:flex; flex-direction:column; gap:6px; }
        .dos-rowtop{ display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap; }
        .dos-rowbot{ display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
        .dos-badges{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
        .dos-mini{
          border:1px solid #1f3b1f; background:#020302;
          border-radius:10px; padding:4px 8px; font-size:12px; opacity:0.95;
        }

        .dos-summary{ display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap; }
        .dos-summary-title{ font-size:14px; }
        .dos-actionline{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px; }

        .dos-blockhead{ font-weight:900; margin-bottom:6px; }
        .dos-blockhead-row{ display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
        .dos-stack{ display:grid; gap:6px; }
        .dos-itemline{ display:flex; gap:10px; flex-wrap:wrap; }
        .dos-key{ min-width:120px; }
        .dos-note{ opacity:0.9; }
        .dos-next{ outline: 1px dashed #7a6a2a; border-radius:10px; padding:6px 8px; }

        /* Drawer (mobile) */
       /* Drawer — HARD disable when closed (fix iOS double-tap) */
.dos-drawer{
  position: fixed;
  inset: 0;
  z-index: 40;
  display: none;              /* key: remove from hit-testing */
}
.dos-drawer-on{
  display: block;
}

.dos-drawer-scrim{
  position:absolute;
  inset:0;
  background: rgba(0,0,0,0.55);
}

.dos-drawer-sheet{
  position:absolute;
  left:0; right:0; bottom:0;
  padding: 10px 10px calc(env(safe-area-inset-bottom) + 90px) 10px;
}
.dos-drawer-panel{
  max-height: 70dvh;
  overflow:auto;
}


        /* Bottom command bar */
        .dos-commandbar{
          position: fixed;
          left: calc(env(safe-area-inset-left) + 12px);
          right: calc(env(safe-area-inset-right) + 12px);
          bottom: calc(env(safe-area-inset-bottom) + 12px);
          z-index: 30;
          display:flex; gap:8px; flex-wrap:wrap;
          padding:10px;
          border:1px solid #1f3b1f;
          border-radius:12px;
          background:#070a07;
          box-shadow: 0 0 0 1px #0a140a inset;
        }
/* Allow EXEC pill to wrap on iPad (avoid clipping) */
.dos-pill-wrap {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: initial !important;
  line-height: 1.25;
}

.dos-break {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.dos-subhead{
  margin-top:10px;
  margin-bottom:6px;
  font-weight:700;
  color:#9fe3a8;
}

.dos-ks-grid{
  border:1px solid #133013;
  border-radius:12px;
  overflow:hidden;
  background:#040604;
}

.dos-ks-row{
  display:grid;
  grid-template-columns: 52px 1.2fr 1fr 1fr;
  gap:10px;
  padding:8px 10px;
  border-top:1px solid #0d1f0d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size:12px;
  line-height:1.2;
}

.dos-ks-row:first-child{ border-top:none; }

.dos-ks-head{
  background:#050a05;
  color:#8fdc99;
  font-weight:700;
}

.dos-ks-cell{
  min-width:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.dos-ks-tf{
  color:#b7f3c1;
  font-weight:700;
}
.dos-mo-grid{
  border:1px solid #133013;
  border-radius:12px;
  overflow:hidden;
  background:#040604;
}
.dos-mo-row{
  display:grid;
  grid-template-columns: 52px 90px 140px 110px 1fr;
  gap:10px;
  padding:8px 10px;
  border-top:1px solid #0d1f0d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size:12px;
  line-height:1.2;
}

.dos-mo-row:first-child{ border-top:none; }

.dos-mo-head{
  background:#050a05;
  color:#8fdc99;
  font-weight:700;
}

.dos-mo-cell{
  min-width:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.dos-mo-tf{
  color:#b7f3c1;
  font-weight:700;
}

        /* Toast */
        .dos-toast{
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(env(safe-area-inset-bottom) + 90px);
          z-index: 50;
          border:1px solid #2a532a;
          background:#020302;
          color:#cfe9cf;
          padding:10px 12px;
          border-radius:12px;
          font-weight:900;
          box-shadow: 0 0 0 1px #0a140a inset;
        }
      `}</style>

            <div className="dos-frame">
                <div className="dos-header">
                    <div className="dos-left">
                        <span className="dos-title">DOS OPS</span>

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
                            onFocus={(e) => e.currentTarget.select()}
                        />
                        <button className="dos-btn" {...tap(commitAnalyze)}>
                            ANALYZE
                        </button>

                        <button
                            className={`dos-btn dos-btn-danger ${paused ? "dos-btn-active" : ""}`}
                            {...tap(stopToggle)}
                        >
                            {paused ? "RESUME" : "STOP"}
                        </button>

                        <button className="dos-btn" {...tap(resetAll)}>
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
                    </div>
                </div>

                <AnalysisSession key={`${symbol}:${sessionKey}`} symbol={symbol} paused={paused} />
            </div>
        </div>
    );
}
