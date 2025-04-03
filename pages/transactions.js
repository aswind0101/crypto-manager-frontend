import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import Link from "next/link";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";

function Transactions() {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);

    const [selectedCoin, setSelectedCoin] = useState("All");
    const [selectedType, setSelectedType] = useState("All");

    const router = useRouter();
    const queryCoin = router.query.coin?.toUpperCase();
    const isFilteredByQueryCoin = !!queryCoin;

    // Lấy user từ Firebase và gọi fetch
    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchTransactions(user);
            } else {
                setCurrentUser(null);
                setTransactions([]);
            }
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (queryCoin) {
            setSelectedCoin(queryCoin);
        }
    }, [queryCoin]);

    const fetchTransactions = async (user) => {
        if (!user) return;

        try {
            const idToken = await user.getIdToken();

            const response = await fetch("https://crypto-manager-backend.onrender.com/api/transactions", {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
            const data = await response.json();
            setTransactions(data);
        } catch (error) {
            console.error("Error fetching transactions:", error);
        } finally {
            setLoading(false);
        }
    };

    const deleteTransaction = async (id) => {
        if (!currentUser) return;

        const confirmDelete = window.confirm("Are you sure you want to delete this transaction?");
        if (!confirmDelete) return;

        setDeletingId(id);
        try {
            const idToken = await currentUser.getIdToken();
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/transactions/${id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            if (res.ok) {
                setTransactions((prev) => prev.filter((t) => t.id !== id));
                // ✅ Xoá cache portfolio để đảm bảo Dashboard sẽ fetch lại dữ liệu mới
                const storedUser = localStorage.getItem("user");
                if (storedUser) {
                    const user = JSON.parse(storedUser);
                    localStorage.removeItem(`portfolio_${user.uid}`);
                    localStorage.removeItem(`lastUpdated_${user.uid}`);
                }
            } else {
                console.error("Failed to delete transaction");
            }
        } catch (err) {
            console.error("Error deleting transaction:", err);
        } finally {
            setDeletingId(null);
        }
    };

    const filteredTransactions = transactions.filter((tx) => {
        const matchesCoin = selectedCoin === "All" || tx.coin_symbol.toUpperCase() === selectedCoin;
        const matchesType = selectedType === "All" || tx.transaction_type.toLowerCase() === selectedType.toLowerCase();
        const matchesQuery = !queryCoin || tx.coin_symbol.toUpperCase() === queryCoin;
        return matchesCoin && matchesType && matchesQuery;
    });

    const coinOptions = [...new Set(transactions.map((tx) => tx.coin_symbol.toUpperCase()))];

    return (
        <div className="w-full p-4 bg-black min-h-screen">
            <Navbar />
            <div className="flex justify-between items-center my-6">
                <h1 className="text-2xl font-bold text-yellow-400">📜 Transaction History</h1>
            </div>

            {/* Bộ lọc */}
            <div className="flex flex-col md:flex-row gap-4 mb-4">
                {isFilteredByQueryCoin ? (
                    <select
                        value={selectedCoin}
                        className="bg-[#1f2937] text-white px-4 py-2 rounded-md w-full md:w-1/3"
                        disabled
                    >
                        <option value={selectedCoin}>{selectedCoin}</option>
                    </select>
                ) : (
                    <select
                        value={selectedCoin}
                        onChange={(e) => setSelectedCoin(e.target.value)}
                        className="bg-[#1f2937] text-white px-4 py-2 rounded-md w-full md:w-1/3"
                    >
                        <option value="All">All Coins</option>
                        {coinOptions.map((coin) => (
                            <option key={coin} value={coin}>{coin}</option>
                        ))}
                    </select>
                )}

                <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-md w-full md:w-1/3"
                >
                    <option value="All">All Types</option>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                </select>
            </div>

            {queryCoin && (
                <div className="flex justify-end mb-2">
                    <button
                        onClick={() => router.push("/transactions")}
                        className="text-sm text-yellow-400 bg-gray-800 px-3 py-1 rounded hover:bg-gray-700 transition"
                    >
                        ❌ Clear Filter
                    </button>
                </div>
            )}

            {/* Bảng giao dịch */}
            {loading ? (
                <p className="text-white">Loading transactions...</p>
            ) : filteredTransactions.length === 0 ? (
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
                            {filteredTransactions.map((tx, index) => (
                                <tr
                                    key={tx.id}
                                    className="border-t border-gray-700 hover:bg-[#162330] transition"
                                >
                                    <td className="px-4 py-2">{index + 1}</td>
                                    <td className="px-4 py-2 font-semibold text-yellow-300">
                                        {tx.coin_symbol.toUpperCase()}
                                    </td>
                                    <td className={`px-4 py-2 font-medium ${tx.transaction_type === "buy" ? "text-green-400" : "text-red-400"}`}>
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
                                            {deletingId === tx.id ? "Deleting..." : "Delete"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <Link
                href="/add-transaction"
                className="fixed bottom-6 right-6 md:hidden bg-green-600 hover:bg-green-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg text-3xl transition z-50"
            >
                +
            </Link>
        </div>
    );
}

export default withAuthProtection(Transactions);
