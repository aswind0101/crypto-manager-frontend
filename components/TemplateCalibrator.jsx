// /components/TemplateCalibrator.jsx
import React, { useMemo, useRef, useState } from "react";

export default function TemplateCalibrator({ imgSrc, onDone }) {
  const imgRef = useRef(null);
  const [points, setPoints] = useState([]); // [{x,y}] theo tọa độ ảnh (px)

  const stage = useMemo(() => {
    if (points.length === 0) return "Click góc TRÊN-TRÁI của khung bảng 5×5";
    if (points.length === 1) return "Click góc DƯỚI-PHẢI của khung bảng 5×5";
    if (points.length === 2) return "Click vị trí neo SERIAL (giữa dòng SERIAL)";
    return "Đã xong";
  }, [points.length]);

  const handleClick = (e) => {
    const img = imgRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // quy về tọa độ ảnh thật (natural)
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;

    const x = clickX * scaleX;
    const y = clickY * scaleY;

    setPoints((prev) => {
      if (prev.length >= 3) return prev;
      const next = [...prev, { x, y }];
      if (next.length === 3) {
        const [p1, p2, p3] = next;
        const calib = {
          gridRect: {
            x1: Math.min(p1.x, p2.x),
            y1: Math.min(p1.y, p2.y),
            x2: Math.max(p1.x, p2.x),
            y2: Math.max(p1.y, p2.y),
          },
          serialAnchor: { x: p3.x, y: p3.y },
        };
        onDone?.(calib, { w: img.naturalWidth, h: img.naturalHeight });
      }
      return next;
    });
  };

  const reset = () => setPoints([]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">Calibration</div>
          <div className="mt-1 text-xs text-slate-400">{stage}</div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-xl border border-slate-700 bg-black/30 px-3 py-2 text-xs text-slate-200 hover:bg-black/40"
        >
          Reset
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
        <img
          ref={imgRef}
          src={imgSrc}
          alt="template"
          className="w-full select-none"
          onClick={handleClick}
          draggable={false}
        />
      </div>

      <div className="mt-3 text-xs text-slate-500">
        Đã chọn: {points.length}/3 điểm
      </div>
    </div>
  );
}
