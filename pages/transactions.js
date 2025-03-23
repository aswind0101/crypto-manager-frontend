import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";

export default function Transactions() {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        fetchTransactions();
    }, []);

    const fetchTransactions = async () => {
        try {
            const response = await fetch("https://crypto-manager-backend.onrender.com/api/transactions");
            const data = await response.json();
            setTransactions(data);
        } catch (error) {
            console.error("Error fetching transactions:", error);
        } finally {
            setLoading(false);
        }
    };

    const deleteTransaction = async (id) => {
        const confirmDelete = window.confirm("Are you sure you want to delete this transaction?");
        if (!confirmDelete) return;

        setDeletingId(id);
        try {
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/transactions/${id}`, {
                method: "DELETE"
            });

            if (res.ok) {
                setTransactions((prev) => prev.filter((t) => t.id !== id));
            } else {
                console.error("Failed to delete transaction");
            }
        } catch (err) {
            console.error("Error deleting transaction:", err);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-4 bg-black min-h-screen">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 my-6">📜 Transaction History</h1>

            {loading ? (
                <p className="text-white">Loading transactions...</p>
            ) : transactions.length === 0 ? (
                <p className="text-gray-400">No transactions found.</p>
            ) : (
                        <div className="overflow-x-auto bg-[#0e1628] rounded-xl shadow-lg">
                            <table className="min-w-full text-white text-sm">
                                <thead>
                                    <tr className="bg-[#1f2937] text-gray-400 uppercase">
                                        <th className="px-4 py-3 text-left">#</th>
                                        <th className="px-4 py-3 text-left">Coin</th>
                                        <th className="px-4 py-3 text-left">Type</th>
                                        <th className="px-4 py-3 text-left">Quantity</th>
                                        <th className="px-4 py-3 text-left">Price</th>
                                        <th className="px-4 py-3 text-left">Total</th>
                                        <th className="px-4 py-3 text-left">Date</th>
                                        <th className="px-4 py-3 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map((tx, index) => (
                                        <tr
                                            key={tx.id}
                                            className="border-t border-gray-700 hover:bg-[#162330] transition"
                                        >
                                            <td className="px-4 py-2">{index + 1}</td>
                                            <td className="px-4 py-2 font-semibold text-yellow-300">
                                                {tx.coin_symbol.toUpperCase()}
                                            </td>
                                            <td
                                                className={`px-4 py-2 font-medium ${tx.transaction_type === "buy"
                                                        ? "text-green-400"
                                                        : "text-red-400"
                                                    }`}
                                            >
                                                {tx.transaction_type.toUpperCase()}
                                            </td>
                                            <td className="px-4 py-2">
                                                {parseFloat(tx.quantity).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2">
                                                ${parseFloat(tx.price).toFixed(3)}
                                            </td>
                                            <td className="px-4 py-2">
                                                ${(tx.quantity * tx.price).toFixed(2)}
                                            </td>
                                            <td className="px-4 py-2">
                                                {new Date(tx.transaction_date).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <button
                                                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                                                    onClick={() => deleteTransaction(tx.id)}
                                                    disabled={deletingId === tx.id}
                                                >
                                                    {deletingId === tx.id ? "Deleting..." : "🗑️ Delete"}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
        </div>
    );
}
