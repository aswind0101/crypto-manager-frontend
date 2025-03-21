import { useState, useEffect } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import {
    ResponsiveContainer, RadialBarChart, RadialBar, PieChart, Pie, Cell 
} from "recharts";
import { FaBitcoin, FaEthereum, FaCoins } from "react-icons/fa";

export default function Dashboard() {
    // State quản lý danh mục đầu tư
    const [portfolio, setPortfolio] = useState([]);
    const [totalInvested, setTotalInvested] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);
    const [profitLossHistory, setProfitLossHistory] = useState([]);
    const [totalCurrentValue, setTotalCurrentValue] = useState(0);
    const totalProfitPositive = totalProfitLoss >= 0; // Kiểm tra tổng danh mục có lời hay lỗ

    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

    const summaryData = [
        { name: "Invested", value: totalInvested },
        { name: "Profit/Loss", value: totalProfitLoss }
    ];

    // Dữ liệu hiển thị biểu đồ tròn
    const data = [
        { name: "Current", value: totalCurrentValue, color: "#32CD32" }, // Xanh lá
        { name: "Remaining", value: totalInvested - totalCurrentValue, color: "#FF0000" } // Đỏ nếu bị lỗ
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
    //Tính tổng giá trị hiện tại
    


    // Lấy danh mục đầu tư từ API backend
    const fetchPortfolio = async () => {
        try {
            const response = await fetch("https://crypto-manager-backend.onrender.com/api/portfolio");
            const data = await response.json();
            setPortfolio(data.portfolio);
            setTotalInvested(data.totalInvested);
            setTotalProfitLoss(data.totalProfitLoss);
            setProfitLossHistory(data.profitLossHistory || []);
            // Tính tổng giá trị hiện tại
            const totalValue = data.portfolio.reduce((sum, coin) => sum + coin.current_value, 0);
            setTotalCurrentValue(totalValue);
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
   
    const portfolioData = portfolio.map(coin => ({
        name: coin.coin_symbol,
        value: coin.current_value,
        fill: coin.profit_loss >= 0 ? "#32CD32" : "#FF0000" // Xanh nếu lời, đỏ nếu lỗ
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
            <div className="bg-white p-6 rounded-lg shadow-md mb-6 text-gray-700">
                <h2 className="text-xl text-center font-semibold mb-4 ">Porfolio Summary</h2>
                {/* Tổng quan danh mục đầu tư */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                    {/* Biểu đồ hiển thị Total Profit/Loss */}
                    <div className="relative w-full h-80 flex justify-center items-center mb-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadialBarChart
                                innerRadius="70%"
                                outerRadius="100%"
                                data={portfolio.map(coin => ({
                                    name: coin.coin_symbol,
                                    value: coin.current_value,
                                    fill: coin.profit_loss >= 0 ? "#32CD32" : "#FF0000"
                                }))}
                                startAngle={180}
                                endAngle={0}
                            >
                                <RadialBar minAngle={15} background clockWise dataKey="value" />
                            </RadialBarChart>
                        </ResponsiveContainer>
                        <div className="absolute text-center">
                            <p className={`text-xl font-bold ${totalProfitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalProfitLoss)}
                            </p>
                            <p className="text-xs text-gray-500">Total Profit/Loss</p>
                            {/* Tổng đầu tư và tổng giá trị hiện tại */}
                            <div className="flex justify-between w-full mt-4 px-6 text-center">
                                <div className="flex flex-col items-center">
                                    <span className="text-sm font-bold text-gray-700">💰 Invested</span>
                                    <p className="text-sm font-bold text-blue-600">${totalInvested.toLocaleString()}</p>
                                </div>
                                <div className="flex flex-col items-center">
                                    <span className="text-sm font-bold text-gray-700">📊 Current Value</span>
                                    <p className="text-sm font-bold text-green-600">${totalCurrentValue.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
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
                                    ? `$${((coin.total_invested - coin.total_sold) / coin.total_quantity).toFixed(3)}`
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
    );
}
