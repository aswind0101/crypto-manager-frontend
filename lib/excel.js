// /lib/excel.js
import * as XLSX from "xlsx";

export function parseExcelToTickets(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được file Excel."));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

        // lọc dòng rỗng, ép 5 cột số
        const clean = rows
          .map((r) => (Array.isArray(r) ? r.slice(0, 5) : []))
          .filter((r) => r.length === 5 && r.every((x) => x !== null && x !== undefined && x !== ""));

        // 5 dòng = 1 vé
        const tickets = [];
        for (let i = 0; i < clean.length; i += 5) {
          const block = clean.slice(i, i + 5);
          if (block.length < 5) break; // bỏ dư nếu không đủ 5 dòng
          // matrix 5x5
          const grid = block.map((r) => r.map((x) => String(x).trim()));
          tickets.push({ grid });
        }

        resolve({
          totalRows: clean.length,
          tickets,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
