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

        const absNum = Math.abs(num);
        let formatted;

        if (absNum >= 1) {
            formatted = absNum.toLocaleString(undefined, { maximumFractionDigits: 2 });
        } else if (absNum >= 0.01) {
            formatted = absNum.toFixed(4);
        } else if (absNum >= 0.0001) {
            formatted = absNum.toFixed(6);
        } else {
            formatted = absNum.toFixed(8);
        }

        return `${num < 0 ? "-" : ""}${options.prefix}${formatted}`;
    };
    const formatLastUpdatedDuration = (timestamp) => {
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffMin = Math.floor(diffMs / 60000);

        if (diffMin >= 1440) { // > 24 giờ
            const days = Math.floor(diffMin / 1440);
            return `${days} day${days > 1 ? "s" : ""} ago`;
        } else if (diffMin >= 60) {
            const hours = Math.floor(diffMin / 60);
            return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        } else {
            return `${diffMin} min ago`;
        }
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
    const [showAllCoins, setShowAllCoins] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [hasRawPortfolioData, setHasRawPortfolioData] = useState(false);
    const [isReadyToRender, setIsReadyToRender] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const intervalRef = useRef(null);
    const router = useRouter();
    //const baseUrl = "http://192.168.1.58:5000"; // 🔁 đổi thành domain backend của Hiền
    const baseUrl = "https://crypto-manager-backend.onrender.com"

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
        const prices = {};

        try {
            const query = symbols.join(",");
            const res = await fetch(`${baseUrl}/api/price?symbols=${query}`);
            if (!res.ok) throw new Error("Price fetch failed");

            const data = await res.json(); // { BTC: 72800, NEAR: 7.3 }

            symbols.forEach(symbol => {
                const upper = symbol.toUpperCase();
                const price = data[upper];

                if (price && price > 0) {
                    // ✅ Giá hợp lệ → dùng
                    prices[upper] = price;
                    localStorage.setItem("price_" + upper, price); // cập nhật cache
                    localStorage.setItem("price_" + upper + "_updated", Date.now().toString());
                } else {
                    // ⚠️ Giá không có hoặc = 0 → thử lấy cache
                    const cached = localStorage.getItem("price_" + upper);
                    prices[upper] = cached ? parseFloat(cached) : 0;
                }
            });

            return prices;
        } catch (e) {
            console.warn("⚠️ Price fetch failed – fallback to cache", e.message);
            symbols.forEach(symbol => {
                const upper = symbol.toUpperCase();
                const cached = localStorage.getItem("price_" + upper);
                prices[upper] = cached ? parseFloat(cached) : 0;
            });
            return prices;
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
                fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1")
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
    const checkIfHasTransactions = async (uid) => {
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) return false;

            const idToken = await user.getIdToken();

            const response = await fetch(`${baseUrl}/api/transactions`, {
                headers: {
                    Authorization: `Bearer ${idToken}`
                }
            });

            if (!response.ok) throw new Error("Failed to fetch transactions");

            const data = await response.json();
            return data && data.length > 0;
        } catch (error) {
            console.error("⚠️ checkIfHasTransactions error:", error.message || error);
            return false;
        }
    };

    useEffect(() => {
        const unsubscribe = getAuth().onAuthStateChanged(async (user) => {
            if (!user) {
                router.push("/login");
                return;
            }

            const uid = user.uid;

            // Reset filter
            setSearchTerm("");
            setFilterByProfit("all");
            setIncludeSoldCoins(false);

            const hasTx = await checkIfHasTransactions(uid);

            if (!hasTx) {
                setPortfolio([]);
                setHasRawPortfolioData(false);
                setFirstLoaded(true);
                setIsReadyToRender(true);
                setLoading(false);
            } else {
                const cached = localStorage.getItem(`portfolio_${uid}`);
                const cachedTime = localStorage.getItem(`lastUpdated_${uid}`);

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

                fetchPortfolioWithRetry(uid);
                fetchMarketData(true);

                if (!intervalRef.current) {
                    intervalRef.current = setInterval(() => {
                        fetchPortfolioWithRetry(uid);
                        fetchMarketData(false);
                    }, 300000);
                }
            }
        });

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            unsubscribe(); // cleanup listener
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

            const response = await fetch(`${baseUrl}/api/portfolio`, {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            if (!response.ok) throw new Error("Failed to fetch portfolio");

            const data = await response.json();
            // ✅ Nếu user chưa có giao dịch, dừng tại đây, KHÔNG cần gọi API giá
            if (!data.portfolio || data.portfolio.length === 0) {
                setHasRawPortfolioData(false);
                setPortfolio([]);
                setFirstLoaded(true);
                setLoading(false);
                setIsReadyToRender(true);
                setPriceFetchFailed(false); // ✅ Không hiển thị lỗi giá
                return;
            }

            setHasRawPortfolioData(true);  // ✅ Có dữ liệu giao dịch thực tế

            const symbols = data.portfolio.map(c => c.coin_symbol);

            const prices = await getCoinPrices(symbols);

            const updatedPortfolio = data.portfolio.map(c => {
                const symbol = c.coin_symbol.toUpperCase();
                const fetchedPrice = prices[symbol];
                const fallbackPrice = c.total_quantity > 0
                    ? (c.total_invested - c.total_sold) / c.total_quantity
                    : 0;

                const isFallback = !fetchedPrice || fetchedPrice === 0;
                //const finalPrice = isFallback ? fallbackPrice : fetchedPrice;
                const finalPrice = isFallback ? fallbackPrice : fetchedPrice;
                const lastUpdatedKey = "price_" + symbol + "_updated";
                const lastUpdated = localStorage.getItem(lastUpdatedKey);
                const currentValue = finalPrice * c.total_quantity;
                const netInvested = c.total_invested - c.total_sold;

                return {
                    ...c,
                    current_price: finalPrice,
                    current_value: currentValue,
                    profit_loss: currentValue - netInvested,
                    is_fallback_price: isFallback,
                    price_last_updated: lastUpdated ? parseInt(lastUpdated) : null,
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
                setFirstLoaded(true); // ✅ Đảm bảo tránh treo app
                setPriceFetchFailed(true);
            }
        } finally {
            setLoading(false); // ❗ luôn đảm bảo setLoading(false)
            setIsReadyToRender(true);
        }
    };

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
            await fetch(`${baseUrl}/api/transactions`, {
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

    if (!isReadyToRender) {
        return <LoadingScreen />;
    }

    const isEmptyPortfolioView =
        isReadyToRender &&
        !loading &&
        !hasRawPortfolioData && // 🔥 dùng đúng state xác định đã có giao dịch hay chưa
        firstLoaded;

    if (isEmptyPortfolioView) {
        return <EmptyPortfolioView />;
    }

    return (
        <div className="p-0 bg-[#1C1F26] text-white min-h-screen font-mono overflow-y-scroll scrollbar-hide">
            <Navbar />

            <div className="mt-4 grid grid-cols-1 gap-2 p-4 rounded-xl">
                {/* Modal */}
                {showModal && selectedCoin && (
                    <div className="fixed inset-0 bg-[#1C1F26] flex items-center justify-center z-50">
                        <div className="bg-[#1C1F26] max-w-md w-full mx-4 p-6 rounded-xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] text-white space-y-4 relative z-50">
                            <h2 className="text-xl font-bold text-yellow-400 text-center">
                                {tradeType === "buy" ? "➕ Buy" : "➖ Sell"} {selectedCoin.coin_symbol.toUpperCase()}
                            </h2>

                            <div className="relative w-full">
                                <label className="block text-sm text-gray-300 mb-1">Transaction Type</label>

                                <select
                                    value={tradeType}
                                    onChange={(e) => setTradeType(e.target.value)}
                                    className="bg-[#1C1F26] border border-gray-800 text-white rounded-xl px-4 py-2 w-full outline-none appearance-none pr-10 transition"
                                >
                                    <option value="buy">🟢 Buy</option>
                                    <option value="sell">🔴 Sell</option>
                                </select>

                                {/* Mũi tên canh giữa tuyệt đối */}
                                <div className="pointer-events-none absolute top-[2.4rem] right-4">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Quantity</label>
                                <input
                                    type="number"
                                    value={quantity}
                                    onChange={(e) => setQuantity(e.target.value)}
                                    placeholder="e.g., 100"
                                    className="w-full px-4 py-2 border border-gray-800 rounded-xl text-white outline-none transition"
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
                                    className="w-full px-4 py-2 border border-gray-800 rounded-xl text-white outline-none"
                                    step="any"
                                />
                            </div>

                            {formError && <p className="text-red-400 text-sm text-center">{formError}</p>}

                            <div className="flex justify-between gap-4 mt-2">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="w-1/2 px-4 py-2 rounded-xl bg-gray-600 hover:bg-gray-700 text-white text-sm shadow transition"
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </button>

                                <button
                                    onClick={handleConfirmTrade}
                                    disabled={isSubmitting}
                                    className={`w-1/2 px-4 py-2 rounded-xl text-white text-sm shadow transition
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
                    {!hasCache && priceFetchFailed && portfolio.length > 0 ? (
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
                                <div className="absolute bottom-2 w-full flex justify-center items-center gap-4 text-xs text-gray-400 z-10">
                                    <span>🕒 Last update: {lastUpdated}</span>
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
                                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[#1C1F26] shadow-[4px_2px_4px_#0b0f17,_-4px_-2px_4px_#1e2631]
    text-yellow-300 hover:bg-yellow-700 hover:text-white 
    transition duration-200 border border-[#1C1F26]"
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
                    <div className="mt-10 w-full max-w-[1200px] mx-auto rounded-xl overflow-hidden shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
                        {/* Header */}
                        <div className="bg-yellow-700 px-6 py-4 text-center">
                            <div className="flex justify-center items-center gap-2 text-white font-bold text-lg">
                                🌐 Market Overview
                            </div>
                            <p className="text-xs text-gray-300 mt-1">
                                Total Market Cap:{" "}
                                <span className="text-yellow-400 font-bold">${formatNumber(globalMarketCap)}</span>
                            </p>
                        </div>

                        {/* Danh sách top coin */}
                        <div className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] divide-y divide-white/5 p-4">
                            <AnimatePresence initial={false}>
                                {topCoins.slice(0, showAllCoins ? 10 : 5).map((coin) => (
                                    <motion.div
                                        key={coin.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={{ duration: 0.3 }}
                                        className="flex items-center text-sm justify-between rounded-lg px-4 py-4"
                                    >
                                        <div className="flex items-center gap-3">
                                            <img src={coin.image} className="w-8 h-8 rounded-full" alt={coin.name} />
                                            <div>
                                                <p className="text-white font-bold">
                                                    {coin.name} <span className="font-normal">({coin.symbol.toUpperCase()})</span>
                                                </p>
                                                <p className="text-xs text-gray-400">
                                                    Market Cap: ${formatNumber(coin.market_cap)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-yellow-300 font-semibold">
                                                ${formatCurrency(coin.current_price)}
                                            </p>
                                            <p
                                                className={`text-xs ${coin.price_change_percentage_24h >= 0 ? "text-green-400" : "text-red-400"
                                                    }`}
                                            >
                                                {coin.price_change_percentage_24h >= 0 ? "↑" : "↓"} {coin.price_change_percentage_24h.toFixed(2)}%
                                            </p>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                            {/* Nút Show More / Show Less */}
                            <div className="text-center mt-4">
                                <button
                                    onClick={() => setShowAllCoins(!showAllCoins)}
                                    className="text-yellow-300 hover:text-yellow-400 font-semibold text-sm transition"
                                >
                                    {showAllCoins ? "Show Less ▲" : "Show More ▼"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Luôn hiển thị bộ lọc nếu có dữ liệu */}
                {portfolio.length > 0 && (
                    <div className="w-full max-w-[1200px] mx-auto mt-6 px-6 py-4 bg-[#1C1F26] rounded-xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#262f3d] flex items-center gap-4">
                        <select
                            value={filterByProfit}
                            onChange={(e) => setFilterByProfit(e.target.value)}
                            className="bg-[#1C1F26] text-white rounded-xl px-4 py-2 text-sm outline-none"
                        >
                            <option value="all">📋 All</option>
                            <option value="profit">🟢 Profit</option>
                            <option value="loss">🔴 Loss</option>
                        </select>

                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={includeSoldCoins}
                                onChange={(e) => setIncludeSoldCoins(e.target.checked)}
                                className="accent-yellow-400 w-4 h-4"
                            />
                            Include sold
                        </label>
                    </div>


                )}


                {/* phần còn lại giữ nguyên */}
                <div className="w-full max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                    {filteredPortfolio.map((coin, index) => {
                        const netInvested = coin.total_invested - coin.total_sold;
                        const avgPrice = (netInvested > 0 && coin.total_quantity > 0)
                            ? (netInvested / coin.total_quantity)
                            : 0;
                        const profitLossPercentage = netInvested > 0
                            ? ((coin.profit_loss / netInvested) * 100).toFixed(1) + "%"
                            : coin.profit_loss > 0 ? "∞%" : "0%";
                        return (
                            <div key={index}
                                className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17]  
                                rounded-xl p-2 shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] 
                                transition-all hover:scale-[1.01]"
                            >
                                {/* Hint for mobile users */}
                                <div className="text-center text-[11px] text-gray-500 italic mb-2 mt-4">
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
                                    <p className="text-lg text-yellow-300">
                                        ${formatCurrency(coin.current_price)} <span className="text-white">-</span> ${avgPrice > 0 ? `${formatCurrency(avgPrice)}` : "–"}
                                    </p>

                                    {coin.is_fallback_price && (
                                        <p className="text-xs text-yellow-400 mt-1">
                                            ⚠️ Using fallback price (buy price).
                                        </p>
                                    )}

                                    {!coin.is_fallback_price &&
                                        coin.price_last_updated &&
                                        Math.abs(coin.current_price - parseFloat(localStorage.getItem("price_" + coin.coin_symbol.toUpperCase()))) < 0.000001 &&
                                        Math.round((Date.now() - coin.price_last_updated) / 60000) >= 1 && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                ⚠️ Last price from {formatLastUpdatedDuration(coin.price_last_updated)}
                                            </p>
                                        )}


                                </div>


                                <div className="grid grid-cols-2 gap-x-3 gap-y-4 w-full px-2 md:px-6 text-center">
                                    {/* Hàng 1 */}
                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹Total Quantity</p>
                                        <p className="text-lg text-white">{coin.total_quantity.toLocaleString()}</p>
                                    </div>

                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹Total Invested</p>
                                        <p className="text-lg text-orange-400">${formatCurrency(coin.total_invested)}</p>
                                    </div>

                                    {/* Hàng 2 */}
                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹Net Invested</p>
                                        <p className={`text-lg ${netInvested >= 0 ? "text-purple-400" : "text-green-300"}`}>
                                            ${formatCurrency(netInvested)}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1">🔹Current Value</p>
                                        <p className="text-lg text-blue-400">${Math.round(coin.current_value).toLocaleString()}</p>
                                    </div>

                                    {/* Hàng 3 - Profit / Loss */}
                                    <div className="col-span-2 border-t border-white/10 pt-2">
                                        <p className="text-sm text-gray-400 flex items-center justify-center gap-1 mt-2">
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
                                        <p className={`text-lg font-bold ${coin.profit_loss >= 0 ? "text-green-400" : "text-red-400"}`}>
                                            ${Math.round(coin.profit_loss).toLocaleString()}
                                            <span className="text-xs ml-1">({profitLossPercentage})</span>
                                        </p>
                                    </div>
                                </div>



                                <div className="mt-4 mb-4 flex justify-center gap-4">
                                    <button
                                        onClick={() => handleOpenTradeModal(coin, "buy")}
                                        className="px-4 py-2 min-w-[96px] rounded-3xl bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm transition-all duration-200"
                                    >
                                        Buy
                                    </button>


                                    <button
                                        onClick={() => coin.total_quantity > 0 && handleOpenTradeModal(coin, "sell")}
                                        disabled={coin.total_quantity === 0}
                                        className={`px-4 py-2 min-w-[96px] rounded-3xl text-white text-sm transition-all duration-200
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
