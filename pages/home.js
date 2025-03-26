// updated: Hiển thị trạng thái chờ khi lần đầu không lấy được giá, chỉ cập nhật khi lấy được giá + Fix lỗi setInterval lặp khi chuyển trang + Hiển thị bộ lọc ngay cả khi dùng dữ liệu cache
import { useState, useEffect, useRef } from "react";
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
    const formatNumber = (num) => {
        if (!num || isNaN(num)) return '–';
        if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return Number(num).toLocaleString();
    };
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
    const [hasCache, setHasCache] = useState(false);
    const [selectedCoin, setSelectedCoin] = useState(null);
    const [tradeType, setTradeType] = useState("buy");
    const [quantity, setQuantity] = useState("");
    const [price, setPrice] = useState("");
    const [showModal, setShowModal] = useState(false);  

    const [globalMarketCap, setGlobalMarketCap] = useState(null);
    const [topCoins, setTopCoins] = useState([]);
    const [showMarketOverview, setShowMarketOverview] = useState(true);


    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState("");


    const intervalRef = useRef(null);
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
            setHasCache(true);
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
        fetchMarketData();
        
        if (!intervalRef.current) {
            intervalRef.current = setInterval(() => {
                fetchPortfolioWithRetry(user.uid);
                fetchGlobalMarketCap(); // ✅ thêm dòng này để tự động cập nhật
            }, 60000);
        }


        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);

    const fetchMarketData = async () => {
        const cachedCap = localStorage.getItem("cachedMarketCap");
        const cachedTop = localStorage.getItem("cachedTopCoins");
        if (cachedCap && cachedTop) {
            setGlobalMarketCap(Number(cachedCap));
            setTopCoins(JSON.parse(cachedTop));
        }

        try {
            const [globalRes, topRes] = await Promise.all([
                fetch("https://api.coingecko.com/api/v3/global"),
                fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=3&page=1")
            ]);

            // ✅ Kiểm tra nếu fetch thành công
            if (!globalRes.ok || !topRes.ok) {
                throw new Error("CoinGecko API failed");
            }

            const globalData = await globalRes.json();
            const topData = await topRes.json();

            setGlobalMarketCap(globalData.data.total_market_cap.usd);
            setTopCoins(topData);

            // ✅ Lưu cache
            localStorage.setItem("cachedMarketCap", globalData.data.total_market_cap.usd);
            localStorage.setItem("cachedTopCoins", JSON.stringify(topData));
        } catch (error) {
            console.error("⚠️ Failed to fetch market data:", error.message || error);
        }
    };



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
                    console.warn("Skipped update, giữ nguyên dữ liệu cũ.");
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

    const handleOpenTradeModal = (coin, type) => {
        setSelectedCoin(coin);
        setTradeType(type);
        setQuantity("");
        setPrice(coin.current_price || "");
        setShowModal(true);
        setFormError("");
    };


    const handleConfirmTrade = async () => {
        if (!quantity || parseFloat(quantity) <= 0) {
            setFormError("Please enter a valid quantity > 0.");
            return;
        }
        setIsSubmitting(true);
        const user = JSON.parse(localStorage.getItem("user"));
        if (!user) return;

        try {
            await fetch("https://crypto-manager-backend.onrender.com/api/transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    coin_symbol: selectedCoin.coin_symbol,
                    quantity: parseFloat(quantity),
                    price: parseFloat(price),
                    transaction_type: tradeType,
                    user_id: user.uid
                })
            });
            setShowModal(false);
            fetchPortfolioWithRetry(user.uid);
        } catch (error) {
            setFormError("An error occurred. Please try again later.");
        } finally {
            setIsSubmitting(false);
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
                {/* Modal */}
                {showModal && selectedCoin && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-gray-900 p-6 rounded-lg w-96 shadow-xl">
                            <h2 className="text-xl font-bold mb-4 text-white">
                                {tradeType === "buy" ? "Buy" : "Sell"} {selectedCoin.coin_symbol.toUpperCase()}
                            </h2>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                placeholder="Quantity"
                                className="w-full mb-2 p-2 rounded bg-gray-800 text-white"
                            />
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="Price"
                                className="w-full mb-2 p-2 rounded bg-gray-800 text-white"
                            />
                            {formError && <p className="text-red-400 text-sm mb-2">{formError}</p>}
                            <div className="flex justify-between">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white"
                                    disabled={isSubmitting}
                                >Cancel</button>
                                <button
                                    onClick={handleConfirmTrade}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
                                    disabled={isSubmitting}
                                >{isSubmitting ? "Processing..." : "Confirm"}</button>
                            </div>
                        </div>
                    </div>
                )}


                <div className="relative h-80 rounded-xl shadow-lg bg-black overflow-hidden">
                    {!hasCache && priceFetchFailed ? (
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
                {/* Market Overview */}
                <div className="mt-4 bg-gray-900 rounded-lg p-4 text-white shadow">
                    <div className="flex items-center justify-between cursor-pointer" className="flex items-center justify-between cursor-pointer transition-colors duration-200" onClick={() => setShowMarketOverview(!showMarketOverview)}>
        <h2 className="text-lg font-bold">🌐 Market Overview</h2>
                <span className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                    <span className={`transform transition-transform duration-300 ${showMarketOverview ? 'rotate-180' : ''}`}>▼</span>
                </span>
        </div>
                    
                    {showMarketOverview && (
                        <>
                            <p className="text-sm text-gray-300 mb-4">
                                <span className="text-sm text-gray-400">Total Market Cap: </span>
                                <span className="text-sm text-gray-400">${formatNumber(globalMarketCap)}</span>
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {topCoins.map((coin) => (
                                    <div key={coin.id} className="bg-gray-800 rounded p-3">
                                        <div className="flex items-center gap-2">
                                            <img src={coin.image} alt={coin.name} className="w-6 h-6" />
                                            <span className="font-semibold">{coin.name} ({coin.symbol.toUpperCase()})</span>
                                        </div>
                                        <p className="text-sm mt-1">💵 ${formatNumber(coin.current_price)}</p>
                                        <p className="text-sm text-gray-400">Market Cap: ${formatNumber(coin.market_cap)}</p>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                {/* Luôn hiển thị bộ lọc nếu có dữ liệu */}
                {portfolio.length > 0 && (
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

                {/* phần còn lại giữ nguyên */}
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
                            <div className="mt-4 flex gap-4">
                                <button
                                    onClick={() => handleOpenTradeModal(coin, "buy")}
                                    className="bg-green-600 hover:bg-green-700 px-4 py-1 rounded text-white text-sm"
                                >Buy</button>
                                <button
                                    onClick={() => handleOpenTradeModal(coin, "sell")}
                                    className="bg-red-600 hover:bg-red-700 px-4 py-1 rounded text-white text-sm"
                                >Sell</button>
                            </div>

                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default withAuthProtection(Dashboard);
