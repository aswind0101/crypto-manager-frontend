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
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import { useWakeLock } from "../hooks/useWakeLock";



function Dashboard() {
    useWakeLock();
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
            <img src={url} alt={symbol} className="w-12 h-12 object-contain rounded-full" />
        ) : (
            <FaCoins className="text-gray-500 text-2xl" />
        );
    };
    //Flip card
    const [expandedTypes, setExpandedTypes] = useState({});
    const [expandedMonths, setExpandedMonths] = useState({}); // { buy: { 'April 2025': true } }
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());


    const [flippedCoins, setFlippedCoins] = useState({});
    const toggleFlip = (symbol) => {
        setFlippedCoins((prev) => {
            const next = !prev[symbol];

            if (next) {
                // ✅ Khi flip sang mặt sau → mở sẵn BUY & SELL cho coin này
                setExpandedTypes((prevTypes) => ({
                    ...prevTypes,
                    [symbol]: { buy: true, sell: true },
                }));
            }

            return { ...prev, [symbol]: next };
        });
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
    const fetchCoinTargets = async (uid) => {
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) return;

            const idToken = await user.getIdToken();
            const res = await fetch(`${baseUrl}/api/coin-targets`, {
                headers: { Authorization: `Bearer ${idToken}` }
            });

            if (!res.ok) throw new Error("Failed to fetch targets");

            const data = await res.json(); // [{ coin_symbol: 'BTC', target_percent: 50 }, ...]

            data.forEach(item => {
                localStorage.setItem(`target_${item.coin_symbol.toUpperCase()}`, parseFloat(item.target_percent));
            });

        } catch (error) {
            console.warn("⚠️ Failed to fetch coin targets:", error.message);
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
                fetchCoinTargets(uid);

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
                const finalPrice = fetchedPrice && fetchedPrice > 0 ? fetchedPrice : fallbackPrice;
                const lastUpdatedKey = "price_" + symbol + "_updated";
                const lastUpdated = localStorage.getItem(lastUpdatedKey);
                const currentValue = finalPrice * c.total_quantity;
                const netInvested = c.total_invested - c.total_sold;

                // 👇 Ghép transaction gần nhất của coin này
                const recent_transactions = (data.transactions || [])
                    .filter(tx => tx.coin_symbol === c.coin_symbol)
                    .map(tx => ({
                        type: tx.transaction_type,
                        date: new Date(tx.transaction_date).toLocaleDateString(),
                        quantity: tx.quantity,
                        price: tx.price
                    }));

                return {
                    ...c,
                    current_price: finalPrice,
                    current_value: currentValue,
                    profit_loss: currentValue - netInvested,
                    is_fallback_price: !fetchedPrice,
                    price_last_updated: lastUpdated ? parseInt(lastUpdated) : null,
                    recent_transactions // 🆕 thêm vào
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
        .filter((coin) => {
            const matchesQty = includeSoldCoins || coin.total_quantity > 0;
            const matchesSearch = coin.coin_symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (coin.coin_name || "").toLowerCase().includes(searchTerm.toLowerCase());
            const matchesProfit =
                filterByProfit === "all" ||
                (filterByProfit === "profit" && coin.profit_loss >= 0) ||
                (filterByProfit === "loss" && coin.profit_loss < 0);

            return matchesQty && matchesSearch && matchesProfit;
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


    const setTargetForCoin = async (coinSymbol) => {
        const currentTarget = parseFloat(localStorage.getItem(`target_${coinSymbol.toUpperCase()}`)) || 0;
        const input = prompt(`🎯 Set target profit (%) for ${coinSymbol.toUpperCase()}`, currentTarget);

        if (input !== null && !isNaN(parseFloat(input))) {
            const newTarget = parseFloat(input);

            // 1️⃣ Lưu cache
            localStorage.setItem(`target_${coinSymbol.toUpperCase()}`, newTarget);

            // 2️⃣ Lưu database
            try {
                const auth = getAuth();
                const user = auth.currentUser;
                const idToken = await user.getIdToken();
                await fetch(`${baseUrl}/api/coin-targets/${coinSymbol}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`
                    },
                    body: JSON.stringify({ target_percent: newTarget })
                });
            } catch (err) {
                console.error("⚠️ Failed to update target:", err.message);
            }

            // 3️⃣ Re-render
            setPortfolio([...portfolio]);
        }
    };

    const getTargetPercent = (coin) => {
        return parseFloat(localStorage.getItem(`target_${coin.coin_symbol.toUpperCase()}`)) || 0;
    };

    const getRealProfitPercent = (coin) => {
        const netInvested = coin.total_invested - coin.total_sold;
        if (netInvested <= 0) return 0;
        return ((coin.profit_loss / netInvested) * 100).toFixed(1);
    };

    const getProfitEmoji = (coin) => {
        const percent = parseFloat(getRealProfitPercent(coin));

        if (percent >= 50) return "🤑";
        if (percent >= 20) return "😎";
        if (percent > 0) return "🙂";
        if (percent === 0) return "😐";
        if (percent > -20) return "😕";
        if (percent > -50) return "😢";
        return "😭";
    };

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
                                <div className="absolute bottom-2 w-full flex justify-center items-center gap-2 text-xs text-gray-400 z-10">
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
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-full shadow-[4px_2px_4px_#0b0f17,_-4px_-2px_4px_#1e2631]
                                            text-yellow-300 hover:bg-yellow-700 hover:text-white transition duration-200"
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
                    {filteredPortfolio.map((coin, index) => (
                        <div key={index} className="w-full min-h-[680px]">
                            <div className="relative perspective-[1500px] w-full h-full">
                                <div
                                    className={`transition-transform duration-700 ease-in-out transform-style-preserve-3d w-full min-h-[680px] ${flippedCoins[coin.coin_symbol] ? "rotate-y-180" : ""
                                        }`}
                                >
                                    {/* Mặt trước */}
                                    <div className="absolute inset-0 backface-hidden min-h-[680px] w-full rounded-xl overflow-hidden">
                                        <div className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17]
                                                rounded-xl p-2 shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]
                                                transition-all h-full flex flex-col space-y-4 pb-8 md:pb-10">
                                            <div className="text-center text-[11px] text-gray-500 italic">
                                                (Tap icon to view transaction detail)
                                            </div>

                                            <div className="flex flex-col items-center justify-center mt-2">
                                                <div className="relative group w-40 h-40 cursor-pointer" onClick={() => toggleFlip(coin.coin_symbol)}>
                                                    <CircularProgressbar
                                                        value={Math.abs(getRealProfitPercent(coin))}
                                                        maxValue={getTargetPercent(coin)}
                                                        styles={buildStyles({
                                                            pathColor: getRealProfitPercent(coin) >= 0 ? "#4ade80" : "#f87171",
                                                            textColor: "#facc15",
                                                            trailColor: "#2f374a",
                                                            textSize: "24px"
                                                        })}
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        {getCoinIcon(coin.coin_symbol)}
                                                    </div>
                                                </div>

                                                <div className="mt-4 text-center text-xs">
                                                    <button
                                                        className="text-yellow-300 hover:text-yellow-400 hover:underline"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTargetForCoin(coin.coin_symbol);
                                                        }}
                                                    >
                                                        🎯 Target: +{getTargetPercent(coin)}%
                                                    </button>
                                                    <div className="text-xs text-white mt-1">
                                                        📈 {getRealProfitPercent(coin)}%
                                                    </div>
                                                </div>

                                                <h2 className="text-4xl font-bold text-yellow-400 mt-4 tracking-wider">
                                                    {coin.coin_symbol.toUpperCase()}
                                                </h2>
                                            </div>

                                            <div className="w-full text-center">
                                                <p className="text-sm text-blue-200 font-medium">Current Price – Avg. Buy</p>
                                                <p className="text-lg text-yellow-300">
                                                    ${formatCurrency(coin.current_price)} – ${formatCurrency((coin.total_invested - coin.total_sold) / coin.total_quantity)}
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 w-full px-2 text-center text-sm">
                                                <div>
                                                    <p className="text-gray-400">🔹 Total Quantity</p>
                                                    <p className="text-white text-lg">{coin.total_quantity.toLocaleString()}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">🔹 Total Invested</p>
                                                    <p className="text-orange-400 text-lg">${formatCurrency(coin.total_invested)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">🔹 Net Invested</p>
                                                    <p className={`text-lg ${coin.total_invested - coin.total_sold >= 0 ? "text-purple-400" : "text-green-300"}`}>
                                                        ${formatCurrency(coin.total_invested - coin.total_sold)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">🔹 Current Value</p>
                                                    <p className="text-blue-400 text-lg">${Math.round(coin.current_value).toLocaleString()}</p>
                                                </div>
                                            </div>

                                            <div className="mt-2 mb-2 text-center border-t border-white/10 pt-2">
                                                <p className="text-sm text-gray-400 flex items-center justify-center gap-1">
                                                    <span className="text-xl">{getProfitEmoji(coin)}</span>
                                                    Profit / Loss
                                                </p>
                                                <p className={`flex items-baseline justify-center gap-2 font-bold ${coin.profit_loss >= 0 ? "text-green-400" : "text-red-400"}`}>
                                                    <span className="text-2xl">
                                                        ${Math.round(coin.profit_loss).toLocaleString()}
                                                    </span>
                                                    <span className="text-sm">
                                                        ({getRealProfitPercent(coin)}%)
                                                    </span>
                                                </p>
                                            </div>

                                            <div className="mt-auto mb-2 flex justify-center gap-4">
                                                <button
                                                    onClick={() => handleOpenTradeModal(coin, "buy")}
                                                    className="px-4 py-2 min-w-[96px] rounded-2xl bg-green-600 hover:bg-green-700 text-white text-sm"
                                                >
                                                    Buy
                                                </button>
                                                <button
                                                    onClick={() => coin.total_quantity > 0 && handleOpenTradeModal(coin, "sell")}
                                                    disabled={coin.total_quantity === 0}
                                                    className={`px-4 py-2 min-w-[96px] rounded-2xl text-white text-sm ${coin.total_quantity === 0 ? "bg-gray-600 cursor-not-allowed" : "bg-red-600 hover:bg-red-700"
                                                        }`}
                                                >
                                                    Sell
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Mặt sau */}
                                    <div className="absolute inset-0 rotate-y-180 backface-hidden min-h-[680px] w-full flex flex-col rounded-xl overflow-hidden">
                                        <div className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] text-white rounded-xl p-2 
                                            shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] flex flex-col items-center justify-center min-h-[680px]">
                                            <button
                                                onClick={() => router.push(`/transactions?coin=${coin.coin_symbol}`)}
                                                className="absolute bottom-4 left-4 text-xs text-gray-400 hover:text-yellow-400 
                                                font-semibold flex items-center gap-1 cursor-pointer"
                                            >
                                                <span>✏️</span>
                                                <span>Update Transactions</span>
                                            </button>

                                            <div className="absolute top-3 left-3">
                                                <select
                                                    className="bg-white/5 text-yellow-300 text-xs rounded-full px-2 py-1
                                                    shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]"
                                                    value={selectedYear}
                                                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                                >
                                                    {[
                                                        ...new Set(
                                                            coin.recent_transactions
                                                                .map((tx) => new Date(tx.date).getFullYear())
                                                                .sort((a, b) => b - a) // sắp xếp năm giảm dần
                                                        ),
                                                    ].map((year) => (
                                                        <option key={year} value={year}>
                                                            {year}
                                                        </option>
                                                    ))}

                                                </select>
                                            </div>

                                            <div className="mb-8 text-center">
                                                <h2 className="text-4xl font-bold text-yellow-400 tracking-widest">
                                                    {coin.coin_symbol.toUpperCase()}
                                                </h2>

                                            </div>
                                            {coin.recent_transactions && coin.recent_transactions.length > 0 ? (
                                                <div className="w-full text-xs font-mono space-y-4 max-h-[400px] overflow-y-auto pr-1">
                                                    <>
                                                        {["buy", "sell"].map((type) => {
                                                            const fullList = coin.recent_transactions.filter(tx => tx.type === type);
                                                            const list = fullList.filter(tx => {
                                                                const txYear = new Date(tx.date).getFullYear();
                                                                return txYear === selectedYear;
                                                            });

                                                            if (list.length === 0) return null;

                                                            const groupedByMonth = list.reduce((acc, tx) => {
                                                                const month = new Date(tx.date).toLocaleString("default", { month: "long" });
                                                                if (!acc[month]) acc[month] = [];
                                                                acc[month].push(tx);
                                                                return acc;
                                                            }, {});

                                                            const totalGroup = list.reduce(
                                                                (sum, tx) => sum + parseFloat(tx.price) * parseFloat(tx.quantity),
                                                                0
                                                            );

                                                            const isExpanded = expandedTypes?.[coin.coin_symbol]?.[type];

                                                            return (
                                                                <div key={type} className="rounded-lg">
                                                                    <button
                                                                        onClick={() =>
                                                                            setExpandedTypes((prev) => ({
                                                                                ...prev,
                                                                                [coin.coin_symbol]: {
                                                                                    ...(prev[coin.coin_symbol] || {}),
                                                                                    [type]: !prev?.[coin.coin_symbol]?.[type]
                                                                                }
                                                                            }))
                                                                        }
                                                                        className="flex items-center justify-between w-full text-left font-bold py-1 px-3 transition text-sm cursor-pointer"
                                                                    >
                                                                        <span className={`flex items-center gap-2 ${type === "buy" ? "text-green-400" : "text-red-400"}`}>
                                                                            {isExpanded ? "➖" : "➕"} {type.toUpperCase()} ({list.length})
                                                                        </span>
                                                                        <span className="text-yellow-300 font-mono">
                                                                            ${formatCurrency(totalGroup)}
                                                                        </span>
                                                                    </button>

                                                                    {isExpanded && (
                                                                        <div className="mt-2 px-3 pb-2 space-y-4">
                                                                            {Object.entries(groupedByMonth).map(([month, txs]) => {
                                                                                const isMonthOpen = expandedMonths?.[coin.coin_symbol]?.[type]?.[month];
                                                                                const totalMonth = txs.reduce(
                                                                                    (sum, tx) => sum + parseFloat(tx.price) * parseFloat(tx.quantity),
                                                                                    0
                                                                                );

                                                                                return (
                                                                                    <div key={month} className="space-y-2">
                                                                                        <button
                                                                                            onClick={() =>
                                                                                                setExpandedMonths((prev) => ({
                                                                                                    ...prev,
                                                                                                    [coin.coin_symbol]: {
                                                                                                        ...(prev[coin.coin_symbol] || {}),
                                                                                                        [type]: {
                                                                                                            ...(prev[coin.coin_symbol]?.[type] || {}),
                                                                                                            [month]: !prev?.[coin.coin_symbol]?.[type]?.[month],
                                                                                                        },
                                                                                                    },
                                                                                                }))
                                                                                            }
                                                                                            className="flex justify-between items-center w-full text-left px-3 py-4 mb-4 cursor-pointer bg-white/5
                                                                                                    shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] rounded-full font-semibold text-sm text-yellow-300"
                                                                                        >
                                                                                            <span className="flex items-center gap-2">
                                                                                                <span
                                                                                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-yellow-500 ${isMonthOpen ? "text-black" : "text-white"
                                                                                                        }`}
                                                                                                >
                                                                                                    {isMonthOpen ? "–" : "+"}
                                                                                                </span>
                                                                                                {month}
                                                                                            </span>
                                                                                            <span className={`font-mono ${type === "buy" ? "text-green-400" : "text-red-400"}`}>
                                                                                                ${formatCurrency(totalMonth)}
                                                                                            </span>
                                                                                        </button>

                                                                                        {isMonthOpen && (
                                                                                            <div className="space-y-2">
                                                                                                {txs.map((tx, idx) => {
                                                                                                    const total = parseFloat(tx.price) * parseFloat(tx.quantity);
                                                                                                    return (
                                                                                                        <div key={idx} className="px-3 py-2 border-t border-white/10 rounded-sm">
                                                                                                            <div className="flex justify-between items-center text-sm text-blue-300 mb-1">
                                                                                                                <span className="flex items-center gap-1">📅 {tx.date}</span>
                                                                                                                <div className={`text-sm font-semibold text-right ${type === "buy" ? "text-green-300" : "text-red-300"}`}>
                                                                                                                    💰 ${formatCurrency(total)}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                            <div className="pl-4 flex items-center gap-1 text-sm text-gray-400">
                                                                                                                ➤ ${formatCurrency(tx.price)} × {formatCurrency(tx.quantity)}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}

                                                        {/* ✅ Thêm thông báo nếu không có giao dịch nào cho năm đã chọn */}
                                                        {["buy", "sell"].every((type) => {
                                                            const txs = coin.recent_transactions.filter(tx =>
                                                                tx.type === type && new Date(tx.date).getFullYear() === selectedYear
                                                            );
                                                            return txs.length === 0;
                                                        }) && (
                                                                <p className="text-center text-sm text-gray-400 mt-6 italic">
                                                                    📭 No transactions found in {selectedYear}.
                                                                </p>
                                                            )}
                                                    </>
                                                </div>
                                            ) : (
                                                <p className="text-gray-400 text-sm text-center">No recent transactions</p>
                                            )}

                                            {/* Nút Back */}
                                            <div className="mt-6 mb-6 text-center">
                                                <button
                                                    onClick={() => toggleFlip(coin.coin_symbol)}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 active:scale-95 transition rounded-full text-sm text-black font-bold shadow-md"
                                                >
                                                    <span className="text-lg">↩</span> Back
                                                </button>
                                            </div>

                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    ))}

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
