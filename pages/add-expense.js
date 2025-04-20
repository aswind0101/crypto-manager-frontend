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
    const [isSubmitting, setIsSubmitting] = useState(false); // 🆕 trạng thái loading khi submit

    const CATEGORY_CACHE_KEY = "categories_cache";
    const CATEGORY_CACHE_EXPIRY_KEY = "categories_cache_expiry";
    const CATEGORY_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 giờ (ms)


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
        const now = Date.now();

        // 1. Kiểm tra cache trong localStorage
        const cachedData = localStorage.getItem(CATEGORY_CACHE_KEY);
        const cachedExpiry = localStorage.getItem(CATEGORY_CACHE_EXPIRY_KEY);

        if (cachedData && cachedExpiry && now < parseInt(cachedExpiry)) {
            try {
                const parsed = JSON.parse(cachedData);
                setCategories(parsed);
                return; // ✅ dùng cache luôn
            } catch (err) {
                console.warn("⚠️ Lỗi parse cache categories:", err.message);
            }
        }

        // 2. Nếu không có cache hoặc đã hết hạn → gọi API
        try {
            const idToken = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/categories", {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const data = await res.json();
            setCategories(data);

            // 3. Cập nhật cache
            localStorage.setItem(CATEGORY_CACHE_KEY, JSON.stringify(data));
            localStorage.setItem(CATEGORY_CACHE_EXPIRY_KEY, (now + CATEGORY_CACHE_TTL).toString());
        } catch (err) {
            console.error("❌ Error fetching categories:", err.message);
        }
    };


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!amount || !category || !type) {
            setStatus("❗ Please fill in all fields.");
            return;
        }
        setIsSubmitting(true); // ✅ bắt đầu loading
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
        setIsSubmitting(false); // ✅ kết thúc loading
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
                        <option value="credit-spending">Credit Spending</option>
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
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none custom-date"
                    required
                />

                <input
                    type="text"
                    placeholder="Description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                />

                <div className="flex flex-col sm:flex-row justify-center gap-4 mt-4 w-full max-w-md mx-auto">
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`flex-1 font-semibold py-2 rounded-full transition
                            ${isSubmitting
                                ? "bg-green-400 cursor-not-allowed"
                                : "bg-green-600 hover:bg-green-700 text-white"}`}
                    >
                        {isSubmitting ? "Processing..." : "Add"}
                    </button>

                    <button
                        onClick={() => window.location.href = '/expenses'}
                        className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 rounded-full transition"
                    >
                        Close
                    </button>
                </div>

                {status && (
                    <p className="text-sm text-center text-yellow-300 mt-2">{status}</p>
                )}


            </form>
        </div>
    );
}

export default withAuthProtection(AddExpense);
