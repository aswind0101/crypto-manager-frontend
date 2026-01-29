// /pages/loto-export.jsx
import React, { useEffect, useMemo, useState } from "react";
import TemplateCalibrator from "../components/TemplateCalibrator";
import { parseExcelToTickets } from "../lib/excel";
import { exportTicketsToPdf } from "../lib/pdf";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Không đọc được file ảnh."));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

export default function LotoExportPage() {
  const [templateFile, setTemplateFile] = useState(null);
  const [templateDataUrl, setTemplateDataUrl] = useState("");
  const [templateSize, setTemplateSize] = useState(null);

  const [calib, setCalib] = useState(null);

  const [excelFile, setExcelFile] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [totalRows, setTotalRows] = useState(0);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const totalTickets = tickets.length;
  const totalPages = useMemo(() => Math.ceil(totalTickets / 4), [totalTickets]);

  // load template image to dataUrl
  useEffect(() => {
    (async () => {
      try {
        if (!templateFile) return;
        const url = await fileToDataUrl(templateFile);
        setTemplateDataUrl(url);
        setErr("");

        // reset calib khi đổi template
        setCalib(null);
        setTemplateSize(null);
      } catch (e) {
        setErr(e?.message || "Lỗi template.");
      }
    })();
  }, [templateFile]);

  // load excel
  useEffect(() => {
    (async () => {
      try {
        if (!excelFile) return;
        setLoading(true);
        setErr("");

        const { totalRows, tickets } = await parseExcelToTickets(excelFile);
        setTotalRows(totalRows);
        setTickets(tickets);
      } catch (e) {
        setErr(e?.message || "Lỗi Excel.");
      } finally {
        setLoading(false);
      }
    })();
  }, [excelFile]);

  // persist calib
  useEffect(() => {
    try {
      if (calib && templateSize) {
        localStorage.setItem("loto_calib_v1", JSON.stringify({ calib, templateSize }));
      }
    } catch {}
  }, [calib, templateSize]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("loto_calib_v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.calib && parsed?.templateSize) {
        setCalib(parsed.calib);
        setTemplateSize(parsed.templateSize);
      }
    } catch {}
  }, []);

  const canExport = templateDataUrl && templateSize && calib && totalTickets > 0 && !loading;

  const onExport = async () => {
    try {
      setErr("");
      setLoading(true);
      await exportTicketsToPdf({
        templateImgDataUrl: templateDataUrl,
        templateNaturalSize: templateSize,
        tickets,
        serialStart: 1, // LT-001
        calib,
        fileName: "loto_export.pdf",
      });
    } catch (e) {
      setErr(e?.message || "Export lỗi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="text-lg font-semibold">Lô Tô Export (4 vé / trang)</div>
        <div className="mt-1 text-xs text-slate-400">
          Excel: 5 dòng = 1 vé · PDF: 4 vé/trang · SERIAL: LT-001 tăng dần
        </div>

        {/* Uploads */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="text-sm font-semibold">1) Template image</div>
            <input
              type="file"
              accept="image/*"
              className="mt-3 block w-full text-sm"
              onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
            />
            <div className="mt-2 text-xs text-slate-500">Khuyên dùng JPG/PNG đúng mẫu.</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="text-sm font-semibold">2) Excel data</div>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="mt-3 block w-full text-sm"
              onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
            />
            <div className="mt-2 text-xs text-slate-500">
              {excelFile ? `Đã tải: ${excelFile.name}` : "Chưa có file."}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 rounded-2xl border border-slate-800 bg-black/20 p-4 text-sm">
          <div className="flex flex-wrap gap-4">
            <div>Rows: <span className="text-slate-200">{totalRows}</span></div>
            <div>Tickets: <span className="text-slate-200">{totalTickets}</span></div>
            <div>PDF pages: <span className="text-slate-200">{totalPages}</span></div>
          </div>
        </div>

        {/* Calibrate */}
        {templateDataUrl ? (
          <div className="mt-4">
            <TemplateCalibrator
              imgSrc={templateDataUrl}
              onDone={(calib, size) => {
                setCalib(calib);
                setTemplateSize(size);
              }}
            />
          </div>
        ) : null}

        {/* Export */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!canExport}
            onClick={onExport}
            className={[
              "rounded-2xl px-4 py-3 text-sm font-semibold transition",
              canExport
                ? "bg-slate-200 text-slate-950 hover:bg-white"
                : "cursor-not-allowed bg-slate-800 text-slate-400",
            ].join(" ")}
          >
            {loading ? "Đang xử lý..." : "EXPORT PDF"}
          </button>

          <div className="text-xs text-slate-500">
            {(!calib || !templateSize) ? "Cần calibrate xong (3 clicks) trước khi export." : "Calibration OK."}
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
