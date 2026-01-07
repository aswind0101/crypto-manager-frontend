import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";

/**
 * Assumptions (based on files you sent):
 * - useSetupsSnapshot(symbol) returns: { snap, features, setups }
 * - setups is either null or:
 *   {
 *     ts: number;
 *     dq_ok: boolean;
 *     preferred_id?: string;
 *     setups: Array<TradeSetup & { execution?: ExecutionDecision }>;
 *   }
 *
 * TradeSetup fields used (confirmed in setups engine):
 * - id, canon, type, side, entry_tf, bias_tf, trigger_tf
 * - status, created_ts, expires_ts
 * - entry: { mode, zone: {lo, hi}, trigger: {confirmed, checklist, summary} }
 * - stop: { price, basis, note }
 * - tp: Array<{ price, size_pct, basis, note }>
 * - rr_min, rr_est
 * - confidence: { score, grade, reasons: string[] }
 * - tags: string[]
 *
 * ExecutionDecision (from setups types):
 * - state, canEnterMarket, canPlaceLimit, blockers, reason
 */

type SetupSide = "LONG" | "SHORT";
type SetupStatus = "FORMING" | "READY" | "TRIGGERED" | "INVALIDATED" | "EXPIRED";
type SetupType = string;

type ExecutionDecision = {
    state:
    | "BLOCKED"
    | "READY"
    | "WAIT_CONFIRM"
    | "WAIT_CLOSE"
    | "WAIT_RETEST"
    | "WAIT_ZONE"
    | "PLACE_LIMIT"
    | "ENTER_MARKET"
    | "WAIT_FILL";
    canEnterMarket: boolean;
    canPlaceLimit: boolean;
    blockers: string[];
    reason: string;
};

type EntryPlan = {
    mode: "LIMIT" | "MARKET";
    zone: { lo: number; hi: number };
    trigger: {
        confirmed: boolean;
        checklist: Array<{ key: string; ok: boolean; note?: string }>;
        summary: string;
    };
};

type TradeSetup = {
    id: string;
    canon?: string;
    type: SetupType;
    side: SetupSide;
    entry_tf: string;
    bias_tf: string;
    trigger_tf: string;
    status: SetupStatus;
    created_ts: number;
    expires_ts: number;

    entry: EntryPlan;
    stop: { price: number; basis?: string; note?: string };
    tp: Array<{ price: number; size_pct: number; basis?: string; note?: string }>;

    rr_min: number;
    rr_est: number;

    confidence: { score: number; grade: string; reasons: string[] };
    tags?: string[];

    execution?: ExecutionDecision;
};

type SetupsOutput = {
    ts: number;
    dq_ok: boolean;
    preferred_id?: string;
    setups: TradeSetup[];
};

function clamp01(x: number) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
}

function fmtPx(x?: number) {
    if (!Number.isFinite(x as number)) return "—";
    const v = x as number;
    // heuristic: crypto prices can vary widely; keep readable
    if (v >= 1000) return v.toFixed(1);
    if (v >= 100) return v.toFixed(2);
    if (v >= 1) return v.toFixed(4);
    return v.toFixed(6);
}

function fmtPct01(x?: number) {
    if (!Number.isFinite(x as number)) return "—";
    return `${Math.round(clamp01(x as number) * 100)}%`;
}

function fmtScore100(x?: number) {
    if (!Number.isFinite(x as number)) return "—";
    return `${Math.round(Math.max(0, Math.min(100, x as number)))}%`;
}

type AlignState = "ALIGNED" | "MIXED" | "AGAINST" | "UNKNOWN";

function normDir(x: any): "bull" | "bear" | null {
    const s = String(x ?? "").toLowerCase();
    if (!s) return null;

    // handle common variants: bull/bear, up/down, long/short
    if (s.includes("bull") || s.includes("up") || s.includes("long")) return "bull";
    if (s.includes("bear") || s.includes("down") || s.includes("short")) return "bear";
    return null;
}

function latestEventDir(msNode: any): { dir: "bull" | "bear" | null; ts: number | null } {
    if (!msNode) return { dir: null, ts: null };

    const bos = msNode.lastBOS;
    const choch = msNode.lastCHOCH;

    const bosTs = Number.isFinite(bos?.ts) ? (bos.ts as number) : null;
    const chochTs = Number.isFinite(choch?.ts) ? (choch.ts as number) : null;

    let picked: any = null;
    if (bosTs !== null && chochTs !== null) {
        picked = bosTs >= chochTs ? bos : choch;
    } else if (bosTs !== null) {
        picked = bos;
    } else if (chochTs !== null) {
        picked = choch;
    }

    const ts = Number.isFinite(picked?.ts) ? (picked.ts as number) : null;
    const dir = normDir(picked?.dir);

    return { dir, ts };
}

/**
 * Alignment between canonical bias direction and recent HTF structure events.
 * Uses 4h and 1h only (HTF), because those are the most meaningful for conflict warnings.
 */
function computeAlignment(features: any): AlignState {
    const biasDir = normDir(features?.bias?.trend_dir);
    if (!biasDir) return "UNKNOWN";

    const ms = features?.market_structure;
    const e4 = latestEventDir(ms?.["4h"]);
    const e1 = latestEventDir(ms?.["1h"]);

    // If both missing, unknown
    const dirs: Array<"bull" | "bear"> = [];
    if (e4.dir) dirs.push(e4.dir);
    if (e1.dir) dirs.push(e1.dir);

    if (dirs.length === 0) return "UNKNOWN";

    const alignedCount = dirs.filter((d) => d === biasDir).length;
    const againstCount = dirs.filter((d) => d !== biasDir).length;

    if (againstCount === 0) return "ALIGNED";
    if (alignedCount === 0) return "AGAINST";
    return "MIXED";
}

function alignmentTone(a: AlignState) {
    if (a === "ALIGNED") return "good";
    if (a === "AGAINST") return "bad";
    if (a === "MIXED") return "warn";
    return "muted";
}

function humanizeType(x: string) {
    return (x || "").replace(/_/g, " ");
}

function relTime(ts?: number) {
    if (!Number.isFinite(ts as number)) return "—";
    const t = ts as number;

    // Guard against 0 / nonsense timestamps
    if (t <= 0) return "—";

    const now = Date.now();
    const diffSec = (t - now) / 1000; // future positive, past negative
    const absSec = Math.abs(diffSec);

    // avoid "0s ago" spam
    if (absSec < 2) return "just now";

    const fmt = (n: number, unit: string) => `${n}${unit}`;

    if (absSec < 60) {
        const v = Math.round(absSec);
        return diffSec > 0 ? `in ${fmt(v, "s")}` : `${fmt(v, "s")} ago`;
    }

    const absMin = absSec / 60;
    if (absMin < 60) {
        const v = Math.round(absMin);
        return diffSec > 0 ? `in ${fmt(v, "m")}` : `${fmt(v, "m")} ago`;
    }

    const absHr = absMin / 60;
    if (absHr < 24) {
        const v = Math.round(absHr);
        return diffSec > 0 ? `in ${fmt(v, "h")}` : `${fmt(v, "h")} ago`;
    }

    const absDay = absHr / 24;
    const v = Math.round(absDay);
    return diffSec > 0 ? `in ${fmt(v, "d")}` : `${fmt(v, "d")} ago`;
}

function sideColor(side: SetupSide) {
    return side === "LONG" ? "var(--good)" : "var(--bad)";
}

function statusTone(status: SetupStatus) {
    if (status === "READY") return "ready";
    if (status === "FORMING") return "waiting";
    if (status === "TRIGGERED") return "ready";
    return "blocked";
}

function gradeTone(grade?: string) {
    const g = (grade || "").toUpperCase();
    if (g === "A") return "gradeA";
    if (g === "B") return "gradeB";
    if (g === "C") return "gradeC";
    return "gradeD";
}

function pickActionChip(ex?: ExecutionDecision, status?: SetupStatus) {
    if (!ex) {
        // fallback based on setup status only
        if (status === "READY") return { label: "MONITOR", tone: "chipWait" as const };
        return { label: "MONITOR", tone: "chipWait" as const };
    }

    if (ex.state === "BLOCKED") return { label: "BLOCKED", tone: "chipBad" as const };
    if (ex.canEnterMarket || ex.state === "ENTER_MARKET") return { label: "ENTER NOW", tone: "chipGood" as const };
    if (ex.canPlaceLimit || ex.state === "PLACE_LIMIT") return { label: "PLACE LIMIT", tone: "chipGood" as const };

    // waiting states
    return { label: "MONITOR", tone: "chipWait" as const };
}

function computePriorityScore(s: TradeSetup, dqGrade?: string) {
    // Deterministic priority score 0..100
    const conf = Math.max(0, Math.min(100, s.confidence?.score ?? 0));
    const rr = Number.isFinite(s.rr_min) ? Math.max(0, Math.min(3, s.rr_min)) : 0;
    const rrNorm = rr / 3;

    const grade = (s.confidence?.grade || "D").toUpperCase();
    const gradeMap: Record<string, number> = { A: 1.0, B: 0.82, C: 0.62, D: 0.35 };
    const gradeNorm = gradeMap[grade] ?? 0.35;

    const statusBonus = s.status === "READY" ? 1 : s.status === "FORMING" ? 0.55 : 0.25;

    const dq = (dqGrade || "").toUpperCase();
    const dqMap: Record<string, number> = { A: 1.0, B: 0.9, C: 0.75, D: 0.0 };
    const dqNorm = dqMap[dq] ?? 0.85;

    // weights
    const score =
        0.40 * (conf / 100) +
        0.20 * gradeNorm +
        0.15 * rrNorm +
        0.15 * statusBonus +
        0.10 * dqNorm;

    return Math.round(Math.max(0, Math.min(100, score * 100)));
}

function uniq<T>(arr: T[]) {
    return Array.from(new Set(arr));
}

function SafeBadge({ tone, children }: { tone: string; children: React.ReactNode }) {
    return <span className={`badge ${tone}`}>{children}</span>;
}

function StrengthBar({
    label,
    value01,
    rightText,
    tone,
}: {
    label: string;
    value01?: number;
    rightText?: string;
    tone?: "good" | "warn" | "bad" | "neutral";
}) {
    const v = Number.isFinite(value01 as number) ? clamp01(value01 as number) : undefined;
    const t = tone || "neutral";
    return (
        <div className="barRow">
            <div className="barRowTop">
                <div className="barLabel">{label}</div>
                <div className="barRight">{rightText ?? (v !== undefined ? fmtPct01(v) : "—")}</div>
            </div>
            <div className={`barTrack ${t}`}>
                <div className="barFill" style={{ width: `${v !== undefined ? v * 100 : 0}%` }} />
            </div>
        </div>
    );
}

function ContextStrip({
    features,
    setups,
}: {
    features: any;
    setups: SetupsOutput | null;
}) {
    const bias = features?.bias;
    const ms = features?.market_structure;

    const dq = features?.quality?.dq_grade || "—";
    const biasDir = bias?.trend_dir ? String(bias.trend_dir).toUpperCase() : "—";
    const biasTf = bias?.tf ? String(bias.tf) : "—";
    const strength01 = Number.isFinite(bias?.trend_strength) ? clamp01(bias.trend_strength) : undefined;
    const vol = bias?.vol_regime ? String(bias.vol_regime).toUpperCase() : "—";

    const msRow = (tf: string) => {
        const node = ms?.[tf];
        const bos = node?.lastBOS;
        const choch = node?.lastCHOCH;
        // Display whichever is more recent, if timestamps exist
        const bosTs = bos?.ts;
        const chochTs = choch?.ts;
        let label = "—";
        if (Number.isFinite(bosTs) || Number.isFinite(chochTs)) {
            const pick = (Number.isFinite(bosTs) && Number.isFinite(chochTs))
                ? ((bosTs > chochTs) ? { k: "BOS", e: bos } : { k: "CHOCH", e: choch })
                : (Number.isFinite(bosTs) ? { k: "BOS", e: bos } : { k: "CHOCH", e: choch });
            const dir = pick.e?.dir ? String(pick.e.dir) : "";
            label = `${pick.k} ${dir}`;
        }
        return label;
    };

    const updated = setups?.ts ? relTime(setups.ts) : "—";

    return (
        <div className="contextStrip">
            <div className="contextTop">
                <div className="ctxLeft">
                    <div className="ctxBias">
                        <SafeBadge tone={biasDir === "BULL" ? "good" : biasDir === "BEAR" ? "bad" : "muted"}>
                            {biasDir} • {biasTf}
                        </SafeBadge>
                    </div>
                    <div className="ctxVol">
                        <SafeBadge tone={vol === "HIGH" ? "warn" : vol === "LOW" ? "muted" : "neutral"}>VOL {vol}</SafeBadge>
                    </div>
                    <div className="ctxDQ">
                        <SafeBadge tone={dq === "A" ? "good" : dq === "B" ? "neutral" : dq === "C" ? "warn" : "bad"}>
                            DQ {dq}
                        </SafeBadge>
                    </div>
                    <div className="ctxAlign">
                        {(() => {
                            const a = computeAlignment(features);
                            return (
                                <SafeBadge tone={alignmentTone(a)}>
                                    ALIGN {a}
                                </SafeBadge>
                            );
                        })()}
                    </div>
                </div>

                <div className="ctxRight">
                    <div className="ctxUpdated">Updated {updated}</div>
                </div>
            </div>

            <div className="contextBars">
                <StrengthBar label="Bias strength" value01={strength01} tone={strength01 !== undefined && strength01 >= 0.62 ? "good" : "warn"} />
            </div>

            <div className="contextBottom">
                <div className="ctxMs">
                    <div className="ctxMsItem"><span className="ctxMsTf">4h</span><span className="ctxMsVal">{msRow("4h")}</span></div>
                    <div className="ctxMsItem"><span className="ctxMsTf">1h</span><span className="ctxMsVal">{msRow("1h")}</span></div>
                    <div className="ctxMsItem"><span className="ctxMsTf">15m</span><span className="ctxMsVal">{msRow("15m")}</span></div>
                </div>
            </div>
        </div>
    );
}

function ReadyAlertBanner({
    active,
    text,
    onOpen,
    onDismiss,
}: {
    active: boolean;
    text: string;
    onOpen: () => void;
    onDismiss: () => void;
}) {
    if (!active) return null;
    return (
        <div className="alertBanner" role="alert">
            <button className="alertMain" onClick={onOpen}>
                <div className="alertDot" />
                <div className="alertText">{text}</div>
            </button>
            <button className="alertDismiss" onClick={onDismiss} aria-label="Dismiss">
                ✕
            </button>
        </div>
    );
}

function SetupRow({
    s,
    isSelected,
    onSelect,
    dqGrade,
}: {
    s: TradeSetup;
    isSelected: boolean;
    onSelect: () => void;
    dqGrade?: string;
}) {
    const tone = statusTone(s.status);
    const action = pickActionChip(s.execution, s.status);
    const pri = computePriorityScore(s, dqGrade);

    return (
        <button className={`setupRow ${isSelected ? "selected" : ""}`} onClick={onSelect}>
            <div className="rowLeft">
                <div className="rowTitle">
                    <span className="rowType">{humanizeType(String(s.type))}</span>
                    <span className="rowSide" style={{ color: sideColor(s.side) }}>{s.side}</span>
                </div>
                <div className="rowMeta">
                    <SafeBadge tone={tone === "ready" ? "good" : tone === "waiting" ? "warn" : "bad"}>{s.status}</SafeBadge>
                    <span className={`chip ${action.tone}`}>{action.label}</span>
                    <span className={`badge ${gradeTone(s.confidence?.grade)}`}>GRADE {String(s.confidence?.grade || "—").toUpperCase()}</span>
                </div>
                <div className="rowSub">
                    <span className="muted">Conf {fmtScore100(s.confidence?.score)}</span>
                    <span className="dot">•</span>
                    <span className="muted">RR {Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"}</span>
                    <span className="dot">•</span>
                    <span className="muted">Priority {pri}</span>
                </div>
            </div>
            <div className="rowRight">
                <div className="rowArrow">›</div>
            </div>
        </button>
    );
}

function SetupDetail({
    s,
    features,
}: {
    s: TradeSetup;
    features: any;
}) {
    const action = pickActionChip(s.execution, s.status);

    const entry = s.entry;
    const stop = s.stop?.price;
    const tp1 = s.tp?.[0]?.price;

    // Derive some meters (best-effort, no guessing):
    const biasStrength01 = Number.isFinite(features?.bias?.trend_strength) ? clamp01(features.bias.trend_strength) : undefined;

    const of = features?.orderflow;
    const deltaNorm01 = Number.isFinite(of?.delta?.delta_norm) ? clamp01((of.delta.delta_norm + 1) / 2) : undefined; // map [-1..1] => [0..1]
    const divScore01 = Number.isFinite(of?.delta?.divergence_score) ? clamp01(of.delta.divergence_score) : undefined;
    const absScore01 = Number.isFinite(of?.delta?.absorption_score) ? clamp01(of.delta.absorption_score) : undefined;

    const cross = features?.cross;
    const consensus01 = Number.isFinite(cross?.consensus_score) ? clamp01(cross.consensus_score) : undefined;

    const conf01 = Number.isFinite(s.confidence?.score) ? clamp01(s.confidence.score / 100) : undefined;

    const rr01 = Number.isFinite(s.rr_min) ? clamp01(Math.min(3, Math.max(0, s.rr_min)) / 3) : undefined;

    const blockers = s.execution?.blockers || [];
    const reason = s.execution?.reason || "";

    const checklist = entry?.trigger?.checklist || [];

    return (
        <div className="detail">
            <div className="detailHeader">
                <div className="detailHeaderLeft">
                    <div className="detailTitle">
                        <div className="detailType">{humanizeType(String(s.type))}</div>
                        <div className="detailSide" style={{ color: sideColor(s.side) }}>{s.side}</div>
                    </div>
                    <div className="detailBadges">
                        <SafeBadge tone={statusTone(s.status) === "ready" ? "good" : statusTone(s.status) === "waiting" ? "warn" : "bad"}>
                            {s.status}
                        </SafeBadge>
                        <span className={`chip ${action.tone}`}>{action.label}</span>
                        <span className={`badge ${gradeTone(s.confidence?.grade)}`}>GRADE {String(s.confidence?.grade || "—").toUpperCase()}</span>
                    </div>
                    {(() => {
                        const a = computeAlignment(features);
                        return (
                            <SafeBadge tone={alignmentTone(a)}>
                                ALIGN {a}
                            </SafeBadge>
                        );
                    })()}
                    <div className="detailMeta muted">
                        {(() => {
                            const created = relTime(s.created_ts);
                            const expiresOk = Number.isFinite(s.expires_ts) && Number.isFinite(s.created_ts) && s.expires_ts > s.created_ts + 5_000;
                            const expires = expiresOk ? relTime(s.expires_ts) : "n/a";
                            return (
                                <>
                                    Created {created} • Expires {expires}
                                </>
                            );
                        })()}
                    </div>
                </div>

                <div className="detailHeaderRight">
                    <button
                        className="btn primary"
                        onClick={() => {
                            const lines = [
                                `SETUP ${String(s.type)} ${s.side}`,
                                `Status: ${s.status}`,
                                `Action: ${action.label}`,
                                `Entry: ${entry?.mode} zone ${fmtPx(entry?.zone?.lo)} - ${fmtPx(entry?.zone?.hi)}`,
                                `Stop: ${fmtPx(stop)}`,
                                `TP1: ${fmtPx(tp1)}`,
                                `RR(min): ${Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"}`,
                                `Confidence: ${fmtScore100(s.confidence?.score)} (Grade ${String(s.confidence?.grade || "—").toUpperCase()})`,
                                reason ? `Reason: ${reason}` : "",
                                blockers.length ? `Blockers: ${blockers.join(", ")}` : "",
                            ].filter(Boolean);
                            navigator.clipboard?.writeText(lines.join("\n"));
                        }}
                    >
                        Copy plan
                    </button>
                </div>
            </div>

            <div className="panelGrid">
                <div className="panel">
                    <div className="panelTitle">Execution</div>

                    <div className="kv">
                        <div className="kvRow">
                            <div className="k">Entry mode</div>
                            <div className="v">{entry?.mode || "—"}</div>
                        </div>
                        <div className="kvRow">
                            <div className="k">Entry zone</div>
                            <div className="v">{fmtPx(entry?.zone?.lo)} — {fmtPx(entry?.zone?.hi)}</div>
                        </div>
                        <div className="kvRow">
                            <div className="k">Stop</div>
                            <div className="v">{fmtPx(stop)}</div>
                        </div>
                        <div className="kvRow">
                            <div className="k">Targets</div>
                            <div className="v">
                                {(s.tp || []).slice(0, 3).map((t, i) => (
                                    <span key={i} className="pill">
                                        TP{i + 1} {fmtPx(t.price)} ({t.size_pct}%)
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="kvRow">
                            <div className="k">RR (min / est)</div>
                            <div className="v">
                                <span className="pill">Min {Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"}</span>
                                <span className="pill">Est {Number.isFinite(s.rr_est) ? s.rr_est.toFixed(2) : "—"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="divider" />

                    <div className="panelTitle">Operator guidance</div>
                    <div className="guidance">
                        <div className="guidanceLine">{reason || entry?.trigger?.summary || "—"}</div>
                        {blockers.length > 0 && (
                            <div className="guidanceBlockers">
                                <div className="mutedSmall">Waiting for / Blocked by:</div>
                                <div className="pillRow">
                                    {blockers.map((b) => (
                                        <span key={b} className="pill warn">{b}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="panel">
                    <div className="panelTitle">Strength meters</div>
                    <StrengthBar label="Confidence" value01={conf01} tone={conf01 !== undefined && conf01 >= 0.7 ? "good" : "warn"} rightText={fmtScore100(s.confidence?.score)} />
                    <StrengthBar label="RR quality" value01={rr01} tone={rr01 !== undefined && rr01 >= 0.5 ? "good" : "warn"} rightText={Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"} />
                    <StrengthBar label="Bias strength" value01={biasStrength01} tone={biasStrength01 !== undefined && biasStrength01 >= 0.62 ? "good" : "warn"} />
                    <StrengthBar label="Delta alignment" value01={deltaNorm01} tone="neutral" rightText={Number.isFinite(of?.delta?.delta_norm) ? of.delta.delta_norm.toFixed(2) : "—"} />
                    <StrengthBar label="Divergence signal" value01={divScore01} tone={divScore01 !== undefined && divScore01 >= 0.65 ? "good" : "neutral"} />
                    <StrengthBar label="Absorption signal" value01={absScore01} tone={absScore01 !== undefined && absScore01 >= 0.65 ? "good" : "neutral"} />
                    <StrengthBar label="Cross consensus" value01={consensus01} tone={consensus01 !== undefined && consensus01 >= 0.65 ? "good" : consensus01 !== undefined && consensus01 <= 0.35 ? "warn" : "neutral"} rightText={consensus01 !== undefined ? fmtPct01(consensus01) : "—"} />
                </div>
            </div>

            <div className="panel">
                <div className="panelTitle">Checklist</div>
                {checklist.length === 0 ? (
                    <div className="muted">—</div>
                ) : (
                    <div className="checklist">
                        {checklist.map((c) => (
                            <div key={c.key} className={`checkItem ${c.ok ? "ok" : "no"}`}>
                                <div className="checkIcon">{c.ok ? "✓" : "•"}</div>
                                <div className="checkBody">
                                    <div className="checkKey">{c.key}</div>
                                    <div className="checkNote">{c.note || ""}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="panel">
                <div className="panelTitle">Reasons</div>
                <div className="pillRow">
                    {(s.confidence?.reasons || []).slice(0, 12).map((r, i) => (
                        <span key={i} className="pill">{r}</span>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function SetupsRadarScreen() {
    // Symbol control: simple, deterministic, mobile-friendly.
    const [symbol, setSymbol] = useState<string>(() => {
        const saved = typeof window !== "undefined" ? window.localStorage.getItem("su2_symbol") : null;
        return saved || "BTCUSDT";
    });

    const { snap, features, setups } = useSetupsSnapshot(symbol);
    const out = (setups as unknown as SetupsOutput | null) ?? null;

    // selected setup
    const dqGrade = features?.quality?.dq_grade;
    const ranked = useMemo(() => {
        const arr = out?.setups || [];
        return [...arr].sort((a, b) => {
            const pa = computePriorityScore(a, dqGrade);
            const pb = computePriorityScore(b, dqGrade);
            if (pa !== pb) return pb - pa;
            return (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0);
        });
    }, [out?.setups, dqGrade]);

    const preferred = useMemo(() => {
        const byId = new Map<string, TradeSetup>();
        for (const s of ranked) byId.set(s.id, s);
        const p = out?.preferred_id ? byId.get(out.preferred_id) : undefined;
        return p || ranked[0] || null;
    }, [ranked, out?.preferred_id]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => {
        if (!selectedId && preferred?.id) setSelectedId(preferred.id);
    }, [preferred?.id, selectedId]);

    const selected = useMemo(() => {
        if (!selectedId) return preferred;
        return ranked.find((x) => x.id === selectedId) || preferred;
    }, [ranked, selectedId, preferred]);

    // Strong alert: detect new READY setup ids
    const readyIds = useMemo(() => {
        return uniq((out?.setups || []).filter((s) => s.status === "READY").map((s) => s.id));
    }, [out?.setups]);

    const prevReadyRef = useRef<string[]>([]);
    const [banner, setBanner] = useState<{ active: boolean; text: string }>({ active: false, text: "" });

    useEffect(() => {
        const prev = prevReadyRef.current;
        const now = readyIds;
        prevReadyRef.current = now;

        // new ready detected
        const newOnes = now.filter((id) => !prev.includes(id));
        if (newOnes.length > 0) {
            const s = (out?.setups || []).find((x) => x.id === newOnes[0]);
            const text = s
                ? `READY: ${symbol} • ${humanizeType(String(s.type))} • ${s.side} • RR ${Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"} • Conf ${fmtScore100(s.confidence?.score)}`
                : `READY setup detected`;

            setBanner({ active: true, text });

            // Strong attention: haptic if available
            try {
                if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
            } catch {
                // ignore
            }
        } else {
            // If still have ready setups, keep a calm banner on (optional)
            if (now.length > 0 && !banner.active) {
                const s = preferred;
                if (s && s.status === "READY") {
                    setBanner({
                        active: true,
                        text: `READY: ${symbol} • ${humanizeType(String(s.type))} • ${s.side} • RR ${Number.isFinite(s.rr_min) ? s.rr_min.toFixed(2) : "—"} • Conf ${fmtScore100(s.confidence?.score)}`,
                    });
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readyIds.join("|")]);

    useEffect(() => {
        if (typeof window !== "undefined") window.localStorage.setItem("su2_symbol", symbol);
    }, [symbol]);

    const dqOk = out?.dq_ok !== false && (dqGrade === "A" || dqGrade === "B" || dqGrade === "C");
    const globalBlocked = !dqOk;

    return (
        <div className="app">
            <style>{css}</style>

            <div className="topBar">
                <div className="brand">
                    <div className="brandTitle">SU2 Setups</div>
                    <div className="brandSub muted">Action-first signal console</div>
                </div>

                <div className="symbolBox">
                    <label className="label">Symbol</label>
                    <input
                        className="symbolInput"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase().trim())}
                        placeholder="BTCUSDT"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </div>
            </div>

            <ReadyAlertBanner
                active={banner.active}
                text={banner.text}
                onOpen={() => {
                    if (preferred?.id) setSelectedId(preferred.id);
                    setBanner((b) => ({ ...b, active: false }));
                }}
                onDismiss={() => setBanner((b) => ({ ...b, active: false }))}
            />

            <div className="main">
                <div className="left">
                    <ContextStrip features={features} setups={out} />

                    {globalBlocked ? (
                        <div className="blockedPanel">
                            <div className="blockedTitle">Trading blocked</div>
                            <div className="blockedBody">
                                Data quality gate is not OK. Current DQ: <b>{String(dqGrade || "—")}</b>.
                            </div>
                            <div className="mutedSmall">
                                When DQ is D, the setup engine intentionally returns no actionable setups.
                            </div>
                        </div>
                    ) : (
                        <div className="queue">
                            <div className="sectionTitle">Setup queue</div>
                            {ranked.length === 0 ? (
                                <div className="empty">
                                    <div className="emptyTitle">No setups</div>
                                    <div className="muted">Either the market has no valid patterns or data is incomplete.</div>
                                </div>
                            ) : (
                                <div className="rows">
                                    {ranked.map((s) => (
                                        <SetupRow
                                            key={s.id}
                                            s={s}
                                            dqGrade={dqGrade}
                                            isSelected={selected?.id === s.id}
                                            onSelect={() => setSelectedId(s.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="right">
                    <div className="sectionTitle">Selected setup</div>
                    {!selected ? (
                        <div className="empty">
                            <div className="emptyTitle">No selection</div>
                            <div className="muted">Waiting for setups…</div>
                        </div>
                    ) : (
                        <SetupDetail s={selected} features={features} />
                    )}
                </div>
            </div>
        </div>
    );
}

const css = `
:root{
  --bg: #0b0e14;
  --panel: #101625;
  --panel2:#0f1421;
  --text:#e8eefc;
  --muted:#97a6c5;
  --border:#1f2a44;
  --good:#21c087;
  --warn:#ffcc66;
  --bad:#ff5c7a;
  --accent:#5aa7ff;
  --shadow: rgba(0,0,0,0.25);
}

*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial}
button,input{font:inherit}

.app{min-height:100vh;padding:12px 12px 18px;max-width:1200px;margin:0 auto}
.muted{color:var(--muted)}
.mutedSmall{color:var(--muted);font-size:12px}
.dot{margin:0 6px;color:var(--muted)}
.label{font-size:12px;color:var(--muted);margin-bottom:6px;display:block}

.topBar{
  display:flex;gap:12px;align-items:flex-end;justify-content:space-between;
  padding:10px 12px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg, rgba(90,167,255,0.08), rgba(16,22,37,0.0));
  box-shadow: 0 10px 30px var(--shadow);
}
.brandTitle{font-weight:700;letter-spacing:0.2px}
.brandSub{font-size:12px;margin-top:2px}
.symbolBox{min-width:180px}
.symbolInput{
  width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);
  background:var(--panel2);color:var(--text);outline:none
}
.symbolInput:focus{border-color: rgba(90,167,255,0.6);box-shadow:0 0 0 3px rgba(90,167,255,0.12)}

.alertBanner{
  margin-top:10px;
  display:flex;align-items:center;justify-content:space-between;
  border-radius:14px;border:1px solid rgba(33,192,135,0.35);
  background:linear-gradient(180deg, rgba(33,192,135,0.18), rgba(16,22,37,0.0));
  box-shadow: 0 10px 28px var(--shadow);
}
.alertMain{flex:1;display:flex;gap:10px;align-items:center;padding:12px 14px;background:transparent;border:0;color:var(--text);cursor:pointer;text-align:left}
.alertDot{width:10px;height:10px;border-radius:999px;background:var(--good);box-shadow:0 0 0 4px rgba(33,192,135,0.15)}
.alertText{font-weight:650}
.alertDismiss{border:0;background:transparent;color:var(--muted);padding:12px 14px;cursor:pointer}

.main{
  margin-top:10px;
  display:grid;gap:12px;
  grid-template-columns: 1fr;
}
@media (min-width: 900px){
  .main{grid-template-columns: 380px 1fr;}
}

.sectionTitle{
  font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.12em;
  margin:8px 2px 8px;
}

.contextStrip{
  padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--panel);
  box-shadow: 0 10px 30px var(--shadow);
}
.contextTop{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ctxLeft{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ctxRight{color:var(--muted);font-size:12px}
.contextBars{margin-top:10px}
.contextBottom{margin-top:10px}
.ctxMs{display:flex;gap:10px;flex-wrap:wrap}
.ctxMsItem{display:flex;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:999px;background:var(--panel2)}
.ctxMsTf{color:var(--muted);font-size:12px}
.ctxMsVal{font-size:12px}

.badge{
  display:inline-flex;align-items:center;gap:6px;
  padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--panel2);
  font-size:12px;font-weight:650;
}
.badge.good{border-color:rgba(33,192,135,0.35);background:rgba(33,192,135,0.10)}
.badge.warn{border-color:rgba(255,204,102,0.35);background:rgba(255,204,102,0.10)}
.badge.bad{border-color:rgba(255,92,122,0.35);background:rgba(255,92,122,0.10)}
.badge.neutral{border-color:rgba(90,167,255,0.35);background:rgba(90,167,255,0.10)}
.badge.muted{opacity:0.85}

.badge.gradeA{border-color:rgba(33,192,135,0.35);background:rgba(33,192,135,0.10)}
.badge.gradeB{border-color:rgba(90,167,255,0.35);background:rgba(90,167,255,0.10)}
.badge.gradeC{border-color:rgba(255,204,102,0.35);background:rgba(255,204,102,0.10)}
.badge.gradeD{border-color:rgba(255,92,122,0.35);background:rgba(255,92,122,0.10)}

.queue{
  margin-top:12px;
  padding:10px;border:1px solid var(--border);border-radius:14px;background:var(--panel);
  box-shadow: 0 10px 30px var(--shadow);
}
.rows{display:flex;flex-direction:column;gap:8px}
.setupRow{
  width:100%;
  display:flex;align-items:stretch;justify-content:space-between;gap:10px;
  padding:12px;border-radius:14px;border:1px solid var(--border);background:var(--panel2);
  cursor:pointer;text-align:left;
}
.setupRow:hover{border-color:rgba(90,167,255,0.35)}
.setupRow.selected{border-color:rgba(90,167,255,0.65);box-shadow:0 0 0 3px rgba(90,167,255,0.12)}
.rowLeft{flex:1}
.rowTitle{display:flex;gap:10px;align-items:baseline}
.rowType{font-weight:750}
.rowSide{font-weight:800}
.rowMeta{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rowSub{margin-top:8px;font-size:12px}
.rowRight{display:flex;align-items:center}
.rowArrow{color:var(--muted);font-size:18px}

.chip{
  display:inline-flex;align-items:center;justify-content:center;
  padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.04em;
  border:1px solid var(--border);background:var(--panel2);
}
.chipGood{border-color:rgba(33,192,135,0.5);background:rgba(33,192,135,0.12)}
.chipWait{border-color:rgba(255,204,102,0.5);background:rgba(255,204,102,0.10)}
.chipBad{border-color:rgba(255,92,122,0.5);background:rgba(255,92,122,0.10)}

.right{
  padding:10px;border:1px solid var(--border);border-radius:14px;background:var(--panel);
  box-shadow: 0 10px 30px var(--shadow);
}

.detail{display:flex;flex-direction:column;gap:12px}
.detailHeader{
  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--panel2);
}
.detailTitle{display:flex;gap:10px;align-items:baseline}
.detailType{font-weight:850}
.detailSide{font-weight:900}
.detailBadges{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.detailMeta{margin-top:8px;font-size:12px}
.btn{
  padding:10px 12px;border-radius:12px;border:1px solid var(--border);
  background:var(--panel2);color:var(--text);cursor:pointer;font-weight:750
}
.btn:hover{border-color:rgba(90,167,255,0.35)}
.btn.primary{border-color:rgba(90,167,255,0.6);background:rgba(90,167,255,0.12)}
.btn.primary:hover{border-color:rgba(90,167,255,0.8)}

.panelGrid{display:grid;gap:12px;grid-template-columns: 1fr}
@media (min-width: 900px){
  .panelGrid{grid-template-columns: 1.1fr 0.9fr}
}
.panel{
  padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--panel2);
}
.panelTitle{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px}
.divider{height:1px;background:var(--border);margin:12px 0}

.kv{display:flex;flex-direction:column;gap:10px}
.kvRow{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
.k{color:var(--muted);font-size:12px;min-width:110px}
.v{font-size:13px;text-align:right;flex:1}

.pillRow{display:flex;flex-wrap:wrap;gap:8px}
.pill{
  display:inline-flex;align-items:center;gap:8px;
  padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,0.03);
  font-size:12px;
}
.pill.warn{border-color:rgba(255,204,102,0.4);background:rgba(255,204,102,0.08)}

.guidanceLine{font-weight:650;line-height:1.35}
.guidanceBlockers{margin-top:10px}

.barRow{margin-bottom:10px}
.barRowTop{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.barLabel{font-size:12px;color:var(--muted)}
.barRight{font-size:12px}
.barTrack{
  height:10px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,0.03);overflow:hidden
}
.barFill{height:100%;background:var(--accent)}
.barTrack.good .barFill{background:var(--good)}
.barTrack.warn .barFill{background:var(--warn)}
.barTrack.bad .barFill{background:var(--bad)}
.barTrack.neutral .barFill{background:var(--accent)}

.checklist{display:flex;flex-direction:column;gap:8px}
.checkItem{
  display:flex;gap:10px;align-items:flex-start;
  padding:10px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,0.02)
}
.checkItem.ok{border-color:rgba(33,192,135,0.35)}
.checkItem.no{border-color:rgba(255,204,102,0.28)}
.checkIcon{width:22px;height:22px;border-radius:999px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--border);background:rgba(255,255,255,0.03);font-weight:900
}
.checkItem.ok .checkIcon{border-color:rgba(33,192,135,0.45);background:rgba(33,192,135,0.10)}
.checkBody{flex:1}
.checkKey{font-weight:750}
.checkNote{margin-top:2px;color:var(--muted);font-size:12px;line-height:1.3}

.empty{padding:14px;border:1px dashed var(--border);border-radius:14px;background:rgba(255,255,255,0.02)}
.emptyTitle{font-weight:750;margin-bottom:6px}

.blockedPanel{
  margin-top:12px;padding:14px;border:1px solid rgba(255,92,122,0.35);border-radius:14px;
  background:linear-gradient(180deg, rgba(255,92,122,0.14), rgba(16,22,37,0));
}
.blockedTitle{font-weight:850}
.blockedBody{margin-top:8px;line-height:1.35}
`;
