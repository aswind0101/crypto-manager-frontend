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
import { getAuth } from "firebase/auth";

import CountUp from "react-countup";

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
    const [totalNetInvested, settotalNetInvested] = useState(0);

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

    const [refreshing, setRefreshing] = useState(false);



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
    const fetchMarketData = async (useCache = true) => {
        if (useCache) {
            const cachedCap = localStorage.getItem("cachedMarketCap");
            const cachedTop = localStorage.getItem("cachedTopCoins");
            if (cachedCap && cachedTop) {
                setGlobalMarketCap(Number(cachedCap));
                setTopCoins(JSON.parse(cachedTop));
            }
        }

        try {
            const [globalRes, topRes] = await Promise.all([
                fetch("https://api.coingecko.com/api/v3/global"),
                fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=3&page=1")
            ]);

            if (!globalRes.ok || !topRes.ok) {
                throw new Error("CoinGecko API failed");
            }

            const globalData = await globalRes.json();
            const topData = await topRes.json();

            setGlobalMarketCap(globalData.data.total_market_cap.usd);
            setTopCoins(topData);

            localStorage.setItem("cachedMarketCap", globalData.data.total_market_cap.usd);
            localStorage.setItem("cachedTopCoins", JSON.stringify(topData));
        } catch (error) {
            console.error("⚠️ Failed to fetch market data:", error.message || error);
        }
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
            //Thêm để tính % lời lỗ
            const totalNet = parsed.reduce((sum, coin) => sum + (coin.total_invested - coin.total_sold), 0);

            setTotalInvested(netTotalInvested);
            //Thêm để tính % lời lỗ
            settotalNetInvested(totalNet);
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
        fetchMarketData(true);

        if (!intervalRef.current) {
            intervalRef.current = setInterval(() => {
                fetchPortfolioWithRetry(user.uid);
                fetchMarketData(false); // ✅ thêm dòng này để tự động cập nhật
            }, 60000);
        }


        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);




    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

    const fetchPortfolioWithRetry = async (userId, retryCount = 0) => {
        try {
            if (!firstLoaded) setLoading(true);

            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) {
                router.push("/login");
                return;
            }

            const idToken = await user.getIdToken();

            const response = await fetch("https://crypto-manager-backend.onrender.com/api/portfolio", {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            if (!response.ok) throw new Error("Failed to fetch portfolio");

            const data = await response.json();

            const totalValue = data.portfolio.reduce((sum, coin) => sum + coin.current_value, 0);
            const netTotalInvested = data.portfolio.reduce((sum, coin) => sum + coin.total_invested, 0);
            const totalProfit = data.portfolio.reduce((sum, coin) => sum + coin.profit_loss, 0);
            //Thêm để tính % lời lỗ
            const totalNet = data.portfolio.reduce((sum, coin) => sum + (coin.total_invested - coin.total_sold), 0);



            if (totalValue > 0) {
                // ✅ Cập nhật cache
                localStorage.setItem("cachedPortfolio", JSON.stringify(data.portfolio));
                localStorage.setItem("lastUpdated", new Date().toISOString());

                // ✅ Cập nhật state
                setPortfolio(data.portfolio);
                setTotalInvested(netTotalInvested);
                //Thêm để tính % lời lỗ
                settotalNetInvested(totalNet);
                setTotalProfitLoss(totalProfit);
                setTotalCurrentValue(totalValue);

                // ✅ Cập nhật định dạng thời gian như bản gốc của Hiền
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
                    console.warn("⚠️ Skipped update, giữ nguyên dữ liệu cũ.");
                }
            }
        } catch (error) {
            console.error(`❌ Retry ${retryCount + 1} failed:`, error.message || error);

            if (retryCount < 2) {
                const waitTime = 3000 * (retryCount + 1); // 3s, 6s
                await delay(waitTime);
                return fetchPortfolioWithRetry(userId, retryCount + 1);
            } else {
                setPriceFetchFailed(true);
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

        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) return;

        const idToken = await user.getIdToken();
        try {
            await fetch("https://crypto-manager-backend.onrender.com/api/transactions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    coin_symbol: selectedCoin.coin_symbol,
                    quantity: parseFloat(quantity),
                    price: parseFloat(price),
                    transaction_type: tradeType,
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
                                <p className={`text-3xl font-bold font-mono flex items-center justify-center gap-1 ${totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'} shadow-md`}>$<CountUp key={totalProfitLoss} end={Math.round(totalProfitLoss)} duration={10} separator="," />
                                </p>
                                <p className={`text-sm flex items-center justify-center gap-1 ${totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    (<CountUp
                                        key={totalProfitLoss + '-' + totalNetInvested}
                                        end={parseFloat((Math.abs(totalNetInvested) > 0 ? totalProfitLoss / Math.abs(totalNetInvested) : 0) * 100)}
                                        duration={1.5}
                                        decimals={1}
                                    />%
                                    {totalProfitLoss >= 0 ? '▲' : '▼'})
                                </p>
                                <p className="text-sm text-gray-400 flex items-center justify-center gap-1">
                                    {(() => {
                                        const ratio = Math.abs(totalNetInvested) > 0 ? totalProfitLoss / Math.abs(totalNetInvested) : 0;
                                        if (ratio > 0.5) return "🤑";
                                        if (ratio > 0.1) return "😎";
                                        if (ratio > 0) return "🙂";
                                        if (ratio > -0.1) return "😕";
                                        if (ratio > -0.5) return "😢";
                                        return "😭";
                                    })()} Total Profit / Loss
                                </p>
                            </div>

                            <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-x-12 text-sm text-gray-300">
                                <div className="flex flex-col items-center">
                                    <span className="font-bold text-gray-400">💰 Invested</span>
                                    <p className="font-bold text-green-400 text-xl">${Math.round(totalInvested).toLocaleString()}</p>
                                </div>
                                <div className="flex flex-col items-center">
                                    <span className="font-bold text-gray-400">📊 Current Value</span>
                                    <p className="font-bold text-blue-400 text-xl">$$<CountUp key={totalCurrentValue} end={Math.round(totalCurrentValue)} duration={10} separator="," /></p>
                                </div>
                            </div>

                            {lastUpdated && (
                                <div className="absolute bottom-2 w-full flex justify-center items-center gap-4 text-xs text-gray-400 z-10">
                                    <span>🕒 Last price update: {lastUpdated}</span>
                                    <button
                                        onClick={async () => {
                                            const storedUser = localStorage.getItem("user");
                                            if (storedUser) {
                                                const user = JSON.parse(storedUser);
                                                setRefreshing(true); // bắt đầu xoay
                                                await fetchPortfolioWithRetry(user.uid);
                                                setRefreshing(false); // ngừng xoay
                                            }
                                        }}
                                        className="min-w-[80px] px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-yellow-300 rounded-full border border-yellow-400 text-xs font-semibold transition active:scale-95 z-10 flex items-center gap-1"
                                    >
                                        <span
                                            className={`inline-block transition-transform duration-500 ${refreshing ? "animate-spin" : ""
                                                }`}
                                        >
                                            🔄
                                        </span>
                                        {refreshing ? "Refreshing..." : "Refresh"}
                                    </button>

                                </div>
                            )}


                        </>
                    )}
                </div>
                {/* Market Overview */}
                <div className="mt-4 bg-gray-900 rounded-lg p-4 text-white shadow ">
                    <div className="flex items-center justify-between cursor-pointer transition-colors duration-200"
                        onClick={() => setShowMarketOverview(!showMarketOverview)}>
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
                    const profitLossPercentage = netInvested > 0
                        ? ((coin.profit_loss / netInvested) * 100).toFixed(1) + "%"
                        : coin.profit_loss > 0 ? "∞%" : "0%";

                    return (
                        <div key={index} className="bg-[#0e1628] hover:scale-105 hover:shadow-2xl transition-all duration-300 p-6 rounded-xl shadow-md flex flex-col text-white w-full">
                            <div className="flex flex-col items-center justify-center mb-4">
                                <div className="flex items-center gap-2">
                                    {getCoinIcon(coin.coin_symbol)}
                                    <h2 className="text-lg font-bold text-yellow-400">{coin.coin_symbol.toUpperCase()}</h2>
                                </div>
                                <p className="text-sm text-gray-400">{coin.coin_name || ""}</p>
                            </div>

                            <div className="w-full text-center mb-4">
                                <p className="text-sm text-gray-400">Current Price - Avg. Buy Price</p>
                                <p className="text-lg font-mono text-yellow-300">
                                    ${coin.current_price.toLocaleString()} <span className="text-white">-</span> {avgPrice > 0 ? `$${avgPrice.toFixed(3)}` : "–"}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-4 w-full px-2 md:px-6 text-center">
                                <div>
                                    <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Total Quantity</p>
                                    <p className="text-lg font-mono text-white">{coin.total_quantity.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Total Invested</p>
                                    <p className="text-lg font-mono text-orange-400">${Math.round(coin.total_invested).toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Net Invested</p>
                                    <p className={`text-lg font-mono ${netInvested >= 0 ? "text-purple-400" : "text-green-300"}`}>${Math.round(netInvested).toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Current Value</p>
                                    <p className="text-lg font-mono text-blue-400">${Math.round(coin.current_value).toLocaleString()}</p>
                                </div>
                                <div className="col-span-2 border-t border-gray-700 pt-2">
                                    <p className="text-sm text-gray-400 flex items-center justify-center gap-1">
                                        {(() => {
                                            const ratio = Math.abs(netInvested) > 0 ? coin.profit_loss / Math.abs(netInvested) : 0;
                                            if (ratio > 0.5) return "🤑";
                                            if (ratio > 0.1) return "😎";
                                            if (ratio > 0) return "🙂";
                                            if (ratio > -0.1) return "😕";
                                            if (ratio > -0.5) return "😢";
                                            return "😭";
                                        })()} Profit / Loss
                                    </p>
                                    <p className={`text-lg font-mono ${coin.profit_loss >= 0 ? "text-green-400" : "text-red-400"}`}>
                                        ${Math.round(coin.profit_loss).toLocaleString()} <span className="text-xs">({profitLossPercentage})</span>
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 flex justify-center gap-4">
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
            {/* FAB chỉ hiển thị khi không mở modal và chỉ trên mobile */}
            {!showModal && (
                <div className="fixed bottom-6 right-6 z-50 md:hidden">
                    <button
                        onClick={() => router.push("/add-transaction")}
                        className="bg-yellow-400 hover:bg-yellow-500 hover:scale-105 active:scale-95 text-black text-3xl rounded-full shadow-lg w-14 h-14 flex items-center justify-center transition-all duration-300"
                        title="Add Transaction"
                    >
                        +
                    </button>
                </div>
            )}
        </div>
    );
}

export default withAuthProtection(Dashboard);
