import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { ResponsiveContainer, RadialBarChart, RadialBar } from "recharts";
import CountUp from "react-countup";



const SwipeDashboard = ({
    portfolio,
    totalCurrentValue,
    totalProfitLoss,
    totalNetInvested,
    coinIcons,
    lastUpdated,
    onSlideChange }) => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [direction, setDirection] = useState('left');


    const handleSwipe = (direction) => {
        const totalSlides = 2;
        let newSlide;

        if (direction === "left") {
            newSlide = (currentSlide + 1) % totalSlides;
        } else if (direction === "right") {
            newSlide = (currentSlide - 1 + totalSlides) % totalSlides;
        } else {
            newSlide = currentSlide;
        }

        if (newSlide !== currentSlide) {
            setDirection(direction);
            setCurrentSlide(newSlide);
            if (onSlideChange) {
                onSlideChange(newSlide);
            }
        }
    };
    // Ngưỡng % để gộp coin nhỏ
    const threshold = 0.5;

    // Tính lại danh sách coins sau khi gộp
    const processedPortfolio = (() => {
        let othersValue = 0;
        const majorCoins = [];

        portfolio.forEach((coin) => {
            const percent = totalCurrentValue > 0
                ? (coin.current_value / totalCurrentValue) * 100
                : 0;

            if (percent >= threshold) {
                majorCoins.push({ ...coin, percent });
            } else {
                othersValue += coin.current_value;
            }
        });

        if (othersValue > 0) {
            majorCoins.push({
                coin_symbol: "OTHERS",
                current_value: othersValue,
                profit_loss: 0, // hoặc giữ giá trị nếu muốn
                percent: totalCurrentValue > 0 ? (othersValue / totalCurrentValue) * 100 : 0
            });
        }

        return majorCoins.sort((a, b) => b.percent - a.percent);
    })();
    const getProfitLossColor = (coin) => {
        const netInvested = coin.total_invested - coin.total_sold;
        const percent = netInvested > 0 ? (coin.profit_loss / netInvested) * 100 : 0;

        if (percent >= 0) {
            const lightness = Math.max(30, 70 - percent); // lời càng nhiều → màu xanh càng đậm
            return `hsl(140, 70%, ${lightness}%)`;
        } else {
            const lightness = Math.max(30, 70 + percent); // lỗ càng nhiều → màu đỏ càng đậm
            return `hsl(0, 70%, ${lightness}%)`;
        }
    };
    const colorPalette = [
        "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0",
        "#9966FF", "#FF9F40", "#00C49F", "#FF4444", "#8884d8", "#00BFFF"
    ];

    const getColorByIndex = (index) => colorPalette[index % colorPalette.length];

    return (
        <div className="relative w-full h-80 overflow-hidden rounded-xl ">
            <AnimatePresence initial={false} mode="wait">
                {currentSlide === 0 && (
                    <motion.div
                        key="slide-0"
                        className="absolute top-0 left-0 w-full h-full"
                        initial={{ x: direction === "left" ? 300 : -300, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: direction === "left" ? -300 : 300, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={(e, info) => {
                            if (info.offset.x < -100) handleSwipe("left");
                            if (info.offset.x > 100) handleSwipe("right");
                        }}
                    >
                        <div className="h-full w-full flex flex-col items-center justify-center text-white rounded-xl shadow-lg px-4 py-2">
                            <div className="relative w-full h-80">
                                {/* Tính dữ liệu biểu đồ */}
                                {(() => {
                                    const colorPalette = [
                                        "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0",
                                        "#9966FF", "#FF9F40", "#00C49F", "#FF4444", "#8884d8", "#00BFFF"
                                    ];
                                    const getColorByIndex = (i) => colorPalette[i % colorPalette.length];
                                    const totalValue = portfolio.reduce((sum, c) => sum + c.current_value, 0);

                                    const radialData = portfolio
                                        .filter(coin => coin.total_quantity > 0)
                                        .map((coin, i) => {
                                            const net = coin.total_invested - coin.total_sold;
                                            const percentHold = totalValue > 0 ? (coin.current_value / totalValue) * 100 : 0;
                                            const percentProfit = net > 0 ? (coin.profit_loss / net) * 100 : 0;
                                            return {
                                                name: coin.coin_symbol,
                                                value: coin.current_value,
                                                fill: getColorByIndex(i),
                                                holdPercent: percentHold.toFixed(1),
                                                profitPercent: percentProfit.toFixed(1),
                                            };
                                        });

                                    return (
                                        <>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <RadialBarChart
                                                    innerRadius="70%"
                                                    outerRadius="100%"
                                                    data={radialData}
                                                    startAngle={180}
                                                    endAngle={0}
                                                >
                                                    <RadialBar minAngle={15} background clockWise dataKey="value" />
                                                </RadialBarChart>
                                            </ResponsiveContainer>

                                            {/* Total P/L hiển thị ở giữa */}
                                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                                <p
                                                    className={`text-3xl font-bold font-mono flex items-center justify-center gap-1 ${totalProfitLoss >= 0 ? "text-green-400" : "text-red-400"
                                                        }`}
                                                >
                                                    $
                                                    <CountUp
                                                        key={totalProfitLoss}
                                                        end={Math.round(totalProfitLoss)}
                                                        duration={10}
                                                        separator=","
                                                    />
                                                </p>
                                                <p
                                                    className={`text-sm flex items-center justify-center gap-1 ${totalProfitLoss >= 0 ? "text-green-400" : "text-red-400"
                                                        }`}
                                                >
                                                    (
                                                    <CountUp
                                                        key={totalProfitLoss + "-" + totalNetInvested}
                                                        end={
                                                            parseFloat(
                                                                (Math.abs(totalNetInvested) > 0
                                                                    ? (totalProfitLoss / Math.abs(totalNetInvested)) * 100
                                                                    : 0
                                                                )
                                                            )
                                                        }
                                                        duration={10}
                                                        decimals={1}
                                                    />
                                                    %
                                                    {totalProfitLoss >= 0 ? "▲" : "▼"})
                                                </p>
                                                <p className="text-sm text-gray-400 flex items-center justify-center gap-1">
                                                    {(() => {
                                                        const ratio =
                                                            Math.abs(totalNetInvested) > 0
                                                                ? totalProfitLoss / Math.abs(totalNetInvested)
                                                                : 0;
                                                        if (ratio > 0.5) return "🤑";
                                                        if (ratio > 0.1) return "😎";
                                                        if (ratio > 0) return "🙂";
                                                        if (ratio > -0.1) return "😕";
                                                        if (ratio > -0.5) return "😢";
                                                        return "😭";
                                                    })()}{" "}
                                                    Total Profit / Loss
                                                </p>
                                            </div>

                                            {/* Legend bên dưới biểu đồ */}
                                            <div className="mt-4 space-y-2 text-sm text-white max-h-[160px] overflow-y-auto">
                                                {radialData.map((coin, index) => (
                                                    <div key={index} className="flex items-center gap-2">
                                                        <div
                                                            className="w-3 h-3 rounded-full"
                                                            style={{ backgroundColor: coin.fill }}
                                                        ></div>
                                                        <span className="font-semibold">{coin.name}</span>
                                                        <span className="text-gray-400 ml-auto">
                                                            💼 {coin.holdPercent}%
                                                            {parseFloat(coin.profitPercent) !== 0 && (
                                                                <span
                                                                    className={`ml-1 ${coin.profitPercent >= 0
                                                                            ? "text-green-400"
                                                                            : "text-red-400"
                                                                        }`}
                                                                >
                                                                    ({coin.profitPercent}%)
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* Dòng tổng đầu tư + giá trị hiện tại */}
                            <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-x-12 text-sm text-gray-300">
                                <div className="flex flex-col items-center">
                                    <span className="font-bold text-gray-400">💰 Invested</span>
                                    <p className="font-bold text-green-400 text-xl">
                                        ${Math.round(totalNetInvested).toLocaleString()}
                                    </p>
                                </div>
                                <div className="flex flex-col items-center">
                                    <span className="font-bold text-gray-400">📊 Current Value</span>
                                    <p className="font-bold text-blue-400 text-xl">
                                        $
                                        <CountUp
                                            key={totalCurrentValue}
                                            end={Math.round(totalCurrentValue)}
                                            duration={10}
                                            separator=","
                                        />
                                    </p>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                {currentSlide === 1 && (
                    <motion.div
                        key="slide-1"
                        className="absolute top-0 left-0 w-full h-full"
                        initial={{ x: direction === 'left' ? 300 : -300, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: direction === 'left' ? -300 : 300, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={(e, info) => {
                            if (info.offset.x < -100) handleSwipe("left");
                            if (info.offset.x > 100) handleSwipe("right");
                        }}
                    >
                        <div className="h-full w-full flex flex-col items-center justify-center  text-white p-4">
                            <h2 className="text-2xl font-bold text-yellow-400 mb-3">📈 Portfolio Allocation</h2>

                            {/* Vertical Bars */}
                            {/* Nếu chỉ có 1 coin → show đơn giản */}
                            {processedPortfolio.length === 1 ? (
                                <div className="flex flex-col items-center justify-center text-yellow-300 mt-6">
                                    <p className="text-lg font-bold">💼 100% in {processedPortfolio[0].coin_symbol.toUpperCase()}</p>
                                </div>
                            ) : (
                                <>
                                    {/* Biểu đồ dạng cột giới hạn chiều cao */}
                                    <div className="flex items-end justify-center gap-3 w-full min-h-[240px] h-[200px] md:h-[240px] overflow-y-visible pt-6">
                                        {processedPortfolio.map((coin, index) => {
                                            const height = Math.min(coin.percent * 2.5, 160); // giới hạn max 160px
                                            return (
                                                <div key={index} className="flex flex-col items-center w-10">
                                                    {/* Thêm phần trăm lời/lỗ trên đầu */}
                                                    <span className={`mb-1 text-[11px] font-mono ${coin.profit_loss >= 0 ? "text-green-400" : "text-red-400"}`}>
                                                        {(coin.total_invested - coin.total_sold) > 0
                                                            ? `${((coin.profit_loss / (coin.total_invested - coin.total_sold)) * 100).toFixed(1)}%`
                                                            : coin.profit_loss > 0 ? "∞%" : "0%"}
                                                    </span>

                                                    <div
                                                        className="w-3 rounded-t"
                                                        style={{
                                                            height: `${height}px`,
                                                            minHeight: '8px',
                                                            backgroundColor: getProfitLossColor(coin),
                                                        }}
                                                    />

                                                    <span className="mt-1 text-[11px] text-white">{coin.coin_symbol.toUpperCase()}</span>
                                                    <span className="text-[10px] text-yellow-300">{coin.percent.toFixed(1)}%</span>
                                                </div>
                                            );

                                        })}
                                    </div>
                                </>
                            )}

                            {/* Legend */}
                            {processedPortfolio.length > 1 && (
                                <div className="flex justify-center items-center gap-4 mt-4 text-xs font-mono flex-wrap">
                                    <div className="flex items-center gap-1">
                                        <div className="w-3 h-3 rounded bg-green-500" />
                                        <span>Profit</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <div className="w-3 h-3 rounded bg-red-500" />
                                        <span>Loss</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <div className="w-3 h-3 rounded bg-yellow-300" />
                                        <span>% of Portfolio</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}

            </AnimatePresence>
        </div>
    );
};

export default SwipeDashboard;
