import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { ResponsiveContainer, CartesianGrid, LabelList, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import React from "react";
import { FaPlusCircle, FaMinusCircle } from "react-icons/fa";


function Expenses() {
    const [expenses, setExpenses] = useState([]);
    const [amount, setAmount] = useState("");
    const [category, setCategory] = useState("");
    const [type, setType] = useState("expense");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [categories, setCategories] = useState([]);
    const [date, setDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split("T")[0]; // định dạng yyyy-mm-dd
    });
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [expandedMonth, setExpandedMonth] = useState(null);
    const [expandedCategory, setExpandedCategory] = useState({});


    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchExpenses(user);
                fetchCategories(user);
            }
        });
        return () => unsubscribe();
    }, []);

    const fetchExpenses = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/expenses", {
            headers: {
                Authorization: `Bearer ${idToken}`,
            },
        });
        const data = await res.json();
        setExpenses(data);
    };
    const fetchCategories = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/categories", {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        setCategories(data);
    };
    const handleDeleteExpense = async (id) => {
        if (!confirm("Are you sure you want to delete this transaction?")) return;

        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/expenses/${id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.ok) {
                // Sau khi xoá thì reload lại dữ liệu
                fetchExpenses(currentUser);
            } else {
                const err = await res.json();
                alert("❌ Failed to delete: " + err.error);
            }
        } catch (err) {
            console.error("❌ Delete error:", err.message);
            alert("❌ Something went wrong.");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!amount || !category || !type) {
            setStatus("❗ Please fill in all fields.");
            return;
        }

        const idToken = await currentUser.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/expenses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ amount: parseFloat(amount), category, type, description, expense_date: date, }),
        });

        if (res.ok) {
            setAmount("");
            setCategory("");
            setDescription("");
            setType("expense");
            setStatus("✅ Added successfully!");
            fetchExpenses(currentUser);
        } else {
            const err = await res.json();
            setStatus("❌ Error: " + err.error);
        }
    };

    const totalIncome = expenses.filter(e => e.type === "income").reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const totalExpense = expenses.filter(e => e.type === "expense").reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const balance = totalIncome - totalExpense;
    const availableYears = Array.from(
        new Set(expenses.map(e => new Date(e.expense_date).getFullYear()))
    ).sort((a, b) => b - a); // Sắp xếp giảm dần (mới trước)

    // 🟩 TẠO DỮ LIỆU CHO BIỂU ĐỒ
    const chartData = (() => {
        const grouped = {};

        expenses.forEach((e) => {
            const date = new Date(e.expense_date).toLocaleDateString(); // nhóm theo ngày
            if (!grouped[date]) {
                grouped[date] = { date, income: 0, expense: 0 };
            }
            if (e.type === "income") {
                grouped[date].income += parseFloat(e.amount);
            } else {
                grouped[date].expense += parseFloat(e.amount);
            }
        });

        return Object.values(grouped).sort((a, b) => new Date(a.date) - new Date(b.date));
    })();

    const groupedByMonth = {};

    expenses.forEach((e) => {
        const date = new Date(e.expense_date);
        const year = date.getFullYear();
        const month = date.toLocaleString("default", { month: "long" });

        if (year === selectedYear) {
            if (!groupedByMonth[month]) {
                groupedByMonth[month] = [];
            }
            groupedByMonth[month].push(e);
        }
    });
    const barChartData = (() => {
        const grouped = Array.from({ length: 12 }, (_, i) => {
            const monthExpenses = expenses.filter((e) => {
                const date = new Date(e.expense_date);
                return date.getFullYear() === selectedYear && date.getMonth() === i;
            });

            const income = monthExpenses
                .filter((e) => e.type === "income")
                .reduce((sum, e) => sum + parseFloat(e.amount), 0);
            const expense = monthExpenses
                .filter((e) => e.type === "expense")
                .reduce((sum, e) => sum + parseFloat(e.amount), 0);

            return {
                name: new Date(2023, i).toLocaleString("default", { month: "short" }),
                income,
                expense,
            };
        });

        return grouped.filter((d) => d.income > 0 || d.expense > 0);
    })();


    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">📒 Expense Tracker</h1>
            <div className="mt-8 flex flex-col items-center justify-center text-white p-4">
                <h2 className="text-2xl font-bold text-yellow-400 mb-4 flex items-center gap-2">
                    <span>📊</span> <span>Monthly Cash Flow</span>
                </h2>

                {barChartData.length === 0 ? (
                    <p className="text-yellow-300">✅ No data for this year</p>
                ) : (
                    <>
                        {(() => {
                            const maxValue = Math.max(...barChartData.map(d => d.income + d.expense));
                            const maxHeight = 160;
                            const colors = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

                            return (
                                <div className="w-full flex justify-center">
                                    <div className="overflow-x-auto">
                                        <div
                                            className="flex items-end gap-4 px-2"
                                            style={{
                                                width: `${barChartData.length * 60}px`, // mỗi tháng ~60px
                                                minWidth: "100%",
                                                height: "260px",
                                            }}
                                        >
                                            {barChartData.map((item, index) => {
                                                const maxValue = Math.max(...barChartData.map(d => d.income + d.expense));
                                                const maxHeight = 160;
                                                const total = item.income + item.expense;
                                                const totalHeight = total > 0 ? (total / maxValue) * maxHeight : 0;
                                                const expenseHeight = total > 0 ? (item.expense / total) * totalHeight : 0;
                                                const incomeHeight = totalHeight - expenseHeight;

                                                const colors = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#a3e635"];
                                                const incomeColor = colors[index % colors.length];

                                                return (
                                                    <div key={index} className="flex flex-col items-center w-[50px] min-w-[50px]">
                                                        {/* Số tiền chi tiêu (ở trên) */}
                                                        <span className="mb-1 text-[11px] font-mono text-white">
                                                            ${item.expense.toLocaleString()}
                                                        </span>

                                                        {/* Cột dọc gồm income + expense */}
                                                        <div className="w-4 flex flex-col justify-end" style={{ height: `${totalHeight}px` }}>
                                                            <div
                                                                style={{ height: `${expenseHeight}px`, backgroundColor: "#111111" }}
                                                                className="w-full rounded-t"
                                                            />
                                                            <div
                                                                style={{ height: `${incomeHeight}px`, backgroundColor: incomeColor }}
                                                                className="w-full"
                                                            />
                                                        </div>

                                                        {/* Tháng và income bên dưới */}
                                                        <span className="mt-1 text-[11px] text-white text-center">{item.name}</span>
                                                        <span className="text-[11px] text-green-300 font-semibold">
                                                            ${item.income.toLocaleString()}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                </div>
                            );
                        })()}
                    </>
                )}
            </div>

            {/* Dropdown chọn năm */}
            <div className="flex justify-start items-center mb-4">
                <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none text-sm"
                >
                    {availableYears.map((year) => (
                        <option key={year} value={year}>{year}</option>
                    ))}
                </select>
            </div>
            {/* Bảng tổng hợp theo tháng */}
            <div className="mb-8 overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg">
                <table className="min-w-full text-[11px] text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Month</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Income</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Expenses</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.keys(groupedByMonth)
                            .filter(
                                (month) =>
                                    Array.isArray(groupedByMonth[month]) &&
                                    groupedByMonth[month].some((e) => new Date(e.expense_date).getFullYear() === selectedYear)
                            )
                            .map((month) => {
                                const monthData = groupedByMonth[month].filter(
                                    (e) => new Date(e.expense_date).getFullYear() === selectedYear
                                );
                                const income = monthData.filter((e) => e.type === "income").reduce((sum, e) => sum + parseFloat(e.amount), 0);
                                const expense = monthData.filter((e) => e.type === "expense").reduce((sum, e) => sum + parseFloat(e.amount), 0);
                                const balance = income - expense;

                                return (
                                    <React.Fragment key={month}>
                                        {/* 📅 Dòng tổng tháng */}
                                        <tr
                                            className="border-t border-gray-700 hover:bg-[#162330] cursor-pointer"
                                            onClick={() =>
                                                setExpandedMonth((prev) => (prev === month ? null : month))
                                            }
                                        >
                                            <td className="px-4 py-2 font-bold text-yellow-300">
                                                <div className="flex items-center gap-2">
                                                    {expandedMonth === month ? (
                                                        <FaMinusCircle className="text-yellow-400" />
                                                    ) : (
                                                        <FaPlusCircle className="text-yellow-400" />
                                                    )}
                                                    {month}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-green-400 font-mono">
                                                ${income.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2 text-red-400 font-mono">
                                                ${expense.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2 text-white font-mono">
                                                ${balance.toLocaleString()}
                                            </td>
                                        </tr>

                                        {/* 📂 Income + Expense dòng con */}
                                        {expandedMonth === month &&
                                            ["income", "expense"].map((type) => (
                                                <React.Fragment key={`${month}-${type}`}>
                                                    <tr
                                                        className="bg-[#101d33] border-t border-gray-800 text-[11px] cursor-pointer"
                                                        onClick={() =>
                                                            setExpandedCategory((prev) => ({
                                                                ...prev,
                                                                [`${month}-${type}`]: !prev[`${month}-${type}`],
                                                            }))
                                                        }
                                                    >
                                                        <td className="px-8 py-2" colSpan={5}>
                                                            <div className="flex items-center gap-2">
                                                                {expandedCategory[`${month}-${type}`] ? (
                                                                    <FaMinusCircle className="text-yellow-400" />
                                                                ) : (
                                                                    <FaPlusCircle className="text-yellow-400" />
                                                                )}
                                                                <span className={`font-bold text-[11px] ${type === "income" ? "text-green-400" : "text-red-400"}`}>
                                                                    {type === "income" ? "Income" : "Expenses"} ({monthData.filter((e) => e.type === type).length})
                                                                </span>

                                                            </div>
                                                        </td>
                                                    </tr>

                                                    {/* 📅 Chi tiết từng ngày */}
                                                    {expandedCategory[`${month}-${type}`] &&
                                                        monthData
                                                            .filter((e) => e.type === type)
                                                            .sort((a, b) => new Date(a.expense_date) - new Date(b.expense_date))
                                                            .map((e, idx) => (
                                                                <tr key={idx} className="bg-[#0d1a2b] border-t border-gray-800 text-[11px]">
                                                                    <td className="px-12 py-1 whitespace-nowrap" colSpan={5}>
                                                                        📅 {new Date(e.expense_date).toLocaleDateString()} | 💵 ${parseFloat(e.amount).toLocaleString()} | 🗂 {e.category}
                                                                        {e.description && ` | 📝 ${e.description}`} |
                                                                        <button
                                                                            onClick={() => handleDeleteExpense(e.id)}
                                                                            className="text-red-400 hover:text-red-600 text-[11px]"
                                                                        >
                                                                            🗑️ Delete
                                                                        </button>
                                                                    </td>

                                                                </tr>
                                                            ))}
                                                </React.Fragment>
                                            ))}
                                    </React.Fragment>
                                );
                            })}
                    </tbody>
                </table>
            </div>



            {/* Form thêm thu/chi */}
            <form onSubmit={handleSubmit} className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6">
                <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Entry</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="number"
                        placeholder="Amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none"
                        step="any"
                        required
                    />
                    <select
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                        className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none"
                    >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                    </select>
                </div>

                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                    required
                >
                    <option value="">-- Select Category --</option>
                    {categories
                        .filter((c) => c.type === type)
                        .map((cat) => (
                            <option key={cat.id} value={cat.name}>
                                {cat.name}
                            </option>
                        ))}
                </select>
                {categories.filter((c) => c.type === type).length === 0 && (
                    <p className="text-sm text-yellow-400 mt-2">
                        ⚠️ You have no categories yet. Please add some in{" "}
                        <Link href="/categories" className="underline hover:text-yellow-300">
                            Category
                        </Link>.
                    </p>
                )}

                <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                    required
                />

                <input
                    type="text"
                    placeholder="Description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                />

                <button
                    type="submit"
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-full transition"
                >
                    Add
                </button>

                {status && <p className="text-sm text-center text-yellow-300">{status}</p>}
            </form>
        </div>
    );
}

export default withAuthProtection(Expenses);
