import { useState, useEffect } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import {
    PieChart, Pie, Cell, Legend, BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, LabelList, CartesianGrid, LineChart, Line
} from "recharts";
import { FaBitcoin, FaEthereum, FaCoins } from "react-icons/fa";

export default function Dashboard() {
    // State quản lý danh mục đầu tư
    const [portfolio, setPortfolio] = useState([]);
    const [totalInvested, setTotalInvested] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);
    const [profitLossHistory, setProfitLossHistory] = useState([]);

    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

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
    //Get coin icoins
    const getCoinIcon = (symbol) => {
        switch (symbol.toUpperCase()) {
            case "BTC":
                return <FaBitcoin className="text-yellow-500 text-3xl" />;
            case "ETH":
                return <FaEthereum className="text-blue-500 text-3xl" />;
            default:
                return <FaCoins className="text-gray-500 text-3xl" />;
        }
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <Navbar />
            <div className="p-6">
                <div className="bg-white p-6 rounded-lg shadow-md mb-6 text-gray-700">
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
                        {/* GRID HIỂN THỊ CÁC COIN */}
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {portfolio.map((coin, index) => (
                                <div key={index} className="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center border border-gray-300">
                                    <div className="flex items-center gap-2">
                                        {getCoinIcon(coin.coin_symbol)}
                                        <h2 className="text-lg font-bold text-gray-700">{coin.coin_symbol}</h2>
                                    </div>
                                    <p className="text-gray-500 text-sm">Current Price - Average Price</p>
                                    <p className="text-xl font-semibold">${coin.current_price.toLocaleString()} - {coin.total_quantity > 0
                                        ? `$${((coin.total_invested - coin.total_sold) / coin.total_quantity).toFixed(2)}`
                                        : "N/A"}</p>
                                    <p className="text-gray-500 text-sm">Total Quantity</p>
                                    <p className="text-xl font-semibold">{coin.total_quantity.toLocaleString()}</p>

                                    <p className="text-gray-500 text-sm mt-2">Current Value</p>
                                    <p className="text-xl font-semibold text-blue-600">${coin.current_value.toLocaleString()}</p>

                                    <p className="text-gray-500 text-sm mt-2">Profit/Loss</p>
                                    <p className={`text-xl font-semibold ${coin.profit_loss >= 0 ? "text-green-500" : "text-red-500"}`}>
                                        ${coin.profit_loss.toLocaleString()}
                                    </p>
                                </div>
                            ))}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
