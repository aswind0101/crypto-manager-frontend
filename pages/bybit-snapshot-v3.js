// pages/bybit-snapshot-v3.js
// Next.js pages router – React client page sử dụng buildSnapshotV3
// Output: JSON snapshot version 3 với UI chuyên nghiệp, có copy/download + macro [DASH] FILE=...
import React, { useState, useCallback } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";

function BybitSnapshotV3Page() {
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [fileName, setFileName] = useState("");
  const [dashMacro, setDashMacro] = useState("");
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedMacro, setCopiedMacro] = useState(false);

  // NEW: state cho command section
  const [copiedCommandId, setCopiedCommandId] = useState("");
  const [positionSide, setPositionSide] = useState("LONG");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  const [commandSearch, setCommandSearch] = useState("");


  // ===== Button style helpers (đồng bộ giao diện) =====
  const primaryButtonStyle = (extra = {}) => ({
    padding: "8px 14px",
    borderRadius: 999,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? "default" : "pointer",
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)",
    color: "#f9fafb",
    opacity: loading ? 0.6 : 1,
    boxShadow:
      "0 8px 20px rgba(59,130,246,0.35), 0 0 0 1px rgba(15,23,42,0.8) inset",
    ...extra,
  });

  const secondaryButtonStyle = (extra = {}) => ({
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid #4b5563",
    backgroundColor: "#020617",
    color: "#e5e7eb",
    fontSize: 13,
    cursor: "pointer",
    ...extra,
  });

  const tinySecondaryButtonStyle = (extra = {}) =>
    secondaryButtonStyle({
      padding: "4px 10px",
      fontSize: 12,
      ...extra,
    });

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

      // Snapshot v3: version, generated_at, per_exchange.bybit.symbols
      const ts = result.generated_at || Date.now();
      const firstSymbol =
        result?.per_exchange?.bybit?.symbols?.[0]?.symbol ||
        symbols[0] ||
        "SYMBOL";

      const name = `bybit_snapshot_${ts}_${firstSymbol}.json`;
      const macro = `[DASH] FILE=${name}`;

      setSnapshot(result);
      setFileName(name);
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
      const firstSymbol =
        symbols[0] || "SYMBOL";

      const name = `bybit_ltf_snapshot_${ts}_${firstSymbol}.json`;
      const macro = `[DASH] FILE=${name}`;

      setSnapshot(result);
      setFileName(name);
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
      setTimeout(() => setCopiedJson(false), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(markCopied)
        .catch((err) => {
          console.error("Copy JSON failed:", err);
        });
    } else {
      // Fallback
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
      setTimeout(() => setCopiedMacro(false), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(dashMacro)
        .then(markCopied)
        .catch((err) => {
          console.error("Copy macro failed:", err);
        });
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

  // NEW: copy helper cho các command
  const handleCopyCommand = useCallback(
    (id, rawText) => {
      if (!rawText) return;

      const prefix = dashMacro ? `${dashMacro}\n` : "";
      const finalText = `${prefix}${rawText}`;

      const markCopied = () => {
        setCopiedCommandId(id);
        setTimeout(() => setCopiedCommandId(""), 1500);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(finalText)
          .then(markCopied)
          .catch((err) => {
            console.error("Copy command failed:", err);
          });
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
    [dashMacro]
  );

  const versionLabel =
    snapshot && snapshot.version ? `v${snapshot.version}` : "chưa có";

  const generatedAtLabel =
    snapshot && snapshot.generated_at
      ? new Date(snapshot.generated_at).toLocaleString()
      : "";

  // NEW: danh sách command tĩnh (không cần param)
  // FULL MACRO COMMAND SET – Price Analyzer v3.2-FULL
  // BỘ LỆNH TIẾNG VIỆT – TƯƠNG THÍCH Price Analyzer v3.2
  const staticCommands = [
    // Nhóm DASHBOARD
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

    // Nhóm MODE
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

    // Nhóm CHECK SETUP
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

  // ===== Macro Event Risk Module – Command Set =====
  const eventCommands = [
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

    // ----- Event Types -----
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

    // ----- Event Importance -----
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

    // ----- Event Timing -----
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

    // ----- Event Risk Summary -----
    {
      id: "cmd-event-summary",
      label: "Kiểm tra EVENT RISK",
      text: "EVENT RISK CHECK\nTóm tắt squeeze risk, trap risk, volatility và các cảnh báo chính dựa trên sự kiện vĩ mô.",
    },

    // ----- Combined Commands (tiện dụng) -----
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
  // Gộp lệnh Event Risk vào danh sách command chung
  staticCommands.push(...eventCommands);

    // Gộp lệnh Event Risk vào danh sách command chung
  staticCommands.push(...eventCommands);

  // NHÓM COMMAND THEO WORKFLOW – GIÚP UI GỌN HƠN
  const commandGroups = [
    {
      id: "grp-htf",
      label: "1. HTF Dashboard & Market Context",
      items: staticCommands.filter((c) =>
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
      items: staticCommands.filter((c) =>
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
      items: staticCommands.filter((c) =>
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
      items: staticCommands.filter((c) =>
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
      items: staticCommands.filter((c) =>
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
  ];

  const dynamicPositionCommand =
    entryPrice && stopPrice
      ? `ĐANG ${positionSide.toUpperCase()} @ ${entryPrice}, STOPLOSS @ ${stopPrice}. PHÂN TÍCH LẠI RỦI RO & KỊCH BẢN CHÍNH.`
      : `ĐANG LONG/SHORT @ <entry>, STOPLOSS @ <SL>. PHÂN TÍCH LẠI RỦI RO & KỊCH BẢN CHÍNH.`;

  return (
    <>
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#050816",
          color: "#e5e7eb",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "24px 16px",
        }}
      >
        <div
          style={{
            maxWidth: 960,
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
                letterSpacing: 0.5,
              }}
            >
              Bybit Snapshot v3 – JSON Export
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "#9ca3af",
                maxWidth: 640,
              }}
            >
              Tạo snapshot phiên bản 3 (H1–H4–Daily, derivatives
              Bybit/Binance/OKX) để sử dụng cho Price Analyzer v3.0. Bao gồm
              JSON, macro <code>[DASH] FILE=</code>, copy và download.
            </p>
          </header>

          {/* Input card */}
          <section
            style={{
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(236,72,153,0.08))",
              borderRadius: 12,
              padding: 16,
              border: "1px solid rgba(148,163,184,0.25)",
              marginBottom: 16,
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
                  padding: "8px 10px",
                  borderRadius: 8,
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
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  style={primaryButtonStyle()}
                >
                  {loading ? "Đang tạo snapshot v3..." : "Generate Snapshot v3"}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateLtf}
                  disabled={loading}
                  style={secondaryButtonStyle({ marginLeft: 8 })}
                >
                  {loading ? "Đang tạo LTF..." : "Generate LTF Snapshot (M5/M15)"}
                </button>

                {snapshot && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#9ca3af",
                    }}
                  >
                    Version: <strong>{versionLabel}</strong>
                    {generatedAtLabel && (
                      <>
                        {" "}
                        · Generated at: <strong>{generatedAtLabel}</strong>
                      </>
                    )}
                  </span>
                )}
              </div>

              {error && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 13,
                    color: "#fecaca",
                    backgroundColor: "rgba(127,29,29,0.35)",
                    border: "1px solid rgba(248,113,113,0.5)",
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          </section>

          {/* Macro + actions */}
          {snapshot && (
            <section
              style={{
                backgroundColor: "#020617",
                borderRadius: 12,
                padding: 16,
                border: "1px solid rgba(148,163,184,0.4)",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
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
                        marginTop: 2,
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
                      {copiedJson ? "✓ Đã copy" : "Copy JSON"}
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
                        padding: "6px 8px",
                        borderRadius: 8,
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
                      {copiedMacro ? "✓ Đã copy" : "Copy macro"}
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      marginTop: 4,
                    }}
                  >
                    Khi copy command bên dưới, dòng macro{" "}
                    <code>[DASH] FILE=...</code> sẽ được tự động thêm ở đầu nội
                    dung (nếu đã có snapshot).
                  </div>
                </div>
              </div>
            </section>
          )}

                    {/* CLEAN: Command panel theo nhóm (accordion) */}
          {snapshot && (
            <section
              style={{
                backgroundColor: "#020617",
                borderRadius: 12,
                padding: 16,
                border: "1px solid rgba(148,163,184,0.4)",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
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
                    Command theo nhóm (Workflow HTF → LTF)
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      marginTop: 4,
                    }}
                  >
                    Mỗi nhóm tương ứng một bước: 1) HTF Dashboard, 2) Setup,
                    3) LTF Entry, 4) Position Management, 5) Event Risk.
                  </div>
                </div>

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
                    onChange={(e) => setCommandSearch(e.target.value)}
                    placeholder="Tìm command theo tên / nội dung (vd: setup, risk, ltf...)"
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #4b5563",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 12,
                    }}
                  />
                  {commandSearch && (
                    <button
                      type="button"
                      onClick={() => setCommandSearch("")}
                      style={tinySecondaryButtonStyle()}
                    >
                      Xoá
                    </button>
                  )}
                </div>

                {/* Accordion nhóm command */}
                {commandGroups.map((group) => {
                  const visibleItems = group.items.filter((cmd) => {
                    if (!commandSearch.trim()) return true;
                    const q = commandSearch.toLowerCase();
                    return (
                      cmd.label.toLowerCase().includes(q) ||
                      cmd.text.toLowerCase().includes(q)
                    );
                  });

                  if (!visibleItems.length) return null;

                  return (
                    <details
                      key={group.id}
                      style={{
                        backgroundColor: "#020617",
                        borderRadius: 10,
                        padding: 12,
                        border: "1px solid #334155",
                      }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 600,
                          marginBottom: 8,
                          userSelect: "none",
                          listStyle: "none",
                        }}
                      >
                        {group.label}
                      </summary>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(230px, 1fr))",
                          gap: 10,
                          marginTop: 6,
                        }}
                      >
                        {visibleItems.map((cmd) => (
                          <div
                            key={cmd.id}
                            style={{
                              borderRadius: 10,
                              border: "1px solid #4b5563",
                              padding: 10,
                              background:
                                "radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                              }}
                            >
                              {cmd.label}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#9ca3af",
                                minHeight: 36,
                                whiteSpace: "pre-line",
                              }}
                            >
                              {cmd.text}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyCommand(cmd.id, cmd.text)
                              }
                              style={tinySecondaryButtonStyle({
                                alignSelf: "flex-start",
                                marginTop: 2,
                              })}
                            >
                              {copiedCommandId === cmd.id
                                ? "✓ Đã copy"
                                : "Copy"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}

                {/* Dynamic position command – giữ nguyên logic, chỉ đặt dưới cùng */}
                <div
                  style={{
                    marginTop: 4,
                    borderRadius: 10,
                    border: "1px solid #4b5563",
                    padding: 12,
                    background:
                      "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(56,189,248,0.05))",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    Command cho lệnh đang giữ (ĐANG LONG/SHORT @ ..., STOPLOSS
                    @ ...)
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <label
                      style={{
                        fontSize: 12,
                        color: "#9ca3af",
                      }}
                    >
                      Side:
                    </label>
                    <select
                      value={positionSide}
                      onChange={(e) => setPositionSide(e.target.value)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: "1px solid #4b5563",
                        backgroundColor: "#020617",
                        color: "#e5e7eb",
                        fontSize: 12,
                      }}
                    >
                      <option value="LONG">LONG</option>
                      <option value="SHORT">SHORT</option>
                    </select>

                    <label
                      style={{
                        fontSize: 12,
                        color: "#9ca3af",
                        marginLeft: 4,
                      }}
                    >
                      Entry @
                    </label>
                    <input
                      type="text"
                      value={entryPrice}
                      onChange={(e) => setEntryPrice(e.target.value)}
                      placeholder="Ví dụ: 3335"
                      style={{
                        width: 90,
                        padding: "4px 6px",
                        borderRadius: 8,
                        border: "1px solid #4b5563",
                        backgroundColor: "#020617",
                        color: "#e5e7eb",
                        fontSize: 12,
                      }}
                    />

                    <label
                      style={{
                        fontSize: 12,
                        color: "#9ca3af",
                        marginLeft: 4,
                      }}
                    >
                      SL @
                    </label>
                    <input
                      type="text"
                      value={stopPrice}
                      onChange={(e) => setStopPrice(e.target.value)}
                      placeholder="Ví dụ: 3270"
                      style={{
                        width: 90,
                        padding: "4px 6px",
                        borderRadius: 8,
                        border: "1px solid #4b5563",
                        backgroundColor: "#020617",
                        color: "#e5e7eb",
                        fontSize: 12,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      color: "#9ca3af",
                      marginTop: 4,
                    }}
                  >
                    Xem trước:
                  </div>
                  <div
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
                      fontSize: 12,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(148,163,184,0.6)",
                      backgroundColor: "#020617",
                    }}
                  >
                    {dynamicPositionCommand}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyCommand(
                          "cmd-position-dynamic",
                          dynamicPositionCommand
                        )
                      }
                      style={secondaryButtonStyle({
                        marginTop: 6,
                        fontSize: 12,
                      })}
                    >
                      {copiedCommandId === "cmd-position-dynamic"
                        ? "✓ Đã copy"
                        : "Copy command (kèm macro)"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
          {/* JSON viewer */}
          {snapshot && (
            <section
              style={{
                backgroundColor: "#020617",
                borderRadius: 12,
                padding: 16,
                border: "1px solid rgba(31,41,55,0.9)",
                marginBottom: 32,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Snapshot JSON (version 3)
              </div>
              <div
                style={{
                  borderRadius: 8,
                  backgroundColor: "#020617",
                  border: "1px solid #4b5563",
                  maxHeight: "480px",
                  overflow: "auto",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
                  fontSize: 12,
                  padding: 10,
                  lineHeight: 1.5,
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
            </section>
          )}
        </div>

        {/* Loading overlay chuyên nghiệp */}
        {loading && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15,23,42,0.85)",
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
                  width: 40,
                  height: 40,
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
      </div>

      {/* Global spinner animation */}
      <style jsx global>{`
        @keyframes snapshot-spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </>
  );
}

export default BybitSnapshotV3Page;
