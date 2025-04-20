// pages/tv-dashboard.js
import Navbar from "../components/Navbar";
import { ResponsiveContainer, RadialBarChart, RadialBar, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

const samplePortfolio = [
  { name: "BTC", value: 32000, fill: "#10b981" },
  { name: "ETH", value: 15000, fill: "#3b82f6" },
  { name: "NEAR", value: 8000, fill: "#a855f7" },
];

const sampleBarData = [
  { name: "Jan", income: 5000, expense: 3000 },
  { name: "Feb", income: 6000, expense: 2500 },
  { name: "Mar", income: 4000, expense: 3200 },
  { name: "Apr", income: 8000, expense: 200 },
  { name: "May", income: 5000, expense: 100 },
  { name: "Jun", income: 10000, expense: 1000 },
  { name: "Jul", income: 9000, expense: 3200 },
];

export default function TVDashboard() {
  return (
    <div className="bg-gradient-to-br from-[#0a0f1c] via-[#050b18] to-[#020510] min-h-screen text-white font-mono p-4">
      <Navbar />

      <h1 className="text-2xl font-bold text-cyan-300 text-center mt-4 mb-6 uppercase tracking-widest">📊 Real-time TV Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Biểu đồ bán nguyệt - phân bổ danh mục */}
        <div className="bg-[#10192b] border border-cyan-400/30 shadow-lg shadow-cyan-400/10 rounded-xl p-4">
          <h2 className="text-yellow-300 text-sm uppercase mb-2">Portfolio Allocation</h2>
          <ResponsiveContainer width="100%" height={240}>
            <RadialBarChart innerRadius="60%" outerRadius="100%" data={samplePortfolio} startAngle={180} endAngle={0}>
              <RadialBar minAngle={15} background clockWise dataKey="value" />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>

        {/* Biểu đồ cột thu/chi */}
        <div className="bg-[#10192b] border border-yellow-400/30 shadow-lg shadow-yellow-400/10 rounded-xl p-4">
          <h2 className="text-yellow-300 text-sm uppercase mb-2">Monthly Cash Flow</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sampleBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
              <Legend />
              <Bar dataKey="income" fill="#10b981" />
              <Bar dataKey="expense" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tổng kết bên dưới */}
      <div className="mt-10 flex flex-col md:flex-row justify-around items-center text-sm text-white gap-6">
        <div className="text-green-400">💰 Total Invested: <span className="font-bold">$52,000</span></div>
        <div className="text-blue-400">📊 Current Value: <span className="font-bold">$68,000</span></div>
        <div className="text-yellow-300">📈 Profit: <span className="font-bold">+$16,000</span></div>
      </div>
    </div>
  );
}
