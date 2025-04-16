import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";


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

    const groupedByMonth = (() => {
        const grouped = {};
      
        expenses.forEach((e) => {
          const dateObj = new Date(e.expense_date);
          const year = dateObj.getFullYear();
          if (year !== selectedYear) return; // ✅ chỉ lấy năm được chọn
      
          const month = dateObj.getMonth() + 1;
          const date = dateObj.toLocaleDateString(); // ví dụ "4/5/2025"
      
          if (!grouped[month]) {
            grouped[month] = {
              income: 0,
              expense: 0,
              days: {}
            };
          }
      
          if (e.type === "income") {
            grouped[month].income += parseFloat(e.amount);
          } else {
            grouped[month].expense += parseFloat(e.amount);
          }
      
          if (!grouped[month].days[date]) {
            grouped[month].days[date] = [];
          }
      
          grouped[month].days[date].push(e);
        });
      
        return grouped;
      })();
      
    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">📒 Expense Tracker</h1>
            {/* Biểu đồ dòng tiền */}
            <div className="bg-[#1f2937] rounded-xl shadow-lg p-4 mb-6">
                <h2 className="text-lg font-bold text-yellow-400 mb-4 text-center">📊 Cash Flow Overview</h2>
                {chartData.length === 0 ? (
                    <p className="text-yellow-300 text-center">No data to display</p>
                ) : (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={chartData}>
                            <XAxis dataKey="date" stroke="#ccc" />
                            <YAxis stroke="#ccc" />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="income" fill="#10b981" name="Income" />
                            <Bar dataKey="expense" fill="#ef4444" name="Expense" />
                        </BarChart>
                    </ResponsiveContainer>
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
            {/* 🧾 Bảng tổng hợp theo tháng */}
            <div className="overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg mb-6">
                <table className="min-w-full text-[11px] text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Month</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Income</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Expense</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Balance</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(groupedByMonth).map(([month, data]) => {
                            const isExpanded = expandedMonth === month;
                            const balance = data.income - data.expense;

                            return (
                                <React.Fragment key={month}>
                                    <tr className="border-t border-gray-700 hover:bg-[#162330] cursor-pointer">
                                        <td
                                            className="px-4 py-2 font-bold text-yellow-300"
                                            onClick={() => setExpandedMonth(isExpanded ? null : month)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {isExpanded ? (
                                                    <FaMinusCircle className="text-yellow-400" />
                                                ) : (
                                                    <FaPlusCircle className="text-yellow-400" />
                                                )}
                                                <span>Month {month}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2 text-green-400 font-mono">
                                            ${data.income.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-2 text-red-400 font-mono">
                                            ${data.expense.toLocaleString()}
                                        </td>
                                        <td className={`px-4 py-2 font-mono ${balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                                            ${balance.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-2 text-right">–</td>
                                    </tr>

                                    {/* 🧩 Bước 4 sẽ thêm dòng con tại đây */}
                                    {isExpanded && (
                                        <tr className="bg-[#101d33] border-t border-gray-800 text-sm">
                                            <td colSpan={5} className="px-6 py-2 text-white font-mono italic">
                                                📂 Income & Expenses detail (sẽ xử lý tiếp ở bước 4...)
                                            </td>
                                        </tr>
                                    )}
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
