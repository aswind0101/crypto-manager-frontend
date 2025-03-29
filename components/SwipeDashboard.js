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

    return (
        <div className="relative w-full h-80 overflow-hidden bg-black rounded-xl">
            <AnimatePresence initial={false} mode="wait">
                {currentSlide === 0 && (
                    <motion.div
                        key="slide-0"
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
                        <div className="h-full w-full flex flex-col items-center justify-center bg-black text-white">
                            <div className="relative w-full h-80">
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
                                            duration={10}
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
                            </div>
                            <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-x-12 text-sm text-gray-300">
                                <div className="flex flex-col items-center">
                                    <span className="font-bold text-gray-400">💰 Invested</span>
                                    <p className="font-bold text-green-400 text-xl">${Math.round(totalNetInvested).toLocaleString()}</p>
                                </div>
                                <div className="flex flex-col items-center">
                                    <span className="font-bold text-gray-400">📊 Current Value</span>
                                    <p className="font-bold text-blue-400 text-xl">$$<CountUp key={totalCurrentValue} end={Math.round(totalCurrentValue)} duration={10} separator="," /></p>

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
                        <div className="h-full w-full flex items-center justify-center bg-black text-white">
                            <div className="text-center w-full px-4 overflow-y-auto max-h-72">
                                <h2 className="text-lg font-bold mb-3 text-yellow-400">📊 Portfolio Allocation</h2>
                                <div className="space-y-3 text-left">
                                    {portfolio.map((coin) => {
                                        const percentage = totalCurrentValue > 0 ? (coin.current_value / totalCurrentValue) * 100 : 0;
                                        const barColor = coin.profit_loss >= 0 ? "bg-green-400" : "bg-red-400";
                                        return (
                                            <div key={coin.coin_symbol}>
                                                <div className="flex justify-between items-center mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <img src={coinIcons[coin.coin_symbol.toUpperCase()]} alt={coin.coin_symbol} className="w-5 h-5 rounded-full" />
                                                        <span className="font-semibold">{coin.coin_symbol.toUpperCase()}</span>
                                                    </div>
                                                    <span className="text-sm text-gray-300">{percentage.toFixed(1)}%</span>
                                                </div>
                                                <div className="w-full bg-gray-700 h-2 rounded">
                                                    <div className={`h-2 rounded ${barColor}`} style={{ width: `${percentage}%` }}></div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SwipeDashboard;
