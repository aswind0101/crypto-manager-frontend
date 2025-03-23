import { useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";

function AddTransaction() {
    const [coinSymbol, setCoinSymbol] = useState("");
    const [quantity, setQuantity] = useState("");
    const [price, setPrice] = useState("");
    const [type, setType] = useState("buy");
    const [status, setStatus] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!coinSymbol || !quantity || !price || !type) {
            setStatus("Please fill in all fields.");
            return;
        }

        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    coin_symbol: coinSymbol,
                    quantity: parseFloat(quantity),
                    price: parseFloat(price),
                    transaction_type: type
                })
            });

            if (res.ok) {
                setStatus("✅ Transaction added successfully!");
                setCoinSymbol("");
                setQuantity("");
                setPrice("");
                setType("buy");
            } else {
                const err = await res.json();
                setStatus("❌ Error: " + err.error);
            }
        } catch (err) {
            console.error(err);
            setStatus("❌ Failed to connect to server.");
        }
    };

    return (
        <div className="w-full p-4 bg-black min-h-screen">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 my-6">➕ Add New Transaction</h1>

            <form onSubmit={handleSubmit} className="bg-[#0e1628] max-w-md mx-auto p-6 rounded-xl shadow-lg text-white space-y-4">
                <div>
                    <label className="block text-sm text-gray-300 mb-1">Coin Symbol</label>
                    <input
                        type="text"
                        value={coinSymbol}
                        onChange={(e) => setCoinSymbol(e.target.value.toUpperCase())}
                        placeholder="e.g., NEAR"
                        className="w-full px-4 py-2 bg-[#1f2937] rounded text-white outline-none"
                    />
                </div>

                <div>
                    <label className="block text-sm text-gray-300 mb-1">Transaction Type</label>
                    <select
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                        className="w-full px-4 py-2 bg-[#1f2937] rounded text-white outline-none"
                    >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm text-gray-300 mb-1">Quantity</label>
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="e.g., 100"
                        className="w-full px-4 py-2 bg-[#1f2937] rounded text-white outline-none"
                        step="any"
                    />
                </div>

                <div>
                    <label className="block text-sm text-gray-300 mb-1">Price per Coin (USD)</label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="e.g., 2.5"
                        className="w-full px-4 py-2 bg-[#1f2937] rounded text-white outline-none"
                        step="any"
                    />
                </div>

                <button
                    type="submit"
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded transition"
                >
                    Add Transaction
        </button>

                {status && <p className="text-center mt-2 text-sm text-yellow-300">{status}</p>}
            </form>
        </div>
    );
}
export default withAuthProtection(AddTransaction);
