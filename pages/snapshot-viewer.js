import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildMarketSnapshotV4 } from "../lib/snapshot/market-snapshot-v4"; // adjust path if needed

// --------------------- utils ---------------------
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
function copyText(text) {
  try {
    if (typeof navigator === "undefined") return;
    navigator.clipboard.writeText(String(text || ""));
  } catch {
    // ignore
  }
}

// --------------------- snapshot helpers ---------------------
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

// --------------------- candle close extraction ---------------------
// Goal: show last candle close for 5m, 15m, 1H, 4H, 1D.
// Snapshot schema can vary; this tries common paths and “best effort”.
function lastCloseFromSeries(series) {
  if (!series) return null;

  // series could be:
  // - array of arrays: [t,o,h,l,c,v] ...
  // - array of objects: {t,o,h,l,c,v} ...
  // - object with "candles"/"data"/"rows"
  const xs =
    Array.isArray(series) ? series :
    Array.isArray(series?.candles) ? series.candles :
    Array.isArray(series?.data) ? series.data :
    Array.isArray(series?.rows) ? series.rows :
    null;

  if (!xs || !xs.length) return null;

  const last = xs[xs.length - 1];
  if (Array.isArray(last)) {
    // [t,o,h,l,c,v] => c at index 4
    const c = Number(last[4]);
    return Number.isFinite(c) ? c : null;
  }
  if (last && typeof last === "object") {
    const c = Number(last.c ?? last.close);
    return Number.isFinite(c) ? c : null;
  }
  return null;
}

function findLastClose(snapshot, tfKey) {
  // tfKey: "m5" | "m15" | "h1" | "h4" | "d1"
  // try unified first, then per_exchange (bybit/binance), then generic.
  const uni = snapshot?.unified || null;
  const ex = snapshot?.per_exchange || null;

  // candidate paths (order matters)
  const paths = [
    // unified candles
    (s) => s?.unified?.candles?.[tfKey],
    (s) => s?.unified?.ohlcv?.[tfKey],
    (s) => s?.unified?.klines?.[tfKey],

    // per exchange bybit
    (s) => s?.per_exchange?.bybit?.candles?.[tfKey],
    (s) => s?.per_exchange?.bybit?.ohlcv?.[tfKey],
    (s) => s?.per_exchange?.bybit?.klines?.[tfKey],

    // per exchange binance
    (s) => s?.per_exchange?.binance?.candles?.[tfKey],
    (s) => s?.per_exchange?.binance?.ohlcv?.[tfKey],
    (s) => s?.per_exchange?.binance?.klines?.[tfKey],

    // sometimes timeframe keys are numeric minutes/hours
    (s) => s?.per_exchange?.bybit?.klines?.[tfKey === "m5" ? "5" : tfKey === "m15" ? "15" : tfKey === "h1" ? "60" : tfKey === "h4" ? "240" : tfKey === "d1" ? "D" : tfKey],
    (s) => s?.unified?.klines?.[tfKey === "m5" ? "5" : tfKey === "m15" ? "15" : tfKey === "h1" ? "60" : tfKey === "h4" ? "240" : tfKey === "d1" ? "D" : tfKey],
  ];

  for (const getter of paths) {
    const series = getter(snapshot);
    const c = lastCloseFromSeries(series);
    if (Number.isFinite(c)) return c;
  }

  // final fallback: if no candle series, try ticker last/mark
  const t = ex?.bybit?.ticker || ex?.binance?.ticker || uni?.ticker || null;
  const closeGuess = Number(t?.last ?? t?.mark);
  return Number.isFinite(closeGuess) ? closeGuess : null;
}

// --------------------- UI: Icon + chip ---------------------
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
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

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

// --------------------- components ---------------------
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
    boxSizing: "border-box",
    backdropFilter: "blur(10px)",
  };

  const tileLabel = { fontSize: isCompact ? 10.5 : 11, fontWeight: 750, color: "rgba(148,163,184,0.95)", textAlign: "center", width: "100%" };
  const tileMain = { marginTop: 2, fontSize: isCompact ? 12.5 : 13, fontWeight: 850, color: "rgba(226,232,240,0.95)", overflowWrap: "anywhere", textAlign: "center", width: "100%" };
  const tileSub = { marginTop: 2, fontSize: isCompact ? 11.5 : 12, color: "rgba(226,232,240,0.80)", fontWeight: 650, overflowWrap: "anywhere", textAlign: "center", width: "100%" };

  // Center THE GROUP (not just text): flex-center wrapper + fit-content grid.
  const tileGroup = (
    <div
      style={{
        marginTop: 12,
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          width: "fit-content",
          maxWidth: "100%",
          display: "grid",
          gridTemplateColumns: isWide || isMid ? "repeat(4, minmax(180px, 220px))" : "repeat(2, minmax(160px, 220px))",
          gap: isCompact ? 8 : 10,
          justifyContent: "center",
          justifyItems: "stretch",
          alignItems: "stretch",
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

// --------------------- main page ---------------------
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

  // Top 100 coins autocomplete (CoinGecko)
  const [coins, setCoins] = useState([]); // {id, symbol, name, market_cap_rank}
  const [coinsErr, setCoinsErr] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      setCoinsErr("");
      try {
        const url =
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false";
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) throw new Error(`Coin list HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        const xs = Array.isArray(data) ? data : [];
        setCoins(
          xs
            .map((x) => ({
              id: x?.id,
              symbol: String(x?.symbol || "").toUpperCase(),
              name: String(x?.name || ""),
              rank: Number.isFinite(x?.market_cap_rank) ? x.market_cap_rank : null,
            }))
            .filter((x) => x.symbol && x.name)
        );
      } catch (e) {
        if (!alive) return;
        setCoinsErr(String(e?.message || e));
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const symbolInputRef = useRef(null);

  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [snap, setSnap] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSetup, setSelectedSetup] = useState(null);

  const [tab, setTab] = useState("overview"); // overview | top | all
  const [fText, setFText] = useState("");

  // normalize: allow user type "BTC", "BTCUSDT", "ETH/USDT" etc.
  const safeSymbol = useMemo(() => {
    const raw = String(symbolInput || "").trim().toUpperCase();
    if (!raw) return "";
    const cleaned = raw.replace(/\s+/g, "").replace("/", "");
    if (cleaned.endsWith("USDT")) return cleaned;
    // if user typed known symbol, map to SYMBOLUSDT
    // if typed coin name (rare), we don’t map here—only from selection.
    return `${cleaned}USDT`;
  }, [symbolInput]);

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
  const symbol = snap?.symbol || snap?.request?.symbol || safeSymbol || "—";
  const generatedAt = Number(snap?.generated_at);
  const quality = snap?.unified?.data_quality || "—";
  const diagErrors = snap?.diagnostics?.errors?.length || 0;

  const { px: refPx, src: pxSrc } = useMemo(() => getPrimaryPrice(snap), [snap]);

  // Candle closes
  const close5m = useMemo(() => (snap ? findLastClose(snap, "m5") : null), [snap]);
  const close15m = useMemo(() => (snap ? findLastClose(snap, "m15") : null), [snap]);
  const close1h = useMemo(() => (snap ? findLastClose(snap, "h1") : null), [snap]);
  const close4h = useMemo(() => (snap ? findLastClose(snap, "h4") : null), [snap]);
  const close1d = useMemo(() => (snap ? findLastClose(snap, "d1") : null), [snap]);

  const filteredTop = useMemo(() => {
    const q = toLower(fText).trim();
    if (!q) return top;
    return top.filter((s) => toLower([s?.symbol, s?.type, s?.bias, s?.trigger].join(" ")).includes(q));
  }, [top, fText]);

  const filteredAll = useMemo(() => {
    const q = toLower(fText).trim();
    if (!q) return all;
    return all.filter((s) => toLower([s?.symbol, s?.type, s?.bias, s?.trigger].join(" ")).includes(q));
  }, [all, fText]);

  const onOpenSetup = (s) => {
    setSelectedSetup(s);
    setDrawerOpen(true);
  };
  const onCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedSetup(null);
  };

  const onGenerate = async () => {
    setGenErr("");
    setGenLoading(true);
    try {
      const snapObj = await buildMarketSnapshotV4(safeSymbol, { tz: "America/Los_Angeles" });
      setSnap(snapObj);
      setTab("overview");
    } catch (e) {
      setGenErr(String(e?.message || e));
    } finally {
      setGenLoading(false);
    }
  };

  // Market context (content + icon only)
  const marketContextItems = useMemo(() => {
    if (!headlineObj) return [];
    const items = [];
    if (headlineObj.market_position) items.push({ key: "market", icon: "dot", tone: "muted", text: `${headlineObj.market_position}` });
    if (headlineObj.quick_risk) items.push({ key: "risk", icon: "risk", tone: "warn", text: `${headlineObj.quick_risk}` });
    if (headlineObj.trend_clarity) items.push({ key: "clarity", icon: "clarity", tone: "muted", text: `${headlineObj.trend_clarity}` });
    if (headlineObj.data_quality) items.push({ key: "data", icon: "data", tone: "muted", text: `${headlineObj.data_quality}` });

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
      else c.tone = "muted";
    }
    const d = items.find((x) => x.key === "data");
    if (d) {
      const s = toLower(d.text);
      if (s.includes("tốt") || s.includes("good") || s.includes("ok")) d.tone = "pos";
      else if (s.includes("kém") || s.includes("poor") || s.includes("partial")) d.tone = "warn";
      else d.tone = "muted";
    }
    return items;
  }, [headlineObj]);

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
      fontWeight: 800,
      color: "rgba(226,232,240,0.95)",
      outline: "none",
      minWidth: 0,
      width: "100%",
    },

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

  // Autocomplete datalist options
  const coinOptions = useMemo(() => {
    // keep it tight: top 100 only
    return coins.slice(0, 100).map((c) => {
      const label = `${c.name} (${c.symbol})`;
      const pair = `${c.symbol}USDT`;
      return { label, pair };
    });
  }, [coins]);

  // If user selects a datalist option, browser gives the value (label),
  // but we want to convert to pair. We'll map by label.
  const labelToPair = useMemo(() => {
    const m = new Map();
    for (const o of coinOptions) m.set(o.label, o.pair);
    return m;
  }, [coinOptions]);

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* TOPBAR: Generate + Summary + Candle closes */}
        <div style={styles.topbar}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 950, letterSpacing: 0.2 }}>{symbol || "—"}</div>

                {snap ? (
                  <>
                    <span style={chipStyle(chipsBase, "muted")}>Quality: {String(quality)}</span>
                    <span style={chipStyle(chipsBase, diagErrors ? "warn" : "pos")}>Errors: {diagErrors}</span>
                    <span style={chipStyle(chipsBase, "muted")}>Ref: {Number.isFinite(refPx) ? fmtNum(refPx) : "—"} ({pxSrc})</span>
                  </>
                ) : (
                  <span style={chipStyle(chipsBase, "muted")}>Chưa có snapshot</span>
                )}
              </div>

              {/* candle closes row */}
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={chipStyle(chipsBase, "muted")}>Close 5m: <b style={{ color: "rgba(226,232,240,0.95)" }}>{fmtNum(close5m)}</b></span>
                <span style={chipStyle(chipsBase, "muted")}>Close 15m: <b style={{ color: "rgba(226,232,240,0.95)" }}>{fmtNum(close15m)}</b></span>
                <span style={chipStyle(chipsBase, "muted")}>Close 1H: <b style={{ color: "rgba(226,232,240,0.95)" }}>{fmtNum(close1h)}</b></span>
                <span style={chipStyle(chipsBase, "muted")}>Close 4H: <b style={{ color: "rgba(226,232,240,0.95)" }}>{fmtNum(close4h)}</b></span>
                <span style={chipStyle(chipsBase, "muted")}>Close 1D: <b style={{ color: "rgba(226,232,240,0.95)" }}>{fmtNum(close1d)}</b></span>
              </div>

              <div style={{ marginTop: 8, fontSize: 12.5, color: "rgba(226,232,240,0.72)", fontWeight: 650, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {snap ? (
                  <>
                    Generated: <b style={{ color: "rgba(226,232,240,0.95)", fontWeight: 900 }}>{fmtTs(generatedAt, tz)}</b> · TZ:{" "}
                    <b style={{ color: "rgba(226,232,240,0.95)", fontWeight: 900 }}>{tz}</b>
                  </>
                ) : (
                  "Nhập Symbol rồi bấm Generate để chạy snapshot và phân tích."
                )}
              </div>
            </div>

            {/* Right controls: input + generate + tabs */}
            <div style={{ display: "grid", gap: 10, minWidth: isWide ? 420 : "100%" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <input
                    ref={symbolInputRef}
                    value={symbolInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      // if user picked from datalist (label), map to pair
                      const mapped = labelToPair.get(v);
                      setSymbolInput(mapped || v);
                    }}
                    onBlur={() => {
                      // normalize on blur
                      const v = String(symbolInput || "").trim();
                      if (labelToPair.has(v)) return;
                      // keep user string; safeSymbol will normalize.
                    }}
                    placeholder="BTC / BTCUSDT / ETH..."
                    style={styles.input}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    list="top100-coins"
                  />
                  <datalist id="top100-coins">
                    {coinOptions.map((o) => (
                      <option key={o.label} value={o.label} />
                    ))}
                  </datalist>
                  {coinsErr ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "rgba(245,158,11,0.95)", fontWeight: 750 }}>
                      Không load được Top 100 (CoinGecko). Bạn vẫn có thể nhập symbol thủ công.
                    </div>
                  ) : null}
                </div>

                <button style={styles.btn("primary")} onClick={onGenerate} disabled={genLoading || !safeSymbol}>
                  {genLoading ? "Generating..." : "Generate"}
                </button>
              </div>

              {genErr ? (
                <div style={{ color: "rgb(239,68,68)", fontWeight: 850, whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere" }}>{genErr}</div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={styles.segWrap}>
                  <button style={styles.segBtn(tab === "overview")} onClick={() => setTab("overview")}>Overview</button>
                  <button style={styles.segBtn(tab === "top")} onClick={() => setTab("top")}>Top</button>
                  <button style={styles.segBtn(tab === "all")} onClick={() => setTab("all")}>All</button>
                </div>

                <input
                  value={fText}
                  onChange={(e) => setFText(e.target.value)}
                  placeholder="Search trigger / bias / type..."
                  style={{ ...styles.input, width: isWide ? 260 : "100%" }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          {tab === "overview" ? (
            <div style={styles.card}>
              <Section title="Market Context" right={outlook ? "unified.market_outlook_v1" : "market_outlook_v1 not found"} noTop>
                {marketContextItems.length ? (
                  <div style={styles.subtle}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMid ? "repeat(2, minmax(0, 1fr))" : "1fr",
                        gap: 10,
                        minWidth: 0,
                      }}
                    >
                      {marketContextItems.map((it) => (
                        <div
                          key={it.key}
                          style={{
                            borderRadius: 16,
                            border: "1px solid rgba(148,163,184,0.18)",
                            background: "rgba(2,6,23,0.22)",
                            padding: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            minWidth: 0,
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(226,232,240,0.92)", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                            {it.text}
                          </div>
                          <span style={chipStyle({ padding: "6px 10px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center" }, it.tone)}>
                            <Icon name={it.icon} size={16} />
                          </span>
                        </div>
                      ))}
                    </div>

                    {flagObjs.length ? (
                      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {flagObjs.slice(0, 12).map((f, i) => {
                          const tone = toLower(f?.tone) === "good" ? "pos" : toLower(f?.tone) === "bad" ? "neg" : toLower(f?.tone) === "warn" ? "warn" : "muted";
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
                  <div style={{ color: "rgba(148,163,184,0.95)", fontWeight: 650, fontSize: 13 }}>(Không có headline trong snapshot)</div>
                )}
              </Section>

              {action ? (
                <Section title="Action" right={action?.status || ""}>
                  <div style={styles.subtle}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={chipStyle(chipsBase, "muted")}>Hành động: {action.status || "—"}</span>
                      {action.setup_type_label ? <span style={chipStyle(chipsBase, "muted")}>Setup: {action.setup_type_label}</span> : null}
                      {action.tf_label ? <span style={chipStyle(chipsBase, "muted")}>TF: {action.tf_label}</span> : null}
                      {action.order_type ? (
                        <span style={chipStyle(chipsBase, "muted")}>
                          Order: {action.order_type}
                          {action.order_price != null ? ` @ ${fmtNum(action.order_price)}` : ""}
                        </span>
                      ) : null}
                    </div>

                    {Array.isArray(action.summary) && action.summary.length ? (
                      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                        {action.summary.slice(0, 6).map((b, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <div style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(226,232,240,0.55)", marginTop: 7, flexShrink: 0 }} />
                            <div style={{ fontSize: 12.5, color: "rgba(226,232,240,0.80)", lineHeight: 1.4, fontWeight: 650, overflowWrap: "anywhere" }}>{String(b)}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              <Section title="Horizon Outlook" right={horizons.length ? `${horizons.length} horizons` : ""}>
                <div style={{ marginTop: 12, ...horizonsGridStyle }}>
                  {(horizons.length ? horizons : [{ title: "30m–4h" }, { title: "1–3d" }, { title: "1–2w" }]).map((h, i) => (
                    <div
                      key={i}
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
                      <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(226,232,240,0.95)" }}>{h?.title || h?.label || `Horizon ${i + 1}`}</div>
                      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {h?.bias ? <span style={chipStyle(chipsBase, toneForBias(h.bias))}>{String(h.bias)}</span> : null}
                        {h?.clarity ? <span style={chipStyle(chipsBase, "muted")}>Rõ xu hướng: {String(h.clarity)}</span> : null}
                        {Number.isFinite(Number(h?.confidence)) ? <span style={chipStyle(chipsBase, scoreToTone(Number(h.confidence)))}>Tin cậy: {fmtPct01(Number(h.confidence))}</span> : null}
                      </div>

                      {safeArr(h?.drivers).slice(0, 4).map((d, k) => (
                        <div key={k} style={{ marginTop: 8, fontSize: 12.5, color: "rgba(226,232,240,0.82)", fontWeight: 650, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                          • {String(d)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Primary Setup" right={primary ? "unified.setups_v2.primary" : "no primary setup"}>
                {primary ? (
                  <SetupCard setup={primary} onOpen={onOpenSetup} isWide={isWide} isMid={isMid} />
                ) : (
                  <div style={{ color: "rgba(148,163,184,0.95)", fontWeight: 650, fontSize: 13 }}>(Snapshot không có primary tradable setup)</div>
                )}
              </Section>

              <Section title="Top Candidates" right={filteredTop.length ? `${filteredTop.length} setups` : "none"}>
                {filteredTop.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {filteredTop.map((s, idx) => (
                      <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} dense isWide={isWide} isMid={isMid} />
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "rgba(148,163,184,0.95)", fontWeight: 650, fontSize: 13 }}>(Không có top_candidates khớp filter)</div>
                )}
              </Section>
            </div>
          ) : null}

          {tab === "top" ? (
            <div style={styles.card}>
              <Section title="Top Candidates" right={filteredTop.length ? `${filteredTop.length} setups` : "none"} noTop>
                {filteredTop.length ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {filteredTop.map((s, idx) => (
                      <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} isWide={isWide} isMid={isMid} />
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "rgba(148,163,184,0.95)", fontWeight: 650, fontSize: 13 }}>(Không có top_candidates khớp filter)</div>
                )}
              </Section>
            </div>
          ) : null}

          {tab === "all" ? (
            <div style={styles.card}>
              <Section title="All Candidates" right={`Showing ${filteredAll.length} / ${all.length}`} noTop>
                {filteredAll.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {filteredAll.map((s, idx) => (
                      <SetupCard key={pickSetupKey(s, idx)} setup={s} onOpen={onOpenSetup} dense isWide={isWide} isMid={isMid} />
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "rgba(148,163,184,0.95)", fontWeight: 650, fontSize: 13 }}>(Không có setup nào khớp filter)</div>
                )}
              </Section>
            </div>
          ) : null}
        </div>

        {/* Setup details drawer (NO raw JSON block) */}
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
            <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
              <div
                style={{
                  borderRadius: 18,
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: "rgba(30,41,59,0.45)",
                  padding: 14,
                  minWidth: 0,
                  backdropFilter: "blur(12px)",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>Trigger</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 800, color: "rgba(226,232,240,0.95)", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  {selectedSetup.trigger || "—"}
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    style={{
                      border: "1px solid rgba(148,163,184,0.22)",
                      background: "rgba(2,6,23,0.25)",
                      padding: "10px 12px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 850,
                      color: "rgba(226,232,240,0.95)",
                    }}
                    onClick={() => copyText(selectedSetup.trigger || "")}
                  >
                    Copy Trigger
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: "rgba(148,163,184,0.95)", fontWeight: 650 }}>No setup selected.</div>
          )}
        </Drawer>
      </div>
    </div>
  );
}
