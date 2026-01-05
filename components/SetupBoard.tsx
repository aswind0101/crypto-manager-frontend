import React, { useMemo, useState } from "react";
import type { SetupEngineOutput } from "../lib/feeds/setups/types";

type SnapshotLike = {
  ts?: number;
  canon?: string;
  price?: { mid?: number; last?: number };
};

function fmt(n: any, dp = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(dp);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function bpsDistanceToZone(px: number, z: { lo: number; hi: number }) {
  if (!Number.isFinite(px) || !z || !Number.isFinite(z.lo) || !Number.isFinite(z.hi)) return NaN;
  if (px >= z.lo && px <= z.hi) return 0;
  const ref = px || z.hi || z.lo;
  const dist = px > z.hi ? (px - z.hi) : (z.lo - px);
  return (dist / ref) * 10000;
}

function typeShort(t: string) {
  if (!t) return "—";
  if (t === "LIQUIDITY_SWEEP_REVERSAL") return "LSR";
  if (t === "RANGE_MEAN_REVERT") return "RMR";
  if (t === "TREND_PULLBACK") return "TPB";
  if (t === "BREAKOUT") return "BRK";
  if (t === "FAILED_SWEEP_CONTINUATION") return "FSC";
  return String(t).slice(0, 6).toUpperCase();
}

function actionLabel(s: any) {
  const status = String(s?.status ?? "");
  const mode = String(s?.entry?.mode ?? "");
  const checklist = Array.isArray(s?.entry?.trigger?.checklist) ? s.entry.trigger.checklist : [];
  const hasCloseConfirm = checklist.some((x: any) => String(x?.key ?? "") === "close_confirm");
  const closeOk = checklist.find((x: any) => String(x?.key ?? "") === "close_confirm")?.ok === true;

  if (status === "INVALIDATED") return "INVALID";
  if (status === "EXPIRED") return "EXPIRED";

  if (status === "TRIGGERED") {
    if (mode === "MARKET") return "ENTER NOW (MKT)";
    return "CONFIRMED";
  }

  if (status === "READY") {
    if (hasCloseConfirm && !closeOk) return "WAIT CLOSE";
    if (mode === "LIMIT") return "PLACE LIMIT";
    return "ARMED";
  }

  const next = checklist.find((x: any) => x && x.ok === false);
  if (next?.key) {
    const k = String(next.key);
    if (k === "retest") return "WAIT RETEST";
    if (k === "close_confirm") return "WAIT CLOSE";
    return `WAIT ${k.toUpperCase()}`;
  }
  return "WATCH";
}

function readinessChip(status: string) {
  if (status === "TRIGGERED") return "CONFIRMED";
  if (status === "READY") return "ARMED";
  if (status === "FORMING") return "WAITING";
  return status || "—";
}

function progress(checklist: any[]) {
  const total = checklist.length || 0;
  const ok = checklist.filter((x) => x?.ok === true).length;
  return { ok, total, pct: total ? ok / total : 0 };
}

function barStyle(pct01: number) {
  const w = clamp(Math.round(pct01 * 100), 0, 100);
  return { width: `${w}%` };
}

const styles: Record<string, React.CSSProperties> = {
  panel: { marginTop: 12, border: "1px solid #222", borderRadius: 10, overflow: "hidden" },
  header: {
    padding: "10px 12px",
    borderBottom: "1px solid #222",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    background: "#0b0b0b",
  },
  title: { fontWeight: 700, letterSpacing: 0.2 },
  hint: { opacity: 0.75, fontSize: 12 },
  tableWrap: { width: "100%", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #222", fontWeight: 700, opacity: 0.9, whiteSpace: "nowrap" },
  td: { padding: "8px 10px", borderBottom: "1px solid #151515", verticalAlign: "middle", whiteSpace: "nowrap" },
  row: { cursor: "pointer" },
  rowPreferred: { background: "#10131a" },
  rowDead: { opacity: 0.55 },
  chip: { padding: "2px 8px", border: "1px solid #333", borderRadius: 999, fontSize: 11, display: "inline-flex", gap: 6, alignItems: "center" },
  chipStrong: { borderColor: "#555", background: "#0f0f0f" },
  sideLong: { borderColor: "#1d4ed8" },
  sideShort: { borderColor: "#b91c1c" },
  statusReady: { borderColor: "#0ea5e9" },
  statusTriggered: { borderColor: "#22c55e" },
  statusForming: { borderColor: "#a3a3a3" },
  barOuter: { width: 88, height: 8, border: "1px solid #333", borderRadius: 999, overflow: "hidden", background: "#0a0a0a" },
  barInner: { height: "100%", background: "#666" },
  subRow: { background: "#0a0a0a" },
  subCell: { padding: "10px 12px", borderBottom: "1px solid #222" },
  subGrid: { display: "grid", gap: 10, gridTemplateColumns: "1.1fr 1fr 1fr" },
  box: { border: "1px solid #222", borderRadius: 10, padding: 10, background: "#070707" },
  boxTitle: { fontWeight: 700, marginBottom: 6, fontSize: 12, opacity: 0.9 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
};

function StatusChip({ status }: { status: string }) {
  const s = String(status);
  const extra =
    s === "READY" ? styles.statusReady : s === "TRIGGERED" ? styles.statusTriggered : s === "FORMING" ? styles.statusForming : undefined;
  return <span style={{ ...styles.chip, ...(extra ?? {}) }}>{s || "—"}</span>;
}

function SideTypeChip({ side, type }: { side: string; type: string }) {
  const isLong = String(side) === "LONG";
  const base = { ...styles.chip, ...(isLong ? styles.sideLong : styles.sideShort) };
  return (
    <span style={base}>
      <span style={{ fontWeight: 800 }}>{isLong ? "LONG" : "SHORT"}</span>
      <span style={{ opacity: 0.85 }}>{typeShort(type)}</span>
    </span>
  );
}

function MetricBar({ value, label }: { value: number; label?: string }) {
  const pct = clamp(value / 100, 0, 1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={styles.barOuter}>
        <div style={{ ...styles.barInner, ...barStyle(pct) }} />
      </div>
      <span style={{ ...styles.mono, opacity: 0.85 }}>
        {label ? `${label}:` : ""}
        {Number.isFinite(value) ? value : "—"}
      </span>
    </div>
  );
}

export function SetupBoard({ out, snap }: { out: SetupEngineOutput | null; snap: SnapshotLike | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const mid = Number(snap?.price?.mid ?? snap?.price?.last);
  const rows = useMemo(() => (out?.setups ?? []) as any[], [out]);

  if (!out) return null;

  const noSetups = !rows.length;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Setup Board</div>
          <div style={styles.hint}>
            Sorted by priority. Preferred: <span style={styles.mono}>{out.preferred_id ?? "—"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ ...styles.chip, ...styles.chipStrong }}>
            DQ: <span style={{ ...styles.mono, fontWeight: 800 }}>{out.dq_ok ? "OK" : "GATED"}</span>
          </span>
          <span style={{ ...styles.chip, ...styles.chipStrong }}>
            Mid: <span style={styles.mono}>{Number.isFinite(mid) ? fmt(mid, 2) : "—"}</span>
          </span>
        </div>
      </div>

      {noSetups ? (
        <div style={{ padding: 12, opacity: 0.85 }}>
          No setups (valid). Filters blocked candidates due to RR / structure / retest requirements, or data-quality gating.
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>P</th>
                <th style={styles.th}>C</th>
                <th style={styles.th}>T</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Side/Type</th>
                <th style={styles.th}>TF</th>
                <th style={styles.th}>Entry</th>
                <th style={styles.th}>ΔEntry</th>
                <th style={styles.th}>SL</th>
                <th style={styles.th}>TP</th>
                <th style={styles.th}>RR</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const id = String(s?.id ?? "");
                const isPreferred = out.preferred_id && id === out.preferred_id;
                const isDead = s?.status === "INVALIDATED" || s?.status === "EXPIRED";

                const p = Number(s?.priority_score ?? 0);
                const conf = Number(s?.confidence?.score ?? 0);

                const checklist = Array.isArray(s?.entry?.trigger?.checklist) ? s.entry.trigger.checklist : [];
                const pr = progress(checklist);

                const entryMode = String(s?.entry?.mode ?? "—");
                const z = s?.entry?.zone;
                const lo = Number(z?.lo);
                const hi = Number(z?.hi);

                const distBps = Number.isFinite(mid) && z ? bpsDistanceToZone(mid, z) : NaN;
                const distLabel = !Number.isFinite(distBps) ? "—" : distBps === 0 ? "IN" : `${distBps.toFixed(0)}bps`;

                const tfChain = `${String(s?.bias_tf ?? "—")}→${String(s?.entry_tf ?? "—")}→${String(s?.trigger_tf ?? "—")}`;

                const tpArr = Array.isArray(s?.tp) ? s.tp : [];
                const tp1 = tpArr[0]?.price;
                const tp2 = tpArr[1]?.price;

                const action = actionLabel(s);
                const readyChip = readinessChip(String(s?.status ?? ""));

                const onRow = () => setExpanded((cur) => (cur === id ? null : id));

                return (
                  <React.Fragment key={id || Math.random()}>
                    <tr
                      style={{
                        ...styles.row,
                        ...(isPreferred ? styles.rowPreferred : {}),
                        ...(isDead ? styles.rowDead : {}),
                      }}
                      onClick={onRow}
                    >
                      <td style={styles.td}>
                        <MetricBar value={p} />
                      </td>
                      <td style={styles.td}>
                        <MetricBar value={conf} label={String(s?.confidence?.grade ?? "")} />
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={styles.barOuter}>
                            <div style={{ ...styles.barInner, ...barStyle(pr.pct) }} />
                          </div>
                          <div style={{ ...styles.mono, opacity: 0.8 }}>{`T:${pr.ok}/${pr.total}`}</div>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <StatusChip status={String(s?.status ?? "")} />
                          <span style={{ ...styles.chip, opacity: 0.85 }}>{readyChip}</span>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <SideTypeChip side={String(s?.side ?? "")} type={String(s?.type ?? "")} />
                      </td>
                      <td style={{ ...styles.td, ...styles.mono, opacity: 0.85 }}>{tfChain}</td>
                      <td style={{ ...styles.td, ...styles.mono }}>
                        {entryMode === "LIMIT" && Number.isFinite(lo) && Number.isFinite(hi)
                          ? `LMT [${fmt(lo, 2)}–${fmt(hi, 2)}]`
                          : entryMode === "MARKET"
                          ? "MKT"
                          : "—"}
                      </td>
                      <td style={{ ...styles.td, ...styles.mono, opacity: 0.85 }}>{distLabel}</td>
                      <td style={{ ...styles.td, ...styles.mono }}>{fmt(s?.stop?.price, 2)}</td>
                      <td style={{ ...styles.td, ...styles.mono }}>
                        {fmt(tp1, 2)}
                        {Number.isFinite(Number(tp2)) ? ` | ${fmt(tp2, 2)}` : ""}
                      </td>
                      <td style={{ ...styles.td, ...styles.mono }}>{fmt(s?.rr_min, 2)}</td>
                      <td style={{ ...styles.td, fontWeight: 800 }}>{action}</td>
                    </tr>

                    {expanded === id ? (
                      <tr style={styles.subRow}>
                        <td style={styles.subCell} colSpan={12}>
                          <div style={styles.subGrid}>
                            <div style={styles.box}>
                              <div style={styles.boxTitle}>Trigger Checklist</div>
                              <div style={{ display: "grid", gap: 6 }}>
                                {checklist.length ? (
                                  checklist.map((it: any, i: number) => (
                                    <div
                                      key={String(it?.key ?? i)}
                                      style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                                    >
                                      <span style={{ ...styles.chip, opacity: it?.ok ? 1 : 0.75 }}>
                                        {it?.ok ? "OK" : "WAIT"}
                                      </span>
                                      <span style={{ ...styles.mono, minWidth: 110, opacity: 0.9 }}>
                                        {String(it?.key ?? "")}
                                      </span>
                                      <span style={{ opacity: 0.85 }}>{String(it?.note ?? "")}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div style={{ opacity: 0.75 }}>No checklist available.</div>
                                )}
                              </div>
                            </div>

                            <div style={styles.box}>
                              <div style={styles.boxTitle}>Confluence</div>
                              <div style={{ display: "grid", gap: 6 }}>
                                {(s?.confidence?.reasons ?? []).slice(0, 10).map((r: any, i: number) => (
                                  <div key={i} style={{ opacity: 0.9 }}>
                                    • {String(r)}
                                  </div>
                                ))}
                                {!s?.confidence?.reasons?.length ? (
                                  <div style={{ opacity: 0.75 }}>No reasons provided.</div>
                                ) : null}
                              </div>
                            </div>

                            <div style={styles.box}>
                              <div style={styles.boxTitle}>Execution Ticket</div>
                              <div style={{ display: "grid", gap: 8 }}>
                                <div style={styles.mono}>
                                  Entry:{" "}
                                  {Number.isFinite(lo) && Number.isFinite(hi) ? `[${fmt(lo, 2)}–${fmt(hi, 2)}]` : "—"} ({entryMode})
                                </div>
                                <div style={styles.mono}>
                                  SL: {fmt(s?.stop?.price, 2)} ({String(s?.stop?.basis ?? "—")})
                                </div>
                                <div style={styles.mono}>
                                  TP: {fmt(tp1, 2)}
                                  {Number.isFinite(Number(tp2)) ? ` | ${fmt(tp2, 2)}` : ""}
                                </div>
                                <div style={styles.mono}>
                                  RR(min): {fmt(s?.rr_min, 2)} | RR(est): {fmt(s?.rr_est, 2)}
                                </div>
                                <div style={{ opacity: 0.85 }}>
                                  Priority reasons: {(s?.priority_reasons ?? []).slice(0, 4).join(" • ") || "—"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
