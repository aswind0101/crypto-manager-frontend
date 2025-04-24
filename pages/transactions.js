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
        <div className="w-full p-4 bg-[#1C1F26] min-h-screen text-white font-mono">
            <Navbar />

            <div className="w-full max-w-[1200px] mx-auto flex justify-between items-center my-6">
                <h1 className="text-2xl font-bold text-yellow-400">📜 Transaction History</h1>
            </div>

            <div className="w-full max-w-[1200px] mx-auto flex flex-col md:flex-row gap-4 mb-4 mt-10 overflow-visible">
                <div className="w-full max-w-[1200px] mx-auto mt-6 px-6 py-4 bg-[#1C1F26] rounded-2xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#262f3d] flex items-center gap-4">

                    {isFilteredByQueryCoin ?
                        (

                            <select
                                value={selectedCoin}
                                className="bg-[#1C1F26] text-white rounded-full px-4 py-2 text-sm shadow-[4px_4px_8px_#0b0f17,_-4px_-4px_8px_#1e2631] outline-none"
                                disabled
                            >
                                <option value={selectedCoin}>{selectedCoin}</option>
                            </select>
                        ) : (
                            <select
                                value={selectedCoin}
                                onChange={(e) => setSelectedCoin(e.target.value)}
                                className="bg-[#1C1F26] text-white rounded-full px-4 py-2 text-sm shadow-[4px_4px_8px_#0b0f17,_-4px_-4px_8px_#1e2631] outline-none"
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
                        className="bg-[#1C1F26] text-white rounded-full px-4 py-2 text-sm shadow-[4px_4px_8px_#0b0f17,_-4px_-4px_8px_#1e2631] outline-none"
                    >
                        <option value="All">All Types</option>
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                    </select>
                    <Link
                        href="/add-transaction"
                        className="hidden md:inline-block bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-full text-sm font-medium shadow-[4px_4px_8px_#0b0f17,_-4px_-4px_8px_#1e2631] transition"
                    >
                        ➕ Add Transaction
                    </Link>
                </div>

            </div>

            {queryCoin && (
                <div className="w-full max-w-[1200px] mx-auto flex justify-end mb-2">
                    <button
                        onClick={() => router.push("/transactions")}
                        className="text-sm text-yellow-400 bg-gray-800 px-3 py-1 rounded hover:bg-gray-700 transition"
                    >
                        ❌ Clear Filter
                    </button>
                </div>
            )}

            {loading ? (
                <p className="text-white">Loading transactions...</p>
            ) : filteredTransactions.length === 0 ? (
                <p className="text-gray-400">No transactions found.</p>
            ) : (
                <div className="w-full max-w-[1200px] mx-auto overflow-x-auto rounded-xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
                    <table className="min-w-full text-white text-sm border-collapse">
                        <thead>
                            <tr className="bg-yellow-700 text-white text-bold">
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
                        <tbody className="bg-[#1C1F26] divide-y divide-white/2">
                            {filteredTransactions.map((tx, index) => (
                                <tr
                                    key={tx.id}
                                    className="bg-[#1C1F26] transition"
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
                className="fixed bottom-6 right-6 md:hidden bg-yellow-400 hover:bg-yellow-500 hover:scale-105 active:scale-95 text-black rounded-full w-14 h-14 flex items-center justify-center shadow-lg text-3xl transition z-50"
            >
                +
            </Link>

        </div>
    );
}

export default withAuthProtection(Transactions);
