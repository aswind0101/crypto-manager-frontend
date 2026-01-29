// /lib/templateSpec.js
export const TEMPLATE_SPEC = {
  // Template cố định
  url: "/templates/loto-2025-final.jpeg",

  // Tọa độ theo ratio của template cuối (5x5)
  // Nếu sau này bạn đổi template, chỉ cần chỉnh 2 block ratio này.
  gridRectRatio: { x1: 0.155, y1: 0.295, x2: 0.845, y2: 0.635 },

  // Điểm bắt đầu vẽ suffix (001) ngay sau "LT-"
  // Nếu bị dính dấu "-", tăng x lên nhẹ (vd +0.005)
  serialAnchorRatio: { x: 0.575, y: 0.283 },

  // Style giống ảnh gốc
  numberColor: [34, 34, 34], // #222
  serialColor: [31, 58, 95], // xanh đậm

  // “Trừ border” của lưới (để tâm ô chuẩn thị giác)
  // Nếu số hơi cao/thấp => chỉnh padY; lệch trái/phải => chỉnh padX
  borderPadXRatioOfCell: 0.06,
  borderPadYRatioOfCell: 0.08,

  // Max font scale theo chiều cao ô (auto-fit width sẽ giảm nếu cần)
  numberFontScale: 1.28,

  // Serial font scale theo chiều cao vé
  serialFontScale: 0.065,

  // Debug (vẽ nhãn r1c1…): bật true khi cần kiểm tra
  debug: false,
};
