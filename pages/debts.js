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

    const [totalPaid, setTotalPaid] = useState(0);
    const [totalRemaining, setTotalRemaining] = useState(0);
    const [barChartData, setBarChartData] = useState([]);



    useEffect(() => {
        const auth = getAuth();
        const unsub = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchDebts(user);
                fetchLenders(user);
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
        setBarChartData(barData);


        // ✅ Tính tổng đã trả và còn lại
        const paid = grouped.reduce((sum, d) => sum + parseFloat(d.total_paid || 0), 0);
        const remaining = grouped.reduce((sum, d) => sum + parseFloat(d.remaining || 0), 0);
        setTotalPaid(paid);
        setTotalRemaining(remaining);
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

        return Object.values(grouped).map((item) => ({
            ...item,
            remaining: item.total_amount - item.total_paid,
        }));
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
            } else {
                const err = await res.json();
                setPayStatus("❌ " + err.error);
            }
        } catch (error) {
            console.error("Payment error:", error);
            setPayStatus("❌ Something went wrong.");
        }
    };


    const handleAdd = async (e) => {
        e.preventDefault();
        if (!selectedLenderId || !amount) {
            setStatus("❗ Please select lender and enter amount.");
            return;
        }

        const idToken = await currentUser.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/debts", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                lender_id: selectedLenderId,
                total_amount: parseFloat(amount),
                note,
                created_at: createdDate,
            }),
        });

        if (res.ok) {
            setAmount("");
            setNote("");
            setStatus("✅ Debt added!");
            fetchDebts(currentUser);
        } else {
            const err = await res.json();
            setStatus("❌ " + err.error);
        }
    };

    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">💳 Debt Manager</h1>

            <div className="bg-[#1a2f46] max-w-xl mx-auto p-4 rounded-2xl border border-[#2c4069] shadow-lg mb-6">
                <h2 className="text-lg font-semibold text-yellow-400 mb-4 text-center">💹 Debt Overview</h2>

                <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                        <Pie
                            data={[
                                { name: "Paid", value: totalPaid },
                                { name: "Remaining", value: totalRemaining },
                            ]}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            innerRadius={50}
                            label={({ name, value }) =>
                                `${name}: $${parseFloat(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                            }
                        >
                            <Cell fill="#00C49F" />
                            <Cell fill="#FF8042" />
                        </Pie>
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>

            </div>
            <div className="bg-[#1a2f46] max-w-4xl mx-auto p-4 rounded-2xl border border-[#2c4069] shadow-lg mb-6">
                <h2 className="text-lg font-semibold text-yellow-400 mb-4 text-center">📊 Debts by Lender</h2>

                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={barChartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fill: "#ffffff" }} />
                        <YAxis tick={{ fill: "#ffffff" }} />
                        <Legend />
                        <Bar
                            dataKey="paid"
                            stackId="a"
                            fill="#00C49F"
                            name="Paid"
                            label={{
                                position: "top",
                                fill: "#00C49F",
                                formatter: (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                            }}
                        />
                        <Bar
                            dataKey="remaining"
                            stackId="a"
                            fill="#FF8042"
                            name="Remaining"
                            label={{
                                position: "top",
                                fill: "#FF8042",
                                formatter: (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                            }}
                        />
                    </BarChart>
                </ResponsiveContainer>

            </div>




            <div className="overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg max-w-4xl mx-auto">
                <table className="min-w-full text-sm text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left">Lender</th>
                            <th className="px-4 py-2 text-left">Total Borrowed</th>
                            <th className="px-4 py-2 text-left">Total Paid</th>
                            <th className="px-4 py-2 text-left">Remaining</th>
                            <th className="px-4 py-2 text-left">Action</th> {/* ✅ THÊM DÒNG NÀY */}
                        </tr>
                    </thead>
                    <tbody>
                        {groupedDebts.map((d) => (
                            <React.Fragment key={d.lender_id}>
                                <tr
                                    className="border-t border-gray-700 hover:bg-[#162330] cursor-pointer"
                                    onClick={() =>
                                        setExpandedLender(expandedLender === d.lender_id ? null : d.lender_id)
                                    }
                                >
                                    <td className="px-4 py-2 font-bold text-yellow-300 align-middle">
                                        <div className="flex items-center gap-2">
                                            {expandedLender === d.lender_id ? (
                                                <FaMinusCircle className="text-yellow-400" />
                                            ) : (
                                                <FaPlusCircle className="text-yellow-400" />
                                            )}
                                            <span className="whitespace-nowrap">{d.lender_name}</span>
                                        </div>
                                    </td>

                                    <td className="px-4 py-2">
                                        ${parseFloat(d.total_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-2 text-green-400">
                                        ${parseFloat(d.total_paid || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-2 text-red-400">
                                        ${parseFloat(d.remaining || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-2 text-right">
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
                                    <tr className="bg-[#101d33] border-t border-gray-800 text-sm">
                                        <td colSpan={5} className="px-6 py-3">
                                            <form onSubmit={(e) => handleLenderPayment(e, d.lender_id)} className="flex flex-col md:flex-row items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={payAmount}
                                                    onChange={(e) => setPayAmount(e.target.value)}
                                                    placeholder="Amount to pay"
                                                    step="any"
                                                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none w-full md:w-40"
                                                    required
                                                />
                                                <input
                                                    type="text"
                                                    value={payNote}
                                                    onChange={(e) => setPayNote(e.target.value)}
                                                    placeholder="Note (optional)"
                                                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none w-full md:w-60"
                                                />
                                                <button
                                                    type="submit"
                                                    className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-full text-white font-medium text-sm"
                                                >
                                                    Submit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPayingLenderId(null)} // ✅ Đóng form
                                                    className="bg-gray-500 hover:bg-gray-600 px-4 py-2 rounded-full text-white font-medium text-sm"
                                                >
                                                    Cancel
                                                </button>
                                                {payStatus && (
                                                    <p className="text-yellow-300 text-xs">{payStatus}</p>
                                                )}
                                            </form>
                                        </td>
                                    </tr>
                                )}

                                {/* Dòng chi tiết khoản nợ */}
                                {expandedLender === d.lender_id &&
                                    d.details.map((detail) => (
                                        <tr key={detail.id} className="bg-[#101d33] border-t border-gray-800 text-sm">
                                            <td className="px-8 py-2" colSpan={5}>
                                                📅 {new Date(detail.created_at).toLocaleDateString()} | 💵 $
                                                {parseFloat(detail.total_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} | 🧾{" "}
                                                {detail.note || "No note"}
                                            </td>
                                        </tr>
                                    ))}
                            </React.Fragment>
                        ))}
                    </tbody>

                </table>

            </div>
            <div className="text-center mt-6">
                <Link
                    href="/add-debt"
                    className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2 rounded-full shadow-md transition"
                >
                    ➕ Add Debt
                </Link>
            </div>
        </div>
    );
}

export default withAuthProtection(Debts);
