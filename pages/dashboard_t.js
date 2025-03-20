import { useState, useEffect } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import {
    PieChart, Pie, Cell, Legend, BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, LabelList, CartesianGrid, LineChart, Line
} from "recharts";

export default function Dashboard() {
    // State quản lý danh mục đầu tư
    const [portfolio, setPortfolio] = useState([]);
    const [totalInvested, setTotalInvested] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);
    const [profitLossHistory, setProfitLossHistory] = useState([]);

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
        const interval = setInterval(fetchPortfolio, 60000); // Cập nhật mỗi 10 giây
        return () => clearInterval(interval); // Xóa interval khi unmount
    }, []);

    // Lấy danh mục đầu tư từ API backend
    const fetchPortfolio = async () => {
        try {
            const response = await fetch("https://crypto-manager-backend.onrender.com/api/portfolio");
            const data = await response.json();
            setPortfolio(data.portfolio);
            setTotalInvested(data.totalInvested);
            setTotalProfitLoss(data.totalProfitLoss);
            setProfitLossHistory(data.profitLossHistory || []);
        } catch (error) {
            console.error("Error fetching portfolio:", error);
        }
    };

    // Lấy danh sách giao dịch từ API backend
    const fetchTransactions = async () => {
        try {
            const response = await fetch("https://crypto-manager-backend.onrender.com/api/transactions");
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
            const response = await fetch("https://crypto-manager-backend.onrender.com/api/transactions", {
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
            const response = await fetch(`https://crypto-manager-backend.onrender.com/api/transactions/${id}`, {
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
    /*const pieData = portfolio.map((p) => ({
        name: p.coin_symbol,
        value: parseFloat(p.total_invested),
    }));*/
    const totalInvestment = portfolio.reduce((sum, coin) => sum + coin.total_invested, 0);

    const colors = ["#4CAF50", "#FF9800", "#2196F3", "#9C27B0", "#E91E63", "#FFC107"];
    const profitLossColor = totalProfitLoss >= 0 ? "#4CAF50" : "#E91E63";

    const pieData = portfolio.map((coin) => ({
        name: coin.coin_symbol,
        percentageValue: ((coin.total_invested / totalInvestment) * 100).toFixed(2),
        percentage: `${((coin.total_invested / totalInvestment) * 100).toFixed(2)}%`,
    }));

    const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#A28CFF"];

    return (
        <div className="min-h-screen bg-gray-100">
            <Navbar />
            <div className="p-6 text-gray-700">
                <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
                <p className="text-gray-600 mt-2"></p>


                <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                    <h2 className="text-xl font-semibold mb-4">Porfilio Summary</h2>
                    {/* Tổng quan danh mục đầu tư */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Card Tổng Đầu Tư */}
                        <div className="bg-white p-6 rounded-xl shadow-md flex flex-col items-center">
                            <span className="text-2xl font-bold text-gray-700 flex items-center">
                                <span className="mr-2">💰</span> Total Invested
                            </span>
                            <p className="text-3xl font-bold text-blue-600 mt-2">
                                ${totalInvested.toLocaleString()}
                            </p>
                            <ResponsiveContainer width="100%" height={80}>
                                <BarChart data={[{ name: "Invested", value: totalInvested }]}>
                                    <XAxis dataKey="name" hide />
                                    <YAxis hide domain={[0, totalInvested * 1.2]} />
                                    <Bar dataKey="value" fill="#4A90E2" barSize={50} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Card Tổng Lợi Nhuận */}
                        <div className="bg-white p-6 rounded-xl shadow-md flex flex-col items-center">
                            <span className="text-2xl font-bold text-gray-700 flex items-center">
                                <span className="mr-2">📉</span> Total Profit/Loss
                            </span>
                            <p className={`text-3xl font-bold mt-2 ${totalProfitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                                ${totalProfitLoss.toLocaleString()}
                            </p>
                            <ResponsiveContainer width="100%" height={80}>
                                <LineChart data={[
                                    { time: "Start", value: totalProfitLoss * 0.9 },
                                    { time: "Mid", value: totalProfitLoss },
                                    { time: "Now", value: totalProfitLoss * 1.1 }
                                ]}>
                                    <XAxis dataKey="time" hide />
                                    <YAxis hide />
                                    <Line
                                        type="monotone"
                                        dataKey="value"
                                        stroke={totalProfitLoss >= 0 ? "#27AE60" : "#E74C3C"} // Xanh nếu lợi nhuận dương, đỏ nếu âm
                                        strokeWidth={6}
                                        dot={{ r: 2 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                </div>
                <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                    {/* Tổng quan danh mục đầu tư */}
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">Investment Details</h2>
                        <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                            <table className="w-full border-collapse rounded-lg overflow-hidden shadow">
                                <thead>
                                    <tr className="bg-gray-300 text-gray-700">
                                        <th className="p-3 text-center">Coin</th>
                                        <th className="p-3 text-center">Total Quantity</th>
                                        <th className="p-3 text-center">Total Invested</th>
                                        <th className="p-3 text-center">Total Sold</th>
                                        <th className="p-3 text-center">Avg. Purchase Price</th>
                                        <th className="p-3 text-center">Current Price</th>
                                        <th className="p-3 text-center">Current Value</th>
                                        <th className="p-3 text-center">Profit/Loss</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {portfolio.map((p) => (
                                        <tr key={p.coin_symbol} className="border-t text-gray-600 hover:bg-gray-100">
                                            <td className="p-3 text-center">{p.coin_symbol}</td>
                                            <td className="p-3 text-center">{parseFloat(p.total_quantity).toLocaleString()}</td>
                                            <td className="p-3 text-center">
                                                ${parseFloat(p.total_invested).toLocaleString()}
                                            </td>
                                            <td className="p-3 text-center">${p.total_sold.toLocaleString()}</td>
                                            <td className="p-3 text-center">
                                                {p.total_quantity > 0
                                                    ? `$${((p.total_invested - p.total_sold) / p.total_quantity).toFixed(2)}`
                                                    : "N/A"}
                                            </td>

                                            <td className="p-3 text-center">${p.current_price.toLocaleString()}</td>
                                            <td className="p-3 text-center">
                                                ${p.current_value.toLocaleString()}
                                            </td>
                                            <td className={`p-3 text-center ${p.profit_loss >= 0 ? "text-green-600" : "text-red-600"}`}>
                                                ${p.profit_loss.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>


                {/* Biểu đồ phân bổ danh mục & Lịch sử giao dịch + Thêm giao dịch */}
                <div className="grid grid-cols-2 gap-6 mt-6">
                    {/* Biểu đồ phân bổ danh mục */}
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">Investment Distribution</h2>

                        <div className="bg-white p-6 rounded-lg shadow-sm">
                            <h2 className="text-xl font-semibold text-gray-700 mb-4 text-center">Investment Distribution (%)</h2>

                            <ResponsiveContainer width="100%" height={400}>
                                <BarChart
                                    data={pieData}
                                    margin={{ top: 20, right: 30, left: 20, bottom: 40 }}
                                    barSize={50} // Điều chỉnh độ rộng cột
                                >
                                    {/* Grid giúp làm nổi bật biểu đồ */}
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.5} />

                                    {/* Trục X hiển thị tên coin */}
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fill: "#4A5568", fontSize: 14, fontWeight: "bold" }}
                                    />

                                    {/* Trục Y hiển thị giá trị phần trăm */}
                                    <YAxis tickFormatter={(tick) => `${tick}%`} />

                                    {/* Tooltip (hover để xem chi tiết) 
                                    <Tooltip formatter={(value) => `${value}%`} />*/}

                                    {/* Thêm chú thích (Legend) 
                                    <Legend verticalAlign="top" />*/}


                                    {/* Cột biểu đồ với màu sắc tuỳ chỉnh */}
                                    <Bar dataKey="percentageValue" fill="#4CAF50" radius={[6, 6, 0, 0]}>
                                        <LabelList
                                            dataKey="percentage"
                                            position="top"
                                            fill="#4A5568"
                                            fontSize={14}
                                            fontWeight="bold"
                                        />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
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
