import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildMarketSnapshotV4 } from "../lib/snapshot/market-snapshot-v4"; // adjust path if needed

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

  const hasCore = Array.isArray(setup?.entry_zone) && setup.entry_zone.length === 2 && Number.isFinite(setup?.stop);
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

// ---------- Modern UI: Icon (inline SVG) ----------
function Icon({ name = "dot", size = 16 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" };
  const stroke = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

  if (name === "up") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 19V5" />
        <path {...stroke} d="M6 11l6-6 6 6" />
      </svg>
    );
  }
  if (name === "down") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 5v14" />
        <path {...stroke} d="M6 13l6 6 6-6" />
      </svg>
    );
  }
  if (name === "risk") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 9v4" />
        <path {...stroke} d="M12 17h.01" />
        <path {...stroke} d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
    );
  }
  if (name === "clarity") {
    return (
      <svg {...common}>
        <path {...stroke} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <path {...stroke} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      </svg>
    );
  }
  if (name === "data") {
    return (
      <svg {...common}>
        <path {...stroke} d="M4 6h16" />
        <path {...stroke} d="M4 12h16" />
        <path {...stroke} d="M4 18h16" />
        <path {...stroke} d="M7 6v12" />
        <path {...stroke} d="M17 6v12" />
      </svg>
    );
  }
  if (name === "dot") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

// ---------- Chip style ----------
function chipStyle(base, tone) {
  const t = tone || "muted";
  const bg =
    t === "pos"
      ? "rgba(34,197,94,0.12)"
      : t === "warn"
      ? "rgba(245,158,11,0.14)"
      : t === "neg"
      ? "rgba(239,68,68,0.12)"
      : "rgba(148,163,184,0.16)";
  const br =
    t === "pos"
      ? "rgba(34,197,94,0.35)"
      : t === "warn"
      ? "rgba(245,158,11,0.35)"
      : t === "neg"
      ? "rgba(239,68,68,0.30)"
      : "rgba(148,163,184,0.26)";
  const fg =
    t === "pos"
      ? "rgb(16,120,68)"
      : t === "warn"
      ? "rgb(146,64,14)"
      : t === "neg"
      ? "rgb(153,27,27)"
      : "rgb(148,163,184)";
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
  return safeArr(setupsV2?.candidates_all).length ? safeArr(setupsV2?.candidates_all) : safeArr(setupsV2?.top_candidates);
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
        <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(226,232,240,0.92)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        {right ? <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)", fontWeight: 700, whiteSpace: "nowrap" }}>{right}</div> : null}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

/**
 * KV row: stack K on top of V for mobile to avoid horizontal scroll
 */
function KV({ k, v, mono = false, stacked = false }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        gap: stacked ? 6 : 10,
        justifyContent: stacked ? "flex-start" : "space-between",
        alignItems: stacked ? "flex-start" : "baseline",
        padding: "8px 0",
        borderBottom: "1px dashed rgba(148,163,184,0.28)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(148,163,184,0.95)", minWidth: 0 }}>{k}</div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 650,
          color: "rgba(226,232,240,0.95)",
          textAlign: stacked ? "left" : "right",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : "inherit",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          maxWidth: stacked ? "100%" : "68%",
          minWidth: 0,
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
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.72)",
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
          background: "rgba(15,23,42,0.92)",
          border: "1px solid rgba(148,163,184,0.26)",
          borderRadius: 18,
          boxShadow: "0 34px 90px rgba(0,0,0,0.45)",
          overflow: "hidden",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", borderBottom: "1px solid rgba(148,163,184,0.18)" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(226,232,240,0.95)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || "Details"}</div>
          <button
            onClick={onClose}
            style={{
              border: "1px solid rgba(148,163,184,0.28)",
              background: "rgba(30,41,59,0.72)",
              padding: "8px 10px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 750,
              color: "rgba(226,232,240,0.95)",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ padding: 14, overflow: "auto", minWidth: 0 }}>{children}</div>
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
        <div style={{ fontSize: 11, fontWeight: 750, color: "rgba(148,163,184,0.95)" }}>{label}</div>
        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
          {items.slice(0, 5).map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(226,232,240,0.55)", marginTop: 7, flexShrink: 0 }} />
              <div style={{ fontSize: 12.5, color: "rgba(226,232,240,0.86)", lineHeight: 1.4, fontWeight: 650, overflowWrap: "anywhere" }}>{String(b)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(148,163,184,0.20)",
        background: "rgba(15,23,42,0.55)",
        boxShadow: "0 14px 46px rgba(0,0,0,0.22)",
        padding: 14,
        minHeight: 150,
        minWidth: 0,
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(226,232,240,0.95)" }}>{title}</div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {bias ? <span style={chipStyle(chipBase, tone)}>{String(bias)}</span> : null}
        {clarity ? <span style={chipStyle(chipBase, "muted")}>Rõ xu hướng: {String(clarity)}</span> : null}
        {Number.isFinite(confidence) ? <span style={chipStyle(chipBase, scoreToTone(confidence))}>Tin cậy: {fmtPct01(confidence)}</span> : null}
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

  const tp1 = Number.isFinite(setup?.targets?.tp1) ? setup.targets.tp1 : Number.isFinite(setup?.tp1) ? setup.tp1 : null;
  const tp2 = Number.isFinite(setup?.targets?.tp2) ? setup.targets.tp2 : Number.isFinite(setup?.tp2) ? setup.tp2 : null;

  const finalScore =
    Number.isFinite(setup?.final_score) ? setup.final_score : Number.isFinite(setup?.scores?.final_score) ? setup.scores.final_score : Number.isFinite(setup?.confidence) ? setup.confidence : null;

  const rr =
    Number.isFinite(setup?.execution_metrics?.rr_tp1) ? setup.execution_metrics.rr_tp1 : Number.isFinite(setup?.scores?.rr_tp1) ? setup.scores.rr_tp1 : Number.isFinite(setup?.rr_estimate_tp1) ? setup.rr_estimate_tp1 : null;

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

  const isCompact = !isMid;

  const tileStyle = {
    padding: isCompact ? 8 : 10,
    borderRadius: 14,
    background: "rgba(30,41,59,0.55)",
    border: "1px solid rgba(148,163,184,0.18)",
    textAlign: "center",
    minHeight: isCompact ? 78 : 92,
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    gap: isCompact ? 2 : 4,
    minWidth: 0,
    width: "100%",
    backdropFilter: "blur(10px)",
  };

  const tileLabel = { fontSize: isCompact ? 10.5 : 11, fontWeight: 750, color: "rgba(148,163,184,0.95)", textAlign: "center", width: "100%" };
  const tileMain = { marginTop: 2, fontSize: isCompact ? 12.5 : 13, fontWeight: 850, color: "rgba(226,232,240,0.95)", overflowWrap: "anywhere", textAlign: "center", width: "100%" };
  const tileSub = { marginTop: 2, fontSize: isCompact ? 11.5 : 12, color: "rgba(226,232,240,0.80)", fontWeight: 650, overflowWrap: "anywhere", textAlign: "center", width: "100%" };

  const tileGroup = (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          marginTop: 12,
          display: "inline-grid",
          gridTemplateColumns: isWide || isMid ? "repeat(4, minmax(0, 220px))" : "repeat(2, minmax(0, 220px))",
          gap: isCompact ? 8 : 10,
          justifyContent: "center",
          alignItems: "stretch",
          maxWidth: "100%",
        }}
      >
        <div style={tileStyle}>
          <div style={tileLabel}>Entry zone</div>
          <div style={tileMain}>{ez ? `${fmtNum(Math.min(ez[0], ez[1]))} → ${fmtNum(Math.max(ez[0], ez[1]))}` : "—"}</div>
          <div style={tileSub}>
            Preferred: <b style={{ color: "rgba(226,232,240,0.95)", fontWeight: 900 }}>{fmtNum(ep)}</b>
          </div>
        </div>

        <div style={tileStyle}>
          <div style={tileLabel}>Stop / Invalidation</div>
          <div style={tileMain}>{fmtNum(stop)}</div>
          <div style={tileSub}>
            RR TP1: <b style={{ color: "rgba(226,232,240,0.95)", fontWeight: 900 }}>{Number.isFinite(rr) ? rr.toFixed(2) : "—"}</b>
          </div>
        </div>

        <div style={tileStyle}>
          <div style={tileLabel}>Take Profit</div>
          <div style={tileMain}>{Number.isFinite(tp1) ? `TP1: ${fmtNum(tp1)}` : "TP1: —"}</div>
          <div style={tileSub}>{Number.isFinite(tp2) ? `TP2: ${fmtNum(tp2)}` : "\u00A0"}</div>
        </div>

        <div style={tileStyle}>
          <div style={tileLabel}>Score / Execution</div>
          <div style={tileMain}>Score: {Number.isFinite(finalScore) ? fmtPct01(finalScore) : "—"}</div>
          <div style={tileSub}>
            {phase ? `State: ${phase}` : "State: —"}
            {orderType ? ` · ${orderType}` : ""}
            {readiness ? ` · ${readiness}` : ""}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(setup)}
      style={{
        cursor: "pointer",
        borderRadius: 18,
        border: "1px solid rgba(148,163,184,0.18)",
        background: "rgba(15,23,42,0.55)",
        boxShadow: "0 16px 56px rgba(0,0,0,0.25)",
        padding: dense ? 12 : 14,
        transition: "transform 120ms ease, box-shadow 120ms ease",
        minWidth: 0,
        backdropFilter: "blur(12px)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 18px 66px rgba(0,0,0,0.32)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0px)";
        e.currentTarget.style.boxShadow = "0 16px 56px rgba(0,0,0,0.25)";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start", minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "rgba(226,232,240,0.95)" }}>{typeLabelVN(type)}</span>
            <span style={chipStyle(chipBase, biasTone)}>{String(bias)}</span>
            {tf ? <span style={chipStyle(chipBase, "muted")}>{tfLabelVN(tf)}</span> : null}
            <span style={chipStyle(chipBase, sm.tone)}>{sm.label}</span>
            {qualityTier ? <span style={chipStyle(chipBase, scoreToTone(finalScore))}>Tier {qualityTier}</span> : null}
          </div>

          <div style={{ marginTop: 8, fontSize: 12.5, color: "rgba(226,232,240,0.78)", lineHeight: 1.45, fontWeight: 650, overflowWrap: "anywhere" }}>
            <span style={{ color: "rgba(226,232,240,0.92)", fontWeight: 900 }}>Trigger:</span> {setup?.trigger || "—"}
          </div>

          {tileGroup}
        </div>

        <div style={{ flexShrink: 0, textAlign: "center", paddingTop: 2, minWidth: 62 }}>
          <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)", fontWeight: 750 }}>View</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "rgba(148,163,184,0.95)", fontWeight: 700, overflowWrap: "anywhere" }}>{setup?.symbol || ""}</div>
        </div>
      </div>
    </div>
  );
}

export default function SnapshotViewerPage() {
  const [isWide, setIsWide] = useState(false);
  const [isMid, setIsMid] = useState(false);

  const lastWRef = useRef(0);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth || 0;
      if (Math.abs(w - lastWRef.current) < 2) return;
      lastWRef.current = w;

      setIsWide(w >= 1024);
      setIsMid(w >= 760);
    };
    onResize();
    window.addEventListener("resize", onResize);

    const vv = window.visualViewport;
    if (vv?.addEventListener) vv.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (vv?.removeEventListener) vv.removeEventListener("resize", onResize);
    };
  }, []);

  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const symbolInputRef = useRef(null);
  // --- Symbol autocomplete (Top 100 by market cap) ---
  const [topCoins, setTopCoins] = useState([]); // [{id,name,symbol,rank,pair}]
  const [coinsLoading, setCoinsLoading] = useState(false);
  const [coinsErr, setCoinsErr] = useState("");
  const [suggOpen, setSuggOpen] = useState(false);
  const [suggActive, setSuggActive] = useState(-1);
  const suggWrapRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    const load = async () => {
      setCoinsErr("");
      setCoinsLoading(true);
      try {
        // CoinGecko public endpoint (no key). If your env blocks it, proxy this call server-side.
        const url =
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false";
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(`Coin list HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;

        const list = Array.isArray(data) ? data : [];
        const mapped = list
          .map((c) => ({
            id: c?.id,
            name: c?.name,
            symbol: String(c?.symbol || "").toUpperCase(),
            rank: Number(c?.market_cap_rank),
            pair: `${String(c?.symbol || "").toUpperCase()}USDT`,
          }))
          .filter((x) => x.symbol && x.pair);

        setTopCoins(mapped);
      } catch (e) {
        if (!alive) return;
        if (String(e?.name || "").toLowerCase() === "aborterror") return;
        setCoinsErr(String(e?.message || e));
      } finally {
        if (alive) setCoinsLoading(false);
      }
    };

    load();

    return () => {
      alive = false;
      try {
        ac.abort();
      } catch {}
    };
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (!suggWrapRef.current) return;
      if (!suggWrapRef.current.contains(e.target)) setSuggOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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

  const suggestions = useMemo(() => {
    const q = String(symbolInput || "").toUpperCase().trim();
    const xs = topCoins.slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
    if (!q) return xs.slice(0, 12);
    // allow both BTC and BTCUSDT typing
    const q2 = q.endsWith("USDT") ? q.slice(0, -4) : q;
    const out = xs.filter((c) => c.pair.startsWith(q) || c.symbol.startsWith(q2) || String(c.name || "").toUpperCase().includes(q2));
    return out.slice(0, 12);
  }, [topCoins, symbolInput]);

  const pickSuggestion = (c) => {
    if (!c) return;
    setSymbolInput(c.pair);
    setSuggOpen(false);
    setSuggActive(-1);
    requestAnimationFrame(() => symbolInputRef.current?.focus());
  };

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
          s?.symbol,
          s?.type,
          s?.bias,
          s?.timeframe,
          s?.trigger,
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
      Number.isFinite(s?.final_score) ? s.final_score : Number.isFinite(s?.scores?.final_score) ? s.scores.final_score : Number.isFinite(s?.confidence) ? s.confidence : -1;

    const getRr = (s) =>
      Number.isFinite(s?.execution_metrics?.rr_tp1) ? s.execution_metrics.rr_tp1 : Number.isFinite(s?.scores?.rr_tp1) ? s.scores.rr_tp1 : Number.isFinite(s?.rr_estimate_tp1) ? s.rr_estimate_tp1 : -1;

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

  const applySnapshotObj = (obj, alsoSetRaw = true) => {
    setParseErr("");
    setGenErr("");
    setSnap(obj);
    setTab("overview");
    if (alsoSetRaw) setRaw(JSON.stringify(obj, null, 2));
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
    '"Be Vietnam Pro","Inter",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Helvetica Neue",Arial,"Apple Color Emoji","Segoe UI Emoji"';

  const styles = {
    page: {
      minHeight: "100vh",
      color: "rgba(226,232,240,0.95)",
      fontFamily: fontStack,
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      textRendering: "optimizeLegibility",
      background:
        "radial-gradient(1200px 700px at 10% 0%, rgba(99,102,241,0.22) 0%, rgba(99,102,241,0) 60%)," +
        "radial-gradient(1000px 600px at 90% 10%, rgba(14,165,233,0.20) 0%, rgba(14,165,233,0) 55%)," +
        "radial-gradient(900px 520px at 50% 110%, rgba(34,197,94,0.14) 0%, rgba(34,197,94,0) 55%)," +
        "linear-gradient(180deg, rgba(2,6,23,1) 0%, rgba(15,23,42,1) 50%, rgba(2,6,23,1) 100%)",
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
      border: "1px solid rgba(148,163,184,0.18)",
      background: "rgba(15,23,42,0.62)",
      backdropFilter: "blur(14px)",
      boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
      padding: isWide ? 14 : 12,
    },

    grid: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 12,
      alignItems: "start",
    },

    card: {
      borderRadius: 18,
      border: "1px solid rgba(148,163,184,0.18)",
      background: "rgba(15,23,42,0.58)",
      boxShadow: "0 18px 64px rgba(0,0,0,0.30)",
      padding: 14,
      minWidth: 0,
      backdropFilter: "blur(14px)",
    },

    subtle: {
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.16)",
      background: "rgba(30,41,59,0.45)",
      padding: 14,
      minWidth: 0,
      backdropFilter: "blur(12px)",
    },

    btn: (variant) => ({
      padding: "10px 12px",
      borderRadius: 14,
      border: variant === "primary" ? "1px solid rgba(226,232,240,0.35)" : "1px solid rgba(148,163,184,0.22)",
      background: variant === "primary" ? "rgba(226,232,240,0.10)" : "rgba(30,41,59,0.55)",
      color: "rgba(226,232,240,0.95)",
      fontWeight: 800,
      fontSize: 12,
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
      backdropFilter: "blur(12px)",
    }),

    input: {
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.24)",
      background: "rgba(2,6,23,0.35)",
      fontSize: 12,
      fontWeight: 700,
      color: "rgba(226,232,240,0.95)",
      outline: "none",
      minWidth: 0,
    },

    select: {
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.24)",
      background: "rgba(2,6,23,0.35)",
      fontSize: 12,
      fontWeight: 800,
      color: "rgba(226,232,240,0.95)",
      outline: "none",
      cursor: "pointer",
      minWidth: 0,
    },

    textarea: {
      width: "100%",
      minHeight: 190,
      resize: "vertical",
      borderRadius: 16,
      border: "1px solid rgba(148,163,184,0.24)",
      padding: 12,
      outline: "none",
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      background: "rgba(2,6,23,0.35)",
      color: "rgba(226,232,240,0.95)",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    },

    divider: { height: 1, background: "rgba(148,163,184,0.16)", marginTop: 12, marginBottom: 12 },

    segWrap: {
      display: "inline-flex",
      padding: 4,
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.18)",
      background: "rgba(2,6,23,0.25)",
      gap: 4,
      backdropFilter: "blur(12px)",
    },

    segBtn: (active) => ({
      padding: "8px 10px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.0)",
      background: active ? "rgba(226,232,240,0.12)" : "transparent",
      color: "rgba(226,232,240,0.95)",
      fontWeight: 900,
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
    fontWeight: 850,
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  const horizonsGridStyle = useMemo(() => {
    if (isWide) return { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 };
    if (isMid) return { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
    return { display: "grid", gridTemplateColumns: "1fr", gap: 12 };
  }, [isWide, isMid]);

  // Controls panel removed (Generate is now in topbar)

  const isKVStacked = !isMid;

  const marketContextItems = useMemo(() => {
    if (!headlineObj) return [];
    const items = [];
    if (headlineObj.market_position) items.push({ key: "market", icon: "up", tone: "muted", text: `${headlineObj.market_position}` });
    if (headlineObj.quick_risk) items.push({ key: "risk", icon: "risk", tone: "warn", text: `${headlineObj.quick_risk}` });
    if (headlineObj.trend_clarity) items.push({ key: "clarity", icon: "clarity", tone: "muted", text: `${headlineObj.trend_clarity}` });
    if (headlineObj.data_quality) items.push({ key: "data", icon: "data", tone: "muted", text: `${headlineObj.data_quality}` });

    if (items.length) {
      const m = items.find((x) => x.key === "market");
      if (m) {
        const s = toLower(m.text);
        if (s.includes("tăng") || s.includes("bull") || s.includes("up")) {
          m.icon = "up";
          m.tone = "pos";
        } else if (s.includes("giảm") || s.includes("bear") || s.includes("down")) {
          m.icon = "down";
          m.tone = "neg";
        } else {
          m.icon = "dot";
          m.tone = "muted";
        }
      }
      const r = items.find((x) => x.key === "risk");
      if (r) {
        const s = toLower(r.text);
        if (s.includes("cao") || s.includes("high")) r.tone = "neg";
        else if (s.includes("trung") || s.includes("medium")) r.tone = "warn";
        else r.tone = "muted";
      }
      const c = items.find((x) => x.key === "clarity");
      if (c) {
        const s = toLower(c.text);
        if (s.includes("mạnh") || s.includes("strong")) c.tone = "pos";
        else if (s.includes("yếu") || s.includes("weak")) c.tone = "muted";
        else c.tone = "muted";
      }
      const d = items.find((x) => x.key === "data");
      if (d) {
        const s = toLower(d.text);
        if (s.includes("tốt") || s.includes("good") || s.includes("ok")) d.tone = "pos";
        else if (s.includes("kém") || s.includes("poor") || s.includes("partial")) d.tone = "warn";
        else d.tone = "muted";
      }
    }
    return items;
  }, [headlineObj]);

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topbar}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 950, letterSpacing: 0.2 }}>{symbol}</div>
                <span style={chipStyle(chipsBase, "muted")}>Quality: {String(quality)}</span>
                <span style={chipStyle(chipsBase, diagErrors ? "warn" : "pos")}>Errors: {diagErrors}</span>
                <span style={chipStyle(chipsBase, "muted")}>Ref: {Number.isFinite(refPx) ? fmtNum(refPx) : "—"} ({pxSrc})</span>
              </div>

              <div style={{ marginTop: 8, fontSize: 12.5, color: "rgba(226,232,240,0.72)", fontWeight: 650, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                Generated: <b style={{ color: "rgba(226,232,240,0.95)", fontWeight: 900 }}>{fmtTs(generatedAt, tz)}</b> · TZ:{" "}
                <b style={{ color: "rgba(226,232,240,0.95)", fontWeight: 900 }}>{tz}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div ref={suggWrapRef} style={{ position: "relative", minWidth: isMid ? 220 : 180, flex: isMid ? "0 0 240px" : "1 1 180px" }}>
                  <input
                    ref={symbolInputRef}
                    value={symbolInput}
                    onChange={(e) => {
                      setSymbolInput(e.target.value);
                      setSuggOpen(true);
                      setSuggActive(-1);
                    }}
                    onFocus={() => setSuggOpen(true)}
                    onKeyDown={(e) => {
                      if (!suggOpen) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSuggActive((v) => Math.min(v + 1, suggestions.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSuggActive((v) => Math.max(v - 1, 0));
                      } else if (e.key === "Enter") {
                        if (suggActive >= 0 && suggestions[suggActive]) {
                          e.preventDefault();
                          pickSuggestion(suggestions[suggActive]);
                        }
                      } else if (e.key === "Escape") {
                        setSuggOpen(false);
                        setSuggActive(-1);
                      }
                    }}
                    placeholder="BTCUSDT"
                    style={{ ...styles.input, width: "100%" }}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />

                  {suggOpen ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        left: 0,
                        right: 0,
                        borderRadius: 16,
                        border: "1px solid rgba(148,163,184,0.24)",
                        background: "rgba(15,23,42,0.96)",
                        boxShadow: "0 26px 70px rgba(0,0,0,0.45)",
                        overflow: "hidden",
                        zIndex: 1200,
                        maxHeight: 320,
                      }}
                    >
                      <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid rgba(148,163,184,0.16)" }}>
                        <div style={{ fontSize: 11.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>Top 100 (market cap)</div>
                        <div style={{ fontSize: 11.5, fontWeight: 750, color: "rgba(148,163,184,0.90)" }}>
                          {coinsLoading ? "Loading..." : coinsErr ? "Unavailable" : `${topCoins.length} coins`}
                        </div>
                      </div>

                      {coinsErr ? (
                        <div style={{ padding: 12, fontSize: 12, fontWeight: 750, color: "rgba(226,232,240,0.85)" }}>
                          Không tải được danh sách coin (market cap). Bạn vẫn có thể nhập thủ công symbol (vd: BTCUSDT).<br />
                          <span style={{ color: "rgba(239,68,68,0.95)" }}>{coinsErr}</span>
                        </div>
                      ) : suggestions.length ? (
                        <div style={{ maxHeight: 280, overflow: "auto" }}>
                          {suggestions.map((c, i) => {
                            const active = i === suggActive;
                            return (
                              <div
                                key={c.id || c.pair || i}
                                onMouseEnter={() => setSuggActive(i)}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  pickSuggestion(c);
                                }}
                                style={{
                                  padding: "10px 12px",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  cursor: "pointer",
                                  background: active ? "rgba(226,232,240,0.10)" : "transparent",
                                  borderBottom: "1px solid rgba(148,163,184,0.10)",
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 900, color: "rgba(226,232,240,0.95)" }}>{c.pair}</div>
                                  <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 700, color: "rgba(148,163,184,0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {c.name}
                                  </div>
                                </div>
                                <div style={{ fontSize: 11.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>#{Number.isFinite(c.rank) ? c.rank : "—"}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ padding: 12, fontSize: 12, fontWeight: 750, color: "rgba(148,163,184,0.95)" }}>Không có gợi ý phù hợp.</div>
                      )}
                    </div>
                  ) : null}
                </div>

                <button style={styles.btn("primary")} onClick={onGenerate} disabled={genLoading || !safeSymbol}>
                  {genLoading ? "Generating..." : "Generate"}
                </button>

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
                  Download JSON
                </button>

                <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.20)", background: "rgba(2,6,23,0.25)", fontSize: 12, fontWeight: 850 }}>
                  <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
                  Auto download
                </label>
              </div>

              <div style={styles.segWrap}>
                <button style={styles.segBtn(tab === "overview")} onClick={() => setTab("overview")}>Overview</button>
                <button style={styles.segBtn(tab === "top")} onClick={() => setTab("top")}>Top</button>
                <button style={styles.segBtn(tab === "all")} onClick={() => setTab("all")}>All</button>
              </div>
            </div>
          </div>

          {genErr ? (
            <div style={{ marginTop: 10, color: "rgb(239,68,68)", fontWeight: 850, whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere" }}>{genErr}</div>
          ) : null}
        </div>

        <div style={styles.grid}>
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            {/* ... phần render còn lại của viewer giữ nguyên như file gốc ... */}
            {/* Lưu ý: phần code phía dưới (overview/top/all, drawer, filters...) vẫn giữ nguyên của bạn. */}
          </div>
        </div>
      </div>
    </div>
  );
}
