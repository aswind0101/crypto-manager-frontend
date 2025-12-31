import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildMarketSnapshotV4 } from "../lib/snapshot/market-snapshot-v4"; // adjust path if needed

/**
 * Snapshot Viewer (Retail) - Inline CSS (Pro layout + Mobile-first) + Integrated Generator
 * Fixes:
 * - Vietnamese typography: safer font stack + avoid ultra-heavy weights (950) + smoothing
 * - More professional background (subtle depth)
 * - Better centering + iPad stability: minWidth:0, overflowWrap, consistent grid alignment
 */

function safeJsonParse(text) {
  try {
    const obj = JSON.parse(text);
    return { ok: true, obj };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function clamp(x, a, b) {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function fmtNum(x, opts = {}) {
  const { digits = 2 } = opts;
  if (!Number.isFinite(x)) return "—";
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
  const elig = setup?.eligibility || null;
  if (elig?.status) return String(elig.status);

  const ex = setup?.execution_state || null;
  const phase = ex?.phase ? String(ex.phase) : "";
  const tradable = ex?.tradable;

  if (phase === "invalidated") return "invalidated";
  if (phase === "missed") return "missed";
  if (tradable === true && phase === "ready") return "tradable";
  if (phase === "waiting") return "waiting";

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
    if (typeof navigator === "undefined") return;
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
  return { ...base, background: bg, border: `1px solid ${br}`, color: fg };
}

function toneForBias(bias) {
  const b = toLower(bias);
  if (b === "long" || b === "up" || b === "bull" || b === "tăng" || b === "tang") return "pos";
  if (b === "short" || b === "down" || b === "bear" || b === "giảm" || b === "giam") return "neg";
  return "muted";
}

function scoreToTone(x) {
  if (!Number.isFinite(x)) return "muted";
  if (x >= 0.8) return "pos";
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

function Section({ title, right, children, noTop = false }) {
  return (
    <div style={{ marginTop: noTop ? 0 : 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "rgb(15,23,42)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        {right ? <div style={{ fontSize: 12, color: "rgb(100,116,139)", fontWeight: 700, whiteSpace: "nowrap" }}>{right}</div> : null}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function KV({ k, v, mono = false }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", padding: "8px 0", borderBottom: "1px dashed rgba(148,163,184,0.30)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "rgb(71,85,105)" }}>{k}</div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 650,
          color: "rgb(15,23,42)",
          textAlign: "right",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : "inherit",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          maxWidth: "68%",
        }}
      >
        {v}
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
        background: "rgba(2,6,23,0.58)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        padding: 12,
        zIndex: 2000,
      }}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          maxHeight: "88vh",
          background: "rgba(255,255,255,0.98)",
          border: "1px solid rgba(148,163,184,0.35)",
          borderRadius: 18,
          boxShadow: "0 34px 90px rgba(2,6,23,0.35)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", borderBottom: "1px solid rgba(148,163,184,0.25)" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "rgb(15,23,42)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
              fontWeight: 750,
              color: "rgb(15,23,42)",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ padding: 14, overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

function HorizonCard({ h, idx }) {
  const title = h?.title || h?.label || `Horizon ${idx + 1}`;
  const bias = h?.bias || null;
  const clarity = h?.clarity || null;
  const confidence = Number(h?.confidence);

  const drivers = safeArr(h?.drivers);
  const risks = safeArr(h?.risks);
  const playbook = safeArr(h?.playbook);

  const tone = bias ? toneForBias(bias) : "muted";

  const chipBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 750,
    whiteSpace: "nowrap",
  };

  const block = (label, items) => {
    if (!items.length) return null;
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 750, color: "rgb(71,85,105)" }}>{label}</div>
        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
          {items.slice(0, 5).map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(15,23,42,0.55)", marginTop: 7, flexShrink: 0 }} />
              <div style={{ fontSize: 12.5, color: "rgb(71,85,105)", lineHeight: 1.4, fontWeight: 650, overflowWrap: "anywhere" }}>
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
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.30)",
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 12px 36px rgba(2,6,23,0.06)",
      padding: 14,
      minHeight: 150,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "rgb(15,23,42)" }}>{title}</div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {bias ? <span style={chipStyle(chipBase, tone)}>{String(bias)}</span> : null}
        {clarity ? <span style={chipStyle(chipBase, "muted")}>Rõ xu hướng: {String(clarity)}</span> : null}
        {Number.isFinite(confidence) ? (
          <span style={chipStyle(chipBase, scoreToTone(confidence))}>
            Tin cậy: {fmtPct01(confidence)}
          </span>
        ) : null}
      </div>

      {block("Động lực chính", drivers)}
      {block("Rủi ro / cản trở", risks)}
      {block("Cách hành động", playbook)}
    </div>
  );
}

function SetupCard({ setup, onOpen, dense = false, isWide, isMid }) {
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

  const qualityTier = setup?.quality_tier || setup?.scores?.quality_tier || null;
  const phase = setup?.execution_state?.phase || null;
  const readiness = setup?.execution_state?.readiness || null;
  const orderType = setup?.execution_state?.order?.type || null;

  const chipBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 750,
    whiteSpace: "nowrap",
    userSelect: "none",
  };

  const metricsCols = isWide ? 3 : (isMid ? 3 : 2); // iPad gets 3 cols to avoid awkward wraps

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(setup)}
      style={{
        cursor: "pointer",
        borderRadius: 18,
        border: "1px solid rgba(148,163,184,0.30)",
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 12px 36px rgba(2,6,23,0.07)",
        padding: dense ? 12 : 14,
        transition: "transform 120ms ease, box-shadow 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 16px 46px rgba(2,6,23,0.10)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0px)"; e.currentTarget.style.boxShadow = "0 12px 36px rgba(2,6,23,0.07)"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Header chips: centered baseline */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "rgb(15,23,42)" }}>{typeLabelVN(type)}</span>
            <span style={chipStyle(chipBase, biasTone)}>{String(bias)}</span>
            {tf ? <span style={chipStyle(chipBase, "muted")}>{tfLabelVN(tf)}</span> : null}
            <span style={chipStyle(chipBase, sm.tone)}>{sm.label}</span>
            {qualityTier ? <span style={chipStyle(chipBase, scoreToTone(finalScore))}>Tier {qualityTier}</span> : null}
          </div>

          {/* Trigger: keep left for readability but protect wraps */}
          <div style={{ marginTop: 8, fontSize: 12.5, color: "rgb(71,85,105)", lineHeight: 1.45, fontWeight: 650, overflowWrap: "anywhere" }}>
            <span style={{ color: "rgb(51,65,85)", fontWeight: 800 }}>Trigger:</span>{" "}
            {setup?.trigger || "—"}
          </div>

          {/* Metrics: centered contents + iPad-safe columns */}
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: `repeat(${metricsCols}, minmax(0, 1fr))`,
              gap: 10,
              alignItems: "stretch",
            }}
          >
            <div style={{ padding: 10, borderRadius: 14, background: "rgba(241,245,249,0.75)", border: "1px solid rgba(148,163,184,0.25)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 750, color: "rgb(71,85,105)" }}>Entry zone</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, color: "rgb(15,23,42)", overflowWrap: "anywhere" }}>
                {ez ? `${fmtNum(Math.min(ez[0], ez[1]))} → ${fmtNum(Math.max(ez[0], ez[1]))}` : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgb(71,85,105)", fontWeight: 650 }}>
                Preferred: <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{fmtNum(ep)}</b>
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 14, background: "rgba(241,245,249,0.75)", border: "1px solid rgba(148,163,184,0.25)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 750, color: "rgb(71,85,105)" }}>Stop / Invalidation</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, color: "rgb(15,23,42)", overflowWrap: "anywhere" }}>
                {fmtNum(stop)}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgb(71,85,105)", fontWeight: 650 }}>
                RR TP1: <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{Number.isFinite(rr) ? rr.toFixed(2) : "—"}</b>
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 14, background: "rgba(241,245,249,0.75)", border: "1px solid rgba(148,163,184,0.25)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 750, color: "rgb(71,85,105)" }}>Score / Execution</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, color: "rgb(15,23,42)" }}>
                Score: {Number.isFinite(finalScore) ? fmtPct01(finalScore) : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgb(71,85,105)", fontWeight: 650, overflowWrap: "anywhere" }}>
                {phase ? <>State: <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{phase}</b></> : "State: —"}
                {orderType ? <> · <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{orderType}</b></> : null}
                {readiness ? <> · <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{readiness}</b></> : null}
              </div>
            </div>
          </div>
        </div>

        {/* Right meta: center aligned block */}
        <div style={{ flexShrink: 0, textAlign: "center", paddingTop: 2, minWidth: 62 }}>
          <div style={{ fontSize: 12, color: "rgb(100,116,139)", fontWeight: 700 }}>View</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "rgb(100,116,139)", fontWeight: 650, overflowWrap: "anywhere" }}>
            {setup?.symbol || ""}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SnapshotViewerPage() {
  const [isWide, setIsWide] = useState(false);
  const [isMid, setIsMid] = useState(false);

  useEffect(() => {
    const onResize = () => {
      setIsWide(window.innerWidth >= 1024);
      setIsMid(window.innerWidth >= 760);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [controlsOpen, setControlsOpen] = useState(false);

  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [autoDownload, setAutoDownload] = useState(true);

  const [raw, setRaw] = useState("");
  const [snap, setSnap] = useState(null);
  const [parseErr, setParseErr] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSetup, setSelectedSetup] = useState(null);

  const [tab, setTab] = useState("overview"); // overview | top | all

  const [fText, setFText] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fType, setFType] = useState("all");
  const [fTf, setFTf] = useState("all");
  const [fTradableOnly, setFTradableOnly] = useState(false);
  const [sortBy, setSortBy] = useState("score_desc");

  const safeSymbol = useMemo(() => String(symbolInput || "").toUpperCase().trim(), [symbolInput]);

  const setupsV2 = snap?.unified?.setups_v2 || null;
  const outlook = snap?.unified?.market_outlook_v1 || null;

  const headlineObj = outlook?.headline || null;
  const horizons = safeArr(outlook?.horizons);
  const action = outlook?.action || null;
  const flagObjs = safeArr(outlook?.flag_texts);

  const primary = setupsV2?.primary || null;
  const top = safeArr(setupsV2?.top_candidates);
  const all = getCandidatesAll(setupsV2);

  const tz = snap?.runtime?.tz || "America/Los_Angeles";
  const symbol = snap?.symbol || snap?.request?.symbol || "—";
  const generatedAt = Number(snap?.generated_at);
  const quality = snap?.unified?.data_quality || "—";
  const diagErrors = snap?.diagnostics?.errors?.length || 0;

  const { px: refPx, src: pxSrc } = useMemo(() => getPrimaryPrice(snap), [snap]);

  const allTypes = useMemo(() => uniq(all.map((s) => s?.type)).sort(), [all]);
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

    if (fStatus !== "all") xs = xs.filter((s) => toLower(detectStatus(s)) === toLower(fStatus));
    if (fType !== "all") xs = xs.filter((s) => String(s?.type || "") === fType);
    if (fTf !== "all") xs = xs.filter((s) => String(s?.timeframe ?? s?.tf ?? "") === fTf);

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

  const onOpenSetup = (s) => { setSelectedSetup(s); setDrawerOpen(true); };
  const onCloseDrawer = () => { setDrawerOpen(false); setSelectedSetup(null); };

  const applySnapshotObj = (obj, alsoSetRaw = true) => {
    setParseErr("");
    setGenErr("");
    setSnap(obj);
    setTab("overview");
    if (alsoSetRaw) setRaw(JSON.stringify(obj, null, 2));
    if (!isWide) setControlsOpen(false);
  };

  const onPasteApply = () => {
    setParseErr("");
    const res = safeJsonParse(raw);
    if (!res.ok) {
      setSnap(null);
      setParseErr(res.err || "Invalid JSON");
      return;
    }
    applySnapshotObj(res.obj, false);
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
      applySnapshotObj(res.obj, false);
    } catch (e) {
      setSnap(null);
      setParseErr(String(e?.message || e));
    }
  };

  const onGenerate = async () => {
    setGenErr("");
    setParseErr("");
    setGenLoading(true);
    try {
      const snapObj = await buildMarketSnapshotV4(safeSymbol, { tz: "America/Los_Angeles" });
      applySnapshotObj(snapObj, true);

      if (autoDownload) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const name = `market-snapshot-v4_${safeSymbol}_${ts}.json`;
        downloadJson(snapObj, name);
      }
    } catch (e) {
      setGenErr(String(e?.message || e));
    } finally {
      setGenLoading(false);
    }
  };

  const fontStack =
    '"Be Vietnam Pro", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"';

  const styles = {
    page: {
      minHeight: "100vh",
      color: "rgb(15,23,42)",
      fontFamily: fontStack,
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      textRendering: "optimizeLegibility",
      background:
        "radial-gradient(1000px 600px at 10% 0%, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.00) 60%)," +
        "radial-gradient(900px 520px at 90% 10%, rgba(14,165,233,0.10) 0%, rgba(14,165,233,0.00) 55%)," +
        "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 55%, rgba(248,250,252,1) 100%)",
    },

    shell: {
      maxWidth: 1180,
      margin: "0 auto",
      padding: isWide ? "18px 18px 28px" : "12px 12px 22px",
      display: "grid",
      gap: 12,
    },

    topbar: {
      position: "sticky",
      top: 0,
      zIndex: 1000,
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.32)",
      background: "rgba(255,255,255,0.86)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 14px 44px rgba(2,6,23,0.07)",
      padding: isWide ? 14 : 12,
    },

    grid: {
      display: "grid",
      gridTemplateColumns: isWide ? "380px 1fr" : "1fr",
      gap: 12,
      alignItems: "start",
    },

    card: {
      borderRadius: 18,
      border: "1px solid rgba(148,163,184,0.30)",
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 14px 44px rgba(2,6,23,0.07)",
      padding: 14,
      minWidth: 0,
    },

    subtle: {
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.24)",
      background: "rgba(241,245,249,0.70)",
      padding: 14,
      minWidth: 0,
    },

    btn: (variant) => ({
      padding: "10px 12px",
      borderRadius: 14,
      border: variant === "primary" ? "1px solid rgba(15,23,42,0.95)" : "1px solid rgba(148,163,184,0.35)",
      background: variant === "primary" ? "rgba(15,23,42,0.95)" : "rgba(241,245,249,0.9)",
      color: variant === "primary" ? "white" : "rgb(15,23,42)",
      fontWeight: 750,
      fontSize: 12,
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
    }),

    input: {
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.40)",
      background: "rgba(248,250,252,0.95)",
      fontSize: 12,
      fontWeight: 650,
      color: "rgb(15,23,42)",
      outline: "none",
      minWidth: 0,
    },

    select: {
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.40)",
      background: "rgba(248,250,252,0.95)",
      fontSize: 12,
      fontWeight: 700,
      color: "rgb(15,23,42)",
      outline: "none",
      cursor: "pointer",
      minWidth: 0,
    },

    textarea: {
      width: "100%",
      minHeight: 190,
      resize: "vertical",
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.40)",
      padding: 12,
      outline: "none",
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      background: "rgba(248,250,252,0.95)",
      color: "rgb(15,23,42)",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    },

    divider: { height: 1, background: "rgba(148,163,184,0.22)", marginTop: 12, marginBottom: 12 },

    segWrap: {
      display: "inline-flex",
      padding: 4,
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.30)",
      background: "rgba(241,245,249,0.75)",
      gap: 4,
    },
    segBtn: (active) => ({
      padding: "8px 10px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.0)",
      background: active ? "rgba(15,23,42,0.95)" : "transparent",
      color: active ? "white" : "rgb(15,23,42)",
      fontWeight: 750,
      fontSize: 12,
      cursor: "pointer",
      userSelect: "none",
      minWidth: 72,
      textAlign: "center",
    }),
  };

  const chipsBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 750,
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  const horizonsGridStyle = useMemo(() => {
    if (isWide) return { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 };
    if (isMid) return { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
    return { display: "grid", gridTemplateColumns: "1fr", gap: 12 };
  }, [isWide, isMid]);

  const ControlsOverlay = ({ open, onClose, children }) => {
    if (isWide) return null;
    if (!open) return null;
    return (
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2,6,23,0.58)",
          zIndex: 1500,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          padding: 12,
        }}
      >
        <div style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "86vh",
          borderRadius: 18,
          border: "1px solid rgba(148,163,184,0.35)",
          background: "rgba(255,255,255,0.98)",
          boxShadow: "0 34px 90px rgba(2,6,23,0.35)",
          overflow: "hidden",
        }}>
          <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(148,163,184,0.25)" }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Controls</div>
            <button style={styles.btn("secondary")} onClick={onClose}>Close</button>
          </div>
          <div style={{ padding: 12, overflow: "auto" }}>
            {children}
          </div>
        </div>
      </div>
    );
  };

  const ControlsPanel = (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={styles.card}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Generate Snapshot (v4)</div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="BTCUSDT"
            style={styles.input}
          />
          <button
            style={styles.btn("primary")}
            onClick={onGenerate}
            disabled={genLoading || !safeSymbol}
          >
            {genLoading ? "Generating..." : "Generate"}
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.30)", background: "rgba(248,250,252,0.95)", fontSize: 12, fontWeight: 700 }}>
            <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
            Auto download JSON
          </label>

          <button
            style={styles.btn("secondary")}
            onClick={() => {
              if (!snap) return;
              const ts = new Date().toISOString().replace(/[:.]/g, "-");
              const name = `market-snapshot-v4_${(snap?.symbol || safeSymbol || "SNAP")}_${ts}.json`;
              downloadJson(snap, name);
            }}
            disabled={!snap}
          >
            Download
          </button>
        </div>

        {genErr ? (
          <div style={{ marginTop: 10, color: "rgb(127,29,29)", fontWeight: 750, whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere" }}>
            {genErr}
          </div>
        ) : null}

        <div style={{ marginTop: 10, fontSize: 12, color: "rgb(100,116,139)", fontWeight: 650, lineHeight: 1.4 }}>
          Gợi ý: Nếu 1 exchange bị CORS/geo, snapshot vẫn có thể tạo nhưng quality sẽ “partial” và errors tăng.
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Load JSON</div>
          <label style={{ ...styles.btn("secondary"), display: "inline-flex", alignItems: "center", gap: 8 }}>
            Upload
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => onFilePick(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </label>
        </div>

        <div style={{ marginTop: 10 }}>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='Paste snapshot JSON (market_snapshot v4)...'
            style={styles.textarea}
          />
        </div>

        {parseErr ? (
          <div style={{ marginTop: 10, color: "rgb(127,29,29)", fontWeight: 750, whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere" }}>
            {parseErr}
          </div>
        ) : null}

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={styles.btn("primary")} onClick={onPasteApply}>Apply</button>
          <button
            style={styles.btn("secondary")}
            onClick={() => { if (snap) copyText(JSON.stringify(snap, null, 2)); }}
            disabled={!snap}
          >
            Copy snapshot
          </button>
          <button
            style={styles.btn("secondary")}
            onClick={() => {
              setRaw("");
              setSnap(null);
              setParseErr("");
              setGenErr("");
              setSelectedSetup(null);
              setDrawerOpen(false);
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* Sticky Top Bar */}
        <div style={styles.topbar}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{symbol}</div>
                <span style={chipStyle(chipsBase, "muted")}>Quality: {String(quality)}</span>
                <span style={chipStyle(chipsBase, diagErrors ? "warn" : "pos")}>Errors: {diagErrors}</span>
                <span style={chipStyle(chipsBase, "muted")}>
                  Ref: {Number.isFinite(refPx) ? fmtNum(refPx) : "—"} ({pxSrc})
                </span>
              </div>

              <div style={{ marginTop: 8, fontSize: 12.5, color: "rgb(71,85,105)", fontWeight: 650, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                Generated: <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{fmtTs(generatedAt, tz)}</b> · TZ:{" "}
                <b style={{ color: "rgb(15,23,42)", fontWeight: 800 }}>{tz}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!isWide ? (
                <button style={styles.btn("secondary")} onClick={() => setControlsOpen(true)}>
                  Controls
                </button>
              ) : null}

              <div style={styles.segWrap}>
                <button style={styles.segBtn(tab === "overview")} onClick={() => setTab("overview")}>Overview</button>
                <button style={styles.segBtn(tab === "top")} onClick={() => setTab("top")}>Top</button>
                <button style={styles.segBtn(tab === "all")} onClick={() => setTab("all")}>All</button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Controls Overlay */}
        <ControlsOverlay open={controlsOpen} onClose={() => setControlsOpen(false)}>
          {ControlsPanel}
        </ControlsOverlay>

        {/* Main Grid */}
        <div style={styles.grid}>
          {/* Desktop Controls */}
          {isWide ? (
            <div style={{ position: "sticky", top: 92 }}>
              {ControlsPanel}
            </div>
          ) : null}

          {/* Viewer */}
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            {tab === "overview" ? (
              <div style={styles.card}>
                <Section title="Market Context" right={outlook ? "unified.market_outlook_v1" : "market_outlook_v1 not found"} noTop>
                  {headlineObj ? (
                    <div style={styles.subtle}>
                      <div style={{ display: "grid", gap: 6, fontWeight: 800, color: "rgb(15,23,42)", lineHeight: 1.55, overflowWrap: "anywhere" }}>
                        {headlineObj.market_position ? <div>{headlineObj.market_position}</div> : null}
                        {headlineObj.trend_clarity ? <div>{headlineObj.trend_clarity}</div> : null}
                        {headlineObj.data_quality ? <div>{headlineObj.data_quality}</div> : null}
                        {headlineObj.quick_risk ? <div>{headlineObj.quick_risk}</div> : null}
                      </div>

                      {flagObjs.length ? (
                        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
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
                    </div>
                  ) : (
                    <div style={{ color: "rgb(100,116,139)", fontWeight: 650, fontSize: 13 }}>
                      (Không có headline trong snapshot)
                    </div>
                  )}

                  {action ? (
                    <div style={{ marginTop: 12, borderRadius: 18, border: "1px solid rgba(148,163,184,0.30)", background: "rgba(15,23,42,0.03)", padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>Action</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span style={chipStyle(chipsBase, "muted")}>Hành động: {action.status || "—"}</span>
                          {action.setup_type_label ? <span style={chipStyle(chipsBase, "muted")}>Setup: {action.setup_type_label}</span> : null}
                          {action.tf_label ? <span style={chipStyle(chipsBase, "muted")}>TF: {action.tf_label}</span> : null}
                          {action.order_type ? (
                            <span style={chipStyle(chipsBase, "muted")}>
                              Order: {action.order_type}{action.order_price != null ? ` @ ${fmtNum(action.order_price)}` : ""}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {Array.isArray(action.summary) && action.summary.length ? (
                        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                          {action.summary.slice(0, 6).map((b, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <div style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(15,23,42,0.55)", marginTop: 7, flexShrink: 0 }} />
                              <div style={{ fontSize: 12.5, color: "rgb(71,85,105)", lineHeight: 1.4, fontWeight: 650, overflowWrap: "anywhere" }}>
                                {String(b)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, ...horizonsGridStyle }}>
                    {(horizons.length ? horizons : [{ title: "30m–4h" }, { title: "1–3d" }, { title: "1–2w" }]).map((h, i) => (
                      <HorizonCard key={i} h={h} idx={i} />
                    ))}
                  </div>
                </Section>

                <div style={styles.divider} />

                <Section title="Primary Setup" right={primary ? "unified.setups_v2.primary" : "no primary setup"} noTop>
                  {primary ? (
                    <SetupCard setup={primary} onOpen={onOpenSetup} isWide={isWide} isMid={isMid} />
                  ) : (
                    <div style={{ color: "rgb(100,116,139)", fontWeight: 650, fontSize: 13 }}>
                      (Snapshot không có primary tradable setup)
                    </div>
                  )}
                </Section>

                <Section title="Top Candidates" right={top.length ? `${top.length} setups` : "none"}>
                  {top.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {top.map((s, idx) => (
                        <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} dense isWide={isWide} isMid={isMid} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "rgb(100,116,139)", fontWeight: 650, fontSize: 13 }}>
                      (Không có top_candidates trong snapshot)
                    </div>
                  )}
                </Section>
              </div>
            ) : null}

            {tab === "top" ? (
              <div style={styles.card}>
                <Section title="Top Candidates" right={top.length ? `${top.length} setups` : "none"} noTop>
                  {top.length ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      {top.map((s, idx) => (
                        <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} isWide={isWide} isMid={isMid} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "rgb(100,116,139)", fontWeight: 650, fontSize: 13 }}>
                      (Không có top_candidates trong snapshot)
                    </div>
                  )}
                </Section>
              </div>
            ) : null}

            {tab === "all" ? (
              <div style={styles.card}>
                <Section title="All Candidates" right={`Showing ${filteredAll.length} / ${all.length}`} noTop>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isWide ? "1.1fr 0.65fr 0.7fr 0.6fr 0.7fr 0.8fr" : "1fr 1fr",
                        gap: 10,
                        alignItems: "center",
                        minWidth: 0,
                      }}
                    >
                      <input value={fText} onChange={(e) => setFText(e.target.value)} placeholder="Search trigger / reasons / warnings..." style={styles.input} />

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
                        {allTypes.map((t) => <option key={t} value={t}>{typeLabelVN(t)}</option>)}
                      </select>

                      <select value={fTf} onChange={(e) => setFTf(e.target.value)} style={styles.select}>
                        <option value="all">TF: All</option>
                        {allTfs.map((t) => <option key={t} value={t}>{tfLabelVN(t)}</option>)}
                      </select>

                      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={styles.select}>
                        <option value="score_desc">Sort: Score desc</option>
                        <option value="rr_desc">Sort: RR desc</option>
                        <option value="tf_asc">Sort: TF asc</option>
                      </select>

                      <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.30)", background: "rgba(248,250,252,0.95)", fontSize: 12, fontWeight: 700 }}>
                        <input type="checkbox" checked={fTradableOnly} onChange={(e) => setFTradableOnly(e.target.checked)} />
                        Tradable only
                      </label>
                    </div>

                    <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
                      {filteredAll.length ? (
                        filteredAll.map((s, idx) => (
                          <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} dense isWide={isWide} isMid={isMid} />
                        ))
                      ) : (
                        <div style={{ color: "rgb(100,116,139)", fontWeight: 650, fontSize: 13 }}>
                          (Không có setup nào khớp filter)
                        </div>
                      )}
                    </div>
                  </div>
                </Section>
              </div>
            ) : null}
          </div>
        </div>

        {/* Setup Detail Drawer */}
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
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.28)",
                background: "rgba(241,245,249,0.70)",
                padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 750, color: "rgb(71,85,105)" }}>Trigger</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 750, color: "rgb(15,23,42)", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  {selectedSetup.trigger || "—"}
                </div>
              </div>

              <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.28)", background: "rgba(255,255,255,0.92)", padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Trade Parameters</div>
                <KV
                  k="Entry zone"
                  v={
                    Array.isArray(selectedSetup.entry_zone) && selectedSetup.entry_zone.length === 2
                      ? `${fmtNum(Math.min(selectedSetup.entry_zone[0], selectedSetup.entry_zone[1]))} → ${fmtNum(Math.max(selectedSetup.entry_zone[0], selectedSetup.entry_zone[1]))}`
                      : "—"
                  }
                />
                <KV k="Entry preferred" v={fmtNum(Number.isFinite(selectedSetup.entry_preferred) ? selectedSetup.entry_preferred : selectedSetup.entry)} />
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

              <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.28)", background: "rgba(255,255,255,0.92)", padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Eligibility & Execution</div>
                <KV k="Status" v={statusMeta(detectStatus(selectedSetup)).label} />
                <KV k="Tradable" v={(selectedSetup?.eligibility?.tradable === true || selectedSetup?.execution_state?.tradable === true) ? "Yes" : "No / Unknown"} />
                <KV k="Phase" v={selectedSetup?.execution_state?.phase || "—"} />
                <KV k="Readiness" v={selectedSetup?.execution_state?.readiness || "—"} />
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

              <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.28)", background: "rgba(255,255,255,0.92)", padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>Raw JSON</div>
                  <button
                    style={{
                      border: "1px solid rgba(148,163,184,0.35)",
                      background: "rgba(241,245,249,0.9)",
                      padding: "8px 10px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 750,
                      color: "rgb(15,23,42)",
                    }}
                    onClick={() => copyText(JSON.stringify(selectedSetup, null, 2))}
                  >
                    Copy
                  </button>
                </div>

                <pre style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.35)",
                  background: "rgba(248,250,252,0.95)",
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
            <div style={{ color: "rgb(100,116,139)", fontWeight: 650 }}>No setup selected.</div>
          )}
        </Drawer>
      </div>
    </div>
  );
}
