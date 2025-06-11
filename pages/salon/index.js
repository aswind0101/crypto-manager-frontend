// pages/salon/index.js
import { useEffect, useState, useRef } from "react";
import Navbar from "../../components/Navbar";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";


export default function SalonDashboard() {
  const [user, setUser] = useState(null);
  const [freelancers, setFreelancers] = useState([]);
  const [appointmentsToday, setAppointmentsToday] = useState([]);
  const [nowServing, setNowServing] = useState([]);
  const [nextClients, setNextClients] = useState([]);
  const [revenueData, setRevenueData] = useState([]);
  const [currentNowSlide, setCurrentNowSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const auth = getAuth();
  const router = useRouter();
  const baseUrl = "https://crypto-manager-backend.onrender.com";

  // Helper: get freelancer info
  const getFreelancerInfo = (id) => freelancers.find(f => f.id === id) || {};

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.push("/login");
        return;
      }
      setUser(firebaseUser);

      try {
        const token = await firebaseUser.getIdToken();

        // Lấy freelancers (staff salon)
        const resFreelancers = await fetch(`${baseUrl}/api/freelancers/by-salon`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        let freelancersList = [];
        try {
          freelancersList = await resFreelancers.json();
        } catch { }
        setFreelancers(Array.isArray(freelancersList) ? freelancersList : []);

        // Lấy lịch hẹn hôm nay
        const todayStr = dayjs().format("YYYY-MM-DD");
        const resAppt = await fetch(`${baseUrl}/api/appointments/salon?date=${todayStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        let appointments = [];
        try {
          appointments = await resAppt.json();
        } catch { }
        setAppointmentsToday(Array.isArray(appointments) ? appointments : []);

        // Now serving: status=processing
        setNowServing(appointments.filter(a => a.status === "processing"));

        // Next Client: status=confirmed, chưa started
        setNextClients(appointments
          .filter(a => a.status === "confirmed" && !a.started_at)
          .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date))
        );

        // Revenue: 7 ngày gần nhất
        const from = dayjs().subtract(6, "day").format("YYYY-MM-DD");
        const to = todayStr;
        const resRev = await fetch(`${baseUrl}/api/appointments/salon/revenue?from=${from}&to=${to}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        let revenueArr = [];
        try {
          revenueArr = await resRev.json();
        } catch { }
        setRevenueData(Array.isArray(revenueArr) ? revenueArr.map(item => ({
          ...item,
          revenue: Number(item.revenue || 0),
          date: dayjs(item.date).format("MM-DD"),
        })) : []);

        setLoading(false);
      } catch (err) {
        setError("Failed to load data. Please try again.");
        setLoading(false);
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line
  }, []);
  const serviceIntervalRef = useRef({});
  const [serviceTimers, setServiceTimers] = useState({});

  useEffect(() => {
    // Lấy appointments đang "processing"
    const inProgress = nowServing.filter(a => a.status === "processing" && a.started_at);
    // Clear interval cũ
    Object.values(serviceIntervalRef.current).forEach(clearInterval);
    const timers = {};
    inProgress.forEach(appt => {
      const id = appt.id;
      timers[id] = dayjs().diff(dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss"), "second");
      serviceIntervalRef.current[id] = setInterval(() => {
        setServiceTimers(timers => ({
          ...timers,
          [id]: dayjs().diff(dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss"), "second"),
        }));
      }, 1000);
    });
    setServiceTimers(timers);
    return () => {
      Object.values(serviceIntervalRef.current).forEach(clearInterval);
      serviceIntervalRef.current = {};
    };
  }, [nowServing]);

  // Tổng tiền doanh thu hôm nay
  const todayRevenue = appointmentsToday.filter(a => a.status === "completed")
    .reduce((sum, a) => sum + (a.services?.reduce((s, srv) => s + (srv.price || 0), 0) || 0), 0);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading...</div>;
  if (error) return <div className="text-center text-red-500 py-8">{error}</div>;

  return (
    <div className="min-h-screen text-white px-4 py-6 bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] font-mono sm:font-['Pacifico', cursive]">
      <Navbar />
      <div className="max-w-6xl mx-auto p-2">

        {/* Tổng doanh thu hôm nay + biểu đồ */}
        <div className="flex flex-col md:flex-row gap-6 mb-4">
          <div className="flex-1 bg-gradient-to-r from-yellow-300 to-yellow-500 rounded-2xl p-6 flex flex-col items-center shadow-xl">
            <div className="text-lg text-pink-900 font-bold mb-1">Total Revenue Today</div>
            <div className="text-4xl font-extrabold text-emerald-700 drop-shadow">{todayRevenue.toLocaleString()}$</div>
            <div className="mt-2 text-yellow-900 font-semibold">
              Appointments: {appointmentsToday.length}
            </div>
          </div>
          {/* Biểu đồ doanh thu */}
          <div className="flex-1 bg-white/10 rounded-2xl p-6 shadow-xl min-h-[220px]">
            <h3 className="text-lg font-bold mb-2 text-yellow-300">Revenue by Day</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="revenue" fill="#facc15" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Appointments & Next Client: nằm cùng dòng trên desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-3">
          {/* Appointments Card */}
          <Card
            icon={<span className="text-3xl text-yellow-300">📅</span>}
            title="Appointments"
            value={
              <span>
                {appointmentsToday.filter(a => a.status !== "cancelled").length}
                <span className="ml-2 font-normal text-[16px]">Today</span>
              </span>
            }
            sub={
              <div className="flex flex-col gap-2 pl-2 text-sm">
                <span>✅ Completed: {appointmentsToday.filter(a => a.status === "completed").length}</span>
                <span>👩‍🔧 Serving: {appointmentsToday.filter(a => a.status === "processing").length}</span>
                <span>🟡 Pending: {appointmentsToday.filter(a => a.status === "pending").length}</span>
                <span>⏳ Upcoming: {appointmentsToday.filter(a => a.status === "confirmed" && !a.started_at).length}</span>
              </div>
            }
          />

          {/* Next Client Card */}
          <Card
            icon={<span className="text-3xl text-emerald-300">⏭️</span>}
            title="Next Client"
            value={
              nextClients.length > 0
                ? dayjs.utc(nextClients[0].appointment_date).format("hh:mm A")
                : "No upcoming"
            }
            sub={
              nextClients.length > 0 && (
                <div className="flex flex-col gap-2 p-2 rounded-xl w-full">
                  <div className="flex items-center gap-2 font-bold text-yellow-200 capitalize truncate">
                    <span className="text-pink-300">👤</span>
                    {nextClients[0].customer_name}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-emerald-300 capitalize truncate">
                    <span className="text-yellow-300">💇‍♀️</span>
                    {nextClients[0].services?.map(s => s.name).join(", ")}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-400">
                    <span className="text-blue-300">⏱</span>
                    <span>
                      Estimated Time: <span className="font-semibold text-emerald-200">
                        {nextClients[0].services?.reduce((sum, s) => sum + (s.duration || s.duration_minutes || 0), 0)} min
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">Staff:</span>
                    <span className="text-pink-200 font-semibold">
                      {getFreelancerInfo(nextClients[0].stylist_id).name || "Staff"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="text-gray-300">At: </span>
                    {dayjs.utc(nextClients[0].appointment_date).format("MMM D, hh:mm A")}
                  </div>
                </div>
              )
            }
          />

        </div>

        {/* Now Serving Card */}
        <div className="mt-6">
          <Card
            icon={<span className="text-3xl text-blue-300">🟢</span>}
            title="Now Serving"
            value=""
            sub={
              nowServing.length === 0 ? (
                <div className="text-gray-400">No staff currently serving.</div>
              ) : (
                <div className="flex flex-row gap-4 overflow-x-auto">
                  {nowServing.slice(currentNowSlide, currentNowSlide + 4).map((a, idx) => {
                    const emp = getFreelancerInfo(a.stylist_id);
                    return (
                      <div key={a.id} className="min-w-[220px] bg-gradient-to-br from-pink-400/70 via-emerald-300/60 to-yellow-100/60 rounded-2xl shadow-lg p-4 flex flex-col items-center mx-1">
                        <img src={emp.avatar_url || "/default-avatar.png"} className="w-14 h-14 rounded-full mb-1" alt={emp.name} />
                        <div className="font-bold text-base text-emerald-900">{emp.name || "Staff"}</div>
                        <div className="text-xs text-yellow-800">
                          Start: {a.started_at ? dayjs.utc(a.started_at).format("hh:mm A") : "--"}
                        </div>
                        <div className="text-xs text-pink-900">Client: {a.customer_name || "Customer"}</div>
                        <div className="text-xs text-gray-700 mb-1">
                          Services: {a.services?.map(s => s.name).join(", ")}
                        </div>
                        

                      </div>
                    );
                  })}
                  {nowServing.length > 4 && (
                    <div className="flex flex-col justify-center items-center ml-2">
                      <button onClick={() => setCurrentNowSlide(Math.max(0, currentNowSlide - 1))} className="mb-1">
                        <ChevronLeft />
                      </button>
                      <button onClick={() => setCurrentNowSlide(Math.min(nowServing.length - 4, currentNowSlide + 1))}>
                        <ChevronRight />
                      </button>
                    </div>
                  )}
                </div>
              )
            }
          />
        </div>


        {/* Quick Actions (bạn tuỳ chỉnh sau) */}
        <div className="col-span-12 mt-10">
          <h3 className="text-lg font-bold mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <ActionButton label="📅 Appointments" onClick={() => router.push("/salon/appointments")} />
            <ActionButton label="🧑‍💼 Staff" onClick={() => router.push("/salon/staff")} />
            <ActionButton label="💰 Revenue" onClick={() => router.push("/salon/revenue")} />
            <ActionButton label="⚙️ Settings" onClick={() => router.push("/salon/settings")} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Card component
function Card({ icon, title, value, sub, children, className = "" }) {
  return (
    <div className={`relative ${className} bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-2 border-b-2 border-pink-400 rounded-2xl shadow-lg p-5 transition-all mb-6`}>
      <div className="text-3xl text-yellow-300 mb-1">{icon}</div>
      <h4 className="text-lg font-bold text-pink-300">{title}</h4>
      <div className="text-xl font-extrabold text-white">{value}</div>
      <div className="text-sm text-white/80">{sub}</div>
      {children}
    </div>
  );
}

function ActionButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full py-3 rounded-2xl bg-gradient-to-r from-pink-600 via-yellow-500 to-emerald-500 text-white font-semibold shadow-md hover:scale-105 transition"
    >
      {label}
    </button>
  );
}
