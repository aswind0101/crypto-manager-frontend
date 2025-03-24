// updated: Hiển thị trạng thái chờ khi lần đầu không lấy được giá, chỉ cập nhật khi lấy được giá
import { useState, useEffect } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import {
    ResponsiveContainer,
    RadialBarChart,
    RadialBar
} from "recharts";
import { FaCoins } from "react-icons/fa";
import { useCoinIcons } from "../components/useCoinIcons";
import { useRouter } from "next/router";

import withAuthProtection from "../hoc/withAuthProtection";

function Dashboard() {
    const [portfolio, setPortfolio] = useState([]);
    const [totalInvested, setTotalInvested] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);
    const [totalCurrentValue, setTotalCurrentValue] = useState(0);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterByProfit, setFilterByProfit] = useState("all");
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [priceFetchFailed, setPriceFetchFailed] = useState(false);
    const [firstLoaded, setFirstLoaded] = useState(false);
    const router = useRouter();

    const coinIcons = useCoinIcons();

    const getCoinIcon = (symbol) => {
        const url = coinIcons[symbol.toUpperCase()];
        return url ? (
            <img src={url} alt={symbol} className="w-8 h-8 object-contain rounded-full" />
        ) : (
                <FaCoins className="text-gray-500 text-2xl" />
            );
    };

    useEffect(() => {
        const cached = localStorage.getItem("cachedPortfolio");
        const cachedTime = localStorage.getItem("lastUpdated");
        if (cached) {
            const parsed = JSON.parse(cached);
            setPortfolio(parsed);
            setFirstLoaded(true);
            setLoading(false);

            const totalValue = parsed.reduce((sum, coin) => sum + coin.current_value, 0);
            const netTotalInvested = parsed.reduce((sum, coin) => sum + coin.total_invested, 0);
            const totalProfit = parsed.reduce((sum, coin) => sum + coin.profit_loss, 0);

            setTotalInvested(netTotalInvested);
            setTotalCurrentValue(totalValue);
            setTotalProfitLoss(totalProfit);

            if (cachedTime) {
                setLastUpdated(new Date(cachedTime).toLocaleTimeString());
            }
        }
        const storedUser = localStorage.getItem("user");
        if (!storedUser) {
            router.push("/login");
            return;
        }
        const user = JSON.parse(storedUser);
        fetchPortfolioWithRetry(user.uid);
        const interval = setInterval(() => fetchPortfolioWithRetry(user.uid), 60000);
        return () => clearInterval(interval);
    }, []);

    const fetchPortfolioWithRetry = async (userId, retryCount = 0) => {
        try {
            if (!firstLoaded) setLoading(true);
            const response = await fetch(`https://crypto-manager-backend.onrender.com/api/portfolio?userId=${userId}`);
            const data = await response.json();

            const totalValue = data.portfolio.reduce((sum, coin) => sum + coin.current_value, 0);
            const netTotalInvested = data.portfolio.reduce((sum, coin) => sum + coin.total_invested, 0);
            const totalProfit = data.portfolio.reduce((sum, coin) => sum + coin.profit_loss, 0);

            if (totalValue > 0) {
                localStorage.setItem("cachedPortfolio", JSON.stringify(data.portfolio));
                localStorage.setItem("lastUpdated", new Date().toISOString());
                setPortfolio(data.portfolio);
                setTotalInvested(netTotalInvested);
                setTotalProfitLoss(totalProfit);
                setTotalCurrentValue(totalValue);
                setLastUpdated(new Date().toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                }));
                setPriceFetchFailed(false);
                setFirstLoaded(true);
            } else {
                if (!firstLoaded) {
                    setPriceFetchFailed(true);
                } else {
                    console.warn("Skipped update, giá vẫn giữ nguyên do không lấy được giá mới");
                }
            }
        } catch (error) {
            console.error("Error fetching portfolio:", error);
            if (retryCount < 2) {
                setTimeout(() => {
                    fetchPortfolioWithRetry(userId, retryCount + 1);
                }, 5000);
            }
        } finally {
            if (firstLoaded) setLoading(false);
        }
    };

    const filteredPortfolio = portfolio.filter((coin) => {
        const matchesSearch = coin.coin_symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (coin.coin_name || "").toLowerCase().includes(searchTerm.toLowerCase());

        const matchesProfit =
            filterByProfit === "all" ||
            (filterByProfit === "profit" && coin.profit_loss >= 0) ||
            (filterByProfit === "loss" && coin.profit_loss < 0);

        return matchesSearch && matchesProfit;
    }).sort((a, b) => b.current_value - a.current_value);

    return (
        <div className="p-0 max-w-5xl mx-auto">
            <Navbar />
            <div className="mt-4 grid grid-cols-1 gap-4 p-6 rounded-xl shadow-lg bg-black">
                <div className="relative h-80 rounded-xl shadow-lg bg-black overflow-hidden">
                    {!firstLoaded && priceFetchFailed ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-4">
                            <div className="w-56 h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-yellow-400 animate-pulse w-full"></div>
                            </div>
                            <p className="text-yellow-400 text-sm text-center animate-pulse">
                                ⚠️ Unable to fetch the latest prices. Please wait while we try again...
                            </p>
                        </div>
                    ) : (
                            <>
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

                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                    <p className={`text-2xl font-bold ${totalProfitLoss >= 0 ? "text-green-500" : "text-red-500"}`}>
                                        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalProfitLoss)}
                                    </p>
                                    <p className="font-bold text-gray-400 text-sm">Profit/Loss</p>
                                </div>

                                <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-x-12 text-sm text-gray-300">
                                    <div className="flex flex-col items-center">
                                        <span className="font-bold text-gray-400">💰 Invested</span>
                                        <p className="font-bold text-green-400 text-xl">${totalInvested.toLocaleString()}</p>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="font-bold text-gray-400">📊 Current Value</span>
                                        <p className="font-bold text-blue-400 text-xl">${totalCurrentValue.toLocaleString()}</p>
                                    </div>
                                </div>

                                {lastUpdated && (
                                    <div className="absolute bottom-2 w-full text-center text-xs text-gray-400">
                                        🕒 Last price update: {lastUpdated}
                                    </div>
                                )}
                            </>
                        )}
                </div>
                {/* phần còn lại giữ nguyên */}
                {firstLoaded && !priceFetchFailed && (
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-white mt-4">
                        <input
                            type="text"
                            placeholder="🔍 Search by coin name or symbol..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="p-2 rounded-lg w-full md:w-1/2 bg-gray-800 text-white outline-none"
                        />

                        <select
                            value={filterByProfit}
                            onChange={(e) => setFilterByProfit(e.target.value)}
                            className="p-2 rounded-lg bg-gray-800 text-white w-full md:w-1/4 outline-none"
                        >
                            <option value="all">All</option>
                            <option value="profit">🟢 Profit</option>
                            <option value="loss">🔴 Loss</option>
                        </select>
                    </div>
                )}
                {filteredPortfolio.map((coin, index) => {
                    const netInvested = coin.total_invested - coin.total_sold;
                    const avgPrice = (netInvested > 0 && coin.total_quantity > 0)
                        ? (netInvested / coin.total_quantity)
                        : 0;
                    const originalInvested = coin.total_invested;

                    let profitLossPercentage = "–";
                    if (originalInvested > 0) {
                        profitLossPercentage = ((coin.profit_loss / originalInvested) * 100).toFixed(1) + "%";
                    } else if (netInvested > 0) {
                        profitLossPercentage = ((coin.profit_loss / netInvested) * 100).toFixed(1) + "%";
                    } else if (coin.profit_loss > 0) {
                        profitLossPercentage = "∞%";
                    } else {
                        profitLossPercentage = "0%";
                    }

                    const priceChangeText = avgPrice > 0 ? (
                        <span className={`ml-2 text-sm font-semibold ${(((coin.current_price - avgPrice) / avgPrice) * 100) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            ({(((coin.current_price - avgPrice) / avgPrice) * 100).toFixed(2)}% {((coin.current_price - avgPrice) >= 0 ? "▲" : "▼")})
                        </span>
                    ) : null;

                    return (
                        <div key={index} className="bg-[#0e1628] hover:scale-105 hover:shadow-2xl transition-all duration-300 p-6 rounded-xl shadow-md flex flex-col items-center text-white w-full">
                            <div className="flex items-center gap-3 mb-2">
                                {getCoinIcon(coin.coin_symbol)}
                                <div className="text-left">
                                    <h2 className="text-lg font-bold text-yellow-400">{coin.coin_symbol.toUpperCase()}</h2>
                                    <p className="text-sm text-gray-400">{coin.coin_name || ""}</p>
                                </div>
                            </div>

                            <p className="text-gray-400 text-sm mt-2">Current Price - Avg. Buy Price</p>
                            <p className="text-lg font-mono text-yellow-300">
                                ${coin.current_price.toLocaleString()} <span className="text-white">-</span> {avgPrice > 0 ? `$${avgPrice.toFixed(3)}` : "–"}
                                {priceChangeText}
                            </p>

                            <p className="text-gray-400 text-sm mt-2">Total Quantity</p>
                            <p className="text-lg font-mono text-white">{coin.total_quantity.toLocaleString()}</p>

                            <p className="text-gray-400 text-sm mt-2">Total Invested</p>
                            <p className="text-lg font-mono text-orange-400">
                                ${coin.total_invested.toLocaleString()}
                            </p>

                            <p className="text-gray-400 text-sm mt-2">Net Invested</p>
                            <p className={`text-lg font-mono ${netInvested >= 0 ? "text-purple-400" : "text-green-300"}`}>
                                ${netInvested.toLocaleString()}
                            </p>

                            <p className="text-gray-400 text-sm mt-2">Current Value</p>
                            <p className="text-lg font-mono text-blue-400">${coin.current_value.toLocaleString()}</p>

                            <p className="text-gray-400 text-sm mt-2">Profit / Loss</p>
                            <p className={`text-lg font-mono ${coin.profit_loss >= 0 ? "text-green-400" : "text-red-400"}`}>
                                ${coin.profit_loss.toLocaleString()} <span className="text-xs">({profitLossPercentage})</span>
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default withAuthProtection(Dashboard);
