import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function SalonOwnerDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [chartData, setChartData] = useState(null);
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    setTimeout(() => {
      setStats({
        todayRevenue: 820,
        activeStaff: 4,
        idleStaff: 2,
      });

      setChartData({
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        datasets: [
          {
            label: "Revenue",
            data: [200, 420, 300, 500, 620, 350, 280],
            backgroundColor: "#facc15",
            borderRadius: 8,
            barThickness: 30,
          },
        ],
      });

      setEmployees([
        { name: "Alice", status: "busy" },
        { name: "Bob", status: "idle" },
        { name: "Charlie", status: "busy" },
        { name: "Diana", status: "idle" },
      ]);

      setLoading(false);
    }, 1000);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-8 text-gray-800 dark:text-gray-100">
      <Navbar />
      <div className="max-w-6xl mx-auto space-y-10">
        <h1 className="text-3xl font-extrabold text-center text-emerald-700 dark:text-emerald-300">
          💼 Salon Dashboard
        </h1>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <StatCard
            title="💰 Today's Revenue"
            value={
              stats.todayRevenue !== undefined
                ? `$${stats.todayRevenue.toLocaleString()}`
                : "N/A"
            }
          />
          <StatCard title="👩‍🔧 Active Staff" value={stats.activeStaff ?? "N/A"} />
          <StatCard title="🛋️ Idle Staff" value={stats.idleStaff ?? "N/A"} />
        </div>

        {/* Revenue Chart */}
        <div className="glass-box">
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-yellow-300 mb-4">
            📊 Weekly Revenue
          </h2>
          {chartData && (
            <Bar
              data={chartData}
              options={{
                responsive: true,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `$${ctx.raw.toLocaleString()}`,
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (val) => `$${val}`,
                      color: "#666",
                    },
                    grid: { color: "#ddd" },
                  },
                  x: {
                    ticks: { color: "#666" },
                    grid: { display: false },
                  },
                },
              }}
            />
          )}
        </div>

        {/* Staff Section */}
        <div className="glass-box">
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-yellow-300 mb-4">
            🧑‍🤝‍🧑 Staff Status
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {employees.map((emp, i) => (
              <div
                key={i}
                className="flex justify-between items-center p-4 rounded-xl bg-white/20 dark:bg-white/5 backdrop-blur-md border border-white/20"
              >
                <span className="font-semibold">{emp.name}</span>
                <span
                  className={`text-xs px-3 py-1 rounded-full font-semibold ${
                    emp.status === "busy"
                      ? "bg-green-600 text-white"
                      : "bg-gray-500 text-white"
                  }`}
                >
                  {emp.status === "busy" ? "🟢 Busy" : "⚪ Idle"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ✅ Glass card
function StatCard({ title, value }) {
  return (
    <div className="glass-box text-center">
      <h3 className="text-emerald-700 dark:text-yellow-300 text-sm font-semibold mb-2">
        {title}
      </h3>
      <p className="text-2xl font-bold text-gray-800 dark:text-white">{value}</p>
    </div>
  );
}
