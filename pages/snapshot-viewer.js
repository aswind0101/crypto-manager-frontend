import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Snapshot Viewer (Retail) - Inline CSS
 * - Paste / Upload JSON snapshot
 * - Render:
 *   1) Header (symbol/time/quality)
 *   2) Market Context (market_outlook_v1: headline object, horizons, action, flag_texts objects)
 *   3) Primary Setup (from unified.setups_v2.primary)
 *   4) Top Candidates (from unified.setups_v2.top_candidates)
 *   5) All Candidates (from unified.setups_v2.candidates_all) + filters
 * - Click any setup => Drawer / Bottom sheet detail (mobile-friendly)
 *
 * IMPORTANT: UI is read-only (no trading logic). It only displays fields present in JSON.
 */

function safeJsonParse(text) {
  try {
    const obj = JSON.parse(text);
    return { ok: true, obj };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

function clamp(x, a, b) {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function fmtNum(x, opts = {}) {
  const { digits = 2, compact = false } = opts;
  if (!Number.isFinite(x)) return "—";
  if (compact) {
    const abs = Math.abs(x);
    if (abs >= 1e9) return (x / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (x / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (x / 1e3).toFixed(2) + "K";
  }
  const d = Math.abs(x) >= 1000 ? Math.min(digits, 1) : digits;
  return x.toLocaleString(undefined, { maximumFractionDigits: d });
}

function fmtPct01(x) {
  if (!Number.isFinite(x)) return "—";
  return `${Math.round(clamp(x, 0, 1) * 100)}%`;
}

function fmtTs(ts, tz = "America/Los_Angeles") {
  if (!Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-US", { timeZone: tz });
  } catch {
    return new Date(ts).toISOString();
  }
}

function toLower(x) {
  return String(x || "").toLowerCase();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

function detectStatus(setup) {
  // priority: explicit eligibility/status, else execution_state, else fallback
  const elig = setup?.eligibility || null;
  if (elig?.status) return String(elig.status);

  const ex = setup?.execution_state || null;
  const phase = ex?.phase ? String(ex.phase) : "";
  const tradable = ex?.tradable;

  // Map into retail-friendly buckets
  if (phase === "invalidated") return "invalidated";
  if (phase === "missed") return "missed";
  if (tradable === true && phase === "ready") return "tradable";
  if (phase === "waiting") return "waiting";

  // v2 fallback: if setup appears actionable by presence of entry/stop
  const hasCore =
    Array.isArray(setup?.entry_zone) &&
    setup.entry_zone.length === 2 &&
    Number.isFinite(setup?.stop);
  return hasCore ? "unknown" : "unavailable";
}

function statusMeta(status) {
  const s = toLower(status);
  if (s === "tradable" || s === "ready") return { label: "Tradable", tone: "pos" };
  if (s === "waiting") return { label: "Waiting", tone: "warn" };
  if (s === "rejected" || s === "unavailable") return { label: "Unavailable", tone: "muted" };
  if (s === "missed") return { label: "Missed", tone: "neg" };
  if (s === "invalidated") return { label: "Invalidated", tone: "neg" };
  return { label: status ? String(status) : "Unknown", tone: "muted" };
}

function typeLabelVN(type) {
  const t = String(type || "");
  if (t === "reversal_sweep") return "Đảo chiều (sweep)";
  if (t === "breakout") return "Phá vỡ (breakout)";
  if (t === "trend_continuation") return "Tiếp diễn";
  if (t === "mean_reversion") return "Hồi về trung bình";
  return t || "—";
}

function tfLabelVN(tf) {
  const x = String(tf || "");
  if (x === "15") return "15m";
  if (x === "60") return "1H";
  if (x === "240") return "4H";
  if (x === "D") return "1D";
  return x || "—";
}

function getPrimaryPrice(snapshot) {
  const tBybit = snapshot?.per_exchange?.bybit?.ticker || null;
  const mark = Number(tBybit?.mark);
  const last = Number(tBybit?.last);
  const index = Number(tBybit?.index);
  if (Number.isFinite(mark)) return { px: mark, src: "Bybit mark" };
  if (Number.isFinite(last)) return { px: last, src: "Bybit last" };
  if (Number.isFinite(index)) return { px: index, src: "Bybit index" };

  const tBinance = snapshot?.per_exchange?.binance?.ticker || null;
  const mark2 = Number(tBinance?.mark);
  const last2 = Number(tBinance?.last);
  if (Number.isFinite(mark2)) return { px: mark2, src: "Binance mark" };
  if (Number.isFinite(last2)) return { px: last2, src: "Binance last" };

  return { px: null, src: "—" };
}

function copyText(text) {
  try {
    navigator.clipboard.writeText(String(text || ""));
  } catch {
    // ignore
  }
}

function chipStyle(base, tone) {
  const t = tone || "muted";
  const bg =
    t === "pos" ? "rgba(34,197,94,0.12)" :
    t === "warn" ? "rgba(245,158,11,0.14)" :
    t === "neg" ? "rgba(239,68,68,0.12)" :
    "rgba(148,163,184,0.18)";
  const br =
    t === "pos" ? "rgba(34,197,94,0.35)" :
    t === "warn" ? "rgba(245,158,11,0.35)" :
    t === "neg" ? "rgba(239,68,68,0.30)" :
    "rgba(148,163,184,0.28)";
  const fg =
    t === "pos" ? "rgb(22,101,52)" :
    t === "warn" ? "rgb(120,53,15)" :
    t === "neg" ? "rgb(127,29,29)" :
    "rgb(51,65,85)";
  return {
    ...base,
    background: bg,
    border: `1px solid ${br}`,
    color: fg,
  };
}

/** UPDATED: understands Long/Short + Tăng/Giảm */
function toneForBias(bias) {
  const b = toLower(bias);
  if (b === "long" || b === "up" || b === "bull" || b === "tăng" || b === "tang") return "pos";
  if (b === "short" || b === "down" || b === "bear" || b === "giảm" || b === "giam") return "neg";
  return "muted";
}

function scoreToTone(x) {
  if (!Number.isFinite(x)) return "muted";
  if (x >= 0.80) return "pos";
  if (x >= 0.65) return "warn";
  return "muted";
}

function getCandidatesAll(setupsV2) {
  return safeArr(setupsV2?.candidates_all).length
    ? safeArr(setupsV2?.candidates_all)
    : safeArr(setupsV2?.top_candidates);
}

function pickSetupKey(s, idx) {
  const sym = s?.symbol || "SYM";
  const type = s?.type || "type";
  const bias = s?.bias || "bias";
  const tf = s?.timeframe || s?.tf || "";
  const ep = Number.isFinite(s?.entry_preferred) ? s.entry_preferred : Number.isFinite(s?.entry) ? s.entry : null;
  const st = Number.isFinite(s?.stop) ? s.stop : null;
  return `${sym}_${type}_${bias}_${tf}_${ep ?? "na"}_${st ?? "na"}_${idx}`;
}

function SetupCard({ setup, onOpen, compact = false }) {
  const status = detectStatus(setup);
  const sm = statusMeta(status);

  const bias = setup?.bias || "—";
  const biasTone = toneForBias(bias);

  const tf = setup?.timeframe ?? setup?.tf ?? null;
  const type = setup?.type || null;

  const ez = Array.isArray(setup?.entry_zone) ? setup.entry_zone : null;
  const ep = Number.isFinite(setup?.entry_preferred) ? setup.entry_preferred : Number.isFinite(setup?.entry) ? setup.entry : null;
  const stop = Number.isFinite(setup?.stop) ? setup.stop : Number.isFinite(setup?.invalidation) ? setup.invalidation : null;

  const finalScore =
    Number.isFinite(setup?.final_score) ? setup.final_score :
    Number.isFinite(setup?.scores?.final_score) ? setup.scores.final_score :
    Number.isFinite(setup?.confidence) ? setup.confidence :
    null;

  const rr =
    Number.isFinite(setup?.execution_metrics?.rr_tp1) ? setup.execution_metrics.rr_tp1 :
    Number.isFinite(setup?.scores?.rr_tp1) ? setup.scores.rr_tp1 :
    Number.isFinite(setup?.rr_estimate_tp1) ? setup.rr_estimate_tp1 :
    null;

  const qualityTier =
    setup?.quality_tier ||
    setup?.scores?.quality_tier ||
    null;

  const action = setup?.execution_state?.phase || null;
  const readiness = setup?.execution_state?.readiness || null;
  const orderType = setup?.execution_state?.order?.type || null;

  const base = {
    cursor: "pointer",
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.35)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
    padding: compact ? 12 : 14,
    transition: "transform 120ms ease, box-shadow 120ms ease",
  };

  const chipBase = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.1,
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={base}
      onClick={() => onOpen?.(setup)}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 14px 40px rgba(2,6,23,0.09)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0px)"; e.currentTarget.style.boxShadow = "0 10px 30px rgba(2,6,23,0.06)"; }}
      role="button"
      tabIndex={0}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "rgb(15,23,42)" }}>
              {typeLabelVN(type)}
            </span>
            <span style={chipStyle(chipBase, biasTone)}>{String(bias || "—")}</span>
            {tf ? <span style={chipStyle(chipBase, "muted")}>{tfLabelVN(tf)}</span> : null}
            <span style={chipStyle(chipBase, sm.tone)}>{sm.label}</span>
            {qualityTier ? <span style={chipStyle(chipBase, scoreToTone(finalScore))}>Tier {qualityTier}</span> : null}
          </div>

          <div style={{ marginTop: 8, color: "rgb(51,65,85)", fontSize: 13, lineHeight: 1.35 }}>
            <span style={{ fontWeight: 800 }}>Trigger:</span>{" "}
            <span style={{ color: "rgb(71,85,105)" }}>{setup?.trigger || "—"}</span>
          </div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 12, background: "rgba(241,245,249,0.8)", border: "1px solid rgba(148,163,184,0.28)" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "rgb(71,85,105)" }}>Entry zone</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 900, color: "rgb(15,23,42)" }}>
                {ez ? `${fmtNum(Math.min(ez[0], ez[1]))} → ${fmtNum(Math.max(ez[0], ez[1]))}` : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgb(71,85,105)" }}>
                Preferred: <b style={{ color: "rgb(15,23,42)" }}>{fmtNum(ep)}</b>
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 12, background: "rgba(241,245,249,0.8)", border: "1px solid rgba(148,163,184,0.28)" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "rgb(71,85,105)" }}>Stop / Invalidation</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 900, color: "rgb(15,23,42)" }}>
                {fmtNum(stop)}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgb(71,85,105)" }}>
                RR TP1: <b style={{ color: "rgb(15,23,42)" }}>{Number.isFinite(rr) ? rr.toFixed(2) : "—"}</b>
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 12, background: "rgba(241,245,249,0.8)", border: "1px solid rgba(148,163,184,0.28)" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "rgb(71,85,105)" }}>Score / Execution</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 900, color: "rgb(15,23,42)" }}>
                Score: {Number.isFinite(finalScore) ? fmtPct01(finalScore) : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgb(71,85,105)" }}>
                {action ? <>State: <b style={{ color: "rgb(15,23,42)" }}>{action}</b></> : "State: —"}
                {orderType ? <> · Order: <b style={{ color: "rgb(15,23,42)" }}>{orderType}</b></> : null}
                {readiness ? <> · <b style={{ color: "rgb(15,23,42)" }}>{readiness}</b></> : null}
              </div>
            </div>
          </div>
        </div>

        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "rgb(100,116,139)", fontWeight: 800 }}>Tap to view</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "rgb(100,116,139)" }}>
            {setup?.symbol || ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function Drawer({ open, onClose, title, children }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose?.(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.55)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          maxHeight: "86vh",
          background: "rgba(255,255,255,0.98)",
          border: "1px solid rgba(148,163,184,0.35)",
          borderRadius: 18,
          boxShadow: "0 30px 80px rgba(2,6,23,0.25)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderBottom: "1px solid rgba(148,163,184,0.25)" }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "rgb(15,23,42)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "Details"}
          </div>
          <button
            onClick={onClose}
            style={{
              border: "1px solid rgba(148,163,184,0.35)",
              background: "rgba(241,245,249,0.9)",
              padding: "8px 10px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
              color: "rgb(15,23,42)",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ padding: 14, overflow: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, mono = false }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", padding: "8px 0", borderBottom: "1px dashed rgba(148,163,184,0.30)" }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: "rgb(71,85,105)" }}>{k}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: "rgb(15,23,42)", textAlign: "right", fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : "inherit" }}>
        {v}
      </div>
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 950, color: "rgb(15,23,42)" }}>{title}</div>
        {right ? <div style={{ fontSize: 12, color: "rgb(100,116,139)", fontWeight: 800 }}>{right}</div> : null}
      </div>
      <div style={{ marginTop: 10 }}>
        {children}
      </div>
    </div>
  );
}

/** UPDATED: matches market_outlook_v1.horizons[] schema */
function HorizonCard({ h, idx }) {
  const title = h?.title || h?.label || `Horizon ${idx + 1}`;
  const bias = h?.bias || null;          // "Tăng"/"Giảm"
  const clarity = h?.clarity || null;    // "Yếu"/"Trung bình"/"Rõ"
  const confidence = Number(h?.confidence);

  const drivers = safeArr(h?.drivers);
  const risks = safeArr(h?.risks);
  const playbook = safeArr(h?.playbook);

  const tone = bias ? toneForBias(bias) : "muted";

  const chipBase = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  };

  const block = (label, items) => {
    if (!items.length) return null;
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 950, color: "rgb(71,85,105)" }}>{label}</div>
        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
          {items.slice(0, 5).map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(15,23,42,0.55)", marginTop: 7 }} />
              <div style={{ fontSize: 12.5, color: "rgb(71,85,105)", lineHeight: 1.4, fontWeight: 800 }}>
                {String(b)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.30)",
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 10px 30px rgba(2,6,23,0.05)",
      padding: 14,
      minHeight: 140,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 950, color: "rgb(15,23,42)" }}>{title}</div>

          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {bias ? <span style={chipStyle(chipBase, tone)}>{String(bias)}</span> : null}
            {clarity ? <span style={chipStyle(chipBase, "muted")}>Rõ xu hướng: {String(clarity)}</span> : null}
            {Number.isFinite(confidence) ? (
              <span style={chipStyle(chipBase, scoreToTone(confidence))}>
                Tin cậy: {fmtPct01(confidence)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {block("Động lực chính", drivers)}
      {block("Rủi ro / cản trở", risks)}
      {block("Cách hành động", playbook)}
    </div>
  );
}

export default function SnapshotViewerPage() {
  const [raw, setRaw] = useState("");
  const [snap, setSnap] = useState(null);
  const [parseErr, setParseErr] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSetup, setSelectedSetup] = useState(null);

  const [tab, setTab] = useState("overview"); // overview | top | all

  // Filters for "all"
  const [fText, setFText] = useState("");
  const [fStatus, setFStatus] = useState("all"); // all|tradable|waiting|missed|invalidated|unavailable|unknown
  const [fType, setFType] = useState("all");
  const [fTf, setFTf] = useState("all");
  const [fTradableOnly, setFTradableOnly] = useState(false);
  const [sortBy, setSortBy] = useState("score_desc"); // score_desc | rr_desc | tf_asc

  const tz = snap?.runtime?.tz || "America/Los_Angeles";
  const symbol = snap?.symbol || snap?.request?.symbol || "—";
  const generatedAt = Number(snap?.generated_at);
  const quality = snap?.unified?.data_quality || "—";
  const diagErrors = snap?.diagnostics?.errors?.length || 0;

  const setupsV2 = snap?.unified?.setups_v2 || null;

  // market_outlook_v1 (UPDATED mapping)
  const outlook = snap?.unified?.market_outlook_v1 || null;
  const headlineObj = outlook?.headline || null; // object: {market_position, trend_clarity, data_quality, quick_risk}
  const horizons = safeArr(outlook?.horizons);   // [{title,bias,clarity,confidence,drivers[],risks[],playbook[]}]
  const action = outlook?.action || null;        // {status, order_type, order_price, summary[], setup_type_label, tf_label}
  const flagObjs = safeArr(outlook?.flag_texts); // [{key,text,tone}]

  const primary = setupsV2?.primary || null;
  const top = safeArr(setupsV2?.top_candidates);
  const all = getCandidatesAll(setupsV2);

  const { px: refPx, src: pxSrc } = useMemo(() => getPrimaryPrice(snap), [snap]);

  const allTypes = useMemo(() => {
    return uniq(all.map((s) => s?.type)).sort();
  }, [all]);

  const allTfs = useMemo(() => {
    return uniq(all.map((s) => String(s?.timeframe ?? s?.tf ?? "").trim()).filter(Boolean)).sort((a, b) => {
      const order = { "15": 1, "60": 2, "240": 3, "D": 4 };
      return (order[a] || 99) - (order[b] || 99);
    });
  }, [all]);

  const filteredAll = useMemo(() => {
    let xs = all.slice();

    const q = toLower(fText).trim();
    if (q) {
      xs = xs.filter((s) => {
        const blob = [
          s?.symbol, s?.type, s?.bias, s?.timeframe, s?.trigger,
          safeArr(s?.eligibility?.reasons).join(" "),
          safeArr(s?.execution_state?.reason).join(" "),
          safeArr(s?.warnings).join(" "),
        ].join(" ");
        return toLower(blob).includes(q);
      });
    }

    if (fStatus !== "all") {
      xs = xs.filter((s) => toLower(detectStatus(s)) === toLower(fStatus));
    }

    if (fType !== "all") {
      xs = xs.filter((s) => String(s?.type || "") === fType);
    }

    if (fTf !== "all") {
      xs = xs.filter((s) => String(s?.timeframe ?? s?.tf ?? "") === fTf);
    }

    if (fTradableOnly) {
      xs = xs.filter((s) => {
        const t = s?.eligibility?.tradable;
        const ex = s?.execution_state?.tradable;
        return t === true || ex === true || toLower(detectStatus(s)) === "tradable";
      });
    }

    const getScore = (s) =>
      Number.isFinite(s?.final_score) ? s.final_score :
      Number.isFinite(s?.scores?.final_score) ? s.scores.final_score :
      Number.isFinite(s?.confidence) ? s.confidence :
      -1;

    const getRr = (s) =>
      Number.isFinite(s?.execution_metrics?.rr_tp1) ? s.execution_metrics.rr_tp1 :
      Number.isFinite(s?.scores?.rr_tp1) ? s.scores.rr_tp1 :
      Number.isFinite(s?.rr_estimate_tp1) ? s.rr_estimate_tp1 :
      -1;

    const getTfOrder = (s) => {
      const tf = String(s?.timeframe ?? s?.tf ?? "");
      const order = { "15": 1, "60": 2, "240": 3, "D": 4 };
      return order[tf] || 99;
    };

    xs.sort((a, b) => {
      if (sortBy === "rr_desc") return getRr(b) - getRr(a);
      if (sortBy === "tf_asc") return getTfOrder(a) - getTfOrder(b);
      return getScore(b) - getScore(a);
    });

    return xs;
  }, [all, fText, fStatus, fType, fTf, fTradableOnly, sortBy]);

  const onOpenSetup = (s) => {
    setSelectedSetup(s);
    setDrawerOpen(true);
  };

  const onCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedSetup(null);
  };

  const onPasteApply = () => {
    setParseErr("");
    const res = safeJsonParse(raw);
    if (!res.ok) {
      setSnap(null);
      setParseErr(res.err || "Invalid JSON");
      return;
    }
    setSnap(res.obj);
    setTab("overview");
  };

  const onFilePick = async (file) => {
    setParseErr("");
    if (!file) return;
    try {
      const text = await file.text();
      setRaw(text);
      const res = safeJsonParse(text);
      if (!res.ok) {
        setSnap(null);
        setParseErr(res.err || "Invalid JSON");
        return;
      }
      setSnap(res.obj);
      setTab("overview");
    } catch (e) {
      setSnap(null);
      setParseErr(String(e?.message || e));
    }
  };

  const styles = {
    page: {
      minHeight: "100vh",
      background: "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 70%, rgba(248,250,252,1) 100%)",
      padding: 18,
      color: "rgb(15,23,42)",
    },
    container: {
      maxWidth: 1100,
      margin: "0 auto",
      display: "grid",
      gap: 14,
    },
    header: {
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 12px 40px rgba(2,6,23,0.06)",
      padding: 16,
    },
    titleRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
      flexWrap: "wrap",
    },
    h1: { fontSize: 18, fontWeight: 950, margin: 0 },
    sub: { marginTop: 8, fontSize: 13, color: "rgb(71,85,105)", lineHeight: 1.35 },
    grid2: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 14,
    },
    grid3: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 12,
    },
    card: {
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 12px 40px rgba(2,6,23,0.06)",
      padding: 16,
    },
    textarea: {
      width: "100%",
      minHeight: 180,
      resize: "vertical",
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.40)",
      padding: 12,
      outline: "none",
      fontSize: 12.5,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      background: "rgba(248,250,252,0.9)",
      color: "rgb(15,23,42)",
    },
    btn: (variant) => ({
      padding: "10px 12px",
      borderRadius: 12,
      border: variant === "primary" ? "1px solid rgba(15,23,42,0.9)" : "1px solid rgba(148,163,184,0.35)",
      background: variant === "primary" ? "rgba(15,23,42,0.95)" : "rgba(241,245,249,0.9)",
      color: variant === "primary" ? "white" : "rgb(15,23,42)",
      fontWeight: 950,
      fontSize: 12,
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
    }),
    input: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.40)",
      background: "rgba(248,250,252,0.9)",
      fontSize: 12,
      fontWeight: 800,
      color: "rgb(15,23,42)",
      outline: "none",
    },
    select: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.40)",
      background: "rgba(248,250,252,0.9)",
      fontSize: 12,
      fontWeight: 900,
      color: "rgb(15,23,42)",
      outline: "none",
      cursor: "pointer",
    },
    divider: {
      height: 1,
      background: "rgba(148,163,184,0.28)",
      marginTop: 12,
      marginBottom: 12,
    },
    tiny: { fontSize: 12, color: "rgb(100,116,139)", fontWeight: 800 },
  };

  // responsive columns
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 980);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [isMid, setIsMid] = useState(false);
  useEffect(() => {
    const onResize = () => setIsMid(window.innerWidth >= 720);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const horizonsGridStyle = useMemo(() => {
    if (isWide) return { ...styles.grid3, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" };
    if (isMid) return { ...styles.grid3, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" };
    return { ...styles.grid3, gridTemplateColumns: "1fr" };
  }, [isWide, isMid]);

  const mainGridStyle = useMemo(() => {
    if (isWide) return { ...styles.grid2, gridTemplateColumns: "420px 1fr", alignItems: "start" };
    return { ...styles.grid2, gridTemplateColumns: "1fr" };
  }, [isWide]);

  const chipsBase = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleRow}>
            <div style={{ minWidth: 0 }}>
              <h1 style={styles.h1}>Snapshot Viewer (Retail)</h1>
              <div style={styles.sub}>
                Paste / upload JSON snapshot → xem context thị trường + setups. UI chỉ hiển thị dữ liệu có sẵn trong snapshot.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <label style={{ ...styles.btn("secondary"), display: "inline-flex", alignItems: "center", gap: 8 }}>
                Upload JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => onFilePick(e.target.files?.[0])}
                  style={{ display: "none" }}
                />
              </label>
              <button style={styles.btn("primary")} onClick={onPasteApply}>
                Apply JSON
              </button>
            </div>
          </div>

          <div style={styles.divider} />

          <div style={mainGridStyle}>
            {/* Input panel */}
            <div style={styles.card}>
              <div style={{ fontSize: 13, fontWeight: 950, color: "rgb(15,23,42)" }}>Input JSON</div>
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder='Paste full snapshot JSON here... (market_snapshot v4)'
                  style={styles.textarea}
                />
              </div>

              {parseErr ? (
                <div style={{ marginTop: 10, color: "rgb(127,29,29)", fontWeight: 900, whiteSpace: "pre-wrap", fontSize: 12 }}>
                  {parseErr}
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={styles.btn("secondary")}
                  onClick={() => {
                    if (!snap) return;
                    copyText(JSON.stringify(snap, null, 2));
                  }}
                  disabled={!snap}
                >
                  Copy parsed snapshot
                </button>
                <button
                  style={styles.btn("secondary")}
                  onClick={() => {
                    setRaw("");
                    setSnap(null);
                    setParseErr("");
                    setSelectedSetup(null);
                    setDrawerOpen(false);
                  }}
                >
                  Clear
                </button>
              </div>

              <div style={{ marginTop: 12, ...styles.tiny }}>
                Tip: dùng trang generate JSON hiện có để xuất file snapshot rồi upload vào đây.
              </div>
            </div>

            {/* Snapshot meta + Tabs */}
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: 16, fontWeight: 950, color: "rgb(15,23,42)" }}>
                      {symbol}
                    </div>
                    <span style={chipStyle(chipsBase, "muted")}>Quality: {String(quality)}</span>
                    <span style={chipStyle(chipsBase, diagErrors ? "warn" : "pos")}>
                      Errors: {diagErrors}
                    </span>
                    <span style={chipStyle(chipsBase, "muted")}>
                      Ref: {Number.isFinite(refPx) ? fmtNum(refPx) : "—"} ({pxSrc})
                    </span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12.5, color: "rgb(71,85,105)", fontWeight: 850 }}>
                    Generated: <b style={{ color: "rgb(15,23,42)" }}>{fmtTs(generatedAt, tz)}</b> · TZ: <b style={{ color: "rgb(15,23,42)" }}>{tz}</b>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button style={styles.btn("secondary")} onClick={() => setTab("overview")}>Overview</button>
                  <button style={styles.btn("secondary")} onClick={() => setTab("top")}>Top</button>
                  <button style={styles.btn("secondary")} onClick={() => setTab("all")}>All</button>
                </div>
              </div>

              {/* Body by tab */}
              {tab === "overview" ? (
                <>
                  <Section title="Market Context" right={outlook ? "from unified.market_outlook_v1" : "market_outlook_v1 not found"}>
                    {/* Headline (object) */}
                    {headlineObj ? (
                      <div style={{
                        padding: 14,
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.30)",
                        background: "rgba(241,245,249,0.65)",
                        color: "rgb(15,23,42)",
                        fontWeight: 900,
                        lineHeight: 1.55,
                        display: "grid",
                        gap: 6
                      }}>
                        {headlineObj.market_position ? <div>{headlineObj.market_position}</div> : null}
                        {headlineObj.trend_clarity ? <div>{headlineObj.trend_clarity}</div> : null}
                        {headlineObj.data_quality ? <div>{headlineObj.data_quality}</div> : null}
                        {headlineObj.quick_risk ? <div>{headlineObj.quick_risk}</div> : null}
                      </div>
                    ) : (
                      <div style={{ color: "rgb(100,116,139)", fontWeight: 800, fontSize: 13 }}>
                        (Không có headline trong snapshot)
                      </div>
                    )}

                    {/* Flag chips (array of {key,text,tone}) */}
                    {flagObjs.length ? (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {flagObjs.slice(0, 12).map((f, i) => {
                          const tone =
                            toLower(f?.tone) === "good" ? "pos" :
                            toLower(f?.tone) === "bad" ? "neg" :
                            toLower(f?.tone) === "warn" ? "warn" :
                            "muted";
                          return (
                            <span key={f?.key || i} style={chipStyle(chipsBase, tone)}>
                              {String(f?.text || f?.key || "")}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}

                    {/* Action (schema: status, summary[], setup_type_label, tf_label...) */}
                    {action ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={chipStyle(chipsBase, "muted")}>
                            Hành động: {action.status || "—"}
                          </span>
                          {action.setup_type_label ? (
                            <span style={chipStyle(chipsBase, "muted")}>
                              Setup: {action.setup_type_label}
                            </span>
                          ) : null}
                          {action.tf_label ? (
                            <span style={chipStyle(chipsBase, "muted")}>
                              TF: {action.tf_label}
                            </span>
                          ) : null}
                          {action.order_type ? (
                            <span style={chipStyle(chipsBase, "muted")}>
                              Order: {action.order_type}{action.order_price != null ? ` @ ${fmtNum(action.order_price)}` : ""}
                            </span>
                          ) : null}
                        </div>

                        {Array.isArray(action.summary) && action.summary.length ? (
                          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                            {action.summary.slice(0, 6).map((b, i) => (
                              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                <div style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(15,23,42,0.55)", marginTop: 7 }} />
                                <div style={{ fontSize: 12.5, color: "rgb(71,85,105)", lineHeight: 1.4, fontWeight: 800 }}>
                                  {String(b)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Horizons */}
                    <div style={{ marginTop: 12, ...horizonsGridStyle }}>
                      {(horizons.length ? horizons : [{ title: "30m–4h" }, { title: "1–3d" }, { title: "1–2w" }]).map((h, i) => (
                        <HorizonCard key={i} h={h} idx={i} />
                      ))}
                    </div>
                  </Section>

                  <Section title="Primary Setup" right={primary ? "from unified.setups_v2.primary" : "no primary setup"}>
                    {primary ? (
                      <SetupCard setup={primary} onOpen={onOpenSetup} />
                    ) : (
                      <div style={{ color: "rgb(100,116,139)", fontWeight: 800, fontSize: 13 }}>
                        (Snapshot không có primary tradable setup)
                      </div>
                    )}
                  </Section>

                  <Section title="Top Candidates" right={top.length ? `${top.length} setups` : "none"}>
                    {top.length ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {top.map((s, idx) => (
                          <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} compact />
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: "rgb(100,116,139)", fontWeight: 800, fontSize: 13 }}>
                        (Không có top_candidates trong snapshot)
                      </div>
                    )}
                  </Section>
                </>
              ) : null}

              {tab === "top" ? (
                <Section title="Top Candidates" right={top.length ? `${top.length} setups` : "none"}>
                  {top.length ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      {top.map((s, idx) => (
                        <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "rgb(100,116,139)", fontWeight: 800, fontSize: 13 }}>
                      (Không có top_candidates trong snapshot)
                    </div>
                  )}
                </Section>
              ) : null}

              {tab === "all" ? (
                <Section title="All Candidates" right={`Showing ${filteredAll.length} / ${all.length}`}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: isWide ? "1.2fr 0.7fr 0.7fr 0.7fr 0.9fr 0.9fr" : "1fr 1fr",
                      gap: 10,
                      alignItems: "center",
                    }}>
                      <input
                        value={fText}
                        onChange={(e) => setFText(e.target.value)}
                        placeholder="Search trigger / reasons / warnings..."
                        style={styles.input}
                      />

                      <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={styles.select}>
                        <option value="all">Status: All</option>
                        <option value="tradable">Tradable</option>
                        <option value="waiting">Waiting</option>
                        <option value="missed">Missed</option>
                        <option value="invalidated">Invalidated</option>
                        <option value="unavailable">Unavailable</option>
                        <option value="unknown">Unknown</option>
                      </select>

                      <select value={fType} onChange={(e) => setFType(e.target.value)} style={styles.select}>
                        <option value="all">Type: All</option>
                        {allTypes.map((t) => (
                          <option key={t} value={t}>{typeLabelVN(t)}</option>
                        ))}
                      </select>

                      <select value={fTf} onChange={(e) => setFTf(e.target.value)} style={styles.select}>
                        <option value="all">TF: All</option>
                        {allTfs.map((t) => (
                          <option key={t} value={t}>{tfLabelVN(t)}</option>
                        ))}
                      </select>

                      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={styles.select}>
                        <option value="score_desc">Sort: Score desc</option>
                        <option value="rr_desc">Sort: RR desc</option>
                        <option value="tf_asc">Sort: TF asc</option>
                      </select>

                      <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.35)", background: "rgba(248,250,252,0.9)", fontSize: 12, fontWeight: 950 }}>
                        <input
                          type="checkbox"
                          checked={fTradableOnly}
                          onChange={(e) => setFTradableOnly(e.target.checked)}
                        />
                        Tradable only
                      </label>
                    </div>

                    <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
                      {filteredAll.length ? (
                        filteredAll.map((s, idx) => (
                          <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} compact />
                        ))
                      ) : (
                        <div style={{ color: "rgb(100,116,139)", fontWeight: 800, fontSize: 13 }}>
                          (Không có setup nào khớp filter)
                        </div>
                      )}
                    </div>
                  </div>
                </Section>
              ) : null}
            </div>
          </div>
        </div>

        {/* Drawer */}
        <Drawer
          open={drawerOpen}
          onClose={onCloseDrawer}
          title={
            selectedSetup
              ? `${selectedSetup.symbol || ""} · ${typeLabelVN(selectedSetup.type)} · ${selectedSetup.bias || ""} · ${tfLabelVN(selectedSetup.timeframe ?? selectedSetup.tf)}`
              : "Details"
          }
        >
          {selectedSetup ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.30)",
                background: "rgba(241,245,249,0.65)",
                padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgb(71,85,105)" }}>Trigger</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 900, color: "rgb(15,23,42)", lineHeight: 1.45 }}>
                  {selectedSetup.trigger || "—"}
                </div>
              </div>

              <div style={{
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.30)",
                background: "rgba(255,255,255,0.92)",
                padding: 14,
              }}>
                <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 6 }}>Trade Parameters</div>
                <KV
                  k="Entry zone"
                  v={
                    Array.isArray(selectedSetup.entry_zone) && selectedSetup.entry_zone.length === 2
                      ? `${fmtNum(Math.min(selectedSetup.entry_zone[0], selectedSetup.entry_zone[1]))} → ${fmtNum(Math.max(selectedSetup.entry_zone[0], selectedSetup.entry_zone[1]))}`
                      : "—"
                  }
                />
                <KV
                  k="Entry preferred"
                  v={fmtNum(Number.isFinite(selectedSetup.entry_preferred) ? selectedSetup.entry_preferred : selectedSetup.entry)}
                />
                <KV k="Stop / Invalidation" v={fmtNum(Number.isFinite(selectedSetup.stop) ? selectedSetup.stop : selectedSetup.invalidation)} />
                <KV k="TP1" v={fmtNum(selectedSetup?.targets?.tp1)} />
                <KV k="TP2" v={fmtNum(selectedSetup?.targets?.tp2)} />
                <KV
                  k="RR (TP1)"
                  v={
                    Number.isFinite(selectedSetup?.execution_metrics?.rr_tp1)
                      ? selectedSetup.execution_metrics.rr_tp1.toFixed(2)
                      : Number.isFinite(selectedSetup?.scores?.rr_tp1)
                        ? selectedSetup.scores.rr_tp1.toFixed(2)
                        : Number.isFinite(selectedSetup?.rr_estimate_tp1)
                          ? selectedSetup.rr_estimate_tp1.toFixed(2)
                          : "—"
                  }
                />
              </div>

              <div style={{
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.30)",
                background: "rgba(255,255,255,0.92)",
                padding: 14,
              }}>
                <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 6 }}>Eligibility & Execution State</div>
                <KV
                  k="Status"
                  v={statusMeta(detectStatus(selectedSetup)).label}
                />
                <KV
                  k="Tradable"
                  v={
                    (selectedSetup?.eligibility?.tradable === true || selectedSetup?.execution_state?.tradable === true) ? "Yes" : "No / Unknown"
                  }
                />
                <KV
                  k="Phase"
                  v={selectedSetup?.execution_state?.phase || "—"}
                />
                <KV
                  k="Readiness"
                  v={selectedSetup?.execution_state?.readiness || "—"}
                />
                <KV
                  k="Order"
                  v={
                    selectedSetup?.execution_state?.order?.type
                      ? `${selectedSetup.execution_state.order.type}${selectedSetup.execution_state.order.price != null ? ` @ ${fmtNum(selectedSetup.execution_state.order.price)}` : ""}`
                      : "—"
                  }
                />
                <KV
                  k="Reasons"
                  v={
                    (safeArr(selectedSetup?.eligibility?.reasons).length || safeArr(selectedSetup?.execution_state?.reason).length)
                      ? uniq([...safeArr(selectedSetup?.eligibility?.reasons), ...safeArr(selectedSetup?.execution_state?.reason)]).slice(0, 12).join(" · ")
                      : "—"
                  }
                />
              </div>

              <div style={{
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.30)",
                background: "rgba(255,255,255,0.92)",
                padding: 14,
              }}>
                <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 6 }}>Scores (if present)</div>
                <KV k="Final score" v={Number.isFinite(selectedSetup?.final_score) ? fmtPct01(selectedSetup.final_score) : Number.isFinite(selectedSetup?.scores?.final_score) ? fmtPct01(selectedSetup.scores.final_score) : "—"} />
                <KV k="Quality tier" v={selectedSetup?.quality_tier || selectedSetup?.scores?.quality_tier || "—"} />
                <KV k="Idea confidence" v={Number.isFinite(selectedSetup?.idea_confidence) ? fmtPct01(selectedSetup.idea_confidence) : "—"} />
                <KV k="Parameter reliability" v={Number.isFinite(selectedSetup?.parameter_reliability) ? fmtPct01(selectedSetup.parameter_reliability) : "—"} />
                <KV
                  k="Warnings"
                  v={safeArr(selectedSetup?.warnings).length ? safeArr(selectedSetup.warnings).slice(0, 12).join(" · ") : safeArr(selectedSetup?.scores?.warnings).length ? safeArr(selectedSetup.scores.warnings).slice(0, 12).join(" · ") : "—"}
                />
              </div>

              <div style={{
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.30)",
                background: "rgba(255,255,255,0.92)",
                padding: 14,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 950 }}>Raw JSON</div>
                  <button style={{
                    border: "1px solid rgba(148,163,184,0.35)",
                    background: "rgba(241,245,249,0.9)",
                    padding: "8px 10px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontWeight: 950,
                    color: "rgb(15,23,42)",
                  }} onClick={() => copyText(JSON.stringify(selectedSetup, null, 2))}>
                    Copy
                  </button>
                </div>
                <pre style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.35)",
                  background: "rgba(248,250,252,0.9)",
                  overflow: "auto",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  color: "rgb(15,23,42)",
                }}>
{JSON.stringify(selectedSetup, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ color: "rgb(100,116,139)", fontWeight: 800 }}>No setup selected.</div>
          )}
        </Drawer>
      </div>
    </div>
  );
}
