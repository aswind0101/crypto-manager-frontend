// updated: Hiển thị trạng thái chờ khi lần đầu không lấy được giá, chỉ cập nhật khi lấy được giá + Fix lỗi setInterval lặp khi chuyển trang + Hiển thị bộ lọc ngay cả khi dùng dữ liệu cache
import { useState, useEffect, useRef } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import SwipeDashboard from "../components/SwipeDashboard";
import Link from "next/link";
import { FaCoins } from "react-icons/fa";
import { useCoinIcons } from "../components/useCoinIcons";
import { useRouter } from "next/router";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth } from "firebase/auth";
import { motion, AnimatePresence } from "framer-motion";
import LoadingScreen from "../components/LoadingScreen";
import EmptyPortfolioView from "../components/EmptyPortfolioView";

function Dashboard() {
    const formatNumber = (num) => {
        if (!num || isNaN(num)) return '–';
        if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return Number(num).toLocaleString();
    };
    const formatCurrency = (num, options = { prefix: "", fallback: "–" }) => {
        if (num === null || num === undefined || isNaN(num)) return options.fallback;
        if (num >= 1) return options.prefix + num.toLocaleString(undefined, { maximumFractionDigits: 2 });
        if (num >= 0.01) return options.prefix + num.toFixed(4);
        if (num >= 0.0001) return options.prefix + num.toFixed(6);
        return options.prefix + num.toFixed(8);
    };

    const [portfolio, setPortfolio] = useState([]);
    const [totalNetInvested, settotalNetInvested] = useState(0);
    const [showLastUpdate, setShowLastUpdate] = useState(true);
    const [includeSoldCoins, setIncludeSoldCoins] = useState(false);
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
    const [showMarketOverview, setShowMarketOverview] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [hasRawPortfolioData, setHasRawPortfolioData] = useState(false);
    const [isReadyToRender, setIsReadyToRender] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const intervalRef = useRef(null);
    const router = useRouter();

    useEffect(() => {
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
            // Reset filter mỗi khi user login
            setSearchTerm("");
            setFilterByProfit("all");
            setIncludeSoldCoins(false);
        }
    }, [typeof window !== "undefined" && localStorage.getItem("user")]);

    const coinIcons = useCoinIcons();
    const getCoinIcon = (symbol) => {
        const url = coinIcons[symbol.toUpperCase()];
        return url ? (
            <img src={url} alt={symbol} className="w-8 h-8 object-contain rounded-full" />
        ) : (
            <FaCoins className="text-gray-500 text-2xl" />
        );
    };

    const getCoinPrices = async (symbols = []) => {
        try {
            const baseUrl = "https://crypto-manager-backend.onrender.com"; // 🔁 đổi thành domain backend của Hiền
            const query = symbols.join(",");
            const res = await fetch(`${baseUrl}/api/price?symbols=${query}`);

            if (!res.ok) throw new Error("Price fetch failed");

            const data = await res.json(); // { BTC: 72800, NEAR: 7.3 }

            // Lưu lại cache từng coin
            Object.entries(data).forEach(([symbol, price]) => {
                localStorage.setItem("price_" + symbol.toUpperCase(), price);
            });

            return data;
        } catch (e) {
            console.warn("⚠️ getCoinPrices fallback to cache", e);
            const fallback = {};
            symbols.forEach(symbol => {
                const cached = localStorage.getItem("price_" + symbol.toUpperCase());
                fallback[symbol.toUpperCase()] = cached ? parseFloat(cached) : 0;
            });
            return fallback;
        }
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
        const storedUser = localStorage.getItem("user");
        if (!storedUser) {
            router.push("/login");
            return;
        }
        const user = JSON.parse(storedUser);

        const cached = localStorage.getItem(`portfolio_${user.uid}`);
        const cachedTime = localStorage.getItem(`lastUpdated_${user.uid}`);

        if (cached) {
            setHasCache(true);
            const parsed = JSON.parse(cached);
            setPortfolio(parsed);
            setFirstLoaded(true);
            setLoading(false);

            const totalValue = parsed.reduce((sum, coin) => sum + coin.current_value, 0);
            const totalProfit = parsed.reduce((sum, coin) => sum + coin.profit_loss, 0);
            const totalNet = parsed.reduce((sum, coin) => sum + (coin.total_invested - coin.total_sold), 0);

            settotalNetInvested(totalNet);
            setTotalCurrentValue(totalValue);
            setTotalProfitLoss(totalProfit);

            if (cachedTime) {
                setLastUpdated(new Date(cachedTime).toLocaleTimeString());
            }
        }

        fetchPortfolioWithRetry(user.uid);
        fetchMarketData(true);

        if (!intervalRef.current) {
            intervalRef.current = setInterval(() => {
                fetchPortfolioWithRetry(user.uid);
                fetchMarketData(false);
            }, 300000);
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!portfolio || portfolio.length === 0) return;

        const filtered = portfolio.filter((c) => includeSoldCoins || c.total_quantity > 0);

        const value = filtered.reduce((sum, c) => sum + c.current_value, 0);
        const netInvested = filtered.reduce((sum, c) => sum + (c.total_invested - c.total_sold), 0);
        const profit = filtered.reduce((sum, c) => sum + c.profit_loss, 0);

        setTotalCurrentValue(value);
        settotalNetInvested(netInvested);
        setTotalProfitLoss(profit);
    }, [portfolio, includeSoldCoins]);

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

            if (data.portfolio.length > 0) {
                setHasRawPortfolioData(true);  // ✅ Có dữ liệu giao dịch thực tế
            }

            const symbols = data.portfolio.map(c => c.coin_symbol);

            // ✅ Nếu user chưa có giao dịch, không cần fetch giá
            if (symbols.length === 0) {
                setPortfolio([]);
                setFirstLoaded(true);
                setLoading(false);
                setIsReadyToRender(true);
                return;
            }

            const prices = await getCoinPrices(symbols);

            const updatedPortfolio = data.portfolio.map(c => {
                const symbol = c.coin_symbol.toUpperCase();
                const fetchedPrice = prices[symbol];
                const fallbackPrice = c.total_quantity > 0
                    ? (c.total_invested - c.total_sold) / c.total_quantity
                    : 0;

                const isFallback = !fetchedPrice || fetchedPrice === 0;

                return {
                    ...c,
                    current_price: fetchedPrice || fallbackPrice,
                    current_value: (fetchedPrice || fallbackPrice) * c.total_quantity,
                    profit_loss: ((fetchedPrice || fallbackPrice) * c.total_quantity) - (c.total_invested - c.total_sold),
                    is_fallback_price: isFallback
                };
            });


            if (updatedPortfolio.length > 0) {
                setPortfolio(updatedPortfolio);

                setLastUpdated(new Date().toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                }));

                setPriceFetchFailed(false);
                setFirstLoaded(true);
                setIsReadyToRender(true);

                localStorage.setItem(`portfolio_${user.uid}`, JSON.stringify(updatedPortfolio));
                localStorage.setItem(`lastUpdated_${user.uid}`, new Date().toISOString());
            } else {
                if (!firstLoaded) {
                    setPortfolio([]); // clear
                    setPriceFetchFailed(true);
                }
            }
        } catch (error) {
            console.error(`❌ Retry ${retryCount + 1} failed:`, error.message || error);

            if (retryCount < 2) {
                const waitTime = 3000 * (retryCount + 1);
                await delay(waitTime);
                return fetchPortfolioWithRetry(userId, retryCount + 1);
            } else {
                setPriceFetchFailed(true);
            }
        } finally {
            setLoading(false); // ❗ luôn đảm bảo setLoading(false)
            setIsReadyToRender(true);
        }
    };
    if (!isReadyToRender) {
        return <LoadingScreen />;
    }
    const isEmptyPortfolioView =
        isReadyToRender &&
        !loading &&
        portfolio.length === 0 &&
        !hasRawPortfolioData &&
        firstLoaded;
    if (isEmptyPortfolioView) {
        return <EmptyPortfolioView />;
    }
    const handleOpenTradeModal = (coin, type) => {
        setSelectedCoin(coin);
        setTradeType(type);
        setQuantity(type === "sell" ? coin.total_quantity.toString() : "");
        setPrice((coin.current_price ?? 0).toString());
        setShowModal(true);
        setFormError("");
    };

    const handleConfirmTrade = async () => {
        const qty = parseFloat(quantity);
        if (!quantity || qty <= 0) {
            setFormError("❗ Please enter a valid quantity > 0.");
            return;
        }
        // Kiểm tra nếu là bán
        if (tradeType === "sell" && selectedCoin && qty > selectedCoin.total_quantity) {
            setFormError("❗ Cannot sell more than you own.");
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


    const filteredPortfolio = portfolio
        .filter((coin) => includeSoldCoins || coin.total_quantity > 0) // ✅ lọc theo checkbox
        .filter((coin) => {
            const matchesSearch = coin.coin_symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (coin.coin_name || "").toLowerCase().includes(searchTerm.toLowerCase());

            const matchesProfit =
                filterByProfit === "all" ||
                (filterByProfit === "profit" && coin.profit_loss >= 0) ||
                (filterByProfit === "loss" && coin.profit_loss < 0);

            return matchesSearch && matchesProfit;
        })
        .sort((a, b) => b.current_value - a.current_value);


    return (
        <div className="p-0 max-w-[1280px] mx-auto min-h-screen text-white ">
            <Navbar />

            <div className="mt-4 grid grid-cols-1 gap-4 p-8 rounded-xl shadow-lg bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69]">
                {/* Modal */}
                {showModal && selectedCoin && (
                    <div className="fixed inset-0 bg-[#132649] bg-opacity-50 flex items-center justify-center z-50">
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
                                    className="px-4 py-2 rounded-full bg-gray-600 hover:bg-gray-700 text-white text-sm shadow transition"
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </button>

                                <button
                                    onClick={handleConfirmTrade}
                                    disabled={isSubmitting}
                                    className={`px-4 py-2 rounded-full text-white text-sm shadow transition-all duration-200
        ${tradeType === "buy"
                                            ? "bg-green-600 hover:bg-green-700 active:bg-green-800"
                                            : "bg-red-600 hover:bg-red-700 active:bg-red-800"}
        ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}
    `}
                                >
                                    {isSubmitting ? "Processing..." : "Confirm"}
                                </button>

                            </div>
                        </div>
                    </div>
                )}


                <div className="relative w-full">
                    {!hasCache && priceFetchFailed ? (
                        <div className="flex flex-col items-center justify-center h-80 space-y-4">
                            <div className="w-56 h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-yellow-400 animate-pulse w-full"></div>
                            </div>
                            <p className="text-yellow-400 text-sm text-center animate-pulse">
                                ⚠️ Unable to fetch the latest prices. Please wait while we try again...
                            </p>
                        </div>
                    ) : (
                        <>
                            <SwipeDashboard
                                portfolio={portfolio}
                                totalCurrentValue={totalCurrentValue}
                                totalProfitLoss={totalProfitLoss}
                                totalNetInvested={totalNetInvested}
                                coinIcons={coinIcons}
                                lastUpdated={lastUpdated}
                                onSlideChange={(slideIndex) => setShowLastUpdate(slideIndex === 0)}
                            />

                            {lastUpdated && showLastUpdate && (
                                <div className="absolute bottom-2 w-full flex justify-center items-center gap-4 text-xs text-gray-300 z-10">
                                    <span>🕒 Last price update: {lastUpdated}</span>
                                    <button
                                        onClick={async () => {
                                            const storedUser = localStorage.getItem("user");
                                            if (storedUser) {
                                                const user = JSON.parse(storedUser);
                                                setRefreshing(true);
                                                await fetchPortfolioWithRetry(user.uid);
                                                setRefreshing(false);
                                            }
                                        }}
                                        className="bg-[#3399ff] hover:bg-blue-600 text-white px-4 py-1.5 text-sm rounded-full shadow transition-all duration-200"
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
                {portfolio.length > 0 && (
                    <div className="mt-4 rounded-3xl overflow-hidden text-white shadow-lg bg-[#162b4d] border border-[#1f3b66]">

                        {/* Header trắng nằm trên cùng */}
                        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] px-6 py-3">
                            <h2 className="text-xl text-center font-semibold text-white font-bold ">🌐 Market Overview</h2>
                            <p className="text-sm text-gray-400 text-center">
                                Total Market Cap: <span className="text-lg text-yellow-300 font-mono font-bold">${formatNumber(globalMarketCap)}</span>
                            </p>
                        </div>
                        {/* Nội dung bên trong card như cũ */}
                        <div className="p-6">
                            <div className="flex flex-col divide-y divide-[#2c4069] gap-4">
                                {topCoins.map((coin) => (
                                    <div
                                        key={coin.id}
                                        className="rounded-xl px-4 py-3 flex justify-between items-center"
                                    >
                                        <div className="flex items-center gap-3">
                                            <img src={coin.image} alt={coin.name} className="w-8 h-8 rounded-full" />
                                            <div>
                                                <p className="font-semibold text-white">{coin.name} ({coin.symbol.toUpperCase()})</p>
                                                <p className="text-sm text-gray-400">Market Cap: ${formatNumber(coin.market_cap)}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg text-yellow-300 font-mono">${formatCurrency(coin.current_price)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Luôn hiển thị bộ lọc nếu có dữ liệu */}
                {portfolio.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center text-white mt-4">
                        {/* Tạm thời ẩn chức năng filter vì không có nhiểu coin
                        <input
                            type="text"
                            placeholder="🔍 Search by coin name or symbol..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-[#0f1f3a] text-white placeholder-blue-200 px-4 py-2 rounded-xl shadow-inner w-full"
                        />
                        */}
                        <select
                            value={filterByProfit}
                            onChange={(e) => setFilterByProfit(e.target.value)}
                            className="bg-[#162b4d] text-white px-4 py-2 rounded-full shadow-inner border border-[#2c4069] focus:outline-none"
                        >
                            <option value="all">All</option>
                            <option value="profit">🟢 Profit</option>
                            <option value="loss">🔴 Loss</option>
                        </select>

                        <label className="flex items-center gap-2 text-sm text-blue-100 bg-[#162b4d] px-4 py-2 rounded-full shadow-inner border border-[#2c4069]">
                            <input
                                type="checkbox"
                                checked={includeSoldCoins}
                                onChange={(e) => setIncludeSoldCoins(e.target.checked)}
                                className="accent-yellow-400 w-4 h-4"
                            />
                            Include sold coins
                        </label>

                    </div>
                )}


                {/* phần còn lại giữ nguyên */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-4">
                    {filteredPortfolio.map((coin, index) => {
                        const netInvested = coin.total_invested - coin.total_sold;
                        const avgPrice = (netInvested > 0 && coin.total_quantity > 0)
                            ? (netInvested / coin.total_quantity)
                            : 0;
                        const profitLossPercentage = netInvested > 0
                            ? ((coin.profit_loss / netInvested) * 100).toFixed(1) + "%"
                            : coin.profit_loss > 0 ? "∞%" : "0%";

                        return (
                            <div key={index} // ✅ Thêm dòng này
                                className="w-full bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] border border-[#1f3b66] text-white  rounded-3xl p-6 scale-[1.02] 
  shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_8px_20px_rgba(0,0,0,0.4)]
  transition-all duration-300"
                            >
                                {/* Hint for mobile users */}
                                <div className="text-center text-xs text-gray-500 italic mb-2">
                                    (Tap any coin to view transaction details)
                                </div>
                                <div className="flex flex-col items-center justify-center mb-4" onClick={() => router.push(`/transactions?coin=${coin.coin_symbol}`)}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-400 text-sm">👉</span>
                                        {getCoinIcon(coin.coin_symbol)}
                                        <h2 className="text-lg font-bold text-yellow-400">{coin.coin_symbol.toUpperCase()}</h2>
                                    </div>
                                    <p className="text-sm text-gray-400">{coin.coin_name || ""}</p>
                                </div>

                                <div className="w-full text-center mb-4">
                                    <p className="text-sm text-blue-200 font-medium">Current Price - Avg. Buy Price</p>
                                    <p className="text-lg font-mono text-yellow-300">
                                        ${formatCurrency(coin.current_price)} <span className="text-white">-</span> ${avgPrice > 0 ? `${formatCurrency(avgPrice)}` : "–"}
                                    </p>

                                    {coin.is_fallback_price && (
                                        <p className="text-xs text-yellow-400 mt-1">
                                            ⚠️ Price will be updated in a few minutes. Using your buy price now.
                                        </p>
                                    )}
                                </div>


                                <div className="grid grid-cols-2 gap-x-6 gap-y-4 w-full px-2 md:px-6 text-center">
                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Total Quantity</p>
                                        <p className="text-lg font-mono text-white">{coin.total_quantity.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Total Invested</p>
                                        <p className="text-lg font-mono text-orange-400">${formatCurrency(coin.total_invested)}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹 Net Invested</p>
                                        <p className={`text-lg font-mono ${netInvested >= 0 ? "text-purple-400" : "text-green-300"}`}>${formatCurrency(netInvested)}</p>
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
                                            ${Math.round(coin.profit_loss).toLocaleString()}<span className="text-xs">({profitLossPercentage})</span>
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4 flex justify-center gap-4">
                                    <button
                                        onClick={() => handleOpenTradeModal(coin, "buy")}
                                        className="px-4 py-2 rounded-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm shadow transition-all duration-200"
                                    >
                                        Buy
                                    </button>


                                    <button
                                        onClick={() => coin.total_quantity > 0 && handleOpenTradeModal(coin, "sell")}
                                        disabled={coin.total_quantity === 0}
                                        className={`px-4 py-2 rounded-full text-white text-sm shadow transition-all duration-200
        ${coin.total_quantity === 0
                                                ? "bg-gray-600 cursor-not-allowed"
                                                : "bg-red-600 hover:bg-red-700 active:bg-red-800"}
    `}
                                    >
                                        Sell
                                    </button>



                                </div>

                            </div>
                        );
                    })}
                </div>
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
