// 📁 Tạo file mới: /pages/add-expense.js
import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Link from "next/link";

function AddExpense() {
    const [amount, setAmount] = useState("");
    const [category, setCategory] = useState("");
    const [type, setType] = useState("expense");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [categories, setCategories] = useState([]);
    const [date, setDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split("T")[0];
    });

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchCategories(user);
            }
        });
        return () => unsubscribe();
    }, []);

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
            body: JSON.stringify({ amount: parseFloat(amount), category, type, description, expense_date: date }),
        });

        if (res.ok) {
            setAmount("");
            setCategory("");
            setDescription("");
            setType("expense");
            setStatus("✅ Added successfully!");
        } else {
            const err = await res.json();
            setStatus("❌ Error: " + err.error);
        }
    };

    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">➕ Add Expense / Income</h1>

            <form onSubmit={handleSubmit} className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6">
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
                    {categories.filter(c => c.type === type).map(cat => (
                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                </select>
                {categories.filter(c => c.type === type).length === 0 && (
                    <p className="text-sm text-yellow-400 mt-2">
                        ⚠️ You have no categories yet. Please add some in{' '}
                        <Link href="/categories" className="underline hover:text-yellow-300">Category</Link>.
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

export default withAuthProtection(AddExpense);
