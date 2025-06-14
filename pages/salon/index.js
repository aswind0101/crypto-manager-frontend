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
  const [nextClientIndex, setNextClientIndex] = useState(0);

  const [currentNowPage, setCurrentNowPage] = useState(0);
  const pageSize = 4;
  const totalPages = Math.ceil(nowServing.length / pageSize);

  // Index của khách đầu tiên trên trang hiện tại
  const pageStartIndex = currentNowPage * pageSize;
  const pageEndIndex = pageStartIndex + pageSize;

  const [showStartPopup, setShowStartPopup] = useState(false);
  const [startTarget, setStartTarget] = useState(null); // lưu appointment muốn start
  const [processingStart, setProcessingStart] = useState(false);
  const [actionMsg, setActionMsg] = useState(""); // message khi thao tác

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
  const completedToday = appointmentsToday.filter(a => a.status === "completed").length;
  // Tổng tiền doanh thu hôm nay
  const todayRevenue = appointmentsToday.filter(a => a.status === "completed")
    .reduce((sum, a) => sum + (a.services?.reduce((s, srv) => s + (srv.price || 0), 0) || 0), 0);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading...</div>;
  if (error) return <div className="text-center text-red-500 py-8">{error}</div>;

  return (
    <div className="min-h-screen text-white px-4 py-6 font-mono sm:font-['Pacifico', cursive]">
      <Navbar />
      {showStartPopup && startTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md w-full relative animate-fade-in">
            <button
              className="absolute top-2 right-3 text-pink-400 text-xl font-bold"
              onClick={() => setShowStartPopup(false)}
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-xl font-bold text-emerald-600 mb-4 flex items-center gap-2">
              Confirm Start Service
            </h2>
            <div className="mb-4 text-gray-700">
              Are you sure you want to start this service for customer: <br />
              <b>{startTarget.customer_name}</b> <br />
              Services: <span className="text-pink-400">{startTarget.services?.map(s => s.name).join(", ")}</span> <br />
              <span className="text-blue-700">
                Stylist: <b>{getFreelancerInfo(startTarget.stylist_id).name || "Staff"}</b>
              </span>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 py-2 rounded-lg shadow"
                disabled={processingStart}
                onClick={async () => {
                  setProcessingStart(true);
                  setActionMsg("");
                  try {
                    const token = await user.getIdToken();
                    const res = await fetch(
                      `https://crypto-manager-backend.onrender.com/api/appointments/${startTarget.id}`,
                      {
                        method: "PATCH",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                          status: "processing",
                          started_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                        }),
                      }
                    );
                    if (!res.ok) {
                      setActionMsg("An error occurred. Please try again.");
                    } else {
                      setShowStartPopup(false);
                      setStartTarget(null);
                      setProcessingStart(false);
                      setActionMsg("");
                      // Call fetchData or reload appointment list
                      await fetchData(user);
                    }
                  } catch (err) {
                    setActionMsg("An error occurred. Please try again.");
                  }
                  setProcessingStart(false);
                }}
              >
                {processingStart ? "Processing..." : "Confirm"}
              </button>
              <button
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-black font-bold px-6 py-2 rounded-lg"
                onClick={() => setShowStartPopup(false)}
                disabled={processingStart}
              >
                Cancel
              </button>
            </div>
            {actionMsg && <div className="text-red-500 font-semibold mt-3">{actionMsg}</div>}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-2">

        {/* Tổng doanh thu hôm nay + biểu đồ */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 p-6 flex flex-col items-center">
            <div className="text-5xl font-extrabold text-emerald-500 drop-shadow">${todayRevenue.toLocaleString()}</div>
            <div className="mt-2 text-yellow-600 text-sm">
              Appointments: {completedToday.length || 0}
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
          <div className="relative w-full">
            {nextClients.length > 0 && (
              <div
                className="
        absolute top-4 right-4 z-20
        bg-emerald-400/90 text-emerald-900 font-bold text-sm 
        px-4 py-1 rounded-full shadow-xl border-2 border-white
        whitespace-nowrap
      "
                style={{ minWidth: 90, textAlign: 'center' }}
              >
                {getFreelancerInfo(nextClients[nextClientIndex].stylist_id).name || "Staff"}
              </div>
            )}
            {/* Next Client Card */}
            <Card
              icon={<FiClock />}
              title="Next Client"
              value={
                nextClients.length > 0
                  ? dayjs.utc(nextClients[nextClientIndex].appointment_date).format("hh:mm A")
                  : "No upcoming"
              }
              sub={
                nextClients.length > 0 && (
                  <div className="flex flex-col gap-2 p-2 rounded-xl w-full">
                    <div className="flex items-center gap-2 font-bold text-yellow-200 capitalize truncate">
                      <span className="text-pink-300">👤</span>
                      {nextClients[nextClientIndex].customer_name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-emerald-300 capitalize truncate">
                      <span className="text-yellow-300">💇‍♀️</span>
                      {nextClients[nextClientIndex].services?.map(s => s.name).join(", ")}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-blue-400">
                      <span className="text-blue-300">⏱</span>
                      <span>
                        Estimated Time: <span className="font-semibold text-emerald-200">
                          {nextClients[nextClientIndex].services?.reduce((sum, s) => sum + (s.duration || s.duration_minutes || 0), 0)} min
                        </span>
                      </span>
                    </div>
                    {/* Nút Start Service chỉ cho chủ salon, trạng thái confirmed */}
                    {nextClients[nextClientIndex] &&
                      nextClients[nextClientIndex].status === "confirmed" &&
                      !nextClients[nextClientIndex].started_at && (
                        <button
                          className="mt-3 w-full md:w-auto self-start px-8 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-3xl font-bold shadow transition text-lg flex items-center justify-center gap-2"
                          onClick={() => {
                            setStartTarget(nextClients[nextClientIndex]);
                            setShowStartPopup(true);
                            setActionMsg("");
                          }}
                          disabled={processingStart}
                        >
                          <svg className="w-6 h-6 mr-1" fill="none" viewBox="0 0 24 24">
                            <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                          </svg>
                          Start Service
                        </button>
                      )}

                    {nextClients.length > 1 && (
                      <div className="flex gap-2 mt-2 items-center justify-center">
                        <button
                          onClick={() => setNextClientIndex(idx => idx > 0 ? idx - 1 : nextClients.length - 1)}
                          className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                          aria-label="Previous client"
                        >
                          <ChevronLeft className="w-6 h-6" />
                        </button>
                        <span className="mx-2 text-xs text-pink-400">
                          {`${nextClientIndex + 1} / ${nextClients.length}`}
                        </span>
                        <button
                          onClick={() => setNextClientIndex(idx => idx < nextClients.length - 1 ? idx + 1 : 0)}
                          className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                          aria-label="Next client"
                        >
                          <ChevronRight className="w-6 h-6" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              }
            />
          </div>

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
          <span className="text-3xl mb-2">🚧</span>
          <h3 className="text-lg font-bold mb-2 text-pink-300">Revenue by Day</h3>
          <span className="text-2xl font-bold text-yellow-300 drop-shadow text-center tracking-wide animate-pulse">
            Coming Soon...
          </span>
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
    <div className={`relative ${className} bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-2 border-b-2 border-pink-400 rounded-2xl shadow-lg p-4 sm:p-5 mb-3 transition-all`}>
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