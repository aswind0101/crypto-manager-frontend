// pages/bybit-snapshot-v3.js
// Bybit Snapshot v3 – UI v2.0
// Next.js pages router – React client page sử dụng buildSnapshotV3 & buildLtfSnapshotV3

import React, { useState, useCallback, useMemo } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";

// ==========================
// STATIC COMMAND DEFINITIONS
// ==========================

// Base commands (không bao gồm Event Risk)
const BASE_COMMANDS = [
  // ===== Nhóm DASHBOARD =====
  {
    id: "cmd-dash-compact",
    label: "Chạy DASHBOARD (COMPACT)",
    text: "Chạy DASHBOARD 6 phần ở chế độ COMPACT cho snapshot trên.",
  },
  {
    id: "cmd-dash-full",
    label: "Chạy DASHBOARD FULL",
    text: "MODE = FULL\nXUẤT FULL DASHBOARD 6 phần với toàn bộ chi tiết.",
  },
  {
    id: "cmd-dash-setup-only",
    label: "Chỉ phân tích SETUP",
    text: "Chỉ phân tích SETUP ENGINE (Setup 1–3) cho snapshot trên, không cần các phần khác.",
  },
  {
    id: "cmd-dash-context-only",
    label: "Chỉ bối cảnh thị trường",
    text: "Chỉ phân tích MARKET MODE + TREND RADAR cho snapshot trên, không cần Setup.",
  },

  // ===== Nhóm MODE =====
  {
    id: "cmd-mode-compact",
    label: "Đặt MODE = COMPACT",
    text: "MODE = COMPACT",
  },
  {
    id: "cmd-mode-full",
    label: "Đặt MODE = FULL",
    text: "MODE = FULL",
  },
  {
    id: "cmd-mode-auto",
    label: "Đặt MODE = AUTO",
    text: "MODE = AUTO",
  },
  {
    id: "cmd-mode-hybrid",
    label: "Bật HYBRID MODE",
    text: "MODE = HYBRID\nBật Hybrid Mode để dùng thêm External Context.",
  },
  {
    id: "cmd-mode-snapshot-only",
    label: "Chỉ dùng SNAPSHOT",
    text: "MODE = SNAPSHOT_ONLY\nPhân tích chỉ dựa trên snapshot, không dùng external.",
  },

  // ===== CHECK SETUP =====
  {
    id: "cmd-check-setup-1",
    label: "Kiểm tra SETUP 1",
    text: "CHECK SETUP 1\nGiải thích rõ SETUP_STATE và ENTRY_VALIDITY của Setup 1.",
  },
  {
    id: "cmd-check-setup-2",
    label: "Kiểm tra SETUP 2",
    text: "CHECK SETUP 2\nGiải thích rõ SETUP_STATE và ENTRY_VALIDITY của Setup 2.",
  },
  {
    id: "cmd-check-setup-3",
    label: "Kiểm tra SETUP 3",
    text: "CHECK SETUP 3\nGiải thích rõ SETUP_STATE và ENTRY_VALIDITY của Setup 3.",
  },

  // Ready Filter & Trap
  {
    id: "cmd-check-ready-1",
    label: "Ready Filter – Setup 1",
    text: "CHECK READY FILTER 1\nGiải thích vì sao Setup 1 được/không được coi là READY.",
  },
  {
    id: "cmd-check-ready-2",
    label: "Ready Filter – Setup 2",
    text: "CHECK READY FILTER 2\nGiải thích vì sao Setup 2 được/không được coi là READY.",
  },
  {
    id: "cmd-check-ready-3",
    label: "Ready Filter – Setup 3",
    text: "CHECK READY FILTER 3\nGiải thích vì sao Setup 3 được/không được coi là READY.",
  },
  {
    id: "cmd-check-trap-1",
    label: "Momentum Trap – Setup 1",
    text: "CHECK TRAP 1\nKiểm tra xem Setup 1 có dấu hiệu MOMENTUM TRAP hay không.",
  },
  {
    id: "cmd-check-trap-2",
    label: "Momentum Trap – Setup 2",
    text: "CHECK TRAP 2\nKiểm tra xem Setup 2 có dấu hiệu MOMENTUM TRAP hay không.",
  },
  {
    id: "cmd-check-trap-3",
    label: "Momentum Trap – Setup 3",
    text: "CHECK TRAP 3\nKiểm tra xem Setup 3 có dấu hiệu MOMENTUM TRAP hay không.",
  },

  // Market Mode / Trend Radar
  {
    id: "cmd-market-mode",
    label: "Kiểm tra MARKET MODE",
    text: "CHECK MARKET MODE\nTóm tắt Market Mode theo snapshot trên.",
  },
  {
    id: "cmd-trend-radar",
    label: "Kiểm tra TREND RADAR",
    text: "CHECK TREND RADAR\nTóm tắt xu hướng ngắn hạn / trung hạn / dài hạn.",
  },

  // Risk & Summary
  {
    id: "cmd-summary",
    label: "Chỉ xem ACTION SUMMARY",
    text: "SUMMARY\nChỉ xuất phần Action Summary quan trọng nhất.",
  },
  {
    id: "cmd-risk-check",
    label: "Kiểm tra nhanh RISK",
    text: "RISK CHECK\nKiểm tra nhanh rủi ro squeeze, trap, volatility và cảnh báo chính.",
  },
  {
    id: "cmd-external-conflict",
    label: "Xung đột với External",
    text: "CHECK EXTERNAL CONFLICT\nKiểm tra xem snapshot trên có xung đột với dữ liệu external hay không.",
  },

  // Indicator queries
  {
    id: "cmd-check-atr",
    label: "Xem ATR",
    text: "CHECK ATR\nTóm tắt ATR các timeframe chính và cách dùng cho SL.",
  },
  {
    id: "cmd-check-ema",
    label: "Xem EMA",
    text: "CHECK EMA\nTóm tắt cấu trúc EMA (20/50/100/200) H1/H4/D1.",
  },
  {
    id: "cmd-check-rsi",
    label: "Xem RSI",
    text: "CHECK RSI\nTóm tắt RSI các timeframe và bias chính.",
  },

  // Timeline & Trade Zone
  {
    id: "cmd-timeline-setup-1",
    label: "Timeline Setup 1",
    text: "TIMELINE SETUP 1\nTóm tắt diễn biến Setup 1 theo thời gian (nếu có lịch sử).",
  },
  {
    id: "cmd-trade-zone",
    label: "Chỉ TRADE ZONE TERMINAL",
    text: "XUẤT ĐẦY ĐỦ PHẦN TRADE ZONE TERMINAL VỚI TẤT CẢ SETUP.",
  },

  // LTF Timing – M5/M15
  {
    id: "cmd-ltf-overview",
    label: "LTF Timing – Tổng quan M5/M15",
    text:
      "LTF TIMING OVERVIEW\n" +
      "Dùng snapshot LTF (M5/M15) phía trên để tóm tắt xu hướng, cấu trúc giá và vùng quan trọng " +
      "phục vụ timing vào lệnh (không cần phân tích lại HTF).",
  },
  {
    id: "cmd-ltf-entry-filter",
    label: "LTF Timing – Lọc điểm vào lệnh",
    text:
      "LTF ENTRY FILTER\n" +
      "Dùng snapshot LTF (M5/M15) để lọc điểm vào lệnh tốt nhất theo HTF context hiện tại. " +
      "Chỉ rõ vùng giá ưu tiên, kiểu vào lệnh (limit/market) và điều kiện xác nhận nến.",
  },
  {
    id: "cmd-ltf-position-mgmt",
    label: "LTF Timing – Quản lý lệnh đang giữ",
    text:
      "LTF POSITION MANAGEMENT\n" +
      "Dùng snapshot LTF (M5/M15) để cập nhật kịch bản, đề xuất dời SL, chốt non, chốt phần, " +
      "và vùng invalidation cho lệnh đang giữ.",
  },

  // Position Management
  {
    id: "cmd-position",
    label: "Quản lý lệnh hiện tại",
    text: "CHECK POSITION\nTư vấn quản lý lệnh hiện tại dựa trên snapshot.",
  },
];

// Event Risk Module – Command Set
const EVENT_COMMANDS = [
  {
    id: "cmd-event-risk-on",
    label: "Bật EVENT RISK MODULE",
    text: "EVENT RISK = ON\nKích hoạt Macro Event Risk Module cho snapshot trên.",
  },
  {
    id: "cmd-event-risk-off",
    label: "Tắt EVENT RISK MODULE",
    text: "EVENT RISK = OFF\nKhông chạy phân tích rủi ro sự kiện vĩ mô.",
  },

  // Event Types
  {
    id: "cmd-event-fed",
    label: "Sự kiện: FED / FOMC",
    text: "EVENT_TYPE = FED\nPhân tích rủi ro liên quan đến FED/FOMC.",
  },
  {
    id: "cmd-event-cpi",
    label: "Sự kiện: CPI",
    text: "EVENT_TYPE = CPI\nPhân tích rủi ro liên quan đến báo cáo CPI.",
  },
  {
    id: "cmd-event-nfp",
    label: "Sự kiện: NFP",
    text: "EVENT_TYPE = NFP\nPhân tích rủi ro liên quan đến Non-Farm Payroll.",
  },
  {
    id: "cmd-event-etf",
    label: "Sự kiện: ETF",
    text: "EVENT_TYPE = ETF\nPhân tích rủi ro liên quan đến ETF approval/reject.",
  },

  // Event Importance
  {
    id: "cmd-event-low",
    label: "Mức độ ảnh hưởng: LOW",
    text: "EVENT_IMPORTANCE = LOW\nSự kiện ảnh hưởng thấp.",
  },
  {
    id: "cmd-event-medium",
    label: "Mức độ ảnh hưởng: MEDIUM",
    text: "EVENT_IMPORTANCE = MEDIUM\nSự kiện có ảnh hưởng trung bình.",
  },
  {
    id: "cmd-event-high",
    label: "Mức độ ảnh hưởng: HIGH",
    text: "EVENT_IMPORTANCE = HIGH\nSự kiện ảnh hưởng mạnh, dễ gây biến động cao.",
  },

  // Event Timing
  {
    id: "cmd-event-pre",
    label: "Thời điểm: PRE-EVENT",
    text: "EVENT_TIMING = PRE_EVENT\nĐang ở giai đoạn trước khi tin được công bố.",
  },
  {
    id: "cmd-event-window",
    label: "Thời điểm: EVENT WINDOW",
    text: "EVENT_TIMING = EVENT_WINDOW\nĐang trong thời điểm tin được công bố (khoảng biến động mạnh).",
  },
  {
    id: "cmd-event-post",
    label: "Thời điểm: POST-EVENT",
    text: "EVENT_TIMING = POST_EVENT\nSau khi tin đã ra, đang phân tích hướng đi thật.",
  },

  // Event Risk Summary
  {
    id: "cmd-event-summary",
    label: "Kiểm tra EVENT RISK",
    text:
      "EVENT RISK CHECK\n" +
      "Tóm tắt squeeze risk, trap risk, volatility và các cảnh báo chính dựa trên sự kiện vĩ mô.",
  },

  // Combined Commands
  {
    id: "cmd-fed-full",
    label: "Phân tích FED đầy đủ",
    text:
      "EVENT RISK = ON\n" +
      "EVENT_TYPE = FED\n" +
      "EVENT_IMPORTANCE = HIGH\n" +
      "EVENT_TIMING = PRE_EVENT\n" +
      "EVENT RISK CHECK\n" +
      "Kết hợp snapshot và rủi ro FED để đánh giá squeeze, trap, volatility.",
  },
  {
    id: "cmd-cpi-full",
    label: "Phân tích CPI đầy đủ",
    text:
      "EVENT RISK = ON\n" +
      "EVENT_TYPE = CPI\n" +
      "EVENT_IMPORTANCE = HIGH\n" +
      "EVENT_TIMING = PRE_EVENT\n" +
      "EVENT RISK CHECK",
  },
];

// Scope cho từng command: mặc định = "htf", riêng LTF dùng "ltf"
const COMMAND_SCOPES = {
  // LTF Timing – M5/M15
  "cmd-ltf-overview": "ltf",
  "cmd-ltf-entry-filter": "ltf",
  "cmd-ltf-position-mgmt": "ltf",

  // Có thể bổ sung thêm nếu sau này có command LTF khác
  // "cmd-something-ltf": "ltf",
};


function BybitSnapshotV3Page() {
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [fileName, setFileName] = useState("");
  const [dashMacro, setDashMacro] = useState("");

  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedMacro, setCopiedMacro] = useState(false);
  const [copiedCommandId, setCopiedCommandId] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");

  const [positionSide, setPositionSide] = useState("LONG");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [commandSearch, setCommandSearch] = useState("");

  // Tách riêng file HTF / LTF
  const [htfFileName, setHtfFileName] = useState("");
  const [ltfFileName, setLtfFileName] = useState("");

  const htfMacro = useMemo(
    () => (htfFileName ? `[DASH] FILE=${htfFileName}` : ""),
    [htfFileName]
  );

  const ltfMacro = useMemo(
    () => (ltfFileName ? `[DASH] FILE=${ltfFileName}` : ""),
    [ltfFileName]
  );


  const allCommands = useMemo(
    () => [...BASE_COMMANDS, ...EVENT_COMMANDS],
    []
  );

  const versionLabel =
    snapshot && snapshot.version ? `v${snapshot.version}` : "chưa có";

  const generatedAtLabel =
    snapshot && snapshot.generated_at
      ? new Date(snapshot.generated_at).toLocaleString()
      : "";
  const searchResults = useMemo(() => {
    const q = commandSearch.trim().toLowerCase();
    if (!q) return [];
    return allCommands.filter((cmd) => {
      return (
        cmd.label.toLowerCase().includes(q) ||
        cmd.text.toLowerCase().includes(q)
      );
    });
  }, [commandSearch, allCommands]);

  const dynamicPositionCommand =
    entryPrice && stopPrice
      ? `ĐANG ${positionSide.toUpperCase()} @ ${entryPrice}, STOPLOSS @ ${stopPrice}. PHÂN TÍCH LẠI RỦI RO & KỊCH BẢN CHÍNH.`
      : `ĐANG LONG/SHORT @ <entry>, STOPLOSS @ <SL>. PHÂN TÍCH LẠI RỦI RO & KỊCH BẢN CHÍNH.`;

  // =====================
  // STYLE HELPER FUNCTIONS
  // =====================

  const primaryButtonStyle = (extra = {}) => ({
    padding: "9px 16px",
    borderRadius: 999,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? "default" : "pointer",

    // === NEW GREEN STYLE (giống LTF gold style nhưng chuyển sang green) ===
    background: "linear-gradient(135deg, #34d399, #10b981, #059669)",
    color: "#052e16",
    opacity: loading ? 0.8 : 1,
    boxShadow: "0 8px 20px rgba(16,185,129,0.45)",

    minWidth: 190,
    textAlign: "center",
    ...extra,
  });


  const secondaryButtonStyle = (extra = {}) => ({
    padding: "7px 13px",
    borderRadius: 999,
    border: "none",

    // === GREEN SNAPSHOT v3 STYLE (giống primaryButtonStyle đã đổi) ===
    background: "linear-gradient(135deg, #34d399, #10b981, #059669)",
    color: "#052e16",
    boxShadow: "0 8px 20px rgba(16,185,129,0.45)",
    opacity: 0.95,

    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition:
      "opacity 0.15s ease, transform 0.1s ease",

    // Hover + active effect nhẹ (không phá UI)
    ...(!extra.noHover && {
      ':hover': { opacity: 1 },
      ':active': { transform: "scale(0.97)" }
    }),

    ...extra,
  });


  const tinySecondaryButtonStyle = (extra = {}) =>
    secondaryButtonStyle({
      padding: "5px 11px",
      fontSize: 12,
      ...extra,
    });
  const ltfButtonStyle = (extra = {}) => ({
    padding: "9px 16px",
    borderRadius: 999,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? "default" : "pointer",
    // Gold gradient nổi bật trên nền dark + phù hợp với blue/purple
    background: "linear-gradient(135deg, #facc15, #eab308, #ca8a04)",
    color: "#1c1917",
    opacity: loading ? 0.8 : 1,
    boxShadow: "0 8px 20px rgba(250, 204, 21, 0.45)",
    minWidth: 210,
    textAlign: "center",
    ...extra,
  });

  const showCopyToast = (msg = "Đã copy vào clipboard") => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(""), 1500);
  };

  // =============
  // CORE HANDLERS
  // =============

  const handleGenerate = useCallback(async () => {
    setError("");
    setSnapshot(null);
    setFileName("");
    setDashMacro("");

    const raw = symbolsText || "";
    const symbols = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);

      const result = await buildSnapshotV3(symbols);

      if (!result || typeof result !== "object") {
        throw new Error("Snapshot trả về không hợp lệ.");
      }

      const ts = result.generated_at || Date.now();
      const firstSymbol =
        result?.per_exchange?.bybit?.symbols?.[0]?.symbol ||
        symbols[0] ||
        "SYMBOL";

      const name = `bybit_snapshot_${ts}_${firstSymbol}.json`;
      const macro = `[DASH] FILE=${name}`;

      setSnapshot(result);
      setFileName(name);

      // Ghi nhận đây là file HTF
      setHtfFileName(name);

      // Macro hiển thị phía trên: luôn là snapshot mới nhất
      setDashMacro(macro);
    } catch (e) {

      console.error("buildSnapshotV3 error:", e);
      setError(e?.message || "Có lỗi xảy ra khi tạo snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbolsText]);

  const handleGenerateLtf = useCallback(async () => {
    setError("");
    setSnapshot(null);
    setFileName("");
    setDashMacro("");

    const raw = symbolsText || "";
    const symbols = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);

      const result = await buildLtfSnapshotV3(symbols);

      if (!result || typeof result !== "object") {
        throw new Error("LTF snapshot trả về không hợp lệ.");
      }

      const ts = result.generated_at || Date.now();
      const firstSymbol = symbols[0] || "SYMBOL";

      const name = `bybit_ltf_snapshot_${ts}_${firstSymbol}.json`;
      const macro = `[DASH] FILE=${name}`;

      setSnapshot(result);
      setFileName(name);

      // Ghi nhận đây là file LTF
      setLtfFileName(name);

      // Macro hiển thị phía trên: luôn là snapshot mới nhất
      setDashMacro(macro);
    } catch (e) {

      console.error("buildLtfSnapshotV3 error:", e);
      setError(e?.message || "Có lỗi xảy ra khi tạo LTF snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbolsText]);

  const handleCopyJSON = useCallback(() => {
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);

    const markCopied = () => {
      setCopiedJson(true);
      showCopyToast("Đã copy JSON snapshot.");
      setTimeout(() => setCopiedJson(false), 1200);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(markCopied).catch(console.error);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      markCopied();
    }
  }, [snapshot]);

  const handleCopyMacro = useCallback(() => {
    if (!dashMacro) return;

    const markCopied = () => {
      setCopiedMacro(true);
      showCopyToast("Đã copy macro [DASH] FILE=...");
      setTimeout(() => setCopiedMacro(false), 1200);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(dashMacro).then(markCopied).catch(console.error);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = dashMacro;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      markCopied();
    }
  }, [dashMacro]);

  const handleDownloadJSON = useCallback(() => {
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "snapshot_v3.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [snapshot, fileName]);

  const handleCopyCommand = useCallback(
    (id, rawText, scopeOverride) => {
      if (!rawText) return;

      // 1) Xác định scope của command: htf / ltf
      const scope = scopeOverride || COMMAND_SCOPES[id] || "htf";

      let macro = "";

      if (scope === "ltf") {
        if (!ltfMacro) {
          // Chưa có LTF → hỏi user có muốn copy KHÔNG macro không
          const ok = window.confirm(
            "Chưa có LTF snapshot.\n" +
            "Bạn có muốn copy command nhưng KHÔNG kèm dòng [DASH] FILE=... không?\n\n" +
            "Chọn No để quay lại và Generate LTF Snapshot (M5/M15) trước."
          );
          if (!ok) {
            setCopyFeedback(
              "Vui lòng Generate LTF Snapshot (M5/M15) trước khi dùng command LTF."
            );
            return;
          }
          macro = ""; // copy thuần command
        } else {
          macro = ltfMacro;
        }
      } else {
        // HTF
        if (!htfMacro) {
          const ok = window.confirm(
            "Chưa có HTF snapshot.\n" +
            "Bạn có muốn copy command nhưng KHÔNG kèm dòng [DASH] FILE=... không?\n\n" +
            "Chọn No để quay lại và Generate Snapshot v3 (HTF) trước."
          );
          if (!ok) {
            setCopyFeedback(
              "Vui lòng Generate Snapshot v3 (HTF) trước khi dùng command này."
            );
            return;
          }
          macro = "";
        } else {
          macro = htfMacro;
        }
      }

      const prefix = macro ? `${macro}\n` : "";
      const finalText = `${prefix}${rawText}`;

      const markCopied = () => {
        setCopiedCommandId(id);
        showCopyToast(
          macro
            ? "Đã copy command (kèm đúng macro HTF/LTF)."
            : "Đã copy command (không kèm macro)."
        );
        setTimeout(() => setCopiedCommandId(""), 1200);
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(finalText).then(markCopied).catch(console.error);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = finalText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        markCopied();
      }
    },
    [htfMacro, ltfMacro]
  );

  // ==========================
  // COMMAND GROUP CONFIG (UI)
  // ==========================

  const commandGroups = useMemo(
    () => [
      {
        id: "grp-mode",
        label: "0. MODE (COMPACT / FULL / HYBRID)",
        items: allCommands.filter((c) =>
          [
            "cmd-mode-compact",
            "cmd-mode-full",
            "cmd-mode-auto",
            "cmd-mode-hybrid",
            "cmd-mode-snapshot-only",
          ].includes(c.id)
        ),
      },
      {
        id: "grp-htf",
        label: "1. HTF Dashboard & Market Context",
        items: allCommands.filter((c) =>
          [
            "cmd-dash-compact",
            "cmd-dash-full",
            "cmd-dash-context-only",
            "cmd-trade-zone",
            "cmd-market-mode",
            "cmd-trend-radar",
            "cmd-summary",
            "cmd-risk-check",
          ].includes(c.id)
        ),
      },
      {
        id: "grp-setup",
        label: "2. Setup Engine (Setup 1–3, Ready Filter, Trap)",
        items: allCommands.filter((c) =>
          [
            "cmd-dash-setup-only",
            "cmd-check-setup-1",
            "cmd-check-setup-2",
            "cmd-check-setup-3",
            "cmd-check-ready-1",
            "cmd-check-ready-2",
            "cmd-check-ready-3",
            "cmd-check-trap-1",
            "cmd-check-trap-2",
            "cmd-check-trap-3",
          ].includes(c.id)
        ),
      },
      {
        id: "grp-entry",
        label: "3. Timing Entry (LTF M5/M15)",
        items: allCommands.filter((c) =>
          [
            "cmd-ltf-overview",
            "cmd-ltf-entry-filter",
            "cmd-check-ema",
            "cmd-check-rsi",
            "cmd-check-atr",
          ].includes(c.id)
        ),
      },
      {
        id: "grp-position",
        label: "4. Position Management (LTF)",
        items: allCommands.filter((c) =>
          [
            "cmd-ltf-position-mgmt",
            "cmd-position",
            "cmd-external-conflict",
          ].includes(c.id)
        ),
      },
      {
        id: "grp-event",
        label: "5. Event Risk Module (FED/CPI/NFP/ETF)",
        items: allCommands.filter((c) =>
          [
            "cmd-event-risk-on",
            "cmd-event-risk-off",
            "cmd-event-fed",
            "cmd-event-cpi",
            "cmd-event-nfp",
            "cmd-event-etf",
            "cmd-event-low",
            "cmd-event-medium",
            "cmd-event-high",
            "cmd-event-pre",
            "cmd-event-window",
            "cmd-event-post",
            "cmd-event-summary",
            "cmd-fed-full",
            "cmd-cpi-full",
          ].includes(c.id)
        ),
      },
    ],
    [allCommands]
  );

  const [selectedGroupId, setSelectedGroupId] = useState("grp-mode");
  const [selectedCommandId, setSelectedCommandId] = useState("");

  const usingSearch = commandSearch.trim().length > 0;

  const visibleCommands = useMemo(() => {
    if (usingSearch) {
      return searchResults;
    }
    const group =
      commandGroups.find((g) => g.id === selectedGroupId) ||
      commandGroups[0];
    return group ? group.items : [];
  }, [usingSearch, searchResults, commandGroups, selectedGroupId]);

  const selectedCommand = useMemo(() => {
    if (!visibleCommands.length) return null;
    if (!selectedCommandId) return visibleCommands[0];
    const found = visibleCommands.find((c) => c.id === selectedCommandId);
    return found || visibleCommands[0];
  }, [visibleCommands, selectedCommandId]);

  // =========
  // RENDER UI
  // =========

  return (
    <>
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#020617",
          color: "#e5e7eb",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "24px 16px 32px",
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
          }}
        >
          {/* Header */}
          <header
            style={{
              marginBottom: 24,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              Bybit Snapshot v3 – JSON Export (UI v2.0)
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "#9ca3af",
                maxWidth: 650,
              }}
            >
              Tạo snapshot phiên bản 3 (H1–H4–D1, derivatives Bybit/Binance/OKX)
              để sử dụng cho Price Analyzer v3.x. Bao gồm JSON, macro{" "}
              <code>[DASH] FILE=...</code>, bộ lệnh nhanh (command set) và
              download.
            </p>
          </header>

          {/* Input card */}
          <section
            style={{
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(236,72,153,0.08))",
              borderRadius: 14,
              padding: 16,
              border: "1px solid rgba(148,163,184,0.35)",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <label
                htmlFor="symbols"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Symbols (phân tách bởi dấu phẩy hoặc khoảng trắng)
              </label>
              <input
                id="symbols"
                type="text"
                value={symbolsText}
                onChange={(e) => setSymbolsText(e.target.value)}
                placeholder="Ví dụ: BTCUSDT, ETHUSDT"
                disabled={loading}
                style={{
                  padding: "9px 11px",
                  borderRadius: 10,
                  border: "1px solid #4b5563",
                  backgroundColor: "#020617",
                  color: "#e5e7eb",
                  fontSize: 14,
                  opacity: loading ? 0.7 : 1,
                }}
              />

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleGenerate}
                    disabled={loading}
                    style={primaryButtonStyle()}
                  >
                    {loading ? "Đang tạo snapshot v3..." : "Generate Snapshot v3"}
                  </button>
                  <button
                    type="button"
                    className="ltf-btn"
                    onClick={handleGenerateLtf}
                    disabled={loading}
                    style={ltfButtonStyle()}
                  >
                    {loading
                      ? "Đang tạo LTF..."
                      : "Generate LTF Snapshot (M5/M15)"}
                  </button>

                </div>

                {snapshot && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#9ca3af",
                      marginTop: 4,
                    }}
                  >
                    Version: <strong>{versionLabel}</strong>
                    {generatedAtLabel && (
                      <>
                        {" "}
                        · Generated at: <strong>{generatedAtLabel}</strong>
                      </>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 10,
                    fontSize: 13,
                    color: "#fecaca",
                    backgroundColor: "rgba(127,29,29,0.45)",
                    border: "1px solid rgba(248,113,113,0.7)",
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          </section>

          {/* Macro + actions + Quick Commands */}
          {snapshot && (
            <section
              style={{
                backgroundColor: "#020617",
                borderRadius: 14,
                padding: 16,
                border: "1px solid rgba(148,163,184,0.45)",
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {/* File & JSON actions */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      File name
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#9ca3af",
                        marginTop: 3,
                        wordBreak: "break-all",
                      }}
                    >
                      {fileName || "(chưa có)"}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleCopyJSON}
                      style={secondaryButtonStyle()}
                    >
                      {copiedJson ? "✓ Đã copy JSON" : "Copy JSON"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadJSON}
                      style={secondaryButtonStyle()}
                    >
                      Download JSON
                    </button>
                  </div>
                </div>

                {/* Macro */}
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Macro dùng cho Price Analyzer
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="text"
                      readOnly
                      value={dashMacro}
                      style={{
                        flexGrow: 1,
                        minWidth: 0,
                        padding: "7px 9px",
                        borderRadius: 10,
                        border: "1px solid #4b5563",
                        backgroundColor: "#020617",
                        color: "#f9fafb",
                        fontSize: 13,
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyMacro}
                      style={secondaryButtonStyle({ whiteSpace: "nowrap" })}
                    >
                      {copiedMacro ? "✓ Đã copy macro" : "Copy macro"}
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      marginTop: 4,
                    }}
                  >
                    Khi copy command, app sẽ tự chọn macro{" "}
                    <code>[DASH] FILE=...</code> theo HTF hoặc LTF tùy loại
                    command. Nếu chưa có file tương ứng, bạn sẽ được nhắc
                    Generate trước hoặc chọn copy không kèm macro.
                  </div>

                </div>

                {/* Quick command bar */}
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: "1px solid #1f2937",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Lệnh hay dùng (Quick Commands)
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {[
                      {
                        label: "Dashboard FULL",
                        cmd:
                          "MODE = FULL\nXUẤT FULL DASHBOARD 6 phần với toàn bộ chi tiết.",
                        scope: "htf",
                      },
                      {
                        label: "Dashboard COMPACT",
                        cmd:
                          "Chạy DASHBOARD 6 phần ở chế độ COMPACT cho snapshot trên.",
                        scope: "htf",
                      },
                      {
                        label: "MODE = HYBRID",
                        cmd:
                          "MODE = HYBRID\nBật Hybrid Mode để dùng thêm External Context.",
                        scope: "htf",
                      },
                      {
                        label: "FULL + HYBRID",
                        cmd:
                          "MODE = FULL + HYBRID\n" +
                          "XUẤT FULL DASHBOARD 6 phần với toàn bộ chi tiết và thêm PHẦN 5.7 – External Market Context.",
                        scope: "htf",
                      },
                      {
                        label: "Setup Only",
                        cmd:
                          "Chỉ phân tích SETUP ENGINE (Setup 1–3) cho snapshot trên, không cần các phần khác.",
                        scope: "htf",
                      },
                      {
                        label: "LTF ENTRY FILTER",
                        cmd:
                          "LTF ENTRY FILTER\nDùng snapshot LTF (M5/M15) để lọc điểm vào lệnh tốt nhất.",
                        scope: "ltf",
                      },
                      {
                        label: "EVENT RISK CHECK",
                        cmd: "EVENT RISK CHECK",
                        scope: "htf",
                      },
                    ].map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() =>
                          handleCopyCommand(`quick-${q.label}`, q.cmd, q.scope)
                        }
                        style={tinySecondaryButtonStyle({
                          borderRadius: 999,
                          padding: "6px 13px",
                          backgroundColor: "#020617",
                        })}
                      >
                        {q.label}
                      </button>
                    ))}

                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Command panel theo nhóm */}
          {/* Command panel – dạng menu gọn */}
          {snapshot && (
            <section
              style={{
                backgroundColor: "#020617",
                borderRadius: 14,
                padding: 16,
                border: "1px solid rgba(148,163,184,0.45)",
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {/* Header */}
                <div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    Command Menu (HTF → LTF)
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      marginTop: 4,
                    }}
                  >
                    Chọn nhóm, chọn command rồi bấm copy. Macro{" "}
                    <code>[DASH] FILE=...</code> sẽ tự động chọn đúng
                    HTF / LTF.
                  </div>
                </div>

                {/* Search + menu */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {/* Search box */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <input
                      type="text"
                      value={commandSearch}
                      onChange={(e) =>
                        setCommandSearch(e.target.value)
                      }
                      placeholder="Tìm nhanh (vd: setup, risk, ltf...)"
                      style={{
                        flexGrow: 1,
                        minWidth: 0,
                        padding: "7px 9px",
                        borderRadius: 10,
                        border: "1px solid #4b5563",
                        backgroundColor: "#020617",
                        color: "#e5e7eb",
                        fontSize: 12,
                      }}
                    />
                    {commandSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setCommandSearch("");
                          setSelectedCommandId("");
                        }}
                        style={tinySecondaryButtonStyle()}
                      >
                        Xoá
                      </button>
                    )}
                  </div>

                  {/* Group + Command select */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {!usingSearch && (
                      <select
                        value={selectedGroupId}
                        onChange={(e) => {
                          setSelectedGroupId(e.target.value);
                          setSelectedCommandId("");
                        }}
                        style={{
                          flexBasis: "180px",
                          padding: "6px 8px",
                          borderRadius: 10,
                          border: "1px solid #4b5563",
                          backgroundColor: "#020617",
                          color: "#e5e7eb",
                          fontSize: 12,
                        }}
                      >
                        {commandGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    )}

                    <select
                      value={selectedCommand?.id || ""}
                      onChange={(e) =>
                        setSelectedCommandId(e.target.value)
                      }
                      style={{
                        flexGrow: 1,
                        minWidth: usingSearch ? "220px" : "160px",
                        padding: "6px 8px",
                        borderRadius: 10,
                        border: "1px solid #4b5563",
                        backgroundColor: "#020617",
                        color: "#e5e7eb",
                        fontSize: 12,
                      }}
                    >
                      {visibleCommands.map((cmd) => (
                        <option key={cmd.id} value={cmd.id}>
                          {cmd.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Preview + Copy */}
                <div
                  style={{
                    borderRadius: 10,
                    border: "1px solid #4b5563",
                    padding: 10,
                    backgroundColor: "#020617",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {selectedCommand?.label || "Chưa có command"}
                  </div>
                  <div
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
                      fontSize: 12,
                      color: "#9ca3af",
                      whiteSpace: "pre-wrap",
                      maxHeight: 140,
                      overflowY: "auto",
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(148,163,184,0.5)",
                    }}
                  >
                    {selectedCommand?.text || "—"}
                  </div>
                  <div>
                    <button
                      type="button"
                      disabled={!selectedCommand}
                      onClick={() =>
                        selectedCommand &&
                        handleCopyCommand(
                          selectedCommand.id,
                          selectedCommand.text
                        )
                      }
                      style={secondaryButtonStyle({
                        fontSize: 12,
                        marginTop: 4,
                      })}
                    >
                      {selectedCommand &&
                        copiedCommandId === selectedCommand.id
                        ? "✓ Đã copy command"
                        : "Copy command (tự chọn HTF/LTF)"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}


          {/* JSON viewer – collapsible */}
          {snapshot && (
            <section
              style={{
                backgroundColor: "#020617",
                borderRadius: 14,
                padding: 16,
                border: "1px solid rgba(31,41,55,0.9)",
                marginBottom: 28,
              }}
            >
              <details open={false}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    userSelect: "none",
                    listStyle: "none",
                  }}
                >
                  Snapshot JSON (version 3) – nhấn để mở / đóng
                </summary>
                <div
                  style={{
                    borderRadius: 10,
                    backgroundColor: "#020617",
                    border: "1px solid #4b5563",
                    maxHeight: "480px",
                    overflow: "auto",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
                    fontSize: 12,
                    padding: 10,
                    lineHeight: 1.5,
                    marginTop: 10,
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre",
                    }}
                  >
                    {JSON.stringify(snapshot, null, 2)}
                  </pre>
                </div>
              </details>
            </section>
          )}
        </div>

        {/* Loading overlay */}
        {loading && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15,23,42,0.88)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "999px",
                  border: "4px solid rgba(148,163,184,0.4)",
                  borderTopColor: "#3b82f6",
                  animation: "snapshot-spin 0.9s linear infinite",
                }}
              />
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "#e5e7eb",
                }}
              >
                Đang tạo snapshot v3...
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#9ca3af",
                  maxWidth: 260,
                  textAlign: "center",
                }}
              >
                Hệ thống đang lấy dữ liệu từ Bybit/Binance/OKX và ghép thành
                JSON snapshot.
              </div>
            </div>
          </div>
        )}

        {/* Copy toast */}
        {copyFeedback && (
          <div
            style={{
              position: "fixed",
              bottom: 20,
              right: 20,
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.95), rgba(124,58,237,0.95))",
              color: "#f9fafb",
              padding: "9px 14px",
              borderRadius: 999,
              fontSize: 12,
              boxShadow: "0 10px 25px rgba(15,23,42,0.9)",
              zIndex: 10000,
            }}
          >
            {copyFeedback}
          </div>
        )}
      </div>

      {/* Global spinner animation */}
      <style jsx global>{`
  @keyframes snapshot-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  /* OPTION A — MOBILE BUTTON FIX */
  @media (max-width: 480px) {
    .primary-btn,
    .ltf-btn {
      width: 100% !important;
      min-width: unset !important;
      justify-content: center !important;
      text-align: center !important;
      display: flex !important;
    }
  }
`}</style>

    </>
  );
}

export default BybitSnapshotV3Page;
