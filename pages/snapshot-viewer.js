import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildMarketSnapshotV4 } from "../lib/snapshot/market-snapshot-v4"; // adjust path if needed

/* =========================
   Utilities
========================= */
function safeJsonParse(text) {
  try {
    return { ok: true, obj: JSON.parse(text) };
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

function pct(x, digits = 0) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtNum(x, digits = 2) {
  if (!Number.isFinite(x)) return "—";
  const d = Math.abs(x) >= 1000 ? Math.min(digits, 1) : digits;
  return x.toLocaleString(undefined, { maximumFractionDigits: d });
}

function fmtTs(ts, tz = "America/Los_Angeles") {
  if (!Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-US", { timeZone: tz });
  } catch {
    return new Date(ts).toISOString();
  }
}

function fmtTsShort(ts, tz = "America/Los_Angeles") {
  if (!Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString().slice(0, 16);
  }
}

function toLower(x) {
  return String(x || "").toLowerCase();
}

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

/* =========================
   Domain mapping
========================= */
function tfLabelVN(tf) {
  const x = String(tf || "");
  if (x === "5") return "5m";
  if (x === "15") return "15m";
  if (x === "60") return "1H";
  if (x === "240") return "4H";
  if (x === "D") return "1D";
  return x || "—";
}

function typeLabelVN(type) {
  const t = String(type || "");
  if (t === "reversal_sweep") return "Đảo chiều (sweep)";
  if (t === "breakout") return "Phá vỡ (breakout)";
  if (t === "trend_continuation") return "Tiếp diễn";
  if (t === "mean_reversion") return "Hồi về trung bình";
  return t || "—";
}

function statusMetaVN(status) {
  const s = toLower(status);
  if (s.includes("vào") || s === "ready") return { label: "SẴN SÀNG", tone: "pos" };
  if (s.includes("chờ") || s === "waiting") return { label: "CHỜ", tone: "warn" };
  if (s.includes("bỏ") || s.includes("no trade") || s === "missed") return { label: "ĐỨNG NGOÀI", tone: "muted" };
  if (s.includes("hỏng") || s === "invalidated") return { label: "HỎNG", tone: "neg" };
  return { label: String(status || "UNKNOWN"), tone: "muted" };
}

function toneForBias(bias) {
  const b = toLower(bias);
  if (b === "long" || b.includes("tăng")) return "pos";
  if (b === "short" || b.includes("giảm")) return "neg";
  return "muted";
}

function scoreToTone(x) {
  if (!Number.isFinite(x)) return "muted";
  if (x >= 0.8) return "pos";
  if (x >= 0.65) return "warn";
  return "muted";
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

function computeReadiness(outlook) {
  // Deterministic readiness score 0..1 using: guidance intent + primary context_fit + H0 confidence
  const g = outlook?.guidance?.now || null;
  const so = outlook?.setups_overview || null;
  const primaryId = safeArr(so?.by_horizon?.h0_4h?.focus)?.[0] || null;

  let fit = null;
  if (primaryId) {
    const it = safeArr(so?.items).find((x) => x?.id === primaryId);
    if (it && Number.isFinite(it?.context_fit)) fit = it.context_fit;
  } else {
    // fallback: try primary in setups_overview.primary (no id), use max context_fit
    const maxFit = Math.max(...safeArr(so?.items).map((x) => (Number.isFinite(x?.context_fit) ? x.context_fit : -1)));
    if (Number.isFinite(maxFit) && maxFit >= 0) fit = maxFit;
  }

  const h0 = safeArr(outlook?.horizons).find((h) => h?.key === "h0_4h");
  const conf = Number.isFinite(h0?.confidence) ? h0.confidence : null;

  const intent = String(g?.intent || "").toUpperCase();
  let base = 0.35;
  if (intent.includes("READY")) base = 0.70;
  else if (intent.includes("WAIT")) base = 0.45;
  else if (intent.includes("NO_TRADE")) base = 0.25;

  const fitAdj = Number.isFinite(fit) ? (fit - 0.5) * 0.35 : 0;
  const confAdj = Number.isFinite(conf) ? (conf - 0.5) * 0.25 : 0;

  return clamp(base + fitAdj + confAdj, 0, 1);
}

/* =========================
   Icons (inline SVG)
========================= */
function Icon({ name = "dot", size = 18, tone = "muted" }) {
  const colors = {
    pos: "rgba(34,197,94,1)",
    warn: "rgba(245,158,11,1)",
    neg: "rgba(239,68,68,1)",
    muted: "rgba(148,163,184,1)",
    cyan: "rgba(34,211,238,1)",
    violet: "rgba(167,139,250,1)",
  };
  const color = colors[tone] || colors.muted;
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" };
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

  if (name === "spark") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 2l1.2 5.2L18 9l-4.8 1.8L12 16l-1.2-5.2L6 9l4.8-1.8L12 2z" />
        <path {...stroke} d="M4 14l.8 3.2L8 18l-3.2.8L4 22l-.8-3.2L0 18l3.2-.8L4 14z" />
      </svg>
    );
  }
  if (name === "arrowUp") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 19V5" />
        <path {...stroke} d="M6 11l6-6 6 6" />
      </svg>
    );
  }
  if (name === "arrowDown") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 5v14" />
        <path {...stroke} d="M6 13l6 6 6-6" />
      </svg>
    );
  }
  if (name === "dash") {
    return (
      <svg {...common}>
        <path {...stroke} d="M5 12h14" />
      </svg>
    );
  }
  if (name === "shield") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 2l8 4v6c0 5-3 9-8 10C7 21 4 17 4 12V6l8-4z" />
      </svg>
    );
  }
  if (name === "bolt") {
    return (
      <svg {...common}>
        <path {...stroke} d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg {...common}>
        <circle {...stroke} cx="12" cy="12" r="9" />
        <path {...stroke} d="M12 7v6l4 2" />
      </svg>
    );
  }
  if (name === "x") {
    return (
      <svg {...common}>
        <path {...stroke} d="M6 6l12 12" />
        <path {...stroke} d="M18 6L6 18" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 3v10" />
        <path {...stroke} d="M7 10l5 5 5-5" />
        <path {...stroke} d="M5 21h14" />
      </svg>
    );
  }
  if (name === "layers") {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 2l9 5-9 5-9-5 9-5z" />
        <path {...stroke} d="M3 12l9 5 9-5" />
        <path {...stroke} d="M3 17l9 5 9-5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="4" fill={color} />
    </svg>
  );
}
/* =========================
   Help tooltips (VN)
========================= */
const HELP_VN = {
  readiness: {
    title: "Execution Readiness",
    lines: [
      "Là mức độ SẴN SÀNG để THỰC THI lệnh ngay lúc này (timing).",
      "Không phải xác suất thắng; không thay thế RR hay Score.",
      "Cách đọc nhanh: ≥70% có thể vào theo plan; 40–70% chờ thêm điều kiện; <40% đứng ngoài.",
      "Readiness thấp thường do: giá chưa về entry, trigger chưa xác nhận, hoặc đang tránh FOMO."
    ],
  },
  setup_score: {
    title: "Setup Score",
    lines: [
      "Là điểm chất lượng của setup (độ 'đáng trade' về mặt kỹ thuật + cấu trúc).",
      "Không phản ánh timing vào lệnh; timing xem ở Readiness.",
      "Cách đọc nhanh: ≥80% rất đẹp; 65–80% ổn; <65% chỉ theo dõi/đợi kèo tốt hơn.",
      "Score cao nhưng Readiness thấp: kèo đẹp nhưng CHƯA ĐẾN LÚC vào."
    ],
  },
  context_fit: {
    title: "Context Fit (FIT)",
    lines: [
      "Là mức độ phù hợp của setup với BỐI CẢNH thị trường hiện tại (thuận gió hay ngược gió).",
      "Ví dụ: Long hợp nếu HTF ủng hộ và dòng tiền nghiêng mua; ngược lại FIT giảm.",
      "Cách đọc nhanh: ≥70% ưu tiên; 50–70% theo dõi; <50% tránh (ngược bối cảnh).",
      "FIT khác Score: Score = kèo đẹp; FIT = kèo hợp bối cảnh."
    ],
  },
};

function HelpTip({ k }) {
  const data = HELP_VN[k];
  const [open, setOpen] = useState(false);
  if (!data) return null;

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-label={`Giải thích ${data.title}`}
    >
      <span
        style={{
          width: 16,
          height: 16,
          marginLeft: 6,
          borderRadius: 99,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(148,163,184,0.35)",
          background: "rgba(2,6,23,0.35)",
          color: "rgba(226,232,240,0.95)",
          fontSize: 11,
          fontWeight: 950,
          cursor: "help",
          userSelect: "none",
        }}
        title={`${data.title}: ${data.lines.join(" ")}`}
      >
        i
      </span>

      {open ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 20,
            zIndex: 5000,
            width: 320,
            maxWidth: "min(320px, 80vw)",
            padding: 12,
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.22)",
            background: "rgba(2,6,23,0.92)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 980, color: "rgba(226,232,240,0.95)" }}>{data.title}</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {data.lines.map((t, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ width: 6, height: 6, borderRadius: 99, marginTop: 6, background: "rgba(34,211,238,1)" }} />
                <div style={{ fontSize: 12, fontWeight: 750, color: "rgba(226,232,240,0.86)", lineHeight: 1.45 }}>
                  {t}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}

/* =========================
   UI primitives
========================= */
function chipStyle(tone) {
  const t = tone || "muted";
  const bg =
    t === "pos" ? "rgba(34,197,94,0.12)"
      : t === "warn" ? "rgba(245,158,11,0.14)"
        : t === "neg" ? "rgba(239,68,68,0.12)"
          : t === "cyan" ? "rgba(34,211,238,0.12)"
            : t === "violet" ? "rgba(167,139,250,0.14)"
              : "rgba(148,163,184,0.12)";
  const br =
    t === "pos" ? "rgba(34,197,94,0.35)"
      : t === "warn" ? "rgba(245,158,11,0.35)"
        : t === "neg" ? "rgba(239,68,68,0.30)"
          : t === "cyan" ? "rgba(34,211,238,0.30)"
            : t === "violet" ? "rgba(167,139,250,0.30)"
              : "rgba(148,163,184,0.24)";
  const fg =
    t === "pos" ? "rgba(134,239,172,1)"
      : t === "warn" ? "rgba(253,230,138,1)"
        : t === "neg" ? "rgba(254,202,202,1)"
          : t === "cyan" ? "rgba(165,243,252,1)"
            : t === "violet" ? "rgba(221,214,254,1)"
              : "rgba(226,232,240,0.90)";
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 999,
    border: `1px solid ${br}`,
    background: bg,
    color: fg,
    fontSize: 12,
    fontWeight: 850,
    userSelect: "none",
    whiteSpace: "nowrap",
  };
}

function Bar({ value01, tone = "cyan", labelLeft, labelRight, helpKey }) {
  const v = clamp(Number(value01), 0, 1);
  const c =
    tone === "pos" ? "rgba(34,197,94,1)"
      : tone === "warn" ? "rgba(245,158,11,1)"
        : tone === "neg" ? "rgba(239,68,68,1)"
          : tone === "violet" ? "rgba(167,139,250,1)"
            : "rgba(34,211,238,1)";

  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      {(labelLeft || labelRight) ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, fontWeight: 800, color: "rgba(148,163,184,0.95)" }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
            <span>{labelLeft || ""}</span>
            {helpKey ? <HelpTip k={helpKey} /> : null}
          </div>
          <div style={{ whiteSpace: "nowrap" }}>{labelRight || ""}</div>
        </div>
      ) : null}
      <div style={{ height: 10, borderRadius: 999, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(2,6,23,0.35)", overflow: "hidden", marginTop: (labelLeft || labelRight) ? 8 : 0 }}>
        <div style={{ height: "100%", width: `${(v * 100).toFixed(1)}%`, background: c, boxShadow: `0 0 18px ${c}` }} />
      </div>
    </div>
  );
}

function SectionTitle({ icon, tone, title, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {icon ? <Icon name={icon} tone={tone || "muted"} size={18} /> : null}
        <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(226,232,240,0.95)", letterSpacing: 0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
      </div>
      {right ? (
        <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(148,163,184,0.95)", whiteSpace: "nowrap" }}>{right}</div>
      ) : null}
    </div>
  );
}

function Drawer({ open, title, onClose, children }) {
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
        background: "rgba(2,6,23,0.78)",
        zIndex: 3000,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        padding: 12,
      }}
    >
      <div
        style={{
          width: "min(1020px, 100%)",
          maxHeight: "90vh",
          background: "rgba(15,23,42,0.92)",
          border: "1px solid rgba(148,163,184,0.22)",
          borderRadius: 18,
          boxShadow: "0 30px 100px rgba(0,0,0,0.55)",
          overflow: "hidden",
          backdropFilter: "blur(14px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: 14, borderBottom: "1px solid rgba(148,163,184,0.14)" }}>
          <div style={{ fontSize: 14, fontWeight: 950, color: "rgba(226,232,240,0.95)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || "Details"}</div>
          <button
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.24)",
              background: "rgba(2,6,23,0.35)",
              color: "rgba(226,232,240,0.95)",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            <Icon name="x" tone="muted" size={16} />
            Close
          </button>
        </div>
        <div style={{ padding: 14, overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* =========================
   Autocomplete (Top 100 by market cap)
========================= */
async function fetchTop100Coins(signal) {
  const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false";
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Coin list HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [];
  return list
    .map((c) => ({
      id: c?.id,
      name: c?.name,
      symbol: String(c?.symbol || "").toUpperCase(),
      rank: Number(c?.market_cap_rank),
      pair: `${String(c?.symbol || "").toUpperCase()}USDT`,
    }))
    .filter((x) => x.symbol && x.pair);
}

/* =========================
   Setup components
========================= */
function SetupMiniRow({ item, onOpen }) {
  const biasTone = toneForBias(item?.bias);
  const scoreTone = scoreToTone(item?.final_score);
  const fit = Number.isFinite(item?.context_fit) ? item.context_fit : null;

  const rr = Number.isFinite(item?.rr_tp1) ? item.rr_tp1 : null;
  const dEntry = Number.isFinite(item?.distance_to_entry_pct) ? item.distance_to_entry_pct : null;

  // Execution / trigger state
  const phase = String(item?.phase || item?.execution_state?.phase || "");
  const reasonCodes = safeArr(item?.execution_state?.reason);
  const insideEZ = !!item?.execution_state?.proximity?.inside_entry_zone;
  const needTextRaw = safeArr(item?.reasons_vn)?.[0] || "";

  const phaseMeta = (() => {
    const p = phase.toLowerCase();
    if (p === "ready") return { label: "READY", tone: "pos" };
    if (p === "waiting") return { label: "WAIT", tone: "warn" };
    if (p === "missed") return { label: "NO TRADE", tone: "muted" };
    if (p === "invalidated") return { label: "INVALID", tone: "neg" };
    // fallback by reasons
    if (reasonCodes.includes("inside_entry_zone")) return { label: "READY", tone: "pos" };
    if (reasonCodes.some((r) => String(r).startsWith("waiting_"))) return { label: "WAIT", tone: "warn" };
    return { label: phase ? phase.toUpperCase() : "—", tone: "muted" };
  })();

  const triggerState = (() => {
    if (phaseMeta.label === "READY") {
      return insideEZ ? "Trong entry zone" : "Sẵn sàng (gần entry)";
    }
    if (reasonCodes.includes("waiting_trigger") || reasonCodes.includes("waiting_reversal_confirmation")) {
      return "Chờ xác nhận trigger";
    }
    if (reasonCodes.includes("waiting_pullback_to_zone")) {
      return "Chờ hồi về entry";
    }
    if (reasonCodes.includes("price_too_far_from_entry_zone") || reasonCodes.includes("avoid_chasing")) {
      return "Xa entry, không đuổi";
    }
    if (phaseMeta.label === "INVALID") return "Kèo hỏng";
    return "Theo dõi";
  })();

  const needText = (() => {
    // show a very concrete next step if possible
    if (phaseMeta.label === "READY") return "Có thể đặt lệnh theo plan";
    if (needTextRaw) return needTextRaw;
    if (triggerState) return triggerState;
    return "Chờ điều kiện phù hợp";
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(item)}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1.0fr)",
        gap: 12,
        alignItems: "center",
        padding: "12px 12px",
        borderRadius: 14,
        border: "1px solid rgba(148,163,184,0.16)",
        background: "rgba(2,6,23,0.25)",
        cursor: "pointer",
      }}
    >
      {/* Left: identity + status + what to wait for */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, fontWeight: 980, color: "rgba(226,232,240,0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {typeLabelVN(item?.type)} • {String(item?.bias || "")} • {tfLabelVN(item?.timeframe)}
          </div>
          <span style={chipStyle(phaseMeta.tone)}>{phaseMeta.label}</span>
          <span style={chipStyle(biasTone)}>{String(item?.bias || "—")}</span>
          <span style={chipStyle("muted")}>{triggerState}</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12.0, fontWeight: 850, color: "rgba(226,232,240,0.78)", overflowWrap: "anywhere" }}>
          <span style={{ color: "rgba(148,163,184,0.95)", fontWeight: 950 }}>Cần đợi:</span> {needText}
        </div>

        {item?.trigger ? (
          <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 800, color: "rgba(148,163,184,0.95)", overflowWrap: "anywhere" }}>
            <span style={{ color: "rgba(148,163,184,0.95)", fontWeight: 950 }}>Trigger:</span> {item.trigger}
          </div>
        ) : null}
      </div>

      {/* Right: metrics */}
      <div style={{ minWidth: 0, display: "grid", gap: 10 }}>
        <Bar
          value01={Number.isFinite(item?.final_score) ? item.final_score : 0}
          tone={scoreTone === "pos" ? "pos" : scoreTone === "warn" ? "warn" : "cyan"}
          labelLeft="Score"
          labelRight={Number.isFinite(item?.final_score) ? pct(item.final_score, 0) : "—"}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>
            Fit<br />
            <b style={{ color: "rgba(226,232,240,0.95)" }}>{Number.isFinite(fit) ? pct(fit, 0) : "—"}</b>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>
            RR<br />
            <b style={{ color: "rgba(226,232,240,0.95)" }}>{Number.isFinite(rr) ? rr.toFixed(2) : "—"}</b>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 850, color: "rgba(148,163,184,0.95)", textAlign: "right" }}>
            ΔEntry<br />
            <b style={{ color: "rgba(226,232,240,0.95)" }}>{Number.isFinite(dEntry) ? pct(dEntry, 2) : "—"}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

function FocusSetupCard({ item, outlook, onOpen }) {
  if (!item) return null;

  const biasTone = toneForBias(item?.bias);
  const scoreTone = scoreToTone(item?.final_score);
  const fitTone = Number.isFinite(item?.context_fit) ? (item.context_fit >= 0.75 ? "pos" : item.context_fit >= 0.6 ? "warn" : "muted") : "muted";
  const rrTone = Number.isFinite(item?.rr_tp1) ? (item.rr_tp1 >= 2 ? "pos" : item.rr_tp1 >= 1.2 ? "warn" : "muted") : "muted";

  const ez = Array.isArray(item?.entry_zone) ? item.entry_zone : null;
  const stop = Number.isFinite(item?.stop) ? item.stop : null;
  const tp1 = Number.isFinite(item?.targets?.tp1) ? item.targets.tp1 : null;
  const tp2 = Number.isFinite(item?.targets?.tp2) ? item.targets.tp2 : null;

  const g = outlook?.guidance?.now || null;
  const status = g?.status || item?.status || item?.phase || "—";
  const st = statusMetaVN(status);

  const glow =
    biasTone === "pos" ? "rgba(34,197,94,0.35)"
      : biasTone === "neg" ? "rgba(239,68,68,0.28)"
        : "rgba(34,211,238,0.25)";

  return (
    <div
      style={{
        borderRadius: 20,
        border: "1px solid rgba(148,163,184,0.16)",
        background: "linear-gradient(180deg, rgba(15,23,42,0.80) 0%, rgba(2,6,23,0.55) 100%)",
        boxShadow: `0 26px 88px rgba(0,0,0,0.45), 0 0 28px ${glow}`,
        padding: 16,
        backdropFilter: "blur(16px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 980, color: "rgba(226,232,240,0.95)", letterSpacing: 0.2 }}>
              {typeLabelVN(item?.type)} • {String(item?.bias || "")} • {tfLabelVN(item?.timeframe)}
            </div>
            <span style={chipStyle(st.tone)}>{st.label}</span>
            <span style={chipStyle(biasTone)}>{String(item?.bias || "—")}</span>
          </div>

          <div style={{ marginTop: 8, fontSize: 12.5, color: "rgba(226,232,240,0.78)", fontWeight: 650, lineHeight: 1.45, overflowWrap: "anywhere" }}>
            <span style={{ fontWeight: 900, color: "rgba(226,232,240,0.95)" }}>Trigger:</span> {item?.trigger || "—"}
          </div>
        </div>

        <button
          onClick={() => onOpen?.(item)}
          style={{
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.22)",
            background: "rgba(2,6,23,0.35)",
            color: "rgba(226,232,240,0.95)",
            fontWeight: 950,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          View setup
        </button>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <div style={metricTileStyle()}>
            <div style={metricLabelStyle()}>Entry zone</div>
            <div style={metricValueStyle()}>{ez ? `${fmtNum(Math.min(ez[0], ez[1]))} → ${fmtNum(Math.max(ez[0], ez[1]))}` : "—"}</div>
            <div style={metricSubStyle()}>Preferred: <b style={{ color: "rgba(226,232,240,0.95)" }}>{fmtNum(item?.entry_preferred)}</b></div>
          </div>

          <div style={metricTileStyle()}>
            <div style={metricLabelStyle()}>Stop</div>
            <div style={metricValueStyle()}>{fmtNum(stop)}</div>
            <div style={metricSubStyle()}>ΔStop: <b style={{ color: "rgba(226,232,240,0.95)" }}>{Number.isFinite(item?.stop_distance_pct) ? pct(item.stop_distance_pct, 2) : "—"}</b></div>
          </div>

          <div style={metricTileStyle()}>
            <div style={metricLabelStyle()}>Targets</div>
            <div style={metricValueStyle()}>{Number.isFinite(tp1) ? `TP1 ${fmtNum(tp1)}` : "TP1 —"}</div>
            <div style={metricSubStyle()}>{Number.isFinite(tp2) ? `TP2 ${fmtNum(tp2)}` : "\u00A0"}</div>
          </div>

          <div style={metricTileStyle()}>
            <div style={metricLabelStyle()}>Execution</div>
            <div style={metricValueStyle()}>{g?.status || item?.phase || "—"}</div>
            <div style={metricSubStyle()}>{g?.summary || "—"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 12, alignItems: "end" }}>
          <Bar
            value01={Number.isFinite(item?.final_score) ? item.final_score : 0}
            tone={scoreTone === "pos" ? "pos" : scoreTone === "warn" ? "warn" : "cyan"}
            labelLeft="Setup Score" helpKey="setup_score"
            labelRight={Number.isFinite(item?.final_score) ? pct(item.final_score, 0) : "—"}
          />
          <Bar
            value01={Number.isFinite(item?.context_fit) ? item.context_fit : 0}
            tone={fitTone}
            labelLeft="Context Fit" helpKey="context_fit"
            labelRight={Number.isFinite(item?.context_fit) ? pct(item.context_fit, 0) : "—"}
          />
          <Bar
            value01={Number.isFinite(item?.rr_tp1) ? clamp(item.rr_tp1 / 4, 0, 1) : 0}
            tone={rrTone}
            labelLeft="RR (TP1)"
            labelRight={Number.isFinite(item?.rr_tp1) ? item.rr_tp1.toFixed(2) : "—"}
          />
        </div>
      </div>
    </div>
  );
}

function metricTileStyle() {
  return {
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.14)",
    background: "rgba(2,6,23,0.28)",
    minHeight: 92,
    display: "grid",
    alignContent: "center",
    gap: 4,
    textAlign: "center",
  };
}
function metricLabelStyle() {
  return { fontSize: 11, fontWeight: 850, color: "rgba(148,163,184,0.95)" };
}
function metricValueStyle() {
  return { fontSize: 13.5, fontWeight: 980, color: "rgba(226,232,240,0.95)" };
}
function metricSubStyle() {
  return { fontSize: 11.5, fontWeight: 700, color: "rgba(226,232,240,0.78)", overflowWrap: "anywhere" };
}

function BulletList({ items, tone = "muted" }) {
  const xs = safeArr(items).filter(Boolean);
  if (!xs.length) return <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)", fontWeight: 750 }}>—</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {xs.map((t, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 8, height: 8, borderRadius: 99, marginTop: 6, background: tone === "pos" ? "rgba(34,197,94,1)" : tone === "warn" ? "rgba(245,158,11,1)" : tone === "neg" ? "rgba(239,68,68,1)" : "rgba(148,163,184,0.85)" }} />
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(226,232,240,0.86)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{String(t)}</div>
        </div>
      ))}
    </div>
  );
}

function SetupDetails({ item }) {
  if (!item) return null;

  const biasTone = toneForBias(item?.bias);
  const scoreTone = scoreToTone(item?.final_score);
  const fitTone = Number.isFinite(item?.context_fit) ? (item.context_fit >= 0.75 ? "pos" : item.context_fit >= 0.6 ? "warn" : "muted") : "muted";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={chipStyle(biasTone)}>{String(item?.bias || "—")}</span>
        <span style={chipStyle("muted")}>{tfLabelVN(item?.timeframe)}</span>
        <span style={chipStyle(scoreTone)}>{Number.isFinite(item?.final_score) ? `Score ${pct(item.final_score, 0)}` : "Score —"}</span>
        <span style={chipStyle(fitTone)}>{Number.isFinite(item?.context_fit) ? `Fit ${pct(item.context_fit, 0)}` : "Fit —"}</span>
        <span style={chipStyle("cyan")}>{Number.isFinite(item?.rr_tp1) ? `RR ${item.rr_tp1.toFixed(2)}` : "RR —"}</span>
        <span style={chipStyle("violet")}>{item?.symbol || ""}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
        <div style={detailCardStyle()}>
          <SectionTitle icon="layers" tone="cyan" title="Entry / Stop / Targets" />
          <KV k="Entry zone" v={Array.isArray(item?.entry_zone) ? `${fmtNum(Math.min(item.entry_zone[0], item.entry_zone[1]))} → ${fmtNum(Math.max(item.entry_zone[0], item.entry_zone[1]))}` : "—"} />
          <KV k="Entry preferred" v={fmtNum(item?.entry_preferred)} />
          <KV k="Stop" v={fmtNum(item?.stop)} />
          <KV k="TP1" v={fmtNum(item?.targets?.tp1)} />
          <KV k="TP2" v={fmtNum(item?.targets?.tp2)} />
        </div>

        <div style={detailCardStyle()}>
          <SectionTitle icon="shield" tone="violet" title="Execution metrics" />
          <KV k="Phase" v={String(item?.phase || item?.execution_state?.phase || "—")} />
          <KV k="Readiness" v={String(item?.execution_state?.readiness || "—")} />
          <KV k="ΔEntry" v={Number.isFinite(item?.distance_to_entry_pct) ? pct(item.distance_to_entry_pct, 2) : "—"} />
          <KV k="ΔStop" v={Number.isFinite(item?.stop_distance_pct) ? pct(item.stop_distance_pct, 2) : "—"} />
          <KV k="RR TP1" v={Number.isFinite(item?.rr_tp1) ? item.rr_tp1.toFixed(2) : "—"} />
        </div>
      </div>

      <div style={detailCardStyle()}>
        <SectionTitle icon="spark" tone="pos" title="Explainer" right="Retail playbook" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
          <div style={miniBlockStyle()}>
            <div style={miniBlockTitleStyle()}>Vì sao kèo này đáng chú ý</div>
            <BulletList items={item?.explain?.why_this_setup} />
          </div>
          <div style={miniBlockStyle()}>
            <div style={miniBlockTitleStyle()}>Cách vào lệnh</div>
            <BulletList items={item?.explain?.entry_tactics} />
          </div>
          <div style={miniBlockStyle()}>
            <div style={miniBlockTitleStyle()}>Điều kiện hỏng kèo</div>
            <BulletList items={item?.explain?.invalidation} tone="neg" />
          </div>
          <div style={miniBlockStyle()}>
            <div style={miniBlockTitleStyle()}>Quản trị lệnh</div>
            <BulletList items={item?.explain?.management} tone="warn" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px dashed rgba(148,163,184,0.22)" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(148,163,184,0.95)" }}>{k}</div>
      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(226,232,240,0.92)", textAlign: "right", overflowWrap: "anywhere" }}>{v}</div>
    </div>
  );
}

function detailCardStyle() {
  return {
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.16)",
    background: "rgba(2,6,23,0.28)",
    padding: 14,
    backdropFilter: "blur(12px)",
    minWidth: 0,
  };
}
function miniBlockStyle() {
  return {
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.14)",
    background: "rgba(15,23,42,0.45)",
    minWidth: 0,
  };
}
function miniBlockTitleStyle() {
  return { fontSize: 12.5, fontWeight: 950, color: "rgba(226,232,240,0.95)", marginBottom: 10 };
}

/* =========================
   Market DNA panel
========================= */
function TrendCell({ tf, label }) {
  const t = String(label || "range");
  const isBull = t === "bull";
  const isBear = t === "bear";
  const icon = isBull ? "arrowUp" : isBear ? "arrowDown" : "dash";
  const tone = isBull ? "pos" : isBear ? "neg" : "muted";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.14)", background: "rgba(2,6,23,0.28)" }}>
      <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(226,232,240,0.92)" }}>{tfLabelVN(tf)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>{t.toUpperCase()}</div>
        <Icon name={icon} tone={tone} size={18} />
      </div>
    </div>
  );
}

function VolRow({ tf, v }) {
  const vv = Number(v);
  const tone = vv > 0.02 ? "neg" : vv > 0.012 ? "warn" : vv > 0.005 ? "cyan" : "muted";
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Bar value01={Number.isFinite(vv) ? clamp(vv / 0.04, 0, 1) : 0} tone={tone} labelLeft={`${tfLabelVN(tf)} ATR%`} labelRight={Number.isFinite(vv) ? pct(vv, 2) : "—"} />
    </div>
  );
}

function MarketDNA({ outlook, refPx, pxSrc, isMobile }) {
  const ctx = outlook?.context || null;
  const regime = ctx?.regime?.label || "—";
  const composite = Number(ctx?.regime?.composite);
  const strength = Number(ctx?.regime?.strength);
  const orderflowText = ctx?.orderflow?.text || "—";
  const orderflowFlag = ctx?.orderflow?.flag || "—";

  const q = String(ctx?.data_quality || "—");
  const dqTone = q.includes("Đủ") ? "pos" : q.includes("Thiếu") ? "warn" : "muted";

  const tfTrend = ctx?.trend_by_tf || {};
  const vol = ctx?.volatility_by_tf || {};

  const deriv = ctx?.derivatives || {};
  const fund = deriv?.funding_text;
  const lev = deriv?.leverage_text;
  const liq = deriv?.liquidation_text;
  const liqLevel = deriv?.liquidation_level || "none";

  const ofTone = orderflowFlag.includes("buy") ? "pos" : orderflowFlag.includes("sell") ? "neg" : "muted";
  const liqTone = liqLevel === "high" ? "neg" : liqLevel === "mid" ? "warn" : "muted";

  const regimeTone =
    regime === "bull" ? "pos"
      : regime === "bear" ? "neg"
        : regime.includes("range") ? "warn"
          : "muted";

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.16)", background: "rgba(15,23,42,0.60)", boxShadow: "0 18px 60px rgba(0,0,0,0.32)", padding: 14, backdropFilter: "blur(14px)" }}>
      <SectionTitle icon="layers" tone="violet" title="Market DNA" right={isMobile ? "" : "Context"} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={chipStyle(regimeTone)}>Regime: {String(regime)}</span>
        <span style={chipStyle("muted")}>Composite: {Number.isFinite(composite) ? composite.toFixed(2) : "—"}</span>
        <span style={chipStyle("muted")}>Strength: {Number.isFinite(strength) ? strength.toFixed(2) : "—"}</span>
        <span style={chipStyle(dqTone)}>Data: {q}</span>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={{ padding: 12, borderRadius: 16, border: "1px solid rgba(148,163,184,0.14)", background: "rgba(2,6,23,0.28)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, fontWeight: 950, color: "rgba(226,232,240,0.95)" }}>Reference price</div>
            <div style={{ fontSize: 12.5, fontWeight: 950, color: "rgba(226,232,240,0.95)" }}>
              {Number.isFinite(refPx) ? fmtNum(refPx) : "—"} <span style={{ fontSize: 11.5, fontWeight: 800, color: "rgba(148,163,184,0.95)" }}>({pxSrc})</span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 950, color: "rgba(226,232,240,0.95)" }}>Trend matrix</div>
          <div style={{ display: "grid", gap: 8 }}>
            {["5", "15", "60", "240", "D"].map((k) => (
              <TrendCell key={k} tf={k} label={tfTrend?.[k]?.trend} />
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 950, color: "rgba(226,232,240,0.95)" }}>Volatility (ATR%)</div>
          <div style={{ display: "grid", gap: 10 }}>
            {["15", "60", "240", "D"].map((k) => (
              <VolRow key={k} tf={k} v={vol?.[k]} />
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={chipStyle(ofTone)}>Orderflow</span>
            <span style={{ fontSize: 12.5, fontWeight: 750, color: "rgba(226,232,240,0.80)", overflowWrap: "anywhere" }}>{orderflowText}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={chipStyle(liqTone)}>Liquidation: {String(liqLevel)}</span>
            {fund ? <span style={chipStyle("muted")}>{fund}</span> : null}
            {lev ? <span style={chipStyle("muted")}>{lev}</span> : null}
            {liq ? <span style={chipStyle("muted")}>{liq}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Loading pipeline (hi-tech)
========================= */
function useLoadingPipeline(isLoading) {
  const steps = useMemo(
    () => [
      { key: "scan", label: "Scanning market structure" },
      { key: "flow", label: "Measuring orderflow & volatility" },
      { key: "deriv", label: "Evaluating derivatives risk" },
      { key: "rank", label: "Ranking setups & execution quality" },
      { key: "compose", label: "Composing snapshot & outlook" },
    ],
    []
  );

  const [idx, setIdx] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setIdx(0);
      setElapsedMs(0);
      return;
    }
    let raf = null;
    let start = performance.now();

    const tick = () => {
      const now = performance.now();
      const elapsed = now - start;
      setElapsedMs(elapsed);
      const step = Math.floor(elapsed / 850);
      setIdx(Math.min(step, steps.length - 1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, [isLoading, steps.length]);

  // Monotonic progress: reach 100% and stay there until the real generation finishes.
  // Avoid looping 80% -> 100% caused by fractional progress on the last step.
  const total = steps.length * 850;
  const progress01 = isLoading ? clamp(elapsedMs / total, 0, 1) : 0;

  return { steps, idx, progress01 };
}

/* =========================
   Main page (FULL REWRITE)
========================= */
export default function SnapshotViewerPage() {
  // Responsive
  const [isWide, setIsWide] = useState(false);
  const [isMid, setIsMid] = useState(false);
  const lastWRef = useRef(0);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth || 0;
      if (Math.abs(w - lastWRef.current) < 2) return;
      lastWRef.current = w;
      setIsWide(w >= 1120);
      setIsMid(w >= 820);
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

  // Autocomplete
  const [symbolInput, setSymbolInput] = useState("ETHUSDT");
  const symbolInputRef = useRef(null);
  const [topCoins, setTopCoins] = useState([]);
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
        const list = await fetchTop100Coins(ac.signal);
        if (!alive) return;
        setTopCoins(list);
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
      try { ac.abort(); } catch { }
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

  const safeSymbol = useMemo(() => String(symbolInput || "").toUpperCase().trim(), [symbolInput]);

  const suggestions = useMemo(() => {
    const q = String(symbolInput || "").toUpperCase().trim();
    const xs = topCoins.slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
    if (!q) return xs.slice(0, 12);
    const q2 = q.endsWith("USDT") ? q.slice(0, -4) : q;
    return xs
      .filter((c) => c.pair.startsWith(q) || c.symbol.startsWith(q2) || String(c.name || "").toUpperCase().includes(q2))
      .slice(0, 12);
  }, [topCoins, symbolInput]);

  const pickSuggestion = (c) => {
    if (!c) return;
    setSymbolInput(c.pair);
    setSuggOpen(false);
    setSuggActive(-1);
    requestAnimationFrame(() => symbolInputRef.current?.focus());
  };

  // Snapshot state
  const [snap, setSnap] = useState(null);
  const [raw, setRaw] = useState("");
  const [tab, setTab] = useState("cockpit"); // cockpit | all | debug
  const [autoDownload, setAutoDownload] = useState(true);

  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState("");

  const { steps, idx: loadIdx, progress01 } = useLoadingPipeline(genLoading);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const onOpenItem = (it) => {
    setSelectedItem(it);
    setDrawerOpen(true);
  };
  const onCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedItem(null);
  };

  // Derived
  const outlook = snap?.unified?.market_outlook_v1 || null;
  const so = outlook?.setups_overview || null;
  const byH = so?.by_horizon || null;
  const items = safeArr(so?.items);
  const h0 = byH?.h0_4h || null;

  const focusIds = safeArr(h0?.focus);
  const watchIds = safeArr(h0?.watchlist);
  const avoidIds = safeArr(h0?.avoid);

  const focusItem = focusIds.length ? items.find((x) => x?.id === focusIds[0]) : null;
  const watchItems = watchIds.map((id) => items.find((x) => x?.id === id)).filter(Boolean);
  const avoidItems = avoidIds.map((id) => items.find((x) => x?.id === id)).filter(Boolean);

  const tz = snap?.runtime?.tz || "America/Los_Angeles";
  const generatedAt = Number(snap?.generated_at);
  const symbol = snap?.symbol || snap?.request?.symbol || safeSymbol || "—";

  const { px: refPx, src: pxSrc } = useMemo(() => getPrimaryPrice(snap), [snap]);
  const readiness01 = useMemo(() => computeReadiness(outlook), [outlook]);

  const h0Obj = useMemo(() => safeArr(outlook?.horizons).find((h) => h?.key === "h0_4h") || null, [outlook]);
  const headline = outlook?.headline || null;
  const action = outlook?.action || null;

  const status = outlook?.guidance?.now?.status || action?.status || "—";
  const st = statusMetaVN(status);

  const scoreTone = scoreToTone(focusItem?.final_score);
  const pageBg =
    "radial-gradient(1200px 700px at 10% 0%, rgba(99,102,241,0.26) 0%, rgba(99,102,241,0) 60%)," +
    "radial-gradient(1100px 650px at 92% 12%, rgba(34,211,238,0.22) 0%, rgba(34,211,238,0) 55%)," +
    "radial-gradient(900px 520px at 50% 110%, rgba(34,197,94,0.14) 0%, rgba(34,197,94,0) 55%)," +
    "linear-gradient(180deg, rgba(2,6,23,1) 0%, rgba(15,23,42,1) 55%, rgba(2,6,23,1) 100%)";

  const fontStack =
    '"Be Vietnam Pro","Inter",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Helvetica Neue",Arial';

  const shellMax = 1280;

  // Actions
  const onGenerate = async () => {
    setGenErr("");
    setGenLoading(true);
    try {
      const snapObj = await buildMarketSnapshotV4(safeSymbol, { tz: "America/Los_Angeles" });
      setSnap(snapObj);
      setRaw(JSON.stringify(snapObj, null, 2));

      if (autoDownload) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const name = `market-snapshot-v4_${safeSymbol}_${ts}.json`;
        downloadJson(snapObj, name);
      }
      setTab("cockpit");
    } catch (e) {
      setGenErr(String(e?.message || e));
    } finally {
      setGenLoading(false);
    }
  };

  const onDownload = () => {
    if (!snap) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `market-snapshot-v4_${(snap?.symbol || safeSymbol || "SNAP")}_${ts}.json`;
    downloadJson(snap, name);
  };

  const onPasteApply = () => {
    const res = safeJsonParse(raw);
    if (!res.ok) {
      setGenErr(res.err || "Invalid JSON");
      return;
    }
    setSnap(res.obj);
    setGenErr("");
    setTab("cockpit");
  };

  // UI styles
  const btn = (variant) => ({
    padding: "10px 12px",
    borderRadius: 14,
    border: variant === "primary" ? "1px solid rgba(226,232,240,0.34)" : "1px solid rgba(148,163,184,0.22)",
    background: variant === "primary" ? "rgba(226,232,240,0.10)" : "rgba(2,6,23,0.30)",
    color: "rgba(226,232,240,0.95)",
    fontWeight: 950,
    fontSize: 12,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    backdropFilter: "blur(12px)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  });

  const inputStyle = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "rgba(2,6,23,0.35)",
    fontSize: 12,
    fontWeight: 850,
    color: "rgba(226,232,240,0.95)",
    outline: "none",
    minWidth: 0,
  };

  const segWrap = {
    display: "inline-flex",
    padding: 4,
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(2,6,23,0.25)",
    gap: 4,
    backdropFilter: "blur(12px)",
  };
  const segBtn = (active) => ({
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.0)",
    background: active ? "rgba(226,232,240,0.12)" : "transparent",
    color: "rgba(226,232,240,0.95)",
    fontWeight: 950,
    fontSize: 12,
    cursor: "pointer",
    userSelect: "none",
    minWidth: 86,
    textAlign: "center",
  });

  const card = {
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.16)",
    background: "rgba(15,23,42,0.60)",
    boxShadow: "0 18px 64px rgba(0,0,0,0.32)",
    padding: 14,
    backdropFilter: "blur(14px)",
    minWidth: 0,
  };

  const heroCard = {
    borderRadius: 20,
    border: "1px solid rgba(148,163,184,0.16)",
    background: "linear-gradient(180deg, rgba(15,23,42,0.78) 0%, rgba(2,6,23,0.55) 100%)",
    boxShadow: "0 22px 78px rgba(0,0,0,0.45)",
    padding: 16,
    backdropFilter: "blur(16px)",
    minWidth: 0,
  };

  // Guidance hero content
  const g = outlook?.guidance?.now || null;
  const doList = safeArr(g?.do);
  const avoidList = safeArr(g?.avoid);
  const reasonsVN = safeArr(g?.reasons_vn);

  // Market headline chips
  const chips = [];
  // Compact meta (Ref + Updated + State) to reduce clutter in the top bar
  if (Number.isFinite(refPx) || Number.isFinite(generatedAt)) {
    const parts = [];
    if (Number.isFinite(refPx)) parts.push(`Ref ${fmtNum(refPx)} (${pxSrc})`);
    if (Number.isFinite(generatedAt)) parts.push(`Upd ${fmtTsShort(generatedAt, tz)}`);
    if (parts.length) chips.push({ tone: "muted", text: parts.join(" • ") });
  }
  // State (READY/CHỜ/ĐỨNG NGOÀI...) sits with the other market chips, not the command controls
  if (st?.label) chips.push({ tone: st.tone, text: `Trạng thái: ${st.label}` });
  if (headline?.market_position) chips.push({ tone: "violet", text: headline.market_position });
  if (headline?.trend_clarity) chips.push({ tone: "muted", text: headline.trend_clarity });
  if (headline?.quick_risk) chips.push({ tone: "warn", text: headline.quick_risk });
  if (headline?.data_quality) chips.push({ tone: "muted", text: headline.data_quality });

  const isMobile = !isMid;

  return (
    <div style={{ minHeight: "100vh", background: pageBg, color: "rgba(226,232,240,0.95)", fontFamily: fontStack, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      {/* Top Command Bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 2000, padding: isWide ? "14px 18px" : "12px 12px", borderBottom: "1px solid rgba(148,163,184,0.10)", background: "rgba(2,6,23,0.55)", backdropFilter: "blur(16px)" }}>
        <div style={{ maxWidth: shellMax, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="spark" tone="cyan" size={18} />
                <div style={{ fontSize: 15, fontWeight: 980, letterSpacing: 0.2 }}>{symbol}</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div ref={suggWrapRef} style={{ position: "relative", minWidth: isMid ? 220 : 180, flex: isMid ? "0 0 260px" : "1 1 180px" }}>
              <input
                ref={symbolInputRef}
                value={symbolInput}
                onChange={(e) => { setSymbolInput(e.target.value); setSuggOpen(true); setSuggActive(-1); }}
                onFocus={() => setSuggOpen(true)}
                onKeyDown={(e) => {
                  if (!suggOpen) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setSuggActive((v) => Math.min(v + 1, suggestions.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSuggActive((v) => Math.max(v - 1, 0)); }
                  else if (e.key === "Enter") {
                    if (suggActive >= 0 && suggestions[suggActive]) { e.preventDefault(); pickSuggestion(suggestions[suggActive]); }
                  } else if (e.key === "Escape") { setSuggOpen(false); setSuggActive(-1); }
                }}
                placeholder="BTCUSDT"
                style={{ ...inputStyle, width: "100%" }}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />

              {suggOpen ? (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, borderRadius: 16, border: "1px solid rgba(148,163,184,0.24)", background: "rgba(15,23,42,0.96)", boxShadow: "0 26px 70px rgba(0,0,0,0.55)", overflow: "hidden", zIndex: 2400, maxHeight: 320 }}>
                  <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid rgba(148,163,184,0.14)" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 950, color: "rgba(148,163,184,0.95)" }}>Top 100 (market cap)</div>
                    <div style={{ fontSize: 11.5, fontWeight: 850, color: "rgba(148,163,184,0.90)" }}>{coinsLoading ? "Loading..." : coinsErr ? "Unavailable" : `${topCoins.length} coins`}</div>
                  </div>

                  {coinsErr ? (
                    <div style={{ padding: 12, fontSize: 12, fontWeight: 800, color: "rgba(226,232,240,0.85)" }}>
                      Không tải được danh sách coin. Vẫn nhập thủ công (vd: BTCUSDT).<br />
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
                            onMouseDown={(e) => { e.preventDefault(); pickSuggestion(c); }}
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
                              <div style={{ fontSize: 12.5, fontWeight: 980, color: "rgba(226,232,240,0.95)" }}>{c.pair}</div>
                              <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 800, color: "rgba(148,163,184,0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                            </div>
                            <div style={{ fontSize: 11.5, fontWeight: 950, color: "rgba(148,163,184,0.95)" }}>#{Number.isFinite(c.rank) ? c.rank : "—"}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: 12, fontSize: 12, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>Không có gợi ý phù hợp.</div>
                  )}
                </div>
              ) : null}
            </div>

            <button style={btn("primary")} onClick={onGenerate} disabled={genLoading || !safeSymbol}>
              <Icon name="bolt" tone="cyan" size={16} />
              {genLoading ? "Generating..." : "Generate"}
            </button>

            <button style={btn("secondary")} onClick={onDownload} disabled={!snap}>
              <Icon name="download" tone="muted" size={16} />
              Download
            </button>

            <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(2,6,23,0.25)", fontSize: 12, fontWeight: 950, color: "rgba(226,232,240,0.95)" }}>
              <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
              Auto download
            </label>

            <div style={segWrap}>
              <button style={segBtn(tab === "cockpit")} onClick={() => setTab("cockpit")}>Cockpit</button>
              <button style={segBtn(tab === "all")} onClick={() => setTab("all")} disabled={!snap}>All setups</button>
              <button style={segBtn(tab === "debug")} onClick={() => setTab("debug")}>Debug</button>
            </div>
          </div>
        </div>

        {/* Market headline banner (separate from command bar to reduce clutter) */}
        {chips.length ? (
          <div style={{ padding: isWide ? "10px 18px 0" : "10px 12px 0" }}>
            <div
              style={{
                maxWidth: shellMax,
                margin: "0 auto",
                padding: "10px 12px",
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.12)",
                background: "rgba(15,23,42,0.40)",
                boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
                backdropFilter: "blur(14px)",
                overflowX: "auto",
                display: "flex",
                gap: 10,
                alignItems: "center",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {chips.map((c, i) => (
                <span key={i} style={chipStyle(c.tone)}>{c.text}</span>
              ))}
            </div>
          </div>
        ) : null}

        {genLoading ? (
          <div style={{ maxWidth: shellMax, margin: "12px auto 0", padding: "0 0 4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, fontWeight: 950, color: "rgba(226,232,240,0.92)" }}>
                {steps[loadIdx]?.label}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(148,163,184,0.95)" }}>{Math.round(progress01 * 100)}%</div>
            </div>
            <div style={{ marginTop: 8 }}>
              <Bar value01={progress01} tone="cyan" />
            </div>
          </div>
        ) : null}

        {genErr ? (
          <div style={{ maxWidth: shellMax, margin: "10px auto 0", color: "rgba(239,68,68,0.95)", fontWeight: 900, fontSize: 12.5, whiteSpace: "pre-wrap" }}>
            {genErr}
          </div>
        ) : null}
      </div>

      {/* Main layout */}
      <div style={{ maxWidth: shellMax, margin: "0 auto", padding: isWide ? "18px 18px 28px" : "14px 12px 22px" }}>
        {tab === "cockpit" ? (
          <div style={{ display: "grid", gridTemplateColumns: isWide ? "420px 1fr" : "1fr", gap: 14, alignItems: "start" }}>
            {/* Left: Market DNA */}
            <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
              <MarketDNA outlook={outlook} refPx={refPx} pxSrc={pxSrc} isMobile={!isWide} />

              <div style={card}>
                <SectionTitle icon="clock" tone="muted" title="Horizon signals" right="30m → 2w" />
                {safeArr(outlook?.horizons).length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {safeArr(outlook?.horizons).map((h) => {
                      const biasTone = h?.bias === "Tăng" ? "pos" : h?.bias === "Giảm" ? "neg" : "muted";
                      const confTone = scoreToTone(h?.confidence);
                      return (
                        <div key={h?.key || h?.title} style={{ padding: 12, borderRadius: 16, border: "1px solid rgba(148,163,184,0.14)", background: "rgba(2,6,23,0.28)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div style={{ fontSize: 12.5, fontWeight: 980, color: "rgba(226,232,240,0.95)" }}>{h?.title || "—"}</div>
                            <span style={chipStyle(biasTone)}>{h?.bias || "—"}</span>
                          </div>
                          <div style={{ marginTop: 10 }}>
                            <Bar value01={Number.isFinite(h?.confidence) ? h.confidence : 0} tone={confTone === "pos" ? "pos" : confTone === "warn" ? "warn" : "cyan"} labelLeft="Confidence" labelRight={Number.isFinite(h?.confidence) ? pct(h.confidence, 0) : "—"} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>
                    Generate snapshot để xem market outlook.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Action area */}
            <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
              {/* Guidance Hero */}
              <div style={heroCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Icon name={st.tone === "pos" ? "bolt" : st.tone === "warn" ? "clock" : st.tone === "neg" ? "x" : "shield"} tone={st.tone} size={20} />
                        <div style={{ fontSize: 16, fontWeight: 980, color: "rgba(226,232,240,0.95)", letterSpacing: 0.2 }}>
                          Guidance Now
                        </div>
                      </div>
                      <span style={chipStyle(st.tone)}>{st.label}</span>
                      {h0Obj?.bias ? <span style={chipStyle(h0Obj.bias === "Tăng" ? "pos" : h0Obj.bias === "Giảm" ? "neg" : "muted")}>H0 bias: {h0Obj.bias}</span> : null}
                      {Number.isFinite(readiness01) ? <span style={chipStyle("cyan")}>Readiness {pct(readiness01, 0)}</span> : null}
                    </div>

                    <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800, color: "rgba(226,232,240,0.86)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                      {g?.summary || action?.summary?.[0] || headline?.market_position || "Generate snapshot để xem hướng hành động."}
                    </div>
                  </div>

                  <div style={{ minWidth: 240, flex: "0 0 280px" }}>
                    <Bar value01={readiness01} tone={st.tone === "pos" ? "pos" : st.tone === "warn" ? "warn" : st.tone === "neg" ? "neg" : "cyan"} labelLeft="Execution readiness" helpKey="readiness" labelRight={pct(readiness01, 0)} />
                  </div>
                </div>

                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: isMid ? "1fr 1fr" : "1fr", gap: 12 }}>
                  <div style={{ padding: 12, borderRadius: 16, border: "1px solid rgba(148,163,184,0.14)", background: "rgba(2,6,23,0.28)" }}>
                    <SectionTitle icon="bolt" tone="pos" title="Nên làm" />
                    <BulletList items={doList.length ? doList : action?.summary} tone="pos" />
                  </div>
                  <div style={{ padding: 12, borderRadius: 16, border: "1px solid rgba(148,163,184,0.14)", background: "rgba(2,6,23,0.28)" }}>
                    <SectionTitle icon="shield" tone="warn" title="Tránh" />
                    <BulletList items={avoidList.length ? avoidList : reasonsVN} tone="warn" />
                  </div>
                </div>
              </div>

              {/* Focus Setup */}
              <div>
                <SectionTitle icon="spark" tone="cyan" title="Focus Setup" right={h0?.note || "30m – 4 giờ"} />
                {focusItem ? (
                  <FocusSetupCard item={focusItem} outlook={outlook} onOpen={onOpenItem} />
                ) : (
                  <div style={{ ...card, fontSize: 12.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>
                    Không có setup focus cho H0. Kiểm tra watchlist hoặc generate lại.
                  </div>
                )}
              </div>

              {/* Watchlist */}
              <div style={card}>
                <SectionTitle icon="clock" tone="warn" title="Watchlist" right={watchItems.length ? `${watchItems.length} setups` : ""} />
                {watchItems.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {watchItems.map((it) => (
                      <SetupMiniRow key={it.id} item={it} onOpen={onOpenItem} />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>Watchlist trống.</div>
                )}
              </div>

              {/* Avoid */}
              <div style={card}>
                <SectionTitle icon="x" tone="neg" title="Avoid" right={avoidItems.length ? `${avoidItems.length} setups` : ""} />
                {avoidItems.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {avoidItems.map((it) => (
                      <SetupMiniRow key={it.id} item={it} onOpen={onOpenItem} />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>Không có setup cần tránh.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "all" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={card}>
              <SectionTitle icon="layers" tone="cyan" title="All setups" right={`${items.length} items`} />
              {items.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((it) => (
                    <SetupMiniRow key={it.id} item={it} onOpen={onOpenItem} />
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, fontWeight: 850, color: "rgba(148,163,184,0.95)" }}>Generate snapshot để xem setups.</div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "debug" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={card}>
              <SectionTitle icon="layers" tone="muted" title="Debug JSON" right={snap ? "Loaded" : "Empty"} />
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "rgba(148,163,184,0.95)", marginBottom: 10 }}>
                Paste snapshot JSON vào đây để debug UI (không bắt buộc).
              </div>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 260,
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
                }}
              />
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button style={btn("secondary")} onClick={onPasteApply}>Apply JSON</button>
                <button style={btn("secondary")} onClick={() => { setRaw(""); setSnap(null); }}>Clear</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Details drawer */}
      <Drawer
        open={drawerOpen}
        title={selectedItem ? `${typeLabelVN(selectedItem.type)} • ${selectedItem.bias} • ${tfLabelVN(selectedItem.timeframe)} • ${selectedItem.symbol}` : "Setup details"}
        onClose={onCloseDrawer}
      >
        <SetupDetails item={selectedItem} />
      </Drawer>
    </div>
  );
}
