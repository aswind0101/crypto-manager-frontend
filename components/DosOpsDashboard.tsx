import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";

type AnyObj = any;

const uiMono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const uiSans =
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'";

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

function setupSig(s: AnyObj) {
    return [
        String(s?.canon ?? ""),
        String(s?.side ?? ""),
        String(s?.type ?? ""),
        String(s?.bias_tf ?? ""),
        String(s?.entry_tf ?? ""),
        String(s?.trigger_tf ?? ""),
    ].join("|");
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

    if (status === "INVALIDATED") return "INVALIDATED";
    if (status === "EXPIRED") return "EXPIRED";

    if (status === "TRIGGERED") {
        return mode === "MARKET" ? "ENTER MARKET (CONFIRMED)" : "TRIGGERED (WAIT EXEC)";
    }

    if (status === "READY") {
        if (hasClose && !closeOk) return "WAIT CLOSE (CONFIRM)";
        return mode === "LIMIT" ? "PLACE LIMIT (ARMED)" : "READY (ARMED)";
    }

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

    if (typeof msRoot === "object" && !Array.isArray(msRoot) && msRoot[tf]) return msRoot[tf];

    if (Array.isArray(msRoot)) {
        const hit = msRoot.find((x: AnyObj) => String(x?.tf ?? "") === tf);
        if (hit) return hit;
    }

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

function biasByTfLabel(features: AnyObj, tf: string) {
    const b = features?.bias_by_tf?.[tf];
    if (!b) return "—";

    const complete = Boolean(b.complete);
    const have = Number(b.have ?? 0);
    const need = Number(b.need ?? 210);

    if (!complete) return `PENDING (${have}/${need})`;

    const dir = String(b.trend_dir ?? "").trim();
    const str = Number(b.trend_strength);
    const vr = String(b.vol_regime ?? "").trim();

    const DIR =
        dir === "bull" ? "BULL" :
            dir === "bear" ? "BEAR" :
                dir === "sideways" ? "SIDE" :
                    dir ? dir.toUpperCase() : "—";

    const sPct = Number.isFinite(str) ? Math.round(str * 100) : null;
    const core = sPct != null ? `${DIR} ${sPct}%` : DIR;
    const vol = vr ? ` • ${vr.toUpperCase()}` : "";
    return `${core}${vol}`;
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
    return <div className="toast">{msg}</div>;
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

function stalePct(staleSec?: number) {
    if (staleSec == null || !Number.isFinite(staleSec)) return 0;
    return clamp(1 - staleSec / 5, 0, 1);
}

function ScanPulse({
    title,
    tone,
    dq,
    bybitOk,
    binanceOk,
    staleSec,
    pulse,
}: {
    title: string;
    tone: "ok" | "warn" | "bad";
    dq: string;
    bybitOk: boolean;
    binanceOk: boolean;
    staleSec?: number;
    pulse: number;
}) {
    const pct = stalePct(staleSec);
    const staleLabel = staleSec == null || !Number.isFinite(staleSec) ? "—" : `${staleSec.toFixed(1)}s`;
    const bump = pulse % 2 === 0;

    const staleTone = pct > 0.7 ? "ok" : pct > 0.3 ? "warn" : "bad";

    return (
        <div className="scan">
            <div className="scanTop">
                <div className={`scanTitle ${tone}`}>{title}</div>
                <div className="scanMeta">
                    <span className="chip">DQ <span className="monoStrong">{dq}</span></span>
                    <span className="chip">
                        FEEDS{" "}
                        <span className={bybitOk ? "ok" : "bad"}>BYBIT</span>{" "}
                        <span className={binanceOk ? "ok" : "warn"}>BINANCE</span>
                    </span>
                    <span className="chip">
                        STALE <span className={staleTone}>{staleLabel}</span>
                    </span>
                </div>
            </div>

            <div className="scanMeter" aria-label="scan activity">
                <div
                    className={`scanFill ${bump ? "scanBump" : ""}`}
                    style={{
                        width: `${Math.round(pct * 100)}%`,
                        animation: bump ? "scanPulse 320ms ease-out" : undefined,
                    }}
                />
            </div>
        </div>
    );
}

function statusTone(opts: {
    mid: number;
    dqOk: boolean;
    bybitOk: boolean;
    binanceOk: boolean;
    rowsCount: number;
}) {
    const { mid, dqOk, bybitOk, binanceOk, rowsCount } = opts;

    if (!Number.isFinite(mid)) return { title: "SCAN: CONNECTING", tone: "warn" as const };
    if (!dqOk) return { title: "SCAN: PAUSED (DQ GATED)", tone: "bad" as const };
    if (!bybitOk) return { title: "SCAN: DEGRADED (BYBIT DOWN)", tone: "bad" as const };
    if (!binanceOk) return { title: "SCAN: DEGRADED (BINANCE)", tone: "warn" as const };
    if (rowsCount === 0) return { title: "SCAN: LIVE (NO SETUPS)", tone: "ok" as const };
    return { title: "SCAN: LIVE", tone: "ok" as const };
}

function SystemRibbon({
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
        !bybitOk ? "BYBIT DOWN" :
            !binanceOk ? "BINANCE DEGRADED" :
                !dqOk ? "DQ GATED" :
                    warm ? "WARMING UP" : "OK";

    const healthTone =
        health === "OK" ? "ok" :
            health.includes("WARM") || health.includes("DEGRADED") ? "warn" : "bad";

    const staleTone =
        !Number.isFinite(staleMs) ? "warn" :
            staleMs < 1500 ? "ok" :
                staleMs < 5000 ? "warn" : "bad";

    return (
        <div className="ribbon">
            <span className={`pill ${paused ? "warn" : "ok"}`}>{paused ? "FROZEN" : "LIVE"}</span>
            <span className={`pill ${healthTone}`}>HEALTH: {health}</span>
            <span className="pill dim">
                DQ: <span className="monoStrong">{dq}</span> {!dqOk ? <span className="warn"> (GATED)</span> : null}
            </span>
            <span className="pill dim">
                MID: <span className="monoStrong">{Number.isFinite(mid) ? fmt(mid, 2) : "—"}</span>
                {warm ? <span className="warn"> (warm)</span> : null}
            </span>
            <span className="pill dim">
                DEV: <span className="monoStrong">{Number.isFinite(Number(dev)) ? `${Number(dev).toFixed(1)}bps` : "—"}</span>
            </span>
            <span className="pill dim">
                FEEDS: <span className={bybitOk ? "ok" : "bad"}>BYBIT</span>{" "}
                <span className={binanceOk ? "ok" : "warn"}>BINANCE</span>
            </span>
            <span className="pill dim">
                SETUPS: <span className="monoStrong">{setupsCount}</span>
                {preferredId ? <span className="dim"> pref</span> : null}
            </span>
            <span className="pill dim">
                STALE: <span className={staleTone}>{Number.isFinite(staleMs) ? `${(staleMs / 1000).toFixed(1)}s` : "—"}</span>
            </span>
        </div>
    );
}

function SectionCard({
    title,
    right,
    children,
    className,
}: {
    title: string;
    right?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`card ${className ?? ""}`}>
            <div className="cardHead">
                <div className="cardTitle">{title}</div>
                {right ? <div className="cardRight">{right}</div> : null}
            </div>
            <div className="cardBody">{children}</div>
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
        : (Number.isFinite(Number(vSnap?.price?.bid)) && Number.isFinite(Number(vSnap?.price?.ask)))
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

    // Selection + Freeze DETAILS
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedSig, setSelectedSig] = useState<string | null>(null);

    const [detailModel, setDetailModel] = useState<AnyObj | null>(null);

    // Freeze a price anchor for DETAILS to avoid layout shifts caused by live mid updates
    const [detailMid, setDetailMid] = useState<number>(NaN);


    // UI
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [expandedChecklist, setExpandedChecklist] = useState(true);
    const [expandedReasons, setExpandedReasons] = useState(false);

    // Filters / pinned
    const [statusFilter, setStatusFilter] = useState<"ALL" | "FORMING" | "READY" | "TRIGGERED" | "DEAD">("ALL");
    const [showPinnedOnly, setShowPinnedOnly] = useState(false);
    const [pinned, setPinned] = useState<Record<string, boolean>>({});
    const [pulse, setPulse] = useState(0);

    const rows = useMemo(() => {
        let r = allRows;

        if (statusFilter !== "ALL") {
            r = r.filter((x) => {
                const st = String(x?.status ?? "");
                if (statusFilter === "DEAD") return st === "INVALIDATED" || st === "EXPIRED";
                return st === statusFilter;
            });
        }

        const withKey = r.map((x) => {
            const rawId = String(x?.id ?? "").trim();
            const z = x?.entry?.zone;
            const fp = [
                String(x?.canon ?? ""),
                String(x?.side ?? ""),
                String(x?.type ?? ""),
                String(x?.bias_tf ?? ""),
                String(x?.entry_tf ?? ""),
                String(x?.trigger_tf ?? ""),
                z ? `${Number(z.lo)}-${Number(z.hi)}` : "",
                String(x?.stop?.price ?? ""),
                String(x?.rr_min ?? ""),
            ].join("|");

            const uiKey = rawId ? rawId : fp;
            return { ...x, __uiKey: uiKey };
        });

        let out = withKey;

        if (showPinnedOnly) {
            out = out.filter((x) => pinned[String(x.__uiKey)]);
        }

        out = [...out].sort((a, b) => {
            const pa = pinned[String(a.__uiKey)] ? 1 : 0;
            const pb = pinned[String(b.__uiKey)] ? 1 : 0;
            if (pb !== pa) return pb - pa;
            return 0;
        });

        return out;
    }, [allRows, pinned, statusFilter, showPinnedOnly]);

    const now = Date.now();
    const tickKey = String(vSnap?.price?.ts ?? vSnap?.price?.mid ?? "");
    const lastActivityMsRef = useRef<number | null>(null);

    const priceTs = Number(vSnap?.price?.ts);
    const staleSec = Number.isFinite(priceTs)
        ? (now - priceTs) / 1000
        : lastActivityMsRef.current != null
            ? (now - lastActivityMsRef.current) / 1000
            : undefined;

    useEffect(() => {
        if (paused) return;
        const px = Number(vSnap?.price?.mid);
        if (!Number.isFinite(px) && !tickKey) return;
        lastActivityMsRef.current = Date.now();
        setPulse((p) => p + 1);
    }, [paused, tickKey, vSnap]);

    // Selected row from current rows
    const selected = useMemo(() => {
        if (!rows.length) return null;
        if (selectedId) return rows.find((x: AnyObj) => String(x?.__uiKey ?? "") === selectedId) ?? rows[0];
        return rows[0];
    }, [rows, selectedId]);

    const selectedKey = selected ? String((selected as AnyObj)?.__uiKey ?? "") : "";

    // Stable selection rebind (from your previous fix)
    useEffect(() => {
        if (!rows.length) return;

        if (selectedId && rows.some((x: AnyObj) => String(x?.__uiKey ?? "") === selectedId)) return;

        if (selectedSig) {
            const hit = rows.find((x: AnyObj) => setupSig(x) === selectedSig);
            if (hit) {
                setSelectedId(String(hit?.__uiKey ?? ""));
                setSelectedSig(setupSig(hit));
                return;
            }
        }

        const first = rows[0] as AnyObj;
        setSelectedId(String(first?.__uiKey ?? ""));
        setSelectedSig(setupSig(first));
    }, [rows, selectedId, selectedSig]);

    // Freeze DETAILS model ONLY when selection changes
    // Freeze DETAILS model ONLY when selection changes
    useEffect(() => {
        if (!selected) {
            setDetailModel(null);
            setDetailMid(NaN);
            return;
        }
        setDetailModel(selected);

        // Anchor "mid" used inside DETAILS to prevent flex-wrap / reflow jitter
        setDetailMid(Number.isFinite(mid) ? mid : NaN);
    }, [selectedKey]);


    const togglePin = () => {
        if (!selectedKey) return;
        setPinned((p) => ({ ...p, [selectedKey]: !p[selectedKey] }));
    };

    const pick = (s: AnyObj) => {
        const key = String(s?.__uiKey ?? s?.id ?? "");
        setSelectedId(key);
        setSelectedSig(setupSig(s));
        if (isNarrow) setDrawerOpen(true);
    };

    // Use frozen model for details to prevent jitter
    const s = detailModel;
    const action = s ? actionLabel(s) : "—";
    const z = s?.entry?.zone;
    const distLabel = distLabelFor(detailMid, z, String(s?.entry?.mode ?? ""));

    const prog = s ? triggerProgress(s) : { ok: 0, total: 0, pct: 0, checklist: [], next: null };

    const [toast, setToast] = useState<string | null>(null);

    const copyTicket = async () => {
        if (!s) return;
        const ok = await copyText(buildTicketText(s));
        setToast(ok ? "COPIED TICKET" : "COPY FAILED");
    };

    // Navigation
    const selectedIndex = useMemo(() => {
        if (!rows.length) return 0;
        if (!selectedKey) return 0;
        const i = rows.findIndex((x: AnyObj) => String(x?.__uiKey ?? x?.id ?? "") === selectedKey);
        return i >= 0 ? i : 0;
    }, [rows, selectedKey]);

    const prev = () => {
        if (!rows.length) return;
        const i = clamp(selectedIndex - 1, 0, rows.length - 1);
        setSelectedId(String((rows[i] as AnyObj)?.__uiKey ?? (rows[i] as AnyObj)?.id ?? ""));
        if (isNarrow) setDrawerOpen(true);
    };
    const next = () => {
        if (!rows.length) return;
        const i = clamp(selectedIndex + 1, 0, rows.length - 1);
        setSelectedId(String((rows[i] as AnyObj)?.__uiKey ?? (rows[i] as AnyObj)?.id ?? ""));
        if (isNarrow) setDrawerOpen(true);
    };

    function invalidationLabel(ms: AnyObj) {
        if (!ms) return "—";
        const trend = String(ms.trend ?? "");
        if (!trend || trend === "—") return "—";
        if (trend === "RANGE") return "n/a";
        if (trend === "UP") {
            const x = ms.lastSwingLow?.price;
            return Number.isFinite(Number(x)) ? fmt(x, 2) : "pending";
        }
        if (trend === "DOWN") {
            const x = ms.lastSwingHigh?.price;
            return Number.isFinite(Number(x)) ? fmt(x, 2) : "pending";
        }
        return "—";
    }

    function eventsLabel(ms: AnyObj) {
        if (!ms) return "—";
        const ev: string[] = [];
        if (ms.lastBOS) {
            const d = ms.lastBOS.dir === "UP" ? "↑" : "↓";
            const p = ms.lastBOS.price ?? ms.lastBOS.level;
            ev.push(`BOS${d} ${fmt(p, 0)}`);
        }
        if (ms.lastCHOCH) {
            const d = ms.lastCHOCH.dir === "UP" ? "↑" : "↓";
            const p = ms.lastCHOCH.price ?? ms.lastCHOCH.level;
            ev.push(`CHOCH${d} ${fmt(p, 0)}`);
        }
        if (ms.lastSweep) {
            const d = ms.lastSweep.dir === "UP" ? "↑" : "↓";
            const p = ms.lastSweep.price ?? ms.lastSweep.level;
            ev.push(`SWP${d} ${fmt(p, 0)}`);
        }
        return ev.length ? ev.slice(0, 2).join(" ") : "—";
    }

    const scan = statusTone({ mid, dqOk, bybitOk, binanceOk, rowsCount: rows.length });

    const DetailsPanel = ({ inSheet }: { inSheet: boolean }) => {
        if (!s) {
            return (
                <SectionCard title="Details" className={inSheet ? "sheetCard" : ""}>
                    <div className="muted">No setup selected.</div>
                </SectionCard>
            );
        }

        const isPinned = Boolean(selectedKey && pinned[selectedKey]);

        const mode = String(s?.entry?.mode ?? "—");
        const entry =
            mode === "LIMIT" && s?.entry?.zone
                ? `[${fmt(s.entry.zone.lo, 2)}–${fmt(s.entry.zone.hi, 2)}]`
                : mode === "MARKET"
                    ? "MARKET"
                    : "—";

        const blockers =
            Array.isArray(s?.execution?.blockers) && s.execution.blockers.length ? s.execution.blockers.join(", ") : "";

        const reasons: AnyObj[] = Array.isArray(s?.confidence?.reasons) ? s.confidence.reasons : [];

        return (
            <SectionCard
                title="Details"
                className={inSheet ? "sheetCard" : ""}
                right={
                    <div className="rowActions">
                        <button className={`btn ghost ${isPinned ? "active" : ""}`} {...tap(togglePin)}>
                            {isPinned ? "Pinned" : "Pin"}
                        </button>
                        <button className="btn ghost" {...tap(copyTicket)}>
                            Copy
                        </button>
                        {inSheet ? (
                            <button className="btn" {...tap(() => setDrawerOpen(false))}>
                                Close
                            </button>
                        ) : null}
                    </div>
                }
            >
                {/* Summary header (fixed height-ish) */}
                <div className="summary">
                    <div className="summaryTop">
                        <div className="summaryLeft">
                            <div className="titleLine">
                                <span className={`tag side ${s?.side === "LONG" ? "ok" : "bad"}`}>{String(s?.side ?? "—")}</span>
                                <span className="tag type">{typeShort(String(s?.type ?? ""))}</span>
                                <span className="tag status">{String(s?.status ?? "—")}</span>
                            </div>

                            <div className="metaLine">
                                <span className="mono">TF {String(s?.bias_tf ?? "—")}→{String(s?.entry_tf ?? "—")}→{String(s?.trigger_tf ?? "—")}</span>
                                <span className="dot">•</span>
                                <span className="mono">Δ {distLabel}</span>
                                <span className="dot">•</span>
                                <span className="mono">RR {fmt(s?.rr_min, 2)}</span>
                                <span className="dot">•</span>
                                <span className="mono">P {Math.round(Number(s?.priority_score ?? 0))}</span>
                                <span className="dot">•</span>
                                <span className="mono">C {Math.round(Number(s?.confidence?.score ?? 0))} ({String(s?.confidence?.grade ?? "—")})</span>
                            </div>
                        </div>

                        <div className="summaryRight">
                            <div className="kpi">
                                <div className="kpiLabel">Trigger</div>
                                <div className="kpiValue mono">
                                    {prog.ok}/{prog.total} {bar(prog.pct, 10)}
                                </div>
                                {prog.next?.key ? <div className="kpiHint warn mono">next={String(prog.next.key)}</div> : <div className="kpiHint muted">—</div>}
                            </div>
                        </div>
                    </div>

                    <div className="summaryChips">
                        <span className="chip">
                            SETUP: <span className="monoStrong">{String(s?.status ?? "—")}</span>
                        </span>
                        <span className="chip">
                            EXEC: <span className="monoStrong">{action}</span>
                            {s?.execution?.reason ? <span className="muted"> • {String(s.execution.reason)}</span> : null}
                        </span>
                        {blockers ? (
                            <span className="chip warn">
                                blockers=<span className="monoStrong">{blockers}</span>
                            </span>
                        ) : null}
                    </div>
                </div>

                {/* Execution (kept info) */}
                <div className="subHead">Execution</div>
                <div className="kvGrid">
                    <div className="kv">
                        <div className="k">Entry</div>
                        <div className="v monoStrong">{`(${mode}) ${entry}`}</div>
                    </div>
                    <div className="kv">
                        <div className="k">SL</div>
                        <div className="v monoStrong">{`${fmt(s?.stop?.price, 2)} (${String(s?.stop?.basis ?? "—")})`}</div>
                    </div>
                    <div className="kv">
                        <div className="k">TP</div>
                        <div className="v monoStrong">
                            {(Array.isArray(s?.tp) && s.tp.length) ? s.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ") : "—"}
                        </div>
                    </div>
                    <div className="kv">
                        <div className="k">RR</div>
                        <div className="v monoStrong">{`min ${fmt(s?.rr_min, 2)} • est ${fmt(s?.rr_est, 2)}`}</div>
                    </div>
                </div>

                {/* Checklist */}
                <div className="subHeadRow">
                    <div className="subHead">Checklist</div>
                    <button className="btn ghost" {...tap(() => setExpandedChecklist((x) => !x))}>
                        {expandedChecklist ? "Hide" : "Show"}
                    </button>
                </div>

                {expandedChecklist ? (
                    <div className="listBox">
                        {prog.checklist.length ? (
                            prog.checklist.map((it: AnyObj, i: number) => {
                                const key = String(it?.key ?? i);
                                const ok = Boolean(it?.ok);
                                const isNext = prog.next && String(prog.next?.key ?? "") === key;
                                return (
                                    <div key={key} className={`lineItem ${isNext ? "next" : ""}`}>
                                        <span className={`badge ${ok ? "ok" : "warn"}`}>{ok ? "OK" : "WAIT"}</span>
                                        <span className="monoStrong">{key}</span>
                                        <span className="muted">{String(it?.note ?? "")}</span>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="muted">No checklist.</div>
                        )}
                    </div>
                ) : (
                    <div className="muted">Hidden.</div>
                )}

                {/* Confluence */}
                <div className="subHeadRow">
                    <div className="subHead">Confluence</div>
                    <button className="btn ghost" {...tap(() => setExpandedReasons((x) => !x))}>
                        {expandedReasons ? "Hide" : "Show"}
                    </button>
                </div>

                {expandedReasons ? (
                    reasons.length ? (
                        <div className="listBox">
                            {reasons.map((r: AnyObj, i: number) => (
                                <div key={i} className="lineItem">
                                    <span className="badge dim">•</span>
                                    <span className="muted">{String(r)}</span>
                                </div>
                            ))}

                        </div>
                    ) : (
                        <div className="muted">No reasons provided.</div>
                    )
                ) : (
                    <div className="muted">Hidden.</div>
                )}
            </SectionCard>
        );
    };

    return (
        <>
            <SystemRibbon
                paused={paused}
                dq={dq}
                dqOk={dqOk}
                bybitOk={bybitOk}
                binanceOk={binanceOk}
                mid={mid}
                dev={dev}
                lastTs={vSnap?.price?.ts ?? null}
                staleSec={staleSec}
                setupsCount={rows.length}
                preferredId={preferredId}
            />

            <ScanPulse
                title={scan.title}
                tone={scan.tone}
                dq={dq}
                bybitOk={bybitOk}
                binanceOk={binanceOk}
                staleSec={staleSec}
                pulse={pulse}
            />

            <div className="layout">
                {/* Left column: Market & Signals */}
                <div className="stack">
                    <SectionCard title="Market Outlook">
                        <div className="tableWrap">
                            <div className="tbl">
                                <div className="tblRow head">
                                    <div className="c tf">TF</div>
                                    <div className="c">Trend</div>
                                    <div className="c">Bias</div>
                                    <div className="c">Invalid</div>
                                    <div className="c events">Events</div>
                                </div>

                                {["15m", "1h", "4h", "1d"].map((tf) => {
                                    const ms = resolveMS(vFeat, tf);
                                    const bias = biasByTfLabel(vFeat, tf);
                                    const inval = invalidationLabel(ms);
                                    const events = eventsLabel(ms);

                                    return (
                                        <div className="tblRow" key={tf}>
                                            <div className="c tf monoStrong">{tf}</div>
                                            <div className="c">{String(ms?.trend ?? "—")}</div>
                                            <div className="c mono">{bias}</div>
                                            <div className="c mono">{inval}</div>
                                            <div className="c mono events">{events}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="divider" />

                        <div className="subHead">Key Signals</div>
                        <div className="tableWrap">
                            <div className="tbl tblSignals">
                                <div className="tblRow head">
                                    <div className="c tf">TF</div>
                                    <div className="c">BOS</div>
                                    <div className="c">CHOCH</div>
                                    <div className="c">SWEEP</div>
                                    <div className="c">SwingH</div>
                                    <div className="c">SwingL</div>
                                    <div className="c">Flags</div>
                                </div>

                                {[
                                    ["15m", scan15],
                                    ["1h", scan1h],
                                    ["4h", scan4h],
                                    ["1d", scan1d],
                                ].map(([tf, ss]: any) => (
                                    <div className="tblRow" key={tf}>
                                        <div className="c tf monoStrong">{tf}</div>
                                        <div className="c mono">{ss?.bos ?? "—"}</div>
                                        <div className="c mono">{ss?.choch ?? "—"}</div>
                                        <div className="c mono">{ss?.sweep ?? "—"}</div>
                                        <div className="c mono">{Number.isFinite(Number(ss?.sH)) ? fmt(ss?.sH, 2) : "—"}</div>
                                        <div className="c mono">{Number.isFinite(Number(ss?.sL)) ? fmt(ss?.sL, 2) : "—"}</div>
                                        <div className="c mono">{ss?.fl ?? "—"}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </SectionCard>
                </div>

                {/* Right column: Feed + Details */}
                <div className="rightCol">
                    <SectionCard
                        title="Setups"
                        right={
                            <div className="filters">
                                <button className={`seg ${statusFilter === "ALL" ? "on" : ""}`} onClick={() => setStatusFilter("ALL")}>All</button>
                                <button className={`seg ${statusFilter === "FORMING" ? "on" : ""}`} onClick={() => setStatusFilter("FORMING")}>Forming</button>
                                <button className={`seg ${statusFilter === "READY" ? "on" : ""}`} onClick={() => setStatusFilter("READY")}>Ready</button>
                                <button className={`seg ${statusFilter === "TRIGGERED" ? "on" : ""}`} onClick={() => setStatusFilter("TRIGGERED")}>Triggered</button>
                                <button className={`seg ${statusFilter === "DEAD" ? "on" : ""}`} onClick={() => setStatusFilter("DEAD")}>Dead</button>
                                <button className={`seg ${showPinnedOnly ? "on" : ""}`} onClick={() => setShowPinnedOnly((x) => !x)}>Pinned</button>
                            </div>
                        }
                        className="feedCard"
                    >
                        {rows.length === 0 ? (
                            <div className="empty">
                                {dqOk ? (
                                    <>
                                        <div className="emptyTitle">No setups (valid)</div>
                                        <div className="muted">Filters blocked candidates due to RR / structure / retest requirements.</div>
                                    </>
                                ) : (
                                    <>
                                        <div className="emptyTitle bad">DQ gated</div>
                                        <div className="muted">Fix feeds/liveness before trusting setups.</div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="feed">
                                {rows.map((row) => {
                                    const id = String((row as AnyObj)?.__uiKey ?? row?.id ?? "");
                                    const engineId = String(row?.id ?? "").trim();
                                    const isPreferred = preferredId && engineId === preferredId;
                                    const isSelected = selectedId ? id === selectedId : false;
                                    const dead = row?.status === "INVALIDATED" || row?.status === "EXPIRED";
                                    const p = Number(row?.priority_score ?? 0);
                                    const c = Number(row?.confidence?.score ?? 0);
                                    const g = String(row?.confidence?.grade ?? "—");

                                    const pr = triggerProgress(row);

                                    const zz = row?.entry?.zone;
                                    const dl = distLabelFor(mid, zz, String(row?.entry?.mode ?? ""));
                                    const act = actionLabel(row);

                                    const pin = Boolean(pinned[id]);

                                    return (
                                        <div
                                            key={id}
                                            className={[
                                                "feedRow",
                                                isSelected ? "selected" : "",
                                                isPreferred ? "preferred" : "",
                                                dead ? "dead" : "",
                                            ].join(" ")}
                                            {...tap(() => pick(row))}
                                            role="button"
                                            tabIndex={0}
                                        >
                                            <div className="feedMark">
                                                {isSelected ? "●" : pin ? "★" : isPreferred ? "✓" : " "}
                                            </div>

                                            <div className="feedMain">
                                                <div className="feedTop">
                                                    <div className="feedTitle">
                                                        <span className={`tag side ${row?.side === "LONG" ? "ok" : "bad"}`}>{String(row?.side ?? "—")}</span>
                                                        <span className="tag type">{typeShort(String(row?.type ?? ""))}</span>
                                                        <span className="tag status">{String(row?.status ?? "—")}</span>
                                                    </div>

                                                    <div className="feedBadges">
                                                        <span className="chip mono">Δ {dl}</span>
                                                        <span className="chip mono">RR {fmt(row?.rr_min, 2)}</span>
                                                        <span className="chip mono">P {String(Math.round(p))}</span>
                                                        <span className="chip mono">C {String(Math.round(c))} ({g})</span>
                                                    </div>
                                                </div>

                                                <div className="feedBottom">
                                                    <span className="muted mono">T {pr.ok}/{pr.total} {bar(pr.pct, 10)}</span>
                                                    <span className="muted mono">S:{String(row?.status ?? "—")} | E:{act}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </SectionCard>

                    {/* Desktop/iPad: details side-by-side; Mobile: details via sheet */}
                    {!isNarrow ? <DetailsPanel inSheet={false} /> : null}
                </div>
            </div>

            {/* Bottom Sheet for mobile */}
            {isNarrow ? (
                <div className={`sheet ${drawerOpen ? "on" : ""}`}>
                    <div className="sheetScrim" {...tap(() => setDrawerOpen(false))} />
                    <div className="sheetBody">
                        <DetailsPanel inSheet={true} />
                    </div>
                </div>
            ) : null}

            {/* Command bar */}
            <div className="cmd">
                <button className="btn" {...tap(prev)} disabled={!rows.length}>Prev</button>
                <button className="btn" {...tap(next)} disabled={!rows.length}>Next</button>

                <button
                    className={`btn ghost ${selectedKey && pinned[selectedKey] ? "active" : ""}`}
                    {...tap(togglePin)}
                    disabled={!s}
                >
                    Pin
                </button>

                <button className="btn ghost" {...tap(copyTicket)} disabled={!s}>Copy</button>

                <button className="btn ghost" {...tap(() => setExpandedChecklist((x) => !x))} disabled={!s}>
                    Checklist
                </button>

                <button className="btn ghost" {...tap(() => setExpandedReasons((x) => !x))} disabled={!s}>
                    Reasons
                </button>

                {isNarrow ? (
                    <button className="btn" {...tap(() => setDrawerOpen(true))} disabled={!s}>
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
        <div className="screen">
            <style>{`
        :root{
          --bg: #0b1020;
          --panel: rgba(255,255,255,0.06);
          --panel2: rgba(255,255,255,0.08);
          --border: rgba(255,255,255,0.10);
          --text: rgba(255,255,255,0.92);
          --muted: rgba(255,255,255,0.66);
          --shadow: 0 10px 30px rgba(0,0,0,0.35);
          --r: 16px;
        }

        .screen{
          font-family: ${uiSans};
          background: radial-gradient(1200px 800px at 20% 10%, rgba(64,146,255,0.10), transparent 60%),
                      radial-gradient(1000px 600px at 90% 30%, rgba(46,213,115,0.10), transparent 55%),
                      ${"var(--bg)"};
          color: var(--text);
          min-height: 100dvh;
          padding: calc(env(safe-area-inset-top) + 12px) calc(env(safe-area-inset-right) + 12px) calc(env(safe-area-inset-bottom) + 92px) calc(env(safe-area-inset-left) + 12px);
        }

        .mono{ font-family: ${uiMono}; }
        .monoStrong{ font-family: ${uiMono}; font-weight: 700; }
        .muted{ color: var(--muted); }
        .dim{ opacity: 0.86; }

        .ok{ color: #86efac; }
        .warn{ color: #fde68a; }
        .bad{ color: #fca5a5; }

        /* Header */
        .frame{
          max-width: 1400px;
          margin: 0 auto;
        }
        .topbar{
          position: sticky;
          top: 0;
          z-index: 20;
          backdrop-filter: blur(10px);
          background: rgba(10,12,18,0.55);
          border: 1px solid var(--border);
          border-radius: var(--r);
          box-shadow: var(--shadow);
          padding: 10px;
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .brand{
          font-weight: 800;
          letter-spacing: 0.2px;
          padding: 8px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border);
        }
        .input{
          width: 160px;
          min-height: 40px;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border);
          color: var(--text);
          outline: none;
          font-family: ${uiMono};
          font-weight: 700;
          letter-spacing: 0.2px;
        }
        .chip{
          display:inline-flex;
          gap:8px;
          align-items:center;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.06);
          font-size: 12px;
          white-space: nowrap;
        }
        .dot{ opacity: 0.7; padding: 0 6px; }

        .btn{
          min-height: 40px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.10);
          color: var(--text);
          cursor: pointer;
          font-weight: 700;
        }
        .btn:disabled{ opacity: 0.5; cursor: not-allowed; }
        .btn.ghost{
          background: rgba(255,255,255,0.06);
        }
        .btn.active{
          box-shadow: 0 0 0 1px rgba(134,239,172,0.30) inset;
          border-color: rgba(134,239,172,0.30);
        }
        .btn.danger{
          border-color: rgba(252,165,165,0.35);
          background: rgba(252,165,165,0.10);
        }

        .ribbon{
          max-width: 1400px;
          margin: 12px auto 0;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        .pill{
          display:inline-flex;
          gap:8px;
          align-items:center;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.06);
          font-size: 12px;
          white-space: nowrap;
        }

        /* Scan */
        .scan{
          max-width: 1400px;
          margin: 10px auto 0;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: rgba(255,255,255,0.06);
          box-shadow: var(--shadow);
          padding: 10px 12px;
        }
        .scanTop{
          display:flex;
          justify-content: space-between;
          gap: 10px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .scanTitle{
          font-weight: 800;
          letter-spacing: 0.2px;
        }
        .scanMeta{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .scanMeter{
          margin-top: 10px;
          height: 10px;
          border-radius: 999px;
          overflow:hidden;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
        }
        .scanFill{
          height: 100%;
          background: linear-gradient(90deg, rgba(134,239,172,0.9), rgba(96,165,250,0.75));
          transition: width 220ms ease;
        }
        .scanBump{ filter: brightness(1.2); }
        @keyframes scanPulse {
          0% { box-shadow: 0 0 0 rgba(134,239,172,0); }
          40%{ box-shadow: 0 0 10px rgba(134,239,172,0.6); }
          100%{ box-shadow: 0 0 0 rgba(134,239,172,0); }
        }

        /* Layout */
        .layout{
          max-width: 1400px;
          margin: 12px auto 0;
          display: grid;
          grid-template-columns: 420px 1fr;
          gap: 12px;
          align-items: start;
        }
        @media (max-width: 980px){
          .layout{ grid-template-columns: 1fr; }
        }

        .stack{
          display: grid;
          gap: 12px;
        }

        .rightCol{
          display: grid;
          gap: 12px;
          grid-template-columns: 1.08fr 0.92fr;
          align-items: start;
        }
        @media (max-width: 980px){
          .rightCol{ grid-template-columns: 1fr; }
        }

        /* Cards */
        .card{
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: rgba(255,255,255,0.06);
          box-shadow: var(--shadow);
          overflow: hidden;
        }
        .cardHead{
          padding: 12px 12px;
          background: rgba(255,255,255,0.06);
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .cardTitle{
          font-weight: 800;
          letter-spacing: 0.2px;
        }
        .cardBody{
          padding: 12px;
        }

        .divider{
          height: 1px;
          background: rgba(255,255,255,0.10);
          margin: 12px 0;
        }

        /* Tables */
        .tableWrap{
          overflow: auto;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
        }
        .tbl{
          min-width: 640px;
        }
        .tblRow{
          display:grid;
          grid-template-columns: 64px 92px 220px 120px 1fr;
          gap: 10px;
          padding: 10px 12px;
          border-top: 1px solid rgba(255,255,255,0.08);
          font-size: 12px;
        }
        .tblRow:first-child{ border-top: none; }
        .tblRow.head{
          background: rgba(255,255,255,0.06);
          font-weight: 700;
          color: rgba(255,255,255,0.78);
        }
        .tblRow .c{
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tblRow .c.events{ min-width: 160px; }
        .tblRow .c.tf{ font-weight: 800; }

        @media (max-width: 980px){
          .tbl{ min-width: 720px; }
        }

        .subHead{
          font-weight: 800;
          margin-bottom: 8px;
        }
        .subHeadRow{
          display:flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 14px;
        }

        /* Feed */
        .feedCard .cardBody{ padding: 0; }
        .filters{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .seg{
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.06);
          color: var(--text);
          padding: 8px 10px;
          font-weight: 700;
          cursor: pointer;
          font-size: 12px;
        }
        .seg.on{
          background: rgba(255,255,255,0.12);
          box-shadow: 0 0 0 1px rgba(96,165,250,0.25) inset;
          border-color: rgba(96,165,250,0.25);
        }

        .feed{
          display: grid;
        }
        .feedRow{
          display:grid;
          grid-template-columns: 26px 1fr;
          gap: 10px;
          padding: 12px;
          border-top: 1px solid rgba(255,255,255,0.08);
          cursor: pointer;
          transition: background 120ms ease;
        }
        .feedRow:first-child{ border-top: none; }
        .feedRow:hover{ background: rgba(255,255,255,0.06); }
        .feedRow.selected{
          background: rgba(96,165,250,0.12);
          outline: 1px solid rgba(96,165,250,0.25);
        }
        .feedRow.preferred{
          background: rgba(134,239,172,0.10);
          outline: 1px solid rgba(134,239,172,0.22);
        }
        .feedRow.dead{ opacity: 0.62; }
        .feedMark{
          font-weight: 900;
          display:flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 2px;
        }
        .feedTop{
          display:flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .feedTitle{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .feedBadges{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .feedBottom{
          margin-top: 8px;
          display:flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
        }

        /* Tags */
        .tag{
          display:inline-flex;
          align-items:center;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.22);
          font-size: 12px;
          font-weight: 800;
        }
        .tag.status{
          background: rgba(255,255,255,0.10);
        }
        .tag.type{
          background: rgba(96,165,250,0.14);
          border-color: rgba(96,165,250,0.22);
        }
        .tag.side.ok{
          background: rgba(134,239,172,0.14);
          border-color: rgba(134,239,172,0.22);
        }
        .tag.side.bad{
          background: rgba(252,165,165,0.14);
          border-color: rgba(252,165,165,0.22);
        }

        /* Details */
        .rowActions{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .summary{
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
          border-radius: 14px;
          padding: 12px;
          margin-bottom: 12px;
        }

        .summaryTop{
          display:flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .titleLine{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .metaLine{
          margin-top: 8px;
          display:flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          color: rgba(255,255,255,0.74);
        }
        .summaryChips{
          margin-top: 10px;
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .kpi{
          min-width: 220px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.06);
          border-radius: 14px;
          padding: 10px 12px;
        }
        .kpiLabel{
          font-size: 12px;
          color: rgba(255,255,255,0.66);
          font-weight: 700;
        }
        .kpiValue{
          margin-top: 6px;
          font-weight: 800;
          font-size: 12px;
        }
        .kpiHint{
          margin-top: 6px;
          font-size: 12px;
        }

        .kvGrid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        @media (max-width: 980px){
          .kvGrid{ grid-template-columns: 1fr; }
        }
        .kv{
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
          border-radius: 14px;
          padding: 10px 12px;
        }
        .kv .k{
          font-size: 12px;
          color: rgba(255,255,255,0.66);
          font-weight: 700;
        }
        .kv .v{
          margin-top: 6px;
          font-size: 13px;
          font-weight: 800;
        }

        .listBox{
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
          border-radius: 14px;
          padding: 10px 12px;
          max-height: 260px;     /* prevents page-level layout shift */
          overflow: auto;
        }
        .lineItem{
          display:flex;
          gap: 10px;
          align-items: flex-start;
          padding: 8px 0;
          border-top: 1px solid rgba(255,255,255,0.06);
          font-size: 12px;
        }
        .lineItem:first-child{ border-top: none; padding-top: 2px; }
        .lineItem.next{
          outline: 1px dashed rgba(253,230,138,0.55);
          border-radius: 12px;
          padding: 10px;
          margin: 6px 0;
          background: rgba(253,230,138,0.06);
        }
        .badge{
          min-width: 48px;
          text-align:center;
          border-radius: 999px;
          padding: 6px 10px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          font-weight: 800;
        }
        .badge.ok{
          background: rgba(134,239,172,0.12);
          border-color: rgba(134,239,172,0.22);
        }
        .badge.warn{
          background: rgba(253,230,138,0.12);
          border-color: rgba(253,230,138,0.22);
        }
        .badge.dim{
          background: rgba(255,255,255,0.06);
        }

        .empty{
          padding: 16px 12px;
        }
        .emptyTitle{
          font-weight: 800;
          margin-bottom: 6px;
        }

        /* Bottom sheet */
        .sheet{
          position: fixed;
          inset: 0;
          z-index: 40;
          display: none;
        }
        .sheet.on{ display:block; }
        .sheetScrim{
          position:absolute;
          inset:0;
          background: rgba(0,0,0,0.55);
        }
        .sheetBody{
          position:absolute;
          left:0; right:0; bottom:0;
          padding: 10px 10px calc(env(safe-area-inset-bottom) + 92px) 10px;
        }
        .sheetCard{
          max-height: 72dvh;
          overflow: auto;
        }

        /* Command bar */
        .cmd{
          position: fixed;
          left: calc(env(safe-area-inset-left) + 12px);
          right: calc(env(safe-area-inset-right) + 12px);
          bottom: calc(env(safe-area-inset-bottom) + 12px);
          z-index: 30;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px;
          border-radius: var(--r);
          border: 1px solid var(--border);
          background: rgba(10,12,18,0.70);
          backdrop-filter: blur(10px);
          box-shadow: var(--shadow);
        }

        /* Toast */
        .toast{
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(env(safe-area-inset-bottom) + 96px);
          z-index: 50;
          border: 1px solid var(--border);
          background: rgba(10,12,18,0.85);
          backdrop-filter: blur(10px);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          font-weight: 800;
          box-shadow: var(--shadow);
        }
.tblSignals .tblRow{
  grid-template-columns: 64px 140px 140px 140px 120px 120px 1fr;
}

        /* Tap */
        .btn, .feedRow, .seg, .sheetScrim{
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
      `}</style>

            <div className="frame">
                <div className="topbar">
                    <span className="brand">DOS OPS</span>

                    <input
                        className="input"
                        ref={inputRef}
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

                    <button className="btn" {...tap(commitAnalyze)}>Analyze</button>

                    <button className={`btn danger ${paused ? "active" : ""}`} {...tap(stopToggle)}>
                        {paused ? "Resume" : "Stop"}
                    </button>

                    <button className="btn ghost" {...tap(resetAll)}>Reset</button>

                    <span className="chip dim">
                        <span>Session</span>
                        <span className="monoStrong">#{sessionKey}</span>
                    </span>

                    <span className="chip dim">
                        <span>Mode</span>
                        <span className="monoStrong">{paused ? "FROZEN" : "LIVE"}</span>
                    </span>
                </div>

                <AnalysisSession key={`${symbol}:${sessionKey}`} symbol={symbol} paused={paused} />
            </div>
        </div>
    );
}
