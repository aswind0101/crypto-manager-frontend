import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";

type AnyObj = any;

const UI_MONO =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const UI_SANS =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function fmt(n: any, dp = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(dp);
}
function safeStr(x: any, fallback = "—") {
  const s = String(x ?? "").trim();
  return s ? s : fallback;
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
  const bos = ms?.lastBOS ? `${ms.lastBOS.dir} @ ${fmt(ms.lastBOS.price ?? ms.lastBOS.level, 0)}` : "—";
  const choch = ms?.lastCHOCH ? `${ms.lastCHOCH.dir} @ ${fmt(ms.lastCHOCH.price ?? ms.lastCHOCH.level, 0)}` : "—";
  const sweep = ms?.lastSweep ? `${ms.lastSweep.dir} @ ${fmt(ms.lastSweep.price ?? ms.lastSweep.level, 0)}` : "—";

  const sH = ms?.lastSwingHigh?.price ?? ms?.lastSwingHigh;
  const sL = ms?.lastSwingLow?.price ?? ms?.lastSwingLow;

  const flags = ms?.flags ?? {};
  const fl: string[] = [];
  if (flags.bosUp) fl.push("BOS↑");
  if (flags.bosDown) fl.push("BOS↓");
  if (flags.sweepUp) fl.push("SWP↑");
  if (flags.sweepDown) fl.push("SWP↓");

  return { trend, bos, choch, sweep, sH, sL, fl: fl.length ? fl.join(" ") : "—" };
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
  if (status === "TRIGGERED") return mode === "MARKET" ? "ENTER MARKET (CONFIRMED)" : "TRIGGERED (WAIT EXEC)";
  if (status === "READY") {
    if (hasClose && !closeOk) return "WAIT CLOSE (CONFIRM)";
    return mode === "LIMIT" ? "PLACE LIMIT (ARMED)" : "READY (ARMED)";
  }

  const next = checklist.find((x: AnyObj) => x && x.ok === false);
  if (next?.key) return `WAIT ${String(next.key).toUpperCase()}`;
  return "NO ACTION";
}

async function copyText(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
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
  const side = safeStr(s?.side);
  const type = safeStr(s?.type);
  const status = safeStr(s?.status);
  const tf = `${safeStr(s?.bias_tf)}→${safeStr(s?.entry_tf)}→${safeStr(s?.trigger_tf)}`;
  const mode = safeStr(s?.entry?.mode);
  const z = s?.entry?.zone;
  const entry =
    mode === "LIMIT" && z ? `[${fmt(z.lo, 2)}–${fmt(z.hi, 2)}]` : mode === "MARKET" ? "MARKET" : "—";
  const sl = `${fmt(s?.stop?.price, 2)} (${safeStr(s?.stop?.basis)})`;
  const tps = Array.isArray(s?.tp) && s.tp.length ? s.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ") : "—";
  const rr = `RRmin ${fmt(s?.rr_min, 2)}  RRest ${fmt(s?.rr_est, 2)}`;
  const act = actionLabel(s);

  return [
    `SYMBOL: ${safeStr(s?.canon, "")}`,
    `SIDE: ${side}  TYPE: ${type}  STATUS: ${status}`,
    `TF: ${tf}`,
    `ENTRY (${mode}): ${entry}`,
    `SL: ${sl}`,
    `TP: ${tps}`,
    rr,
    `ACTION: ${act}`,
    `ID: ${safeStr(s?.id, "")}`,
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

/**
 * Virtual list (no libraries):
 * - renders only visible rows + overscan
 * - fixed row height for stable performance (no layout thrash)
 */
function VirtualList({
  items,
  rowHeight,
  height,
  overscan = 6,
  renderRow,
  getKey,
}: {
  items: AnyObj[];
  rowHeight: number;
  height: number;
  overscan?: number;
  getKey: (x: AnyObj, idx: number) => string;
  renderRow: (x: AnyObj, idx: number) => React.ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalH = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  const topPad = start * rowHeight;
  const slice = items.slice(start, end);

  return (
    <div
      className="vlist"
      style={{ height }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: totalH, position: "relative" }}>
        <div style={{ position: "absolute", top: topPad, left: 0, right: 0 }}>
          {slice.map((it, i) => {
            const idx = start + i;
            return (
              <div key={getKey(it, idx)} style={{ height: rowHeight }}>
                {renderRow(it, idx)}
              </div>
            );
          })}
        </div>
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

  // LIVE DATA (but we will only repaint header at low Hz)
  const mid = Number.isFinite(Number(vSnap?.price?.mid))
    ? Number(vSnap.price.mid)
    : (Number.isFinite(Number(vSnap?.price?.bid)) && Number.isFinite(Number(vSnap?.price?.ask)))
      ? (Number(vSnap.price.bid) + Number(vSnap.price.ask)) / 2
      : NaN;

  const dq = safeStr(vFeat?.quality?.dq_grade);
  const dqOk = Boolean(vSet?.dq_ok ?? vFeat?.quality?.dq_ok);
  const bybitOk = Boolean(vFeat?.quality?.bybit_ok);
  const binanceOk = Boolean(vFeat?.quality?.binance_ok);
  const preferredId = vSet?.preferred_id;

  // Realtime tick key (do not setState on it)
  const tickKey = String(vSnap?.price?.ts ?? vSnap?.price?.mid ?? "");

  // refs to avoid React thrash
  const lastActivityMsRef = useRef<number | null>(null);
  const pulseRef = useRef<number>(0);

  useEffect(() => {
    if (paused) return;
    if (!tickKey) return;
    lastActivityMsRef.current = Date.now();
    pulseRef.current += 1;
  }, [paused, tickKey]);

  // UI header clock (2Hz by default) — human-friendly, reduces iOS jitter
  const [uiHeader, setUiHeader] = useState({
    mid: NaN as number,
    staleSec: undefined as number | undefined,
    pulse: 0 as number,
    health: "CONNECTING" as string,
  });

  useEffect(() => {
    if (paused) {
      // keep last header when frozen
      return;
    }
    const id = window.setInterval(() => {
      const now = Date.now();
      const ts = Number(vSnap?.price?.ts);
      const staleSec = Number.isFinite(ts)
        ? (now - ts) / 1000
        : lastActivityMsRef.current != null
          ? (now - lastActivityMsRef.current) / 1000
          : undefined;

      const health =
        !bybitOk ? "BYBIT DOWN" :
        !binanceOk ? "BINANCE DEGRADED" :
        !dqOk ? "DQ GATED" :
        !Number.isFinite(mid) ? "WARMING" :
        "OK";

      setUiHeader({
        mid,
        staleSec,
        pulse: pulseRef.current,
        health,
      });
    }, 500); // 2Hz: near-zero jitter on iOS
    return () => window.clearInterval(id);
  }, [paused, vSnap?.price?.ts, bybitOk, binanceOk, dqOk, mid]);

  const scan15 = marketScan(vFeat, "15m");
  const scan1h = marketScan(vFeat, "1h");
  const scan4h = marketScan(vFeat, "4h");
  const scan1d = marketScan(vFeat, "1d");

  // rows
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

  // UX selection
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSig, setSelectedSig] = useState<string | null>(null);
  const [detailModel, setDetailModel] = useState<AnyObj | null>(null);

  // filters/pin
  const [statusFilter, setStatusFilter] = useState<"ALL" | "FORMING" | "READY" | "TRIGGERED" | "DEAD">("ALL");
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [pinned, setPinned] = useState<Record<string, boolean>>({});

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

    // pinned first
    out = [...out].sort((a, b) => {
      const pa = pinned[String(a.__uiKey)] ? 1 : 0;
      const pb = pinned[String(b.__uiKey)] ? 1 : 0;
      if (pb !== pa) return pb - pa;
      return 0;
    });

    return out;
  }, [allRows, pinned, statusFilter, showPinnedOnly]);

  const selected = useMemo(() => {
    if (!rows.length) return null;
    if (selectedId) return rows.find((x: AnyObj) => String(x?.__uiKey ?? "") === selectedId) ?? rows[0];
    return rows[0];
  }, [rows, selectedId]);

  const selectedKey = selected ? String(selected.__uiKey ?? "") : "";

  // rebind selection by sig if key changes across ticks
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

  // freeze details only when selection changes
  useEffect(() => {
    if (!selected) {
      setDetailModel(null);
      return;
    }
    setDetailModel(selected);
  }, [selectedKey]);

  const s = detailModel;
  const prog = s ? triggerProgress(s) : { ok: 0, total: 0, pct: 0, checklist: [], next: null };

  const selectedIndex = useMemo(() => {
    if (!rows.length) return 0;
    if (!selectedKey) return 0;
    const i = rows.findIndex((x: AnyObj) => String(x?.__uiKey ?? "") === selectedKey);
    return i >= 0 ? i : 0;
  }, [rows, selectedKey]);

  const pick = (row: AnyObj) => {
    const key = String(row?.__uiKey ?? row?.id ?? "");
    setSelectedId(key);
    setSelectedSig(setupSig(row));
  };

  const prev = () => {
    if (!rows.length) return;
    const i = clamp(selectedIndex - 1, 0, rows.length - 1);
    const hit = rows[i] as AnyObj;
    setSelectedId(String(hit?.__uiKey ?? ""));
    setSelectedSig(setupSig(hit));
  };
  const next = () => {
    if (!rows.length) return;
    const i = clamp(selectedIndex + 1, 0, rows.length - 1);
    const hit = rows[i] as AnyObj;
    setSelectedId(String(hit?.__uiKey ?? ""));
    setSelectedSig(setupSig(hit));
  };

  const togglePin = () => {
    if (!selectedKey) return;
    setPinned((p) => ({ ...p, [selectedKey]: !p[selectedKey] }));
  };

  const copyTicket = async () => {
    if (!s) return;
    await copyText(buildTicketText(s));
  };

  // market tables (full info)
  const tfs = ["15m", "1h", "4h", "1d"] as const;

  const headerStale = uiHeader.staleSec == null || !Number.isFinite(uiHeader.staleSec)
    ? "—"
    : `${uiHeader.staleSec.toFixed(1)}s`;

  return (
    <div className="perfRoot">
      {/* Header: pure DOM but low Hz updates only (2Hz). No wrap, no blur. */}
      <div className="hdr">
        <div className="hdrLeft">
          <div className="hdrTitle">
            <span className="hdrBrand">DOS OPS</span>
            <span className={`hdrPill ${paused ? "warn" : "ok"}`}>{paused ? "FROZEN" : "LIVE"}</span>
            <span className={`hdrPill ${uiHeader.health === "OK" ? "ok" : uiHeader.health.includes("DEGRADED") || uiHeader.health.includes("WARM") ? "warn" : "bad"}`}>
              {uiHeader.health}
            </span>
          </div>
          <div className="hdrLine mono">
            <span>DQ {dq}</span>
            <span className="sep">|</span>
            <span>MID {Number.isFinite(uiHeader.mid) ? uiHeader.mid.toFixed(2) : "—"}</span>
            <span className="sep">|</span>
            <span>STALE {headerStale}</span>
            <span className="sep">|</span>
            <span>FEEDS {bybitOk ? "BYBIT" : "BYBIT!"} {binanceOk ? "BINANCE" : "BINANCE!"}</span>
            <span className="sep">|</span>
            <span>SETUPS {rows.length}</span>
          </div>
          <div className="meter" aria-label="stale meter">
            <div
              className="meterFill"
              style={{
                transform: `scaleX(${uiHeader.staleSec == null || !Number.isFinite(uiHeader.staleSec)
                  ? 0
                  : clamp(1 - uiHeader.staleSec / 5, 0, 1)
                })`,
              }}
            />
          </div>
        </div>

        <div className="hdrRight">
          <button className="btn" {...tap(prev)} disabled={!rows.length}>Prev</button>
          <button className="btn" {...tap(next)} disabled={!rows.length}>Next</button>
          <button className={`btn ${selectedKey && pinned[selectedKey] ? "btnOn" : ""}`} {...tap(togglePin)} disabled={!s}>
            Pin
          </button>
          <button className="btn" {...tap(copyTicket)} disabled={!s}>Copy</button>
        </div>
      </div>

      {/* Main layout: no fixed bars, no blur, stable scroll containers */}
      <div className="grid">
        <div className="col">
          <div className="card">
            <div className="cardHead">Market Outlook</div>
            <div className="table">
              <div className="tr th">
                <div>TF</div>
                <div>Trend</div>
                <div>Bias</div>
                <div>Events</div>
              </div>
              {tfs.map((tf) => {
                const ms = resolveMS(vFeat, tf);
                const bias = biasByTfLabel(vFeat, tf);
                const ev: string[] = [];
                if (ms?.lastBOS) ev.push(`BOS${ms.lastBOS.dir === "UP" ? "↑" : "↓"} ${fmt(ms.lastBOS.price ?? ms.lastBOS.level, 0)}`);
                if (ms?.lastCHOCH) ev.push(`CHOCH${ms.lastCHOCH.dir === "UP" ? "↑" : "↓"} ${fmt(ms.lastCHOCH.price ?? ms.lastCHOCH.level, 0)}`);
                if (ms?.lastSweep) ev.push(`SWP${ms.lastSweep.dir === "UP" ? "↑" : "↓"} ${fmt(ms.lastSweep.price ?? ms.lastSweep.level, 0)}`);

                return (
                  <div className="tr" key={tf}>
                    <div className="mono b">{tf}</div>
                    <div>{safeStr(ms?.trend)}</div>
                    <div className="mono">{bias}</div>
                    <div className="mono">{ev.length ? ev.join(" ") : "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="cardHead">Key Signals</div>
            <div className="table">
              <div className="tr th">
                <div>TF</div>
                <div>BOS</div>
                <div>CHOCH</div>
                <div>SWEEP</div>
                <div>SH</div>
                <div>SL</div>
                <div>Flags</div>
              </div>

              {[
                ["15m", scan15],
                ["1h", scan1h],
                ["4h", scan4h],
                ["1d", scan1d],
              ].map(([tf, ss]: any) => (
                <div className="tr" key={tf}>
                  <div className="mono b">{tf}</div>
                  <div className="mono">{ss?.bos ?? "—"}</div>
                  <div className="mono">{ss?.choch ?? "—"}</div>
                  <div className="mono">{ss?.sweep ?? "—"}</div>
                  <div className="mono">{Number.isFinite(Number(ss?.sH)) ? fmt(ss?.sH, 2) : "—"}</div>
                  <div className="mono">{Number.isFinite(Number(ss?.sL)) ? fmt(ss?.sL, 2) : "—"}</div>
                  <div className="mono">{ss?.fl ?? "—"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="cardHead row">
              <div>Setups</div>
              <div className="row">
                <select
                  className="select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                >
                  <option value="ALL">ALL</option>
                  <option value="FORMING">FORMING</option>
                  <option value="READY">READY</option>
                  <option value="TRIGGERED">TRIGGERED</option>
                  <option value="DEAD">DEAD</option>
                </select>
                <button className={`btn ${showPinnedOnly ? "btnOn" : ""}`} onClick={() => setShowPinnedOnly((x) => !x)}>
                  Pinned
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="pad muted">
                {dqOk ? "No setups (valid)" : "DQ gated"}
              </div>
            ) : (
              <VirtualList
                items={rows}
                rowHeight={74}
                height={isNarrow ? 320 : 420}
                getKey={(it) => String(it?.__uiKey ?? it?.id ?? "")}
                renderRow={(row) => {
                  const id = String(row?.__uiKey ?? "");
                  const isSel = selectedId ? id === selectedId : false;
                  const pin = Boolean(pinned[id]);
                  const dead = row?.status === "INVALIDATED" || row?.status === "EXPIRED";
                  const pr = triggerProgress(row);
                  const act = actionLabel(row);

                  return (
                    <div className={`feedRow ${isSel ? "sel" : ""} ${dead ? "dead" : ""}`} {...tap(() => pick(row))}>
                      <div className="feedTop">
                        <div className="row">
                          <span className={`tag ${row?.side === "LONG" ? "ok" : "bad"}`}>{safeStr(row?.side)}</span>
                          <span className="tag">{safeStr(row?.type)}</span>
                          <span className="tag">{safeStr(row?.status)}</span>
                          {pin ? <span className="tag">PIN</span> : null}
                          {preferredId && String(row?.id ?? "") === String(preferredId) ? <span className="tag">PREF</span> : null}
                        </div>
                        <div className="mono small">
                          P {Math.round(Number(row?.priority_score ?? 0))} • C {Math.round(Number(row?.confidence?.score ?? 0))} ({safeStr(row?.confidence?.grade)})
                        </div>
                      </div>
                      <div className="feedBottom mono small">
                        T {pr.ok}/{pr.total} • next={pr.next?.key ? String(pr.next.key) : "—"} • E:{act}
                      </div>
                    </div>
                  );
                }}
              />
            )}
          </div>

          <div className="card">
            <div className="cardHead row">
              <div>Details</div>
              <div className="row">
                <button className={`btn ${selectedKey && pinned[selectedKey] ? "btnOn" : ""}`} {...tap(togglePin)} disabled={!s}>
                  Pin
                </button>
                <button className="btn" {...tap(copyTicket)} disabled={!s}>Copy</button>
              </div>
            </div>

            {!s ? (
              <div className="pad muted">No selection.</div>
            ) : (
              <div className="pad">
                <div className="sec">
                  <div className="secTitle">Summary</div>
                  <div className="mono small">
                    {safeStr(s?.canon)} • {safeStr(s?.side)} • {safeStr(s?.type)} • {safeStr(s?.status)} • TF {safeStr(s?.bias_tf)}→{safeStr(s?.entry_tf)}→{safeStr(s?.trigger_tf)}
                  </div>
                  <div className="mono small">
                    Priority {Math.round(Number(s?.priority_score ?? 0))} • Confidence {Math.round(Number(s?.confidence?.score ?? 0))} ({safeStr(s?.confidence?.grade)})
                  </div>
                </div>

                <div className="sec">
                  <div className="secTitle">Execution</div>
                  <div className="mono small">
                    Entry ({safeStr(s?.entry?.mode)}):{" "}
                    {safeStr(s?.entry?.mode) === "LIMIT" && s?.entry?.zone
                      ? `[${fmt(s.entry.zone.lo, 2)}–${fmt(s.entry.zone.hi, 2)}]`
                      : safeStr(s?.entry?.mode) === "MARKET"
                        ? "MARKET"
                        : "—"}
                  </div>
                  <div className="mono small">SL: {fmt(s?.stop?.price, 2)} ({safeStr(s?.stop?.basis)})</div>
                  <div className="mono small">
                    TP: {Array.isArray(s?.tp) && s.tp.length ? s.tp.map((x: AnyObj) => fmt(x.price, 2)).join(" | ") : "—"}
                  </div>
                  <div className="mono small">RR: min {fmt(s?.rr_min, 2)} • est {fmt(s?.rr_est, 2)}</div>
                  <div className="mono small">ACTION: {actionLabel(s)}</div>
                  {Array.isArray(s?.execution?.blockers) && s.execution.blockers.length ? (
                    <div className="mono small bad">blockers: {s.execution.blockers.join(", ")}</div>
                  ) : null}
                </div>

                <div className="sec">
                  <div className="secTitle">Checklist</div>
                  <div className="mono small">
                    {prog.ok}/{prog.total} • next={prog.next?.key ? String(prog.next.key) : "—"}
                  </div>
                  <div className="list">
                    {prog.checklist.length ? (
                      prog.checklist.map((it: AnyObj, i: number) => (
                        <div key={String(it?.key ?? i)} className="li">
                          <span className={`dot ${it?.ok ? "ok" : "warn"}`}>{it?.ok ? "OK" : "WAIT"}</span>
                          <span className="mono b">{safeStr(it?.key)}</span>
                          <span className="muted">{safeStr(it?.note, "")}</span>
                        </div>
                      ))
                    ) : (
                      <div className="muted small">No checklist.</div>
                    )}
                  </div>
                </div>

                <div className="sec">
                  <div className="secTitle">Confluence</div>
                  <div className="list">
                    {Array.isArray(s?.confidence?.reasons) && s.confidence.reasons.length ? (
                      s.confidence.reasons.map((r: AnyObj, i: number) => (
                        <div key={i} className="li">
                          <span className="dot">•</span>
                          <span className="muted">{String(r)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="muted small">No reasons.</div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DosOpsDashboard() {
  const [draftSymbol, setDraftSymbol] = useState("BTCUSDT");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [sessionKey, setSessionKey] = useState(1);
  const [paused, setPaused] = useState(false);

  const commitAnalyze = () => {
    const clean = String(draftSymbol ?? "").trim().toUpperCase();
    if (!clean) return;
    setPaused(false);
    setSymbol(clean);
    setDraftSymbol(clean);
    setSessionKey((k) => k + 1);
  };

  return (
    <div className="screen">
      <style>{`
        :root{
          --bg:#0b0f16;
          --fg:#e6e8ee;
          --muted:#a7adbb;
          --line:#2a3342;
          --card:#121826;
          --card2:#0f1522;
          --ok:#20c997;
          --warn:#ffdd57;
          --bad:#ff6b6b;
        }

        *{ box-sizing:border-box; }
        body{ margin:0; }

        .screen{
          font-family:${UI_SANS};
          background:var(--bg);
          color:var(--fg);
          min-height:100dvh;
          padding:12px;
        }
        .mono{
          font-family:${UI_MONO};
          font-variant-numeric: tabular-nums;
        }
        .b{ font-weight:800; }
        .muted{ color:var(--muted); }
        .small{ font-size:12px; }
        .ok{ color:var(--ok); }
        .warn{ color:var(--warn); }
        .bad{ color:var(--bad); }

        /* Performance-first: no blur, no big shadows, no fixed */
        .perfRoot{
          max-width:1400px;
          margin:0 auto;
        }

        .hdr{
          border:1px solid var(--line);
          background:var(--card2);
          padding:10px;
          display:grid;
          grid-template-columns: 1fr auto;
          gap:10px;
          align-items:center;
        }
        @media (max-width:980px){
          .hdr{ grid-template-columns:1fr; }
        }
        .hdrTitle{
          display:flex;
          gap:8px;
          align-items:center;
          flex-wrap:nowrap;
          overflow:auto;
        }
        .hdrBrand{
          font-weight:900;
          letter-spacing:0.4px;
        }
        .hdrPill{
          border:1px solid var(--line);
          padding:4px 8px;
          font-size:12px;
          border-radius:999px;
          white-space:nowrap;
        }
        .hdrLine{
          margin-top:6px;
          white-space:nowrap;
          overflow:auto;
        }
        .sep{ margin:0 8px; color:var(--muted); }

        .hdrRight{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          justify-content:flex-end;
        }

        .btn{
          border:1px solid var(--line);
          background:var(--card);
          color:var(--fg);
          padding:8px 10px;
          border-radius:10px;
          font-weight:800;
          cursor:pointer;
        }
        .btn:disabled{ opacity:0.5; cursor:not-allowed; }
        .btnOn{
          border-color: rgba(32,201,151,0.6);
          outline:1px solid rgba(32,201,151,0.25);
        }
        .select{
          border:1px solid var(--line);
          background:var(--card);
          color:var(--fg);
          padding:8px 10px;
          border-radius:10px;
          font-weight:800;
        }

        .meter{
          margin-top:8px;
          height:10px;
          background:#0b0f16;
          border:1px solid var(--line);
          overflow:hidden;
        }
        .meterFill{
          height:100%;
          width:100%;
          background: var(--ok);
          transform-origin:left center;
          transition: transform 120ms linear;
          will-change: transform;
        }

        .grid{
          margin-top:12px;
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap:12px;
          align-items:start;
        }
        @media (max-width:980px){
          .grid{ grid-template-columns:1fr; }
        }

        .col{
          display:grid;
          gap:12px;
        }

        .card{
          border:1px solid var(--line);
          background:var(--card);
          contain: layout paint;
        }
        .cardHead{
          border-bottom:1px solid var(--line);
          padding:10px;
          font-weight:900;
        }
        .pad{
          padding:10px;
        }
        .row{
          display:flex;
          gap:8px;
          align-items:center;
          flex-wrap:wrap;
          justify-content:space-between;
        }

        .table{
          display:grid;
        }
        .tr{
          display:grid;
          grid-template-columns: 70px 90px 220px 1fr;
          gap:10px;
          padding:8px 10px;
          border-top:1px solid var(--line);
          font-size:12px;
        }
        .tr.th{
          background:var(--card2);
          font-weight:900;
          border-top:none;
        }
        @media (max-width:980px){
          .tr{ min-width:820px; }
          .table{ overflow:auto; }
        }

        /* Key Signals has 7 cols; keep it in scroll on mobile */
        .card .table .tr:nth-child(1).th + .tr{ } /* noop */

        .vlist{
          overflow:auto;
          border-top:1px solid var(--line);
          background:var(--card2);
        }

        .feedRow{
          padding:10px;
          border-bottom:1px solid var(--line);
          display:flex;
          flex-direction:column;
          justify-content:center;
          gap:6px;
        }
        .feedRow.sel{
          outline:2px solid rgba(32,201,151,0.25);
          background: rgba(32,201,151,0.06);
        }
        .feedRow.dead{
          opacity:0.65;
        }
        .feedTop{
          display:flex;
          justify-content:space-between;
          gap:10px;
          flex-wrap:wrap;
        }
        .feedBottom{
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }

        .tag{
          border:1px solid var(--line);
          padding:3px 8px;
          border-radius:999px;
          font-size:12px;
          white-space:nowrap;
        }

        .sec{
          margin-top:10px;
          padding-top:10px;
          border-top:1px solid var(--line);
        }
        .secTitle{
          font-weight:900;
          margin-bottom:6px;
        }
        .list{
          max-height:220px;
          overflow:auto;
          border:1px solid var(--line);
          background:var(--card2);
          padding:6px 8px;
        }
        .li{
          display:flex;
          gap:8px;
          align-items:flex-start;
          padding:6px 0;
          border-top:1px solid rgba(42,51,66,0.6);
          font-size:12px;
        }
        .li:first-child{ border-top:none; }
        .dot{
          width:48px;
          text-align:center;
          border:1px solid var(--line);
          border-radius:999px;
          padding:2px 6px;
          font-weight:900;
        }
      `}</style>

      {/* Top controls (simple, no sticky/fixed, no blur) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardHead row">
          <div>Session</div>
          <div className="row">
            <input
              className="select mono"
              style={{ width: 140 }}
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
            <button className="btn" onClick={commitAnalyze}>Analyze</button>
            <button className={`btn ${paused ? "btnOn" : ""}`} onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Stop"}
            </button>
            <button
              className="btn"
              onClick={() => {
                setPaused(false);
                setDraftSymbol("BTCUSDT");
                setSymbol("BTCUSDT");
                setSessionKey((k) => k + 1);
              }}
            >
              Reset
            </button>
            <span className="mono small muted">#{sessionKey}</span>
          </div>
        </div>
        <div className="pad mono small muted">
          Symbol: <span className="b">{symbol}</span>
        </div>
      </div>

      <AnalysisSession key={`${symbol}:${sessionKey}`} symbol={symbol} paused={paused} />
    </div>
  );
}
