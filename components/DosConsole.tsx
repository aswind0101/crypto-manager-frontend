import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";

type AnyObj = any;

const mono =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

const styles: Record<string, React.CSSProperties> = {
  screen: {
    background: "#050505",
    color: "#cfe9cf",
    fontFamily: mono,
    minHeight: "100vh",
    padding: 14,
  },
  frame: {
    border: "1px solid #1f3b1f",
    borderRadius: 10,
    overflow: "hidden",
    boxShadow: "0 0 0 1px #0a140a inset",
  },
  header: {
    padding: "10px 12px",
    borderBottom: "1px solid #1f3b1f",
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    background: "#070a07",
  },
  title: { fontWeight: 900, letterSpacing: 0.6 },
  left: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  right: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  input: {
    width: 140,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #2a532a",
    background: "#020302",
    color: "#cfe9cf",
    outline: "none",
    fontFamily: mono,
  },
  btn: {
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid #2a532a",
    background: "#081008",
    color: "#cfe9cf",
    cursor: "pointer",
    fontFamily: mono,
    fontWeight: 800,
  },
  btnDanger: {
    borderColor: "#6b2b2b",
    background: "#140808",
  },
  btnActive: {
    background: "#0c1b0c",
    boxShadow: "0 0 0 1px #2a532a inset",
  },
  chip: {
    padding: "3px 10px",
    border: "1px solid #2a532a",
    borderRadius: 999,
    background: "#020302",
    fontSize: 12,
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    whiteSpace: "nowrap",
  },
  chipDim: { opacity: 0.75 },
  body: { display: "grid", gridTemplateColumns: "420px 1fr", gap: 10, padding: 12 },
  panel: { border: "1px solid #1f3b1f", borderRadius: 10, overflow: "hidden", background: "#050705" },
  panelHead: { padding: "8px 10px", borderBottom: "1px solid #1f3b1f", background: "#070a07", fontWeight: 900 },
  panelBody: { padding: 10 },
  hr: { borderTop: "1px dashed #1f3b1f", margin: "10px 0" },
  line: { display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  k: { opacity: 0.85 },
  v: { fontWeight: 800 },
  list: { border: "1px solid #1f3b1f", borderRadius: 10, overflow: "hidden", background: "#040604" },
  listHead: { padding: "8px 10px", borderBottom: "1px solid #1f3b1f", background: "#070a07", fontWeight: 900 },
  row: {
    padding: "7px 10px",
    borderBottom: "1px solid #0d170d",
    cursor: "pointer",
    display: "grid",
    gridTemplateColumns: "26px 1fr",
    gap: 8,
    alignItems: "baseline",
  },
  rowLast: { borderBottom: "none" },
  rowSelected: { background: "#0b170b" },
  rowPreferred: { background: "#102010" },
  rowDim: { opacity: 0.65 },
  marker: { fontWeight: 900 },
  mono: { fontFamily: mono },
  reverse: { background: "#cfe9cf", color: "#061006", padding: "0 6px", borderRadius: 6, fontWeight: 900 },
  ok: { color: "#86efac" },
  warn: { color: "#fde68a" },
  bad: { color: "#fca5a5" },
  small: { fontSize: 12, opacity: 0.9 },
  pre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 1.45,
    margin: 0,
  },
};

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

function triggerProgress(s: AnyObj) {
  const checklist = Array.isArray(s?.entry?.trigger?.checklist) ? s.entry.trigger.checklist : [];
  const total = checklist.length || 0;
  const ok = checklist.filter((x: AnyObj) => x?.ok === true).length;
  return { ok, total, pct: total ? ok / total : 0, checklist };
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

function Pipeline({ stage }: { stage: number }) {
  // 0 none, 1 fetch, 2 normalize, 3 features, 4 setups, 5 done
  const steps = [
    { name: "FETCH", idx: 1 },
    { name: "NORMALIZE", idx: 2 },
    { name: "FEATURES", idx: 3 },
    { name: "SETUPS", idx: 4 },
    { name: "DONE", idx: 5 },
  ];
  return (
    <div style={{ ...styles.chip, ...styles.chipDim }}>
      <span>PIPELINE</span>
      <span style={styles.mono}>
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

function AnalysisSession({
  symbol,
  paused,
  onSelectCount,
}: {
  symbol: string;
  paused: boolean;
  onSelectCount?: (n: number) => void;
}) {
  const { snap, features, setups } = useSetupsSnapshot(symbol);

  // freeze view when paused
  const [view, setView] = useState<{ snap: AnyObj | null; features: AnyObj | null; setups: AnyObj | null }>({
    snap: null,
    features: null,
    setups: null,
  });

  useEffect(() => {
    if (paused) return;
    setView({ snap: snap ?? null, features: features ?? null, setups: setups ?? null });
  }, [paused, snap, features, setups]);

  const vSnap = paused ? view.snap : snap;
  const vFeat = paused ? view.features : features;
  const vSet = paused ? view.setups : setups;

  const dq = String(vFeat?.quality?.dq_grade ?? "—");
  const dqOk = Boolean(vSet?.dq_ok ?? vFeat?.quality?.dq_ok);
  const bybitOk = Boolean(vFeat?.quality?.bybit_ok);
  const binanceOk = Boolean(vFeat?.quality?.binance_ok);

  const mid = Number(vSnap?.price?.mid ?? vSnap?.price?.last);
  const dev = vFeat?.cross?.deviation_bps ?? vFeat?.cross?.dev_bps;

  const stage =
    !vSnap ? 1 : !vFeat ? 2 : !vSet ? 3 : Array.isArray(vSet?.setups) ? 5 : 4;

  const rows: AnyObj[] = useMemo(() => {
    const arr = (vSet?.setups ?? []) as AnyObj[];
    // sort by priority_score then confidence
    return [...arr].sort((a, b) => {
      const pa = Number(a?.priority_score ?? -1);
      const pb = Number(b?.priority_score ?? -1);
      if (pb !== pa) return pb - pa;
      const ca = Number(a?.confidence?.score ?? -1);
      const cb = Number(b?.confidence?.score ?? -1);
      return cb - ca;
    });
  }, [vSet]);

  useEffect(() => onSelectCount?.(rows.length), [rows.length, onSelectCount]);

  const preferredId = vSet?.preferred_id;

  // selection state (by index)
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState(true);

  // when rows change, clamp selection
  useEffect(() => {
    setIdx((cur) => clamp(cur, 0, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const selected = rows[idx] ?? null;

  const scan15 = marketScan(vFeat, "15m");
  const scan1h = marketScan(vFeat, "1h");
  const scan4h = marketScan(vFeat, "4h");
  const scan1d = marketScan(vFeat, "1d");

  // hotkeys inside session
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // avoid interfering with input typing: if focus on input, skip
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

  return (
    <>
      {/* status line */}
      <div style={{ ...styles.chip, ...styles.chipDim }}>
        <span>FEEDS</span>
        <span style={bybitOk ? styles.ok : styles.bad}>BYBIT:{bybitOk ? "OK" : "DOWN"}</span>
        <span style={binanceOk ? styles.ok : styles.warn}>BINANCE:{binanceOk ? "OK" : "DOWN"}</span>
        <span>
          DQ:<span style={{ fontWeight: 900 }}>{dq}</span> {dqOk ? "" : "(GATED)"}
        </span>
        <span>
          MID:<span style={{ fontWeight: 900 }}>{Number.isFinite(mid) ? fmt(mid, 2) : "—"}</span>
        </span>
        <span>
          DEV:<span style={{ fontWeight: 900 }}>{Number.isFinite(Number(dev)) ? `${Number(dev).toFixed(1)}bps` : "—"}</span>
        </span>
        <span>TS:{vSnap?.ts ? new Date(vSnap.ts).toLocaleTimeString() : "—"}</span>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Pipeline stage={stage} />
        <div style={{ ...styles.chip, ...styles.chipDim }}>
          <span>SETUPS</span>
          <span style={styles.mono}>
            {Array.isArray(rows) ? `${rows.length}` : "—"}{" "}
            {preferredId ? `preferred=${preferredId}` : ""}
          </span>
        </div>
      </div>

      <div style={styles.body}>
        {/* LEFT: outlook */}
        <div style={styles.panel}>
          <div style={styles.panelHead}>MARKET OUTLOOK (SCAN)</div>
          <div style={styles.panelBody}>
            <div style={styles.small}>
              <div style={styles.line}>
                <span style={styles.k}>15m</span>
                <span style={styles.v}>
                  {scan15.trend} | H {fmt(scan15.sH, 2)} L {fmt(scan15.sL, 2)}
                </span>
              </div>
              <div style={styles.line}>
                <span style={styles.k}>1h</span>
                <span style={styles.v}>
                  {scan1h.trend} | {scan1h.fl}
                </span>
              </div>
              <div style={styles.line}>
                <span style={styles.k}>4h</span>
                <span style={styles.v}>
                  {scan4h.trend} | {scan4h.fl}
                </span>
              </div>
              <div style={styles.line}>
                <span style={styles.k}>1d</span>
                <span style={styles.v}>
                  {scan1d.trend} | {scan1d.fl}
                </span>
              </div>
            </div>

            <div style={styles.hr} />

            <div style={styles.small}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Key Signals</div>
              <pre style={styles.pre}>
{`15m BOS:   ${scan15.bos}
15m CHOCH: ${scan15.choch}
15m SWEEP: ${scan15.sweep}

1h  BOS:   ${scan1h.bos}
1h  CHOCH: ${scan1h.choch}
1h  SWEEP: ${scan1h.sweep}`}
              </pre>
            </div>
          </div>
        </div>

        {/* RIGHT: setup feed + details */}
        <div>
          <div style={styles.list}>
            <div style={styles.listHead}>SETUP FEED (SORT=P) — ↑/↓ select, Enter expand</div>

            {(rows.length === 0) ? (
              <div style={{ padding: 12, opacity: 0.9 }}>
                {dqOk ? (
                  <>NO SETUPS (valid). Market context / RR / retest filters blocked candidates.</>
                ) : (
                  <>DQ GATED. Fix feeds / liveness before trusting setups.</>
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
                    style={{
                      ...styles.row,
                      ...(i === rows.length - 1 ? styles.rowLast : {}),
                      ...(isPreferred ? styles.rowPreferred : {}),
                      ...(isSelected ? styles.rowSelected : {}),
                      ...(dead ? styles.rowDim : {}),
                    }}
                    onClick={() => setIdx(i)}
                  >
                    <div style={styles.marker}>{isPreferred ? ">" : " "}</div>
                    <div>
                      <span style={styles.mono}>
                        {String(i + 1).padStart(2, " ")}{" "}
                        <span style={s?.side === "LONG" ? styles.ok : styles.bad}>
                          {String(s?.side ?? "").padEnd(5, " ")}
                        </span>{" "}
                        <span style={{ fontWeight: 900 }}>{typeShort(String(s?.type ?? ""))}</span>{" "}
                        <span style={styles.reverse}>{String(s?.status ?? "").padEnd(9, " ")}</span>{" "}
                        P{String(Math.round(p)).padStart(2, "0")}{" "}
                        C{String(Math.round(c)).padStart(2, "0")}({g}){" "}
                        T{ok}/{total}{" "}
                        {tf}{" "}
                        Δ{distLabel}{" "}
                        RR{fmt(s?.rr_min, 2)}{" "}
                        <span style={{ fontWeight: 900 }}>{act}</span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* details */}
          <div style={{ ...styles.panel, marginTop: 10 }}>
            <div style={styles.panelHead}>SELECTED SETUP DETAILS</div>
            <div style={styles.panelBody}>
              {!selected ? (
                <div style={{ opacity: 0.85 }}>No setup selected.</div>
              ) : (
                <>
                  <div style={styles.small}>
                    <div style={styles.line}>
                      <span style={styles.k}>ID</span>
                      <span style={styles.v}>{String(selected.id ?? "—")}</span>
                    </div>
                    <div style={styles.line}>
                      <span style={styles.k}>TYPE</span>
                      <span style={styles.v}>{String(selected.type ?? "—")}</span>
                    </div>
                    <div style={styles.line}>
                      <span style={styles.k}>TF</span>
                      <span style={styles.v}>
                        {String(selected.bias_tf ?? "—")}→{String(selected.entry_tf ?? "—")}→{String(selected.trigger_tf ?? "—")}
                      </span>
                    </div>
                    <div style={styles.line}>
                      <span style={styles.k}>STATUS</span>
                      <span style={styles.v}>
                        {String(selected.status ?? "—")}{" "}
                        <span style={{ marginLeft: 8 }} />
                        CONFIRMED:{" "}
                        <span style={selected?.entry?.trigger?.confirmed ? styles.ok : styles.warn}>
                          {selected?.entry?.trigger?.confirmed ? "YES" : "NO"}
                        </span>{" "}
                        <span style={{ marginLeft: 8 }} />
                        ACTION: <span style={{ fontWeight: 900 }}>{actionLabel(selected)}</span>
                      </span>
                    </div>
                  </div>

                  <div style={styles.hr} />

                  <div style={styles.small}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>EXECUTION TICKET</div>
                    <pre style={styles.pre}>
{`ENTRY (${String(selected?.entry?.mode ?? "—")}): ${
  selected?.entry?.mode === "LIMIT" && selected?.entry?.zone
    ? `[${fmt(selected.entry.zone.lo, 2)}–${fmt(selected.entry.zone.hi, 2)}]`
    : "—"
}
SL: ${fmt(selected?.stop?.price, 2)} (${String(selected?.stop?.basis ?? "—")})
TP: ${(Array.isArray(selected?.tp) && selected.tp.length)
  ? selected.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ")
  : "—"}
RR(min): ${fmt(selected?.rr_min, 2)}   RR(est): ${fmt(selected?.rr_est, 2)}
PRIORITY: ${Number(selected?.priority_score ?? 0).toFixed(0)}   CONF: ${Number(selected?.confidence?.score ?? 0).toFixed(0)} (${String(selected?.confidence?.grade ?? "—")})`}
                    </pre>
                  </div>

                  <div style={styles.hr} />

                  <div style={styles.small}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      TRIGGER CHECKLIST {expanded ? "(expanded)" : "(collapsed)"}
                    </div>
                    {expanded ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        {triggerProgress(selected).checklist.length ? (
                          triggerProgress(selected).checklist.map((it: AnyObj, i: number) => (
                            <div key={String(it?.key ?? i)} style={{ display: "flex", gap: 10 }}>
                              <span style={it?.ok ? styles.ok : styles.warn}>
                                [{it?.ok ? "OK" : "WAIT"}]
                              </span>
                              <span style={{ minWidth: 120 }}>{String(it?.key ?? "")}</span>
                              <span style={{ opacity: 0.9 }}>{String(it?.note ?? "")}</span>
                            </div>
                          ))
                        ) : (
                          <div style={{ opacity: 0.85 }}>No checklist.</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ opacity: 0.85 }}>
                        Press Enter to expand checklist and confluence.
                      </div>
                    )}
                  </div>

                  {expanded ? (
                    <>
                      <div style={styles.hr} />
                      <div style={styles.small}>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>WHY (CONFLUENCE)</div>
                        {(selected?.confidence?.reasons ?? []).length ? (
                          <pre style={styles.pre}>
{(selected.confidence.reasons as AnyObj[]).slice(0, 12).map((r: AnyObj) => `• ${String(r)}`).join("\n")}
                          </pre>
                        ) : (
                          <div style={{ opacity: 0.85 }}>No reasons provided.</div>
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
  // draft vs committed for Analyze workflow
  const [draftSymbol, setDraftSymbol] = useState("BTCUSDT");
  const [symbol, setSymbol] = useState("BTCUSDT");

  // sessionKey forces full remount => "like fresh load"
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

  // Global hotkeys for console controls (not arrows)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ae = document.activeElement as HTMLElement | null;
      const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");

      // A: analyze (when not typing) / Enter in input handled by input
      if (!typing && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        commitAnalyze();
      }
      // S: stop/resume
      if (!typing && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        stopToggle();
      }
      // R: reset
      if (!typing && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        resetAll();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draftSymbol]);

  return (
    <div style={styles.screen}>
      <div style={styles.frame}>
        <div style={styles.header}>
          <div style={styles.left}>
            <span style={styles.title}>DOS TRADING CONSOLE</span>

            <span style={{ ...styles.chip, ...styles.chipDim }}>
              <span>SYMBOL</span>
              <input
                ref={inputRef}
                style={styles.input}
                value={draftSymbol}
                onChange={(e) => setDraftSymbol(String(e.target.value).toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitAnalyze();
                  }
                }}
                spellCheck={false}
              />
            </span>

            <button style={styles.btn} onClick={commitAnalyze} title="Analyze (A / Enter)">
              ANALYZE
            </button>

            <button
              style={{ ...styles.btn, ...(paused ? styles.btnActive : {}), ...styles.btnDanger }}
              onClick={stopToggle}
              title="Stop/Resume (S)"
            >
              {paused ? "RESUME" : "STOP"}
            </button>

            <button style={styles.btn} onClick={resetAll} title="Reset (R)">
              RESET
            </button>

            <span style={{ ...styles.chip, ...styles.chipDim }}>
              <span>SESSION</span>
              <span style={styles.mono}>#{sessionKey}</span>
            </span>
          </div>

          <div style={styles.right}>
            <span style={{ ...styles.chip, ...styles.chipDim }}>
              <span>MODE</span>
              <span style={styles.mono}>{paused ? "FROZEN" : "LIVE"}</span>
            </span>
            <span style={{ ...styles.chip, ...styles.chipDim }}>
              <span>HOTKEYS</span>
              <span style={styles.mono}>↑↓ select • Enter expand • A analyze • S stop • R reset</span>
            </span>
          </div>
        </div>

        {/* Analysis session remounts on Analyze to simulate fresh load */}
        <div style={{ padding: 12 }}>
          <AnalysisSession key={`${symbol}:${sessionKey}`} symbol={symbol} paused={paused} />
        </div>
      </div>
    </div>
  );
}
