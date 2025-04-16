import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Link from "next/link";

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

    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">📒 Expense Tracker</h1>

            {/* Tổng kết */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-center">
                <div className="bg-[#1f2937] p-4 rounded-xl shadow-lg">
                    <h2 className="text-gray-400">Income</h2>
                    <p className="text-green-400 text-xl font-bold">${totalIncome.toFixed(2)}</p>
                </div>
                <div className="bg-[#1f2937] p-4 rounded-xl shadow-lg">
                    <h2 className="text-gray-400">Expenses</h2>
                    <p className="text-red-400 text-xl font-bold">${totalExpense.toFixed(2)}</p>
                </div>
                <div className="bg-[#1f2937] p-4 rounded-xl shadow-lg">
                    <h2 className="text-gray-400">Balance</h2>
                    <p className={`text-xl font-bold ${balance >= 0 ? "text-yellow-300" : "text-red-500"}`}>
                        ${balance.toFixed(2)}
                    </p>
                </div>
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

            {/* Bảng hiển thị lịch sử */}
            <div className="overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg">
                <table className="min-w-full text-[11px] text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Date</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Type</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Category</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Amount</th>
                            <th className="px-4 py-2 text-left whitespace-nowrap">Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        {expenses.map((e) => (
                            <tr key={e.id} className="border-t border-gray-700 hover:bg-[#162330]">
                                <td className="px-4 py-2">{new Date(e.expense_date).toLocaleDateString()}</td>
                                <td className={`px-4 py-2 font-bold ${e.type === "income" ? "text-green-400" : "text-red-400"}`}>
                                    {e.type.toUpperCase()}
                                </td>
                                <td className="px-4 py-2">{e.category}</td>
                                <td className="px-4 py-2">${parseFloat(e.amount).toFixed(2)}</td>
                                <td className="px-4 py-2">{e.description}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default withAuthProtection(Expenses);
