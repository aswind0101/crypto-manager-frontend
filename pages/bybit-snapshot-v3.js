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

const PROMPTS = {
  SESSION_START: `[SESSION START]
XUẤT FULL DASHBOARD 6 phần theo SPEC.
- Nếu có 2 file (HTF+LTF): dùng đúng 1 dòng [DASH] với 2 FILE.
- Không dùng MODE/macro khác.
Kết luận: Market Mode, Bias chính, Setup #1-#3.`,


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
- Sai ở đâu (nếu có) và cách sửa.`,
};
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

  // SPEC: FULL dashboard with 2 files must be in ONE [DASH] line
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
    // - POSITION/END: prefer FULL for context if available
    if (stage === "STEP1") return macroHTF || macroFULL || macroLTF;
    if (stage === "STEP2") return macroLTF || macroFULL || macroHTF;

    // SESSION_START / MONITOR / POSITION / END (and others): prefer FULL
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Toast message={toast} />

      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold tracking-tight">Snapshot Console v3</div>
                <div className="text-xs text-slate-400">
                  HTF → Step1 (H1 Close) → Step2 (LTF Gate) → Position → End
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
                  {headerStatus || "No snapshot yet"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-6 lg:grid-cols-12">
        {/* Left Stepper */}
        <div className="lg:col-span-4">
          <WorkflowStepper
            stages={STAGES}
            activeId={stage}
            onSelect={(id) => {
              if (stageLocks[id]) return;
              setStage(id);
            }}
            locks={stageLocks}
          />

          {/* Quick status controls (user enters statuses from ChatGPT output) */}
          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Workflow State</div>
              <div className="text-xs text-slate-400">Manual, from analysis output</div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="text-xs text-slate-400">Step 1 (SETUP_STATE)</div>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs"
                  value={step1Status}
                  onChange={(e) => setStep1Status(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="READY">READY</option>
                  <option value="ALMOST_READY">ALMOST_READY</option>
                  <option value="INVALID">INVALID</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="text-xs text-slate-400">Step 2 (ENTRY_VALIDITY)</div>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs"
                  value={step2Status}
                  onChange={(e) => setStep2Status(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="ENTRY_OK">ENTRY_OK</option>
                  <option value="ENTRY_WAIT">ENTRY_WAIT</option>
                  <option value="ENTRY_OFF">ENTRY_OFF</option>
                </select>
              </div>

              <div className="text-xs text-slate-500">
                UI sẽ tự khóa/mở Step2 và Position theo hai trạng thái này.
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-300">Persist on Refresh</div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={persistSnapshots}
                    onChange={(e) => setPersistSnapshots(e.target.checked)}
                  />
                  Save snapshots
                </label>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Tắt “Save snapshots” nếu lo quota localStorage: tool vẫn nhớ workflow nhưng không giữ JSON.
              </div>
            </div>

            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  try { localStorage.removeItem(LS_KEY); } catch { }

                  setStage("SESSION_START");
                  setSymbolsText("BTCUSDT");
                  setHtf({ snapshot: null, fileName: "", generatedAt: 0 });
                  setLtf({ snapshot: null, fileName: "", generatedAt: 0 });
                  setStep1Status("");
                  setStep2Status("");
                  setPosSide("SHORT");
                  setPosEntry("");
                  setPosStop("");
                  setPosSize("0.5R");
                  setPersistSnapshots(true);

                  showToast("Session reset.");
                }}
              >
                Reset Session
              </Button>
            </div>
          </Card>
        </div>

        {/* Main workspace */}
        <div className="lg:col-span-8">
          {/* Stage header */}
          <div className="mb-4">
            <div className="text-xl font-semibold tracking-tight">
              {STAGES.find((s) => s.id === stage)?.label}
            </div>
            <div className="text-sm text-slate-400">
              {STAGES.find((s) => s.id === stage)?.desc}
            </div>
          </div>

          {/* Data / Generate card */}
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex-1">
                  <div className="text-sm font-semibold">Symbols</div>
                  <div className="text-xs text-slate-400">Phân tách bằng dấu phẩy hoặc khoảng trắng</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-600"
                    value={symbolsText}
                    onChange={(e) => setSymbolsText(e.target.value)}
                    placeholder="Ví dụ: BTCUSDT, ETHUSDT"
                    disabled={loading}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={handleGenerateHTF}
                    disabled={loading}
                  >
                    {loading ? "Generating HTF..." : "Generate HTF Snapshot"}
                  </Button>

                  <Button
                    variant="gold"
                    onClick={handleGenerateLTF}
                    disabled={loading}
                  >
                    {loading ? "Generating LTF..." : "Generate LTF (M5/M15)"}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                  <div className="text-xs text-slate-400">HTF File</div>
                  <div className="mt-1 break-all text-sm">{htf.fileName || "—"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => copyText(JSON.stringify(htf.snapshot, null, 2), "Copied HTF JSON")}
                      disabled={!htf.snapshot}
                    >
                      Copy HTF JSON
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => downloadJson(htf.snapshot, htf.fileName)}
                      disabled={!htf.snapshot}
                    >
                      Download
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => copyText(macroHTF, "Copied HTF macro")}
                      disabled={!macroHTF}
                    >
                      Copy Macro
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                  <div className="text-xs text-slate-400">LTF File</div>
                  <div className="mt-1 break-all text-sm">{ltf.fileName || "—"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => copyText(JSON.stringify(ltf.snapshot, null, 2), "Copied LTF JSON")}
                      disabled={!ltf.snapshot}
                    >
                      Copy LTF JSON
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => downloadJson(ltf.snapshot, ltf.fileName)}
                      disabled={!ltf.snapshot}
                    >
                      Download
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => copyText(macroLTF, "Copied LTF macro")}
                      disabled={!macroLTF}
                    >
                      Copy Macro
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Prompt card */}
          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Prompt Template</div>
                <div className="text-xs text-slate-400">
                  Copy sang ChatGPT (macro sẽ tự gắn đúng file theo stage)
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => copyText(finalPrompt, "Copied stage prompt")}
                  disabled={!finalPrompt}
                >
                  Copy Prompt
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => copyText(`${macroFULL}\nXuất FULL DASHBOARD`, "Copied FULL DASHBOARD command")}
                  disabled={!macroFULL}
                >
                  Copy FULL DASHBOARD
                </Button>

              </div>
            </div>

            <div className="mt-3">
              <PromptBox value={finalPrompt} />
            </div>

            {/* Stage hint */}
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
              {stage === "STEP2" ? (
                <>
                  Step2 dùng <span className="text-slate-200">LTF macro</span>. Điều kiện mở Step2:
                  <span className="ml-1 text-slate-200">Step1 = READY</span> và có LTF snapshot.
                </>
              ) : stage === "POSITION" ? (
                <>
                  Position chỉ mở khi <span className="text-slate-200">Step2 = ENTRY_OK</span>. Nếu bạn muốn override,
                  bạn có thể tạm set Step2 = ENTRY_OK ở panel bên trái.
                </>
              ) : (
                <>
                  Quy tắc: <span className="text-slate-200">H1 đóng → Step1</span>, READY → <span className="text-slate-200">Step2</span>, ENTRY_OK → <span className="text-slate-200">Position</span>.
                </>
              )}
            </div>
          </Card>

          {/* Position card */}
          {stage === "POSITION" && (
            <Card className="mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Position Builder</div>
                  <div className="text-xs text-slate-400">Tạo prompt quản lý lệnh theo format chuẩn</div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const posText = `[POSITION]
SIDE: ${posSide}
ENTRY: ${posEntry || "<price>"}
STOP: ${posStop || "<price>"}
SIZE: ${posSize || "<size>"}
Yêu cầu: cập nhật risk, invalidation, kế hoạch chốt TP1/TP2.`;
                    const prefix = stageMacro ? `${stageMacro}\n` : "";
                    copyText(`${prefix}${posText}`, "Copied position prompt");
                  }}
                >
                  Copy Position Prompt
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <div className="text-xs text-slate-400">Side</div>
                  <select
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                    value={posSide}
                    onChange={(e) => setPosSide(e.target.value)}
                  >
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Entry</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                    value={posEntry}
                    onChange={(e) => setPosEntry(e.target.value)}
                    placeholder="3128"
                  />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Stop</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                    value={posStop}
                    onChange={(e) => setPosStop(e.target.value)}
                    placeholder="3185"
                  />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Size</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                    value={posSize}
                    onChange={(e) => setPosSize(e.target.value)}
                    placeholder="0.5R"
                  />
                </div>
              </div>
            </Card>
          )}

          {/* JSON Viewer */}
          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">JSON Viewer</div>
                <div className="text-xs text-slate-400">
                  Đang hiển thị: {activeFileName || "—"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => copyText(JSON.stringify(activeSnapshot, null, 2), "Copied viewer JSON")}
                  disabled={!activeSnapshot}
                >
                  Copy
                </Button>
              </div>
            </div>

            <div className="mt-3">
              <JsonViewer data={activeSnapshot} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
