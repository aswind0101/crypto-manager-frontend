// /lib/excel.js
import * as XLSX from "xlsx";

/**
 * Parse Excel:
 * - Mỗi vé = 5 dòng
 * - Mỗi dòng có 5 cột (A..E)
 * - Bỏ qua dòng trống hoàn toàn
 *
 * Output: tickets = [{ grid: number[5][5] }]
 */
export async function parseExcelToTickets(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // Convert to array-of-arrays (rows)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  // Lọc các row có ít nhất 1 giá trị
  const filtered = rows
    .map((r) => (Array.isArray(r) ? r : []))
    .filter((r) => r.some((v) => v !== null && v !== undefined && String(v).trim() !== ""));

  // Mỗi vé = 5 row
  const tickets = [];
  for (let i = 0; i + 4 < filtered.length; i += 5) {
    const chunk = filtered.slice(i, i + 5);

    // lấy 5 cột đầu
    const grid = chunk.map((r) =>
      Array.from({ length: 5 }, (_, c) => normalizeNumber(r?.[c]))
    );

    // Nếu chunk không đủ 25 số, vẫn push nhưng sẽ có "" -> bạn có thể throw nếu muốn
    tickets.push({ grid });
  }

  return tickets;
}

function normalizeNumber(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : s; // nếu là text thì giữ nguyên
}
