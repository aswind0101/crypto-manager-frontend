// /lib/pdf.js
import jsPDF from "jspdf";
import { TEMPLATE_SPEC } from "./templateSpec";

/* ===============================
   Helpers
================================ */

function pad3(n) {
    const s = String(n);
    return s.length >= 3 ? s : "0".repeat(3 - s.length) + s;
}

function detectImageType(dataUrl) {
    if (!dataUrl) return "JPEG";
    if (dataUrl.startsWith("data:image/png")) return "PNG";
    return "JPEG";
}

async function fetchTemplateAsDataURL(url) {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `❌ Không tải được template (${res.status}). 
Hãy kiểm tra file nằm đúng tại /public/templates`
        );
    }

    const blob = await res.blob();

    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Đọc template lỗi"));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function getImageSize(dataUrl) {
    return await new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () =>
            resolve({
                w: img.naturalWidth,
                h: img.naturalHeight,
            });

        img.onerror = () =>
            reject(
                new Error(
                    "Không đọc được kích thước template — file có thể bị hỏng."
                )
            );

        img.src = dataUrl;
    });
}

/* ===============================
   Draw Ticket
================================ */

function drawTicket({
    doc,
    templateDataUrl,
    imgW,
    imgH,
    ticket,
    serial,
    boxX,
    boxY,
    boxW,
    boxH,
}) {
    const spec = TEMPLATE_SPEC;

    const imgType = detectImageType(templateDataUrl);

    doc.addImage(templateDataUrl, imgType, boxX, boxY, boxW, boxH);

    const sx = boxW / imgW;
    const sy = boxH / imgH;

    /* ========= SERIAL ========= */

    const serialX = boxX + spec.serialAnchorRatio.x * imgW * sx;
    const serialY = boxY + spec.serialAnchorRatio.y * imgH * sy;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...spec.serialColor);
    doc.setFontSize(Math.max(12, boxH * spec.serialFontScale));

    doc.text(serial, serialX, serialY, {
        align: "left",
        baseline: "middle",
    });

    /* ========= GRID ========= */

    const gridLeft = boxX + spec.gridRectRatio.x1 * imgW * sx;
    const gridTop = boxY + spec.gridRectRatio.y1 * imgH * sy;

    const gridW =
        (spec.gridRectRatio.x2 - spec.gridRectRatio.x1) *
        imgW *
        sx;

    const gridH =
        (spec.gridRectRatio.y2 - spec.gridRectRatio.y1) *
        imgH *
        sy;

    const cellW = gridW / 5;
    const cellH = gridH / 5;

    // trừ border -> căn giữa thị giác
    const padX = cellW * spec.borderPadXRatioOfCell;
    const padY = cellH * spec.borderPadYRatioOfCell;

    const innerLeft = gridLeft + padX;
    const innerTop = gridTop + padY;

    const innerCellW = (gridW - padX * 2) / 5;
    const innerCellH = (gridH - padY * 2) / 5;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...spec.numberColor);

    // auto-fit font (to tối đa)
    let fontSize = innerCellH * 1.42;
    doc.setFontSize(fontSize);

    const maxWidth = innerCellW * 0.78;

    while (doc.getTextWidth("88") > maxWidth) {
        fontSize -= 0.5;
        doc.setFontSize(fontSize);
    }

    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const value = ticket?.grid?.[r]?.[c] ?? "";

            const cx = innerLeft + (c + 0.5) * innerCellW;
            const cy =
                innerTop +
                (r + 0.5) * innerCellH +
                innerCellH * 0.07; // 🔥 magic optical center

            doc.text(String(value), cx, cy, {
                align: "center",
                baseline: "top",
            });
        }
    }
}

/* ===============================
   EXPORT PDF
================================ */

export async function exportTicketsToPdf({
    tickets,
    serialStart = 1,
    fileName = "loto_export.pdf",
}) {
    if (!tickets?.length) {
        throw new Error("Không có dữ liệu vé.");
    }

    // 🔥 TEMPLATE CỐ ĐỊNH
    const templateDataUrl = await fetchTemplateAsDataURL(
        TEMPLATE_SPEC.url
    );

    const { w: imgW, h: imgH } = await getImageSize(
        templateDataUrl
    );

    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
    });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const margin = 12;
    const gap = 10;
    const inset = 2.5;

    const boxW = (pageW - margin * 2 - gap) / 2;
    const boxH = (pageH - margin * 2 - gap) / 2;

    const positions = [
        { x: margin, y: margin },
        { x: margin + boxW + gap, y: margin },
        { x: margin, y: margin + boxH + gap },
        { x: margin + boxW + gap, y: margin + boxH + gap },
    ];

    for (let i = 0; i < tickets.length; i++) {
        const slot = i % 4;

        if (i > 0 && slot === 0) {
            doc.addPage();
        }

        const pos = positions[slot];

        drawTicket({
            doc,
            templateDataUrl,
            imgW,
            imgH,
            ticket: tickets[i],
            serial: pad3(serialStart + i),
            boxX: pos.x + inset,
            boxY: pos.y + inset,
            boxW: boxW - inset * 2,
            boxH: boxH - inset * 2,
        });
    }

    doc.save(fileName);
}
