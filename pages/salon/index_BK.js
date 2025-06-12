// pages/salon/index.js
import { useEffect, useState, useRef } from "react";
import Navbar from "../../components/Navbar";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);
dayjs.extend(timezone);

import { Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from "recharts";
import { ChevronLeft, ChevronRight, AlarmClock, TimerReset, LoaderCircle, RefreshCcw } from "lucide-react";
import {
  FiCalendar,
  FiClock,
  FiUser,
} from "react-icons/fi";

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
  const [isDesktop, setIsDesktop] = useState(false);

  const [processingApptId, setProcessingApptId] = useState(null);
  const [actionError, setActionError] = useState("");


  const [currentNowPage, setCurrentNowPage] = useState(0);
  const pageSize = 4;
  const totalPages = Math.ceil(nowServing.length / pageSize);

  // Index của khách đầu tiên trên trang hiện tại
  const pageStartIndex = currentNowPage * pageSize;
  const pageEndIndex = pageStartIndex + pageSize;

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
          date: dayjs(item.date, "YYYY-MM-DD HH:mm:ss").format("MM-DD"),
        })) : []);
        await fetchData(firebaseUser);
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
    const inProgress = nowServing.filter(a => a.status === "processing" && a.started_at);
    Object.values(serviceIntervalRef.current).forEach(clearInterval);
    const timers = {};
    inProgress.forEach(appt => {
      const id = appt.id;
      // Parse theo format giống freelancers/index, đảm bảo đúng giờ local
      const startedAt = dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss");
      timers[id] = dayjs().diff(startedAt, "second");
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const checkScreen = () => setIsDesktop(window.innerWidth >= 768);
      checkScreen();
      window.addEventListener("resize", checkScreen);
      return () => window.removeEventListener("resize", checkScreen);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchData(user);
    }, 60000); // 60000 ms = 1 phút
    return () => clearInterval(interval);
  }, [user]);


  const handleCompleteAppointment = async (appointmentId) => {
    setProcessingApptId(appointmentId);
    setActionError("");
    try {
      const token = await user.getIdToken();
      await fetch(`${baseUrl}/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: "completed",
          end_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        }),
      });
      // Sau khi complete, reload lại danh sách appointments
      // (bạn có thể extract hàm fetch lại appointments ở useEffect bên trên thành 1 hàm riêng để gọi lại ở đây)
      const todayStr = dayjs().format("YYYY-MM-DD");
      const resAppt = await fetch(`${baseUrl}/api/appointments/salon?date=${todayStr}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let appointments = [];
      try { appointments = await resAppt.json(); } catch { }
      setAppointmentsToday(Array.isArray(appointments) ? appointments : []);
      setNowServing(appointments.filter(a => a.status === "processing"));
      setNextClients(appointments
        .filter(a => a.status === "confirmed" && !a.started_at)
        .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date))
      );
    } catch (err) {
      setActionError("Error: Could not complete appointment. Please try again.");
    }
    setProcessingApptId(null);
  };

  const fetchData = async (firebaseUser) => {
    try {
      const token = await firebaseUser.getIdToken();

      // Lấy freelancers (staff salon)
      const resFreelancers = await fetch(`${baseUrl}/api/freelancers/by-salon`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let freelancersList = [];
      try { freelancersList = await resFreelancers.json(); } catch { }
      setFreelancers(Array.isArray(freelancersList) ? freelancersList : []);

      // Lấy lịch hẹn hôm nay
      const todayStr = dayjs().format("YYYY-MM-DD");
      const resAppt = await fetch(`${baseUrl}/api/appointments/salon?date=${todayStr}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let appointments = [];
      try { appointments = await resAppt.json(); } catch { }
      setAppointmentsToday(Array.isArray(appointments) ? appointments : []);
      setNowServing(appointments.filter(a => a.status === "processing"));
      setNextClients(appointments
        .filter(a => a.status === "confirmed" && !a.started_at)
        .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date))
      );

      // Lấy revenue 7 ngày gần nhất
      const from = dayjs().subtract(6, "day").format("YYYY-MM-DD");
      const to = todayStr;
      const resRev = await fetch(`${baseUrl}/api/appointments/salon/revenue?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let revenueArr = [];
      try { revenueArr = await resRev.json(); } catch { }
      setRevenueData(Array.isArray(revenueArr) ? revenueArr.map(item => ({
        ...item,
        revenue: Number(item.revenue || 0),
        date: dayjs(item.date).format("MM-DD"),
      })) : []);
    } catch (err) {
      setError("Failed to load data. Please try again.");
    }
  };

  // Tổng tiền doanh thu hôm nay
  const todayRevenue = appointmentsToday.filter(a => a.status === "completed")
    .reduce((sum, a) => sum + (a.services?.reduce((s, srv) => s + (srv.price || 0), 0) || 0), 0);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading...</div>;
  if (error) return <div className="text-center text-red-500 py-8">{error}</div>;

  return (
    <div className="min-h-screen text-white px-4 py-6 font-mono sm:font-['Pacifico', cursive]">
      <Navbar />
      <div className="max-w-6xl mx-auto p-2">

        {/* Tổng doanh thu hôm nay + biểu đồ */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 p-6 flex flex-col items-center">
            <div className="text-5xl font-extrabold text-emerald-500 drop-shadow">{todayRevenue.toLocaleString()}$</div>
            <div className="mt-2 text-yellow-600 text-sm">
              Appointments: {appointmentsToday.length}
            </div>
          </div>
        </div>

        {/* Appointments & Next Client: nằm cùng dòng trên desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2">
          {/* Appointments Card */}
          <Card
            icon={<FiCalendar />}
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
            icon={<FiClock />}
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
        <div className="mt-4 mb-8">
          <Card
            icon={<FiUser />}
            title={
              <div className="flex items-center gap-2">
                Now Serving
                <span className="inline-flex items-center justify-center bg-emerald-400 text-emerald-900 font-bold rounded-full text-xs ml-1 px-2 h-6 shadow">
                  {nowServing.length}
                </span>
              </div>
            }
            value=""
            sub={
              nowServing.length === 0 ? (
                <div className="text-gray-400">No staff currently serving.</div>
              ) : (
                <>
                  {/* MOBILE: 1 card/lần, mũi tên khi > 1 người */}
                  <div className="block md:hidden w-full relative">
                    <div className="mx-auto w-full p-6 flex flex-col items-center">
                      <img
                        src={getFreelancerInfo(nowServing[currentNowSlide]?.stylist_id)?.avatar_url || "/default-avatar.png"}
                        className="w-16 h-16 rounded-full mb-3"
                        alt={getFreelancerInfo(nowServing[currentNowSlide]?.stylist_id)?.name}
                      />
                      <div className="font-bold text-lg text-emerald-100 mb-1">
                        {getFreelancerInfo(nowServing[currentNowSlide]?.stylist_id)?.name || "Staff"}
                      </div>
                      <div className="text-sm text-yellow-400 mb-1">
                        Start: {nowServing[currentNowSlide]?.started_at ? dayjs(nowServing[currentNowSlide]?.started_at, "YYYY-MM-DD HH:mm:ss").format("hh:mm A") : "--"}
                      </div>
                      <div className="text-sm text-pink-200 mb-1">
                        Client: {nowServing[currentNowSlide]?.customer_name || "--"}
                      </div>
                      <div className="text-sm text-emerald-300 mb-1">
                        Services: {nowServing[currentNowSlide]?.services?.map(s => s.name).join(", ")}
                      </div>
                      <div className="text-sm text-emerald-400 mb-2 font-mono flex items-center justify-center gap-2">
                        <AlarmClock className="w-6 h-6 text-yellow-400 animate-spin-fast drop-shadow-lg " />
                        {formatSeconds(serviceTimers[nowServing[currentNowSlide]?.id])}
                      </div>
                      <button
                        className={`mt-2 w-full py-2 bg-gradient-to-r from-pink-500 via-yellow-400 to-emerald-400 hover:from-pink-600 text-white rounded-3xl font-bold shadow transition flex items-center justify-center gap-2
                          ${processingApptId === nowServing[currentNowSlide]?.id ? "opacity-60 cursor-not-allowed" : ""}
                        `}
                        disabled={processingApptId === nowServing[currentNowSlide]?.id}
                        onClick={() => handleCompleteAppointment(nowServing[currentNowSlide]?.id)}
                      >
                        {processingApptId === nowServing[currentNowSlide]?.id ? (
                          <>
                            <span className="animate-spin">⏳</span>
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <span>✅</span>
                            Complete
                          </>
                        )}
                      </button>
                      {actionError && <div className="text-xs text-red-400 mt-1">{actionError}</div>}
                    </div>
                    {nowServing.length > 1 && (
                      <div className="flex items-center justify-center gap-4 mt-4">
                        <button
                          className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-pink-300 shadow-md hover:bg-pink-500/80 transition"
                          onClick={() => setCurrentNowSlide(Math.max(0, currentNowSlide - 1))}
                          disabled={currentNowSlide === 0}
                        >
                          <ChevronLeft className="w-6 h-6" />
                        </button>
                        <span className="font-bold text-yellow-100 text-base">
                          {nowServing.length === 0 ? "0/0" : `${currentNowSlide + 1} / ${nowServing.length}`}
                        </span>
                        <button
                          className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-pink-300 shadow-md hover:bg-pink-500/80 transition"
                          onClick={() => setCurrentNowSlide(Math.min(nowServing.length - 1, currentNowSlide + 1))}
                          disabled={currentNowSlide === nowServing.length - 1}
                        >
                          <ChevronRight className="w-6 h-6" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* DESKTOP: 4 card/lần, mũi tên khi >4 người */}
                  <div className="hidden md:flex flex-col items-center w-full">
                    <div className="flex flex-row gap-4 items-center justify-center w-full">
                      {nowServing.slice(pageStartIndex, pageEndIndex).map((a, idx) => {
                        const emp = getFreelancerInfo(a.stylist_id);
                        return (
                          <div key={a.id} className="min-w-[220px] border-t-1 border-pink-400 rounded-2xl shadow-lg p-4 flex flex-col items-center mx-1">
                            <img src={emp.avatar_url || "/default-avatar.png"} className="w-14 h-14 rounded-full mb-1" alt={emp.name} />
                            <div className="font-bold text-base text-emerald-100">{emp.name || "Staff"}</div>
                            <div className="text-xs text-yellow-400">
                              Start: {a.started_at ? dayjs(a.started_at, "YYYY-MM-DD HH:mm:ss").format("hh:mm A") : "--"}
                            </div>
                            <div className="text-xs text-pink-200">Client: {a.customer_name || "Customer"}</div>
                            <div className="text-xs text-emerald-300 mb-1">
                              Services: {a.services?.map(s => s.name).join(", ")}
                            </div>
                            <div className="text-sm text-emerald-400 mb-2 font-mono flex items-center justify-center gap-2">
                              <AlarmClock className="w-6 h-6 text-yellow-400 animate-spin-fast drop-shadow-lg " />
                              {formatSeconds(serviceTimers[a.id])}
                            </div>

                            <button
                              className={`
                              mt-3 w-full py-2 bg-gradient-to-r from-pink-500 via-yellow-400 to-emerald-400
                              hover:from-emerald-400 hover:via-yellow-400 hover:to-pink-500
                              text-white rounded-3xl font-bold shadow-xl
                              transition-all duration-200 ease-in-out
                              flex items-center justify-center gap-2
                              hover:scale-105 hover:shadow-2xl hover:text-yellow-200
                              active:scale-95
                              ${processingApptId === a.id ? "opacity-60 cursor-not-allowed" : ""}
                            `}
                              disabled={processingApptId === a.id}
                              onClick={() => handleCompleteAppointment(a.id)}
                            >
                              {processingApptId === a.id ? (
                                <>
                                  <span className="animate-spin">⏳</span>
                                  <span>Processing...</span>
                                </>
                              ) : (
                                <>
                                  <span>✅</span>
                                  Complete
                                </>
                              )}
                            </button>
                            {actionError && processingApptId === a.id && (
                              <div className="text-xs text-red-400 mt-1">{actionError}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Pagination dưới cùng, căn giữa */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-6 mt-4 mb-2">
                        <button
                          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-pink-300 shadow-lg hover:bg-pink-500/80 transition disabled:opacity-40"
                          onClick={() => setCurrentNowPage(Math.max(0, currentNowPage - 1))}
                          disabled={currentNowPage === 0}
                        >
                          <ChevronLeft className="w-6 h-6" />
                        </button>
                        <span className="font-bold text-yellow-100 text-lg select-none tracking-wide drop-shadow">
                          {`${currentNowPage + 1} / ${totalPages}`}
                        </span>
                        <button
                          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-pink-300 shadow-lg hover:bg-pink-500/80 transition disabled:opacity-40"
                          onClick={() => setCurrentNowPage(Math.min(totalPages - 1, currentNowPage + 1))}
                          disabled={currentNowPage + 1 >= totalPages}
                        >
                          <ChevronRight className="w-6 h-6" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )
            }
          />
        </div>
        {/* Biểu đồ doanh thu theo ngày */}
        <div className="flex-1 rounded-2xl border-t-2 border-pink-400 p-4 shadow-xl min-h-[220px] flex flex-col">
          <h3 className="text-lg font-bold mb-2 text-yellow-300">Revenue by Day</h3>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={revenueData} barCategoryGap="20%" barGap={2} margin={{ top: 32, right: 12, left: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke="#eee" fontSize={13} />
              <YAxis stroke="#eee" fontSize={13} tickFormatter={v => v.toLocaleString()} />
              <Tooltip
                cursor={{ fill: "#eab30822" }}
                contentStyle={{ background: "#1e293b", border: "none", borderRadius: 10, color: "#fff" }}
                formatter={v => [`${v.toLocaleString()}$`, "Revenue"]}
              />
              <Bar
                dataKey="revenue"
                fill="url(#revenueGradient)"
                radius={[10, 10, 0, 0]}
                minPointSize={3}
              >
                <LabelList dataKey="revenue" position="top"
                  formatter={v => `${v > 0 ? v.toLocaleString() + "$" : ""}`}
                  style={{ fill: "#fde68a", fontWeight: 700, fontSize: 13, textShadow: "0 1px 6px #0009" }}
                />
              </Bar>
              {/* Gradient màu cột */}
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#facc15" />
                  <stop offset="100%" stopColor="#a7f3d0" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
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
    <div className={`relative ${className} border-t-2 border-b-2 border-pink-400 rounded-2xl shadow-lg p-4 sm:p-5 mb-3 transition-all`}>
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

function formatSeconds(sec) {
  if (sec == null) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}