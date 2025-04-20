import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import React from "react";
import { FaPlusCircle, FaMinusCircle } from "react-icons/fa";


function Expenses() {
    const [expenses, setExpenses] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [availableYears, setAvailableYears] = useState([]);
    const [expandedMonth, setExpandedMonth] = useState(null);
    const [expandedCategory, setExpandedCategory] = useState({});
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState(null); // 🆕 ID của expense đang được xoá


    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                setLoading(true); // 🔍 Bắt đầu loading
                Promise.all([fetchExpenses(user), fetchCategories(user)]).finally(() => {
                    setLoading(false); // ✅ Kết thúc loading
                });
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (expenses.length > 0) {
            const allYears = Array.from(
                new Set(expenses.map((e) => new Date(e.expense_date).getFullYear()))
            ).sort((a, b) => b - a);

            setAvailableYears(allYears);

            // Nếu selectedYear không còn tồn tại nữa → chọn lại năm mới nhất
            if (!allYears.includes(selectedYear)) {
                setSelectedYear(allYears[0]);
            }
        } else {
            setAvailableYears([]);
            setSelectedYear(new Date().getFullYear());
        }
    }, [expenses]);

    const fetchExpenses = async (user) => {
        try {
            const idToken = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/expenses", {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
            const data = await res.json();
            setExpenses(data);
        } catch (err) {
            console.error("❌ Error fetching expenses:", err.message);
        }
    };

    const fetchCategories = async (user) => {
        try {
            const idToken = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/categories", {
                headers: { Authorization: `Bearer ${idToken}` },
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Failed to fetch categories");
            }

            const data = await res.json();
            setCategories(data);
        } catch (error) {
            console.error("❌ Error fetching categories:", error.message);
        }
    };

    const handleDeleteExpense = async (id) => {
        if (!confirm("Are you sure you want to delete this transaction?")) return;

        setDeletingId(id); // ✅ bắt đầu loading

        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/expenses/${id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.ok) {
                await fetchExpenses(currentUser);
            } else {
                const err = await res.json();
                alert("❌ Failed to delete: " + err.error);
            }
        } catch (err) {
            console.error("❌ Delete error:", err.message);
            alert("❌ Something went wrong.");
        } finally {
            setDeletingId(null); // ✅ kết thúc loading
        }
    };

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
                name: new Date(0, i).toLocaleString("default", { month: "short" }),
                income,
                expense,
            };
        });

        return grouped.filter((d) => d.income > 0 || d.expense > 0);
    })();
    const totalIncome = expenses
        .filter(e => new Date(e.expense_date).getFullYear() === selectedYear && e.type === "income")
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

    const totalExpense = expenses
        .filter(e => new Date(e.expense_date).getFullYear() === selectedYear && e.type === "expense")
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

    const totalCredit = expenses
        .filter(e => new Date(e.expense_date).getFullYear() === selectedYear && e.type === "credit-spending")
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

    const totalBalance = totalIncome - totalExpense; // tuỳ chọn: không trừ credit nếu xem là "chi tiêu sau"

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen text-yellow-300 text-sm font-mono">
                ⏳ Loading...
            </div>
        );
    }
    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">📒 Expense Tracker</h1>
            <div className="w-full mt-8 flex flex-col items-center justify-center text-white p-4">
                {barChartData.length === 0 ? (
                    <p className="text-yellow-300 text-center">✅ No data for this year</p>
                ) : (
                    <div className="w-full overflow-x-auto">
                        <div className="min-w-fit pl-4">
                            <div
                                className="flex items-end gap-4 w-fit mx-auto pr-4"
                                style={{
                                    minWidth: `${barChartData.length * 60}px`,
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
                                    const colors = [
                                        "#3b82f6", // Blue
                                        "#8b5cf6", // Purple
                                        "#10b981", // Emerald
                                        "#f59e0b", // Amber
                                        "#ec4899", // Pink
                                        "#0ea5e9", // Sky
                                        "#facc15", // Yellow
                                        "#14b8a6", // Teal
                                        "#eab308", // Mustard
                                        "#a855f7", // Violet
                                        "#22d3ee", // Cyan
                                        "#4ade80", // Light Green
                                    ];

                                    const incomeColor = colors[index % colors.length];

                                    return (
                                        <div key={index} className="flex flex-col items-center w-[50px] min-w-[50px] scroll-mx-4">
                                            <span className="mb-1 text-[11px] font-mono text-white">
                                                ${item.expense.toLocaleString()}
                                            </span>
                                            <div className="w-4 flex flex-col justify-end" style={{ height: `${totalHeight}px` }}>
                                                <div
                                                    style={{ height: `${expenseHeight}px`, backgroundColor: "#ef4444" }}
                                                    className="w-full rounded-t"
                                                />
                                                <div
                                                    style={{
                                                        height: `${incomeHeight}px`,
                                                        backgroundColor: incomeColor,
                                                        borderTopLeftRadius: expenseHeight === 0 ? "4px" : "0",
                                                        borderTopRightRadius: expenseHeight === 0 ? "4px" : "0",
                                                    }}
                                                    className="w-full"
                                                />

                                            </div>
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
                )}
            </div>

            <div className="mb-6 mt-4 text-sm text-yellow-300 font-bold flex items-center justify-center gap-2">
                <span>📊</span> <span>Monthly Cash Flow</span>
            </div>

            {/* Select year + Add button */}
            <div className="max-w-4xl mx-auto mt-8 rounded-t-2xl bg-yellow-400 px-6 py-3 flex items-center justify-between shadow-md text-black text-sm font-semibold">
                {/* Hiển thị "Year:" và dropdown chọn năm bên trái */}
                <div className="flex items-center gap-2 relative">
                    <span>Year:</span>
                    <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                        className="bg-yellow-400 text-black font-semibold outline-none appearance-none cursor-pointer pr-6"
                    >
                        {availableYears.map((year) => (
                            <option key={year} value={year}>
                                {year}
                            </option>
                        ))}
                    </select>

                    {/* Mũi tên chỉ dropdown */}
                    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                        <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>

                {/* Nút Add nằm bên phải */}
                <Link
                    href="/add-expense"
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-1.5 rounded-full shadow-md transition"
                >
                    ➕ Income/Expense
                </Link>
            </div>
            <div className="max-w-4xl mb-6 mx-auto bg-[#1a2f46] text-white px-4 py-3 shadow-md grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-center">
                <div>
                    <p className="text-green-400 font-bold">💰 Total Income</p>
                    <p className="font-mono">${totalIncome.toLocaleString()}</p>
                </div>
                <div>
                    <p className="text-red-400 font-bold">💸 Total Expenses</p>
                    <p className="font-mono">${totalExpense.toLocaleString()}</p>
                </div>
                <div>
                    <p className="text-purple-300 font-bold">💳 Credit Spending</p>
                    <p className="font-mono">${totalCredit.toLocaleString()}</p>
                </div>
                <div>
                    <p className="text-white font-bold">📊 Balance</p>
                    <p className={`font-mono ${totalBalance >= 0 ? "text-green-300" : "text-red-300"}`}>
                        ${totalBalance.toLocaleString()}
                    </p>
                </div>
            </div>

            {/* Bảng tổng hợp theo tháng */}
            <div className="overflow-x-auto border border-[#2c4069] shadow-lg rounded-b-xl max-w-4xl mx-auto">
                <table className="min-w-full text-[11px] text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Month</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Income</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Expenses</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Credit Spending</th>
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
                                const income = monthData
                                    .filter((e) => e.type === "income")
                                    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
                                const expense = monthData
                                    .filter((e) => e.type === "expense")
                                    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
                                const balance = income - expense;
                                const creditSpending = monthData
                                    .filter((e) => e.type === "credit-spending")
                                    .reduce((sum, e) => sum + parseFloat(e.amount), 0);

                                const countUniqueCategories = (arr) =>
                                    Object.keys(
                                        arr.reduce((acc, e) => {
                                            acc[e.category] = true;
                                            return acc;
                                        }, {})
                                    ).length;

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
                                            <td className="px-4 py-2 text-purple-300 font-mono">
                                                ${creditSpending.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2 text-white font-mono">
                                                ${balance.toLocaleString()}
                                            </td>
                                        </tr>

                                        {expandedMonth === month &&
                                            ["income", "expense", "credit-spending"].map((type) => {
                                                const color =
                                                    type === "income"
                                                        ? "text-green-400"
                                                        : type === "expense"
                                                            ? "text-red-400"
                                                            : "text-purple-300";
                                                const label =
                                                    type === "income"
                                                        ? "Income"
                                                        : type === "expense"
                                                            ? "Expenses"
                                                            : "Credit Spending";

                                                const grouped = {};
                                                monthData
                                                    .filter((e) => e.type === type)
                                                    .forEach((e) => {
                                                        if (!grouped[e.category]) grouped[e.category] = [];
                                                        grouped[e.category].push(e);
                                                    });

                                                return (
                                                    <React.Fragment key={`${month}-${type}`}>
                                                        {/* 🔘 Nhóm chính: Income / Expenses / Credit Spending */}
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
                                                                    <span className={`font-bold text-[11px] ${color}`}>
                                                                        {label} (
                                                                        {countUniqueCategories(monthData.filter((e) => e.type === type))})
                                                                    </span>

                                                                </div>
                                                            </td>
                                                        </tr>

                                                        {/* 🗂 Gom theo từng category con */}
                                                        {expandedCategory[`${month}-${type}`] &&
                                                            Object.entries(grouped).map(([category, items]) => (
                                                                <React.Fragment key={`${month}-${type}-${category}`}>
                                                                    <tr
                                                                        className="bg-[#0f1d30] border-t border-gray-800 text-[11px] cursor-pointer"
                                                                        onClick={() =>
                                                                            setExpandedCategory((prev) => ({
                                                                                ...prev,
                                                                                [`${month}-${type}-${category}`]: !prev[
                                                                                    `${month}-${type}-${category}`
                                                                                ],
                                                                            }))
                                                                        }
                                                                    >
                                                                        <td className="px-12 py-1 font-semibold text-white" colSpan={5}>
                                                                            {expandedCategory[`${month}-${type}-${category}`]
                                                                                ? "➖"
                                                                                : "➕"}{" "}
                                                                            {category} :{" "}
                                                                            {items
                                                                                .reduce((sum, e) => sum + parseFloat(e.amount), 0)
                                                                                .toLocaleString("en-US", { style: "currency", currency: "USD" })}

                                                                        </td>
                                                                    </tr>

                                                                    {expandedCategory[`${month}-${type}-${category}`] &&
                                                                        items
                                                                            .sort(
                                                                                (a, b) =>
                                                                                    new Date(a.expense_date) -
                                                                                    new Date(b.expense_date)
                                                                            )
                                                                            .map((e, idx) => (
                                                                                <tr
                                                                                    key={idx}
                                                                                    className={`bg-[#0d1a2b] border-t border-gray-800 text-[11px] ${type === "income"
                                                                                        ? "text-green-300"
                                                                                        : type === "expense"
                                                                                            ? "text-red-300"
                                                                                            : "text-purple-300"
                                                                                        }`}
                                                                                >
                                                                                    <td
                                                                                        className="px-16 py-1 whitespace-nowrap"
                                                                                        colSpan={5}
                                                                                    >
                                                                                        📅 {e.expense_date.slice(5, 7) + "/" + e.expense_date.slice(8, 10) + "/" + e.expense_date.slice(0, 4)}
                                                                                        | 💵 $
                                                                                        {parseFloat(e.amount).toLocaleString()} | 📝{" "}
                                                                                        {e.description || "-"} |
                                                                                        <button
                                                                                            onClick={() => handleDeleteExpense(e.id)}
                                                                                            disabled={deletingId === e.id}
                                                                                            className={`ml-2 text-[11px] ${deletingId === e.id
                                                                                                ? "text-gray-400 cursor-not-allowed"
                                                                                                : "text-red-400 hover:text-red-600"}`}
                                                                                        >
                                                                                            {deletingId === e.id ? "⏳ Deleting..." : "🗑️ Delete"}
                                                                                        </button>

                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                </React.Fragment>
                                                            ))}
                                                    </React.Fragment>
                                                );
                                            })}
                                    </React.Fragment>
                                );
                            })}
                    </tbody>
                </table>
            </div>
            {/* Form thêm thu/chi */}

        </div>
    );
}

export default withAuthProtection(Expenses);
