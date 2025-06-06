import { useEffect, useState } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { FaPlusCircle, FaMinusCircle } from "react-icons/fa";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";



function Debts() {
    const [debts, setDebts] = useState([]);
    const [amount, setAmount] = useState("");
    const [note, setNote] = useState("");
    const [status, setStatus] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [createdDate, setCreatedDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split("T")[0];
    });
    const [lenders, setLenders] = useState([]);
    const [selectedLenderId, setSelectedLenderId] = useState("");
    const [groupedDebts, setGroupedDebts] = useState([]);
    const [expandedLender, setExpandedLender] = useState(null);

    const [payingLenderId, setPayingLenderId] = useState(null);
    const [payAmount, setPayAmount] = useState("");
    const [payNote, setPayNote] = useState("");
    const [payStatus, setPayStatus] = useState("");
    const [debtPayments, setDebtPayments] = useState([]);


    const [totalPaid, setTotalPaid] = useState(0);
    const [totalRemaining, setTotalRemaining] = useState(0);
    const [totalBorrowed, setTotalBorrowed] = useState(0); // 
    const [barChartData, setBarChartData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deletingItemId, setDeletingItemId] = useState(null); // 🆕 ID đang xoá



    useEffect(() => {
        const auth = getAuth();
        const unsub = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                setLoading(true);
                Promise.all([fetchDebts(user), fetchLenders(user), fetchDebtPayments(user)]).finally(() => {
                    setLoading(false); // ✅ Kết thúc loading
                });
            }
        });
        return () => unsub();
    }, []);

    const fetchLenders = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/lenders", {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        setLenders(data);
    };

    const fetchDebtPayments = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/debt-payments", {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        setDebtPayments(data);
    };

    const fetchDebts = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/debts", {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();

        setDebts(data);

        const grouped = groupDebtsByLender(data);
        setGroupedDebts(grouped);

        const barData = grouped.map((item) => ({
            name: item.lender_name,
            borrowed: parseFloat(item.total_amount || 0),
            paid: parseFloat(item.total_paid || 0),
            remaining: parseFloat(item.remaining || 0),
        }));
        barData.sort((a, b) => b.remaining - a.remaining);
        setBarChartData(barData);


        // ✅ Tính tổng đã trả và còn lại
        const paid = grouped.reduce((sum, d) => sum + parseFloat(d.total_paid || 0), 0);
        const remaining = grouped.reduce((sum, d) => sum + parseFloat(d.remaining || 0), 0);
        setTotalPaid(paid);
        setTotalRemaining(remaining);
        const borrowed = grouped.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
        setTotalBorrowed(borrowed); // 🆕 Thêm state này ở bước 2

    };


    const groupDebtsByLender = (debts) => {
        const grouped = {};

        debts.forEach((d) => {
            const lenderId = d.lender_id;
            if (!grouped[lenderId]) {
                grouped[lenderId] = {
                    lender_id: d.lender_id,
                    lender_name: d.lender_name,
                    total_amount: 0,
                    total_paid: 0,
                    details: [],
                };
            }

            grouped[lenderId].total_amount += parseFloat(d.total_amount || 0);
            grouped[lenderId].total_paid += parseFloat(d.total_paid || 0);
            grouped[lenderId].details.push(d);
        });

        return Object.values(grouped)
            .map((item) => ({
                ...item,
                remaining: item.total_amount - item.total_paid,
            }))
            .filter((item) => item.total_amount > 0); // 🟡 Ẩn lender nếu đã xoá hết nợ
    };

    const handleLenderPayment = async (e, lenderId) => {
        e.preventDefault();

        if (!payAmount) {
            setPayStatus("❗ Please enter amount to pay.");
            return;
        }

        const paying = parseFloat(payAmount);
        if (isNaN(paying) || paying <= 0) {
            setPayStatus("❗ Amount must be a valid positive number.");
            return;
        }

        // 🔍 Tìm lender để lấy số tiền còn lại
        const lenderData = groupedDebts.find((item) => item.lender_id === lenderId);
        const remaining = parseFloat(lenderData?.remaining || 0);

        if (remaining <= 0) {
            setPayStatus("❗ This debt is already fully paid.");
            return;
        }

        if (paying > remaining) {
            setPayStatus(`❗ Amount exceeds remaining debt ($${remaining.toLocaleString("en-US", { minimumFractionDigits: 2 })})`);
            return;
        }

        try {
            const idToken = await currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/debt-payments/by-lender", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    lender_id: lenderId,
                    amount_paid: paying,
                    note: payNote,
                }),
            });

            if (res.ok) {
                setPayStatus("✅ Payment recorded!");
                setPayingLenderId(null);
                setPayAmount("");
                setPayNote("");
                fetchDebts(currentUser); // 🔄 reload danh sách
                fetchDebtPayments(currentUser);    // 🔄 reload debt payments
            } else {
                const err = await res.json();
                setPayStatus("❌ " + err.error);
            }
        } catch (error) {
            console.error("Payment error:", error);
            setPayStatus("❌ Something went wrong.");
        }
    };
    const handleDeleteItem = async (item) => {
        const isBorrow = item.type === "borrow";
        const confirmText = isBorrow
            ? "Do you want to delete this borrow entry?"
            : "Do you want to delete this payment entry?";

        if (!confirm(confirmText)) return;
        setDeletingItemId(item.id); // ✅ Bắt đầu xoá
        try {
            const idToken = await currentUser.getIdToken();
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/${isBorrow ? "debts" : "debt-payments"}/${item.id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            if (res.ok) {
                await fetchDebts(currentUser);
                await fetchDebtPayments(currentUser);
            } else {
                const err = await res.json();
                alert("❌ Failed to delete: " + err.error);
            }
        } catch (err) {
            console.error("❌ Delete error:", err.message);
            alert("❌ Something went wrong.");
        } finally {
            setDeletingItemId(null); // ✅ Kết thúc xoá
        }
    };
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen text-yellow-300 text-sm font-mono">
                ⏳ Loading...
            </div>
        );
    }
    return (
        <div className="bg-[#1C1F26] min-h-screen text-white p-4 font-mono">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">💳 Debt Manager</h1>

            {/* Biểu đồ cột nợ theo người cho vay */}
            <div className="mt-8 flex flex-col items-center justify-center text-white p-4">

                {barChartData.length === 0 ? (
                    <p className="text-yellow-300">✅ No active debts</p>
                ) : (
                    <>
                        {(() => {
                            const maxRemaining = Math.max(...barChartData.map((d) => d.remaining));
                            const maxHeight = 160;
                            const totalBorrowed = barChartData.reduce((sum, item) => sum + item.borrowed, 0);
                            const totalPaid = barChartData.reduce((sum, item) => sum + item.paid, 0);
                            const totalRemaining = barChartData.reduce((sum, item) => sum + item.remaining, 0);

                            return (
                                <div className="flex items-end justify-center gap-2 w-full max-w-5xl min-h-[260px] h-[260px] overflow-x-auto pt-6">
                                    {barChartData.map((item, index) => {
                                        const height = maxRemaining > 0
                                            ? (item.remaining / maxRemaining) * maxHeight
                                            : 0;

                                        const colors = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
                                        const color = colors[index % colors.length];

                                        return (
                                            <div key={index} className="flex flex-col items-center w-16 min-w-[60px]">
                                                <span className="mb-1 text-[11px] font-mono text-white">
                                                    ${item.remaining.toLocaleString()}
                                                </span>
                                                <div
                                                    className="w-4 rounded-t"
                                                    style={{
                                                        height: `${height}px`,
                                                        minHeight: "8px",
                                                        backgroundColor: color,
                                                    }}
                                                />
                                                <span className="mt-1 text-[11px] text-white text-center leading-tight break-words">
                                                    {item.name}
                                                </span>
                                                <span className="text-[11px] text-yellow-300 font-semibold">
                                                    ${item.borrowed.toLocaleString()}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </>
                )}
            </div>
            {/* 🧾 Legend - Dạng dọc, nhỏ gọn, nằm giữa */}
            <div className="mt-6 mb-10 flex flex-col items-center justify-center">
                <div className="flex flex-col items-start text-[11px] font-mono text-white space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-yellow-300" />
                        <span className="text-left">Borrowed: ${totalBorrowed.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-400" />
                        <span className="text-left">Paid: ${totalPaid.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-400" />
                        <span className="text-left">Remaining: ${totalRemaining.toLocaleString()}</span>
                    </div>
                </div>
            </div>


            {/* Wrapper cho Add Debt + Bảng */}
            <div className="mt-10 w-full max-w-4xl mx-auto rounded-xl overflow-hidden shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
                {/* Nút Add Debt */}
                <div className="max-w-4xl mx-auto rounded-t-2xl bg-yellow-700 px-6 py-3 flex items-center justify-between shadow-md text-white text-sm font-bold">
                    <span className="text-base">Debts</span>
                    <Link
                        href="/add-debt"
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-1.5 rounded-xl shadow-md transition"
                    >
                        ➕ Add Debt
                    </Link>
                </div>
                {/* Bảng chi tiết */}
                <div className="overflow-x-auto bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] max-w-4xl mx-auto">
                    <table className="min-w-full text-xs text-white">
                        <thead className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] text-yellow-300">
                            <tr>
                                <th className="px-4 py-2 text-left text-xs whitespace-nowrap">Lender</th>
                                <th className="px-4 py-2 text-left text-xs whitespace-nowrap">Total Borrowed</th>
                                <th className="px-4 py-2 text-left text-xs whitespace-nowrap">Total Paid</th>
                                <th className="px-4 py-2 text-left text-xs whitespace-nowrap">Remaining</th>
                                <th className="px-4 py-2 text-center text-xs align-middle whitespace-nowrap">Action</th>
                            </tr>
                        </thead>

                        <tbody>
                            {groupedDebts.map((d) => (
                                <React.Fragment key={d.lender_id}>
                                    <tr
                                        className="border-t border-white/4 hover:bg-[#162330] cursor-pointer"
                                        onClick={() =>
                                            setExpandedLender(expandedLender === d.lender_id ? null : d.lender_id)
                                        }
                                    >
                                        <td className="px-4 py-2 font-bold text-yellow-300 align-middle whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {expandedLender === d.lender_id ? (
                                                    <FaMinusCircle className="text-yellow-400" />
                                                ) : (
                                                    <FaPlusCircle className="text-yellow-400" />
                                                )}
                                                <span className="whitespace-nowrap">{d.lender_name}</span>
                                            </div>
                                        </td>

                                        <td className="px-4 py-2 whitespace-nowrap">
                                            ${parseFloat(d.total_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-2 text-green-400 whitespace-nowrap">
                                            ${parseFloat(d.total_paid || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-2 text-red-400 whitespace-nowrap">
                                            ${parseFloat(d.remaining || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-2 text-center align-middle whitespace-nowrap">
                                            {parseFloat(d.remaining) > 0 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPayingLenderId(payingLenderId === d.lender_id ? null : d.lender_id);
                                                        setPayStatus("");
                                                        setPayAmount("");
                                                        setPayNote("");
                                                    }}
                                                    className="text-xs px-2 py-1 min-w-[60px] bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm"
                                                >
                                                    💸 Pay
                                                </button>

                                            )}
                                        </td>

                                    </tr>

                                    {/* ✅ Form trả tiền tổng theo lender */}
                                    {payingLenderId === d.lender_id && (
                                        <tr className="bg-[#1C1F20] border-t border-gray-800 text-sm">
                                            <td colSpan={5} className="px-6 py-3">
                                                <form
                                                    onSubmit={(e) => handleLenderPayment(e, d.lender_id)}
                                                    className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2"
                                                >
                                                    <input
                                                        type="number"
                                                        value={payAmount}
                                                        onChange={(e) => setPayAmount(e.target.value)}
                                                        placeholder="Amount to pay"
                                                        step="any"
                                                        className="bg-[#1f2937] text-white px-4 py-2 rounded-xl outline-none w-full md:w-40"
                                                        required
                                                    />
                                                    <input
                                                        type="text"
                                                        value={payNote}
                                                        onChange={(e) => setPayNote(e.target.value)}
                                                        placeholder="Note (optional)"
                                                        className="bg-[#1f2937] text-white px-4 py-2 rounded-xl outline-none w-full md:w-60"
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="submit"
                                                            className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-xl text-white font-medium text-sm"
                                                        >
                                                            Submit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPayingLenderId(null)}
                                                            className="bg-gray-500 hover:bg-gray-600 px-4 py-2 rounded-xl text-white font-medium text-sm"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                    {payStatus && (
                                                        <p className="text-yellow-300 text-xs md:ml-4">{payStatus}</p>
                                                    )}
                                                </form>
                                            </td>
                                        </tr>
                                    )}

                                    {/* Dòng chi tiết khoản nợ */}
                                    {expandedLender === d.lender_id && (() => {
                                        // Lấy tất cả khoản mượn & trả liên quan tới lender này
                                        const combinedItems = [
                                            ...d.details.map(debt => ({
                                                id: debt.id, // 🆕 để xoá được khoản mượn
                                                type: "borrow",
                                                date: debt.created_at,
                                                amount: parseFloat(debt.total_amount || 0),
                                                note: debt.note,
                                            })),
                                            ...debtPayments
                                                .filter(p => d.details.some(debt => debt.id === p.debt_id))
                                                .map(p => ({
                                                    id: p.id, // 🆕 để xoá được khoản trả nợ
                                                    type: "payment",
                                                    date: p.payment_date,
                                                    amount: parseFloat(p.amount_paid),
                                                    note: p.note,
                                                }))
                                        ];

                                        // Sắp xếp theo thời gian tăng dần
                                        combinedItems.sort((a, b) => new Date(a.date) - new Date(b.date));

                                        return combinedItems.map((item, idx) => (
                                            <tr key={idx} className={`text-[11px] ${item.type === "borrow" ? "bg-[#1C1F26] text-white" : "bg-[#0d1a2b] text-green-300"}`}>
                                                <td className="px-8 py-2 text-[11px]" colSpan={5}>
                                                    📅 {item.date.slice(5, 7) + "/" + item.date.slice(8, 10) + "/" + item.date.slice(0, 4)} |
                                                    {item.type === "borrow" ? (
                                                        <> 💵 Borrowed ${item.amount.toLocaleString()} </>
                                                    ) : (
                                                        <> ✅ Paid ${item.amount.toLocaleString()} </>
                                                    )}
                                                    {item.note && <> | 📝 {item.note}</>}
                                                    <button
                                                        onClick={() => handleDeleteItem(item)}
                                                        disabled={deletingItemId === item.id}
                                                        className={`ml-4 text-[11px] transition ${deletingItemId === item.id
                                                            ? "text-gray-400 cursor-not-allowed"
                                                            : "text-red-400 hover:text-red-600"
                                                            }`}
                                                    >
                                                        {deletingItemId === item.id ? "⏳ Deleting..." : "🗑️ Delete"}
                                                    </button>

                                                </td>
                                            </tr>
                                        ));
                                    })()}


                                </React.Fragment>
                            ))}
                        </tbody>

                    </table>
                </div>
            </div>

        </div>
    );
}

export default withAuthProtection(Debts);
