// /lib/pdf.js
import jsPDF from "jspdf";

/**
 * LT-001, LT-002, ...
 */
function pad3(n) {
    const s = String(n);
    return s.length >= 3 ? s : "0".repeat(3 - s.length) + s;
}

/**
 * TEMPLATE CHUẨN CUỐI:
 * - Có sẵn khung 5x5 trống
 * - Có sẵn chữ "SERIAL: LT-" (không gạch dưới, không số)
 *
 * => Ta sẽ hardcode theo TỈ LỆ (ratio) để không cần calibrate.
 */
const FINAL_CALIB_RATIO = {
    // Grid 5x5: kéo xuống thấp hơn để đủ 5 hàng
    gridRect: {
        x1: 0.155,
        y1: 0.305,
        x2: 0.845,
        y2: 0.645,   // <-- QUAN TRỌNG: tăng từ 0.60 lên 0.645
    },

    // Serial suffix "001" ngay sau "LT-": hạ xuống và dịch nhẹ trái
    serialAnchor: {
        x: 0.545,    // giảm từ 0.565
        y: 0.292,    // tăng từ 0.27
    },
};


function buildCalibFromRatio(imgW, imgH) {
    const r = FINAL_CALIB_RATIO;
    return {
        gridRect: {
            x1: r.gridRect.x1 * imgW,
            y1: r.gridRect.y1 * imgH,
            x2: r.gridRect.x2 * imgW,
            y2: r.gridRect.y2 * imgH,
        },
        serialAnchor: {
            x: r.serialAnchor.x * imgW,
            y: r.serialAnchor.y * imgH,
        },
    };
}

/**
 * Vẽ 1 vé vào 1 ô (box) trên trang PDF
 */
function drawTicket({
    doc,
    templateImgDataUrl,
    ticket,
    serialSuffix, // "001" / "002" / ...
    boxX,
    boxY,
    boxW,
    boxH,
    imgW,
    imgH,
}) {
    // 1) Vẽ background template
    doc.addImage(templateImgDataUrl, "JPEG", boxX, boxY, boxW, boxH);

    // 2) Calib theo ratio (không cần user click)
    const calib = buildCalibFromRatio(imgW, imgH);

    // 3) Scale ảnh(px) -> box(mm)
    const sx = boxW / imgW;
    const sy = boxH / imgH;

    /**
     * ===== SERIAL =====
     * Template đã có sẵn "SERIAL: LT-"
     * => chỉ vẽ "001" ngay sau LT-
     */
    const serialX = boxX + calib.serialAnchor.x * sx;
    const serialY = boxY + calib.serialAnchor.y * sy;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(31, 58, 95); // xanh đậm gần giống chữ SERIAL trên template
    doc.setFontSize(Math.max(11, boxH * 0.060)); // to hơn rõ rệt
    // scale theo chiều cao vé
    doc.text(String(serialSuffix), serialX, serialY, { align: "left" });

    /**
     * ===== GRID 5x5 =====
     * Vẽ 25 số vào đúng tâm 25 ô
     */
    // ===== GRID 5x5 =====
    const { x1, y1, x2, y2 } = calib.gridRect;

    const gridLeft = boxX + x1 * sx;
    const gridTop = boxY + y1 * sy;
    const gridW = (x2 - x1) * sx;
    const gridH = (y2 - y1) * sy;

    const cellW = gridW / 5;
    const cellH = gridH / 5;

    // màu chữ giống ảnh gốc (đen xám)
    doc.setTextColor(34, 34, 34);

    // ---------- Font + size (sẽ set sau khi chọn font) ----------
    doc.setFont("helvetica", "bold"); // sẽ đổi sang font custom ở mục 2 nếu bạn làm

    // Tính fontSize "to nhất có thể" mà vẫn lọt ô (fit theo '88')
    let fontSize = cellH * 1.08;                 // muốn to hơn nữa
    doc.setFontSize(fontSize);

    const sample = "88"; // 2 chữ số to nhất thường gặp
    const maxWidth = cellW * 0.78;               // chừa biên trong ô
    while (doc.getTextWidth(sample) > maxWidth && fontSize > 8) {
        fontSize -= 0.5;
        doc.setFontSize(fontSize);
    }

    // Vẽ số vào đúng tâm ô (baseline middle)
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const v = ticket?.grid?.[r]?.[c] ?? "";
            const cx = gridLeft + (c + 0.5) * cellW;
            const cy = gridTop + (r + 0.5) * cellH;
            doc.text(String(v), cx, cy, { align: "center", baseline: "middle" });
        }
    }


}

/**
 * Export tất cả tickets -> PDF
 * - A4 dọc
 * - 4 vé / 1 trang (2x2)
 * - chừa lề để cắt (margin/gap/inset)
 */
export async function exportTicketsToPdf({
    templateImgDataUrl,
    templateNaturalSize, // { w, h }
    tickets,
    serialStart = 1, // LT-001
    fileName = "loto_export.pdf",
}) {
    if (!templateImgDataUrl || !templateNaturalSize?.w || !templateNaturalSize?.h) {
        throw new Error("Thiếu template hoặc không đọc được kích thước template.");
    }
    if (!Array.isArray(tickets) || tickets.length === 0) {
        throw new Error("Không có dữ liệu vé để export.");
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // ✅ A4 dọc + chừa lề để cắt
    const margin = 12; // mm lề ngoài
    const gap = 10; // mm khoảng giữa 2 vé
    const inset = 2.5; // mm thụt vào trong mỗi ô vé để an toàn khi cắt

    const boxW = (pageW - margin * 2 - gap) / 2;
    const boxH = (pageH - margin * 2 - gap) / 2;

    // vị trí 4 ô trên trang
    const positions = [
        { x: margin, y: margin }, // TL
        { x: margin + boxW + gap, y: margin }, // TR
        { x: margin, y: margin + boxH + gap }, // BL
        { x: margin + boxW + gap, y: margin + boxH + gap }, // BR
    ];

    const imgW = templateNaturalSize.w;
    const imgH = templateNaturalSize.h;

    for (let i = 0; i < tickets.length; i++) {
        const slot = i % 4;
        if (i > 0 && slot === 0) doc.addPage();

        const pos = positions[slot];
        const serialSuffix = pad3(serialStart + i); // "001" ...

        drawTicket({
            doc,
            templateImgDataUrl,
            ticket: tickets[i],
            serialSuffix,
            boxX: pos.x + inset,
            boxY: pos.y + inset,
            boxW: boxW - inset * 2,
            boxH: boxH - inset * 2,
            imgW,
            imgH,
        });
    }

    doc.save(fileName);
}
