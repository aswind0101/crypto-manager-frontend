import React, { useCallback, useMemo, useState, useEffect } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";
import WorkflowStepper from "../components/snapshot/WorkflowStepper";
import Card from "../components/snapshot/Card";
import Button from "../components/snapshot/Button";
import PromptBox from "../components/snapshot/PromptBox";
import JsonViewer from "../components/snapshot/JsonViewer";
import Toast from "../components/snapshot/Toast";

const STAGES = [
  { id: "SESSION_START", label: "Session Start", desc: "Tạo HTF snapshot + định bias" },
  { id: "MONITOR", label: "Monitor", desc: "Theo dõi zone, chưa vào lệnh" },
  { id: "STEP1", label: "Step 1 (H1 Close)", desc: "Xác nhận SETUP_STATE" },
  { id: "STEP2", label: "Step 2 (LTF Gate)", desc: "Xác nhận ENTRY_VALIDITY" },
  { id: "POSITION", label: "Position", desc: "Khai báo lệnh & quản lý" },
  { id: "END", label: "Session End", desc: "Tổng kết phiên" },
];

// SPEC output guard (Appendix A/B). Inject into prompts when user expects FULL dashboard.
const DASHBOARD_RENDER_GUARD = `[DASHBOARD_RENDER_GUARD_v1_vi]
BẮT BUỘC (FULL DASHBOARD):
1) Render đủ 6 phần theo đúng thứ tự & tiêu đề + icon được quy định trong file SPEC của project files:
   PHẦN 0 — DATA CHECK (FROM JSON)
   I. MARKET MODE LABEL
   II. TREND RADAR (Short–Mid–Long)
   III. MARKET PARTICIPANT MAP
   IV. TRADE ZONE TERMINAL (Setup Engine)
   V. ACTION SUMMARY
   VI. QUẢN LÝ LỆNH HIỆN TẠI

2) Mỗi setup (>=3 setup: #1/#2/#3) phải có đủ:
   Direction, Priority, SETUP_STATE, ENTRY_VALIDITY, CONFIDENCE SCORE,
   Entry Zone, Stoploss, TP1/TP2/TP3 (nếu state != BUILD-UP), WHY (3–6 bullet gắn JSON path), NEXT CONDITION.
   Tất cả các phần Entry Zone, Stoploss, TP1/TP2/TP3 cần phải là con số dứt khoác, cụ thể và cho biết cách tính 
3) Nếu thiếu field bắt buộc: ghi rõ “MISSING FIELD: <json_path>” và default an toàn theo SPEC.
4) Kết thúc bằng QA CHECK theo SPEC.
`;

const PROMPTS = {
  // NOTE (SPEC): Do NOT use MODE=... for dashboard routing.
  // FULL dashboard is triggered ONLY by: [DASH] FILE=<HTF> FILE=<LTF>
  SESSION_START: `[SESSION START]
XUẤT FULL DASHBOARD 6 phần theo SPEC.
Kết luận: Market Mode, Bias chính của phiên, Setup ưu tiên (#1–#3).
${DASHBOARD_RENDER_GUARD}`,

  MONITOR: `[MONITOR]
XUẤT FULL DASHBOARD 6 phần theo SPEC.
Tập trung: zone, trigger candle đã đóng, điều kiện NEXT CONDITION cho Setup #1/#2/#3.
${DASHBOARD_RENDER_GUARD}`,

  STEP1: `[STEP1]
CHECK SETUP 1
Chỉ trả về: SETUP_STATE (READY/ALMOST_READY/INVALID) + lý do.
Chỉ dùng candle H1 đã đóng.`,

  STEP2: `[STEP2]
LTF ENTRY GATE – SETUP 1
Trả về: ENTRY_VALIDITY (ENTRY_OK/ENTRY_WAIT/ENTRY_OFF) + lý do từ orderflow_summary.
Không phân tích lại HTF.`,

  POSITION: `[POSITION]
SIDE: <LONG/SHORT>
ENTRY: <price>
STOP: <price>
SIZE: <xR or contracts>
Yêu cầu: cập nhật risk, invalidation, kế hoạch chốt TP1/TP2.`,

  END: `[SESSION END]
Tổng kết phiên theo rulebook:
- Bias có đổi không?
- Setup có đúng quy trình 2 bước không?
- Sai ở đâu (nếu có) và cách sửa.
${DASHBOARD_RENDER_GUARD}`,
};


// Optional: a dedicated prompt to force FULL dashboard output consistency.
const FULL_DASHBOARD_PROMPT = `Xuất FULL DASHBOARD 6 phần theo SPEC.
${DASHBOARD_RENDER_GUARD}`;
const LS_KEY = "snapshot_console_v3_session";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function sanitizeSession(raw) {
  // Tránh crash nếu schema thay đổi
  if (!raw || typeof raw !== "object") return null;

  const s = {
    stage: raw.stage || "SESSION_START",
    symbolsText: raw.symbolsText || "BTCUSDT",
    step1Status: raw.step1Status || "",
    step2Status: raw.step2Status || "",
    posSide: raw.posSide || "SHORT",
    posEntry: raw.posEntry || "",
    posStop: raw.posStop || "",
    posSize: raw.posSize || "0.5R",
    htf: raw.htf || { snapshot: null, fileName: "", generatedAt: 0 },
    ltf: raw.ltf || { snapshot: null, fileName: "", generatedAt: 0 },
    // Option: lưu/tắt snapshot để tránh vượt quota
    persistSnapshots: raw.persistSnapshots ?? true,
  };

  // Nếu user tắt persistSnapshots thì bỏ snapshot data khi restore
  if (!s.persistSnapshots) {
    s.htf = { ...s.htf, snapshot: null };
    s.ltf = { ...s.ltf, snapshot: null };
  }

  return s;
}

function normalizeSymbols(input) {
  return (input || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export default function BybitSnapshotV3New() {
  const [stage, setStage] = useState("SESSION_START");

  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // HTF/LTF snapshots kept separately (avoid overwriting)
  const [htf, setHtf] = useState({ snapshot: null, fileName: "", generatedAt: 0 });
  const [ltf, setLtf] = useState({ snapshot: null, fileName: "", generatedAt: 0 });

  // Optional workflow results (user manually sets from ChatGPT output)
  const [step1Status, setStep1Status] = useState(""); // READY / ALMOST_READY / INVALID
  const [step2Status, setStep2Status] = useState(""); // ENTRY_OK / ENTRY_WAIT / ENTRY_OFF

  // Position input
  const [posSide, setPosSide] = useState("SHORT");
  const [posEntry, setPosEntry] = useState("");
  const [posStop, setPosStop] = useState("");
  const [posSize, setPosSize] = useState("0.5R");

  // UI
  const [toast, setToast] = useState("");
  const [persistSnapshots, setPersistSnapshots] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = safeParse(localStorage.getItem(LS_KEY));
    const restored = sanitizeSession(raw);
    if (!restored) return;

    setStage(restored.stage);
    setSymbolsText(restored.symbolsText);
    setStep1Status(restored.step1Status);
    setStep2Status(restored.step2Status);
    setPosSide(restored.posSide);
    setPosEntry(restored.posEntry);
    setPosStop(restored.posStop);
    setPosSize(restored.posSize);
    setPersistSnapshots(restored.persistSnapshots);

    // restore snapshots if allowed
    if (restored.persistSnapshots) {
      setHtf(restored.htf);
      setLtf(restored.ltf);
    }

    setToast("Session restored.");
    setTimeout(() => setToast(""), 1400);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const payload = {
      stage,
      symbolsText,
      step1Status,
      step2Status,
      posSide,
      posEntry,
      posStop,
      posSize,
      persistSnapshots,
      htf: persistSnapshots ? htf : { ...htf, snapshot: null },
      ltf: persistSnapshots ? ltf : { ...ltf, snapshot: null },
    };

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch (e) {
      // Nếu vượt quota: tự fallback sang “không lưu snapshot JSON”
      console.warn("localStorage quota exceeded; saving without snapshots.", e);
      const fallback = {
        ...payload,
        persistSnapshots: false,
        htf: { ...htf, snapshot: null },
        ltf: { ...ltf, snapshot: null },
      };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(fallback));
      } catch { }
    }
  }, [
    stage,
    symbolsText,
    step1Status,
    step2Status,
    posSide,
    posEntry,
    posStop,
    posSize,
    persistSnapshots,
    htf,
    ltf,
  ]);

  const symbols = useMemo(() => normalizeSymbols(symbolsText), [symbolsText]);
  const primarySymbol = symbols[0] || "SYMBOL";

  const stageLocks = useMemo(() => {
    const hasHTF = !!htf.snapshot;
    const hasLTF = !!ltf.snapshot;

    return {
      SESSION_START: false,
      MONITOR: !hasHTF,
      STEP1: !hasHTF,
      STEP2: !(hasHTF && step1Status === "READY" && hasLTF),
      POSITION: !(step2Status === "ENTRY_OK"),
      END: false,
    };
  }, [htf.snapshot, ltf.snapshot, step1Status, step2Status]);

  const macroHTF = useMemo(() => {
    return htf.fileName ? `[DASH] FILE=${htf.fileName}` : "";
  }, [htf.fileName]);

  const macroLTF = useMemo(() => {
    return ltf.fileName ? `[DASH] FILE=${ltf.fileName}` : "";
  }, [ltf.fileName]);

  // SPEC: FULL dashboard with 2 files must be in ONE [DASH] line.
  const macroFULL = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1400);
  };

  const copyText = async (text, okMsg) => {
    try {
      if (!text) return;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showToast(okMsg || "Copied.");
    } catch (e) {
      console.error(e);
      showToast("Copy failed.");
    }
  };

  const handleGenerateHTF = useCallback(async () => {
    setError("");
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);
      const result = await buildSnapshotV3(symbols);
      if (!result || typeof result !== "object") throw new Error("Snapshot HTF trả về không hợp lệ.");

      const ts = result.generated_at || Date.now();
      const firstSymbol =
        result?.per_exchange?.bybit?.symbols?.[0]?.symbol || primarySymbol;

      const name = `bybit_snapshot_${ts}_${firstSymbol}.json`;

      setHtf({ snapshot: result, fileName: name, generatedAt: ts });

      // Reset dependent steps
      setStep1Status("");
      setStep2Status("");
      if (stage === "SESSION_START") setStage("MONITOR");

      showToast("HTF snapshot created.");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Có lỗi khi tạo HTF snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol, stage]);

  const handleGenerateLTF = useCallback(async () => {
    setError("");
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT.");
      return;
    }

    try {
      setLoading(true);
      const result = await buildLtfSnapshotV3(symbols);
      if (!result || typeof result !== "object") throw new Error("Snapshot LTF trả về không hợp lệ.");

      const ts = result.generated_at || Date.now();
      const firstSymbol = primarySymbol;

      const name = `bybit_ltf_snapshot_${ts}_${firstSymbol}.json`;

      setLtf({ snapshot: result, fileName: name, generatedAt: ts });
      showToast("LTF snapshot created.");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Có lỗi khi tạo LTF snapshot.");
    } finally {
      setLoading(false);
    }
  }, [symbols, primarySymbol]);

  const downloadJson = (obj, name) => {
    if (!obj) return;
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "snapshot.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const downloadBoth = () => {
    if (!htf.snapshot || !ltf.snapshot) return;

    downloadJson(htf.snapshot, htf.fileName);
    setTimeout(() => {
      downloadJson(ltf.snapshot, ltf.fileName);
    }, 150);
  };



  // Which snapshot to show in viewer
  const activeSnapshot = useMemo(() => {
    if (stage === "STEP2") return ltf.snapshot || htf.snapshot;
    return htf.snapshot || ltf.snapshot;
  }, [stage, htf.snapshot, ltf.snapshot]);

  const activeFileName = useMemo(() => {
    if (stage === "STEP2") return ltf.fileName || htf.fileName;
    return htf.fileName || ltf.fileName;
  }, [stage, htf.fileName, ltf.fileName]);

  const stagePrompt = useMemo(() => PROMPTS[stage] || "", [stage]);

  const stageMacro = useMemo(() => {
    // SPEC-aligned macro routing
    // - FULL sections: prefer combined [DASH] FILE=HTF FILE=LTF when available
    // - STEP1: HTF only (SETUP_STATE)
    // - STEP2: LTF only (ENTRY_VALIDITY gate)
    if (stage === "STEP1") return macroHTF || macroFULL || macroLTF;
    if (stage === "STEP2") return macroLTF || macroFULL || macroHTF;
    return macroFULL || macroHTF || macroLTF;
  }, [stage, macroHTF, macroLTF, macroFULL]);

  const finalPrompt = useMemo(() => {
    const prefix = stageMacro ? `${stageMacro}\n` : "";
    return `${prefix}${stagePrompt}`.trim();
  }, [stageMacro, stagePrompt]);

  const headerStatus = useMemo(() => {
    const parts = [];
    if (htf.fileName) parts.push(`HTF: ${htf.fileName}`);
    if (ltf.fileName) parts.push(`LTF: ${ltf.fileName}`);
    if (step1Status) parts.push(`Step1: ${step1Status}`);
    if (step2Status) parts.push(`Step2: ${step2Status}`);
    return parts.join(" • ");
  }, [htf.fileName, ltf.fileName, step1Status, step2Status]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Export Snapshots</div>
            <div className="text-xs text-slate-400">
              HTF + LTF (2 files) + FULL macro
            </div>
          </div>

          {toast && (
            <div className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-slate-200">
              {toast}
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
            <div className="text-xs text-slate-400">HTF file</div>
            <div className="mt-1 break-all text-sm">{htf.fileName || "—"}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
            <div className="text-xs text-slate-400">LTF file</div>
            <div className="mt-1 break-all text-sm">{ltf.fileName || "—"}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={downloadBoth}
            disabled={!htf.snapshot || !ltf.snapshot}
          >
            Download HTF + LTF
          </Button>

          <Button
            variant="secondary"
            onClick={() => copyText(macroFULL, "Copied FULL macro")}
            disabled={!macroFULL}
          >
            Copy FULL Macro
          </Button>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );

}
