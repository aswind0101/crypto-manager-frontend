// /pages/loto-export.jsx
import React, { useMemo, useState } from "react";
import { parseExcelToTickets } from "../lib/excel";
import { exportTicketsToPdf } from "../lib/pdf";
import { TEMPLATE_SPEC } from "../lib/templateSpec";

export default function LotoExportPage() {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(false);
    const [serialStart, setSerialStart] = useState(1);
    const totalPages = useMemo(() => Math.ceil(tickets.length / 4), [tickets.length]);

    const onPickExcel = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        try {
            const t = await parseExcelToTickets(file);
            setTickets(t);
        } catch (err) {
            console.error(err);
            alert(err?.message || "Parse Excel lỗi");
        } finally {
            setLoading(false);
            e.target.value = "";
        }
    };

    const onExport = async () => {
        if (!tickets.length) return alert("Chưa có dữ liệu vé. Hãy import Excel trước.");
        setLoading(true);
        try {
            await exportTicketsToPdf({
                tickets,
                serialStart: Number(serialStart) || 1,
            });
        } catch (err) {
            console.error(err);
            alert(err?.message || "Export PDF lỗi");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Lô tô – Import Excel → Export PDF</h1>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ border: "1px solid #ddd", padding: 12, borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Import Excel</div>
                    <input type="file" accept=".xlsx,.xls" onChange={onPickExcel} disabled={loading} />
                </label>

                <label style={{ border: "1px solid #ddd", padding: 12, borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Serial bắt đầu</div>
                    <input
                        type="number"
                        value={serialStart}
                        onChange={(e) => setSerialStart(e.target.value)}
                        disabled={loading}
                        style={{ width: 120 }}
                    />
                </label>

                <button
                    onClick={onExport}
                    disabled={loading || tickets.length === 0}
                    style={{
                        padding: "12px 16px",
                        borderRadius: 10,
                        border: "1px solid #111",
                        background: loading ? "#eee" : "#111",
                        color: loading ? "#111" : "#fff",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontWeight: 700,
                    }}
                >
                    Export PDF
                </button>
            </div>

            <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 13 }}>
                    <b>Template:</b> {TEMPLATE_SPEC.url} (cố định)
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                    <b>Số vé:</b> {tickets.length} &nbsp;|&nbsp; <b>Số trang A4:</b> {totalPages}
                </div>
                <div style={{ fontSize: 12, marginTop: 8, color: "#555" }}>
                    Ghi chú: 1 vé = 5 dòng, mỗi dòng 5 cột. 4 vé / 1 trang A4 dọc.
                </div>
            </div>

            {tickets.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Preview vé đầu tiên (5×5)</div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, 48px)",
                            gap: 6,
                            alignItems: "center",
                        }}
                    >
                        {tickets[0].grid.flat().map((v, idx) => (
                            <div
                                key={idx}
                                style={{
                                    width: 48,
                                    height: 40,
                                    border: "1px solid #ddd",
                                    borderRadius: 6,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: 700,
                                }}
                            >
                                {String(v)}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
