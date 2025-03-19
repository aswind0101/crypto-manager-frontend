import { useState, useEffect } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from "recharts";

export default function Dashboard() {
    // State quản lý danh mục đầu tư
    const [portfolio, setPortfolio] = useState([]);
    const [totalInvested, setTotalInvested] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    const summaryData = [
        { name: "Invested", value: totalInvested },
        { name: "Profit/Loss", value: totalProfitLoss }
    ];

    // State quản lý giao dịch
    const [transactions, setTransactions] = useState([]);
    const [coin, setCoin] = useState("");
    const [quantity, setQuantity] = useState("");
    const [price, setPrice] = useState("");
    const [type, setType] = useState("buy");

    useEffect(() => {
        fetchPortfolio();
        fetchTransactions();
    }, []);

    // Lấy danh mục đầu tư từ API backend
    const fetchPortfolio = async () => {
        try {
            const response = await fetch("http://localhost:5000/api/portfolio");
            const data = await response.json();
            setPortfolio(data.portfolio);
            setTotalInvested(data.totalInvested);
            setTotalProfitLoss(data.totalProfitLoss);
        } catch (error) {
            console.error("Error fetching portfolio:", error);
        }
    };

    // Lấy danh sách giao dịch từ API backend
    const fetchTransactions = async () => {
        try {
            const response = await fetch("http://localhost:5000/api/transactions");
            const data = await response.json();
            setTransactions(data);
        } catch (error) {
            console.error("Error fetching transactions:", error);
        }
    };

    // Thêm giao dịch mới
    const handleSubmit = async () => {
        if (!coin || !quantity || !price) {
            alert("Please fill in all fields.");
            return;
        }

        const newTransaction = {
            coin_symbol: coin.toUpperCase(),
            quantity: parseFloat(quantity),
            price: parseFloat(price),
            transaction_type: type,
        };

        try {
            const response = await fetch("http://localhost:5000/api/transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newTransaction),
            });

            if (response.ok) {
                const data = await response.json();
                setTransactions([data, ...transactions]);
                fetchPortfolio();
                setCoin("");
                setQuantity("");
                setPrice("");
            } else {
                console.error("Failed to add transaction.");
            }
        } catch (error) {
            console.error("Error adding transaction:", error);
        }
    };

    // Xóa giao dịch
    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this transaction?")) {
            return;
        }

        try {
            const response = await fetch(`http://localhost:5000/api/transactions/${id}`, {
                method: "DELETE",
            });

            if (response.ok) {
                setTransactions(transactions.filter((tx) => tx.id !== id));
                fetchPortfolio();
            } else {
                console.error("Failed to delete transaction.");
            }
        } catch (error) {
            console.error("Error deleting transaction:", error);
        }
    };

    // Dữ liệu biểu đồ danh mục đầu tư
    const pieData = portfolio.map((p) => ({
        name: p.coin_symbol,
        value: parseFloat(p.total_invested),
    }));

    const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#A28CFF"];

    return (
        <div className="min-h-screen bg-gray-100">
            <Navbar />
            <div className="p-6">
                <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
                <p className="text-gray-600 mt-2"></p>


                <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                    <h2 className="text-xl font-semibold mb-4">Porfilio Summary</h2>
                    {/* Tổng quan danh mục đầu tư */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Card Tổng Đầu Tư */}
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <div className="flex items-center">
                                <div className="text-blue-500 text-4xl mr-4">💰</div>
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-600">Total Invested</h3>
                                    <p className="text-2xl font-bold text-blue-600">${totalInvested.toLocaleString()}</p>
                                </div>
                            </div>
                            {/* Biểu đồ mini */}
                            <div className="mt-4">
                                <ResponsiveContainer width="100%" height={80}>
                                    <BarChart data={[{ name: "Invested", value: totalInvested }]}>
                                        <XAxis dataKey="name" hide />
                                        <YAxis hide />
                                        <Bar dataKey="value" fill="#007bff" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Card Tổng Lợi Nhuận */}
                        <div className={`bg-white p-6 rounded-lg shadow-md ${totalProfitLoss >= 0 ? "border-l-4 border-green-400" : "border-l-4 border-red-400"}`}>
                            <div className="flex items-center">
                                <div className={`text-4xl mr-4 ${totalProfitLoss >= 0 ? "text-green-500" : "text-red-500"}`}>
                                    {totalProfitLoss >= 0 ? "📈" : "📉"}
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-600">Total Profit/Loss</h3>
                                    <p className={`text-2xl font-bold ${totalProfitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                                        ${totalProfitLoss.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            {/* Biểu đồ mini */}
                            <div className="mt-4">
                                <ResponsiveContainer width="100%" height={80}>
                                    <BarChart data={[{ name: "Profit/Loss", value: totalProfitLoss }]}>
                                        <XAxis dataKey="name" hide />
                                        <YAxis hide />
                                        <Bar dataKey="value" fill={totalProfitLoss >= 0 ? "#4CAF50" : "#F44336"} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                </div>
                {/* Bảng danh mục đầu tư */}
                <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                    <h2 className="text-xl font-semibold mb-4">Investment Details</h2>
                    <table className="w-full border-collapse rounded-lg overflow-hidden shadow ">
                        <thead>
                            <tr className="bg-gray-300 text-gray-700">
                                <th className="px-4 py-2">Coin</th>
                                <th className="px-4 py-2">Total Quantity</th>
                                <th className="px-4 py-2">Total Invested</th>
                                <th className="px-4 py-2">Total Sold</th>
                                <th className="px-4 py-2">Avg. Purchase Price</th>
                                <th className="px-4 py-2">Current Price</th>
                                <th className="px-4 py-2">Current Value</th>
                                <th className="px-4 py-2">Profit/Loss</th>
                            </tr>
                        </thead>
                        <tbody>
                            {portfolio.map((p) => (
                                <tr key={p.coin_symbol} className="border-t text-gray-600 hover:bg-gray-100">
                                    <td className="px-4 py-2 text-center">{p.coin_symbol}</td>
                                    <td className="px-4 py-2 text-center">{parseFloat(p.total_quantity).toLocaleString()}</td>
                                    <td className="px-4 py-2 text-center">
                                        ${parseFloat(p.total_invested).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-center">${p.total_sold.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-center">
                                        {p.total_quantity > 0
                                            ? `$${((p.total_invested - p.total_sold) / p.total_quantity).toFixed(2)}`
                                            : "N/A"}
                                    </td>

                                    <td className="px-4 py-2 text-center">${p.current_price.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-center">
                                        ${p.current_value.toLocaleString()}
                                    </td>
                                    <td className={`px-4 py-2 text-center font-bold ${p.profit_loss >= 0 ? "text-green-600" : "text-red-600"}`}>
                                        ${p.profit_loss.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>


                {/* Biểu đồ phân bổ danh mục & Lịch sử giao dịch + Thêm giao dịch */}
                <div className="grid grid-cols-2 gap-6 mt-6">
                    {/* Biểu đồ phân bổ danh mục */}
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">Investment Distribution</h2>
                        <PieChart width={520} height={520}>
                            <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                outerRadius={160} // Giữ kích thước hợp lý
                                fill="#8884d8"
                                dataKey="value"
                                label={({ name, percent, midAngle, index }) => {
                                    const RADIAN = Math.PI / 180;
                                    const radius = 190; // Đẩy nhãn ra xa hơn
                                    const x = 250 + radius * Math.cos(-midAngle * RADIAN);
                                    const y = 250 + radius * Math.sin(-midAngle * RADIAN);

                                    return (
                                        <text
                                            x={x}
                                            y={y}
                                            fill={COLORS[index % COLORS.length]} // Màu chữ trùng với màu phần biểu đồ
                                            textAnchor={x > 250 ? "start" : "end"}
                                            dominantBaseline="central"
                                            fontSize={14}
                                            fontWeight="bold"
                                        >
                                            {`${name}: ${(percent * 100).toFixed(1)}%`}
                                        </text>
                                    );
                                }}
                                labelLine={{
                                    stroke: "#000",
                                    strokeWidth: 1,
                                    length: 35, // Đẩy đường nối ra xa hơn
                                    length2: 25, // Kéo dài thêm khoảng cách giữa nhãn và biểu đồ
                                }}
                            >
                                {pieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </div>

                    {/* Lịch sử giao dịch + Chức năng thêm giao dịch */}
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">Add New Transaction</h2>

                        {/* Form thêm giao dịch */}
                        <div className="grid grid-cols-5 gap-4 mb-4">
                            <input className="border p-3 rounded-lg" placeholder="Coin (BTC, ETH...)" value={coin} onChange={(e) => setCoin(e.target.value)} />
                            <input className="border p-3 rounded-lg" placeholder="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                            <input className="border p-3 rounded-lg" placeholder="Price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
                            <select className="border p-3 rounded-lg" value={type} onChange={(e) => setType(e.target.value)}>
                                <option value="buy">Buy</option>
                                <option value="sell">Sell</option>
                            </select>
                            <button className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg" onClick={handleSubmit}>Add</button>
                        </div>

                        {/* Lịch sử giao dịch */}
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h2 className="text-xl font-semibold mb-4">Transaction History</h2>
                            <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                                <table className="w-full border-collapse rounded-lg overflow-hidden shadow">
                                    <thead>
                                        <tr className="bg-gray-300 text-gray-700">
                                            <th className="p-3">Coin</th>
                                            <th className="p-3 text-center">Quantity</th>
                                            <th className="p-3 text-center">Purchase Price</th>
                                            <th className="p-3 text-center">Type</th>
                                            <th className="p-3 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map((tx) => (
                                            <tr key={tx.id} className="border-t text-gray-600">
                                                <td className="p-3 text-center">{tx.coin_symbol}</td>
                                                <td className="p-3 text-center">{parseFloat(tx.quantity).toLocaleString()}</td>
                                                <td className="p-3 text-center">${parseFloat(tx.price).toLocaleString()}</td>
                                                <td className={`p-3 text-center ${tx.transaction_type === "buy" ? "text-green-600" : "text-red-600"}`}>
                                                    {tx.transaction_type.toUpperCase()}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <button className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg" onClick={() => handleDelete(tx.id)}>Delete</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </div>


            </div>
        </div>
    );
}
