// bybit-snapshot-v3-ui-macros.js
// UI helper file — COPY COMMANDS chuẩn theo Price Analyzer v3.1 AI Core SPEC (stable)
// Mục tiêu: user chỉ copy TRIGGER HỢP LỆ, không dùng câu tự nhiên

export function buildCopyCommands(snapshotFileName) {
  return {
    // =============================
    // MODE A — FULL DASHBOARD
    // =============================
    fullDashboard: {
      label: "📊 Full Dashboard (Toàn bộ phân tích)",
      command: `[DASH] FILE=${snapshotFileName}`,
      description: "Xuất đầy đủ 6 phần + ≥3 setup theo SPEC"
    },

    // =============================
    // MODE B — QUICK SETUP CHECK
    // =============================
    quickCheck: [
      {
        label: "⚡ Check nhanh Setup #1",
        command: `[CHECK] FILE=${snapshotFileName} SETUP=#1`,
        description: "Kiểm tra nhanh Setup #1: READY chưa, ENTRY OK không, GO/NO-GO"
      },
      {
        label: "⚡ Check nhanh Setup #2",
        command: `[CHECK] FILE=${snapshotFileName} SETUP=#2`,
        description: "Kiểm tra nhanh Setup #2"
      },
      {
        label: "⚡ Check nhanh Setup #3",
        command: `[CHECK] FILE=${snapshotFileName} SETUP=#3`,
        description: "Kiểm tra nhanh Setup #3"
      }
    ],

    // =============================
    // MODE C — PARTIAL DASHBOARD
    // =============================
    partialDashboard: [
      {
        label: "🧭 Market Mode",
        command: `[PART] FILE=${snapshotFileName} SECTION=I`,
        description: "Xem nhanh trạng thái thị trường (trend / range / bias)"
      },
      {
        label: "📈 Trend Radar",
        command: `[PART] FILE=${snapshotFileName} SECTION=II`,
        description: "Xu hướng ngắn / trung / dài hạn"
      },
      {
        label: "👥 Market Participants",
        command: `[PART] FILE=${snapshotFileName} SECTION=III`,
        description: "Hành vi MM / Whale / ETF / Retail"
      },
      {
        label: "🎯 Trade Zone Terminal",
        command: `[PART] FILE=${snapshotFileName} SECTION=IV`,
        description: "Danh sách ≥3 setup đầy đủ Entry / SL / TP / RR / Score"
      }
    ],

    // =============================
    // MODE D — SETUP SUMMARY
    // =============================
    setupSummary: {
      label: "📋 Setup Summary (Tóm tắt nhanh)",
      command: `[SETUPS] FILE=${snapshotFileName}`,
      description: "Tóm tắt ≥3 setup: STATE, ENTRY, SL, TP, RR, CONFIDENCE, GO/NO-GO"
    }
  };
}

// =============================
// Ví dụ sử dụng trong UI
// =============================
// const commands = buildCopyCommands("BTCUSDT_FULL_2025-01-15T12-00.json");
// renderCopyButtons(commands);
