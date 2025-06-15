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
import { SERVICES_BY_SPECIALIZATION } from "../../constants/servicesBySpecialization";
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);
dayjs.extend(timezone);

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from "recharts";
import { ChevronLeft, ChevronRight, AlarmClock, TimerReset, LoaderCircle, RefreshCcw, Loader2 } from "lucide-react";
import {
  FiCalendar,
  FiClock,
  FiUser,
  FiPhone,
  FiPlayCircle, FiStopCircle,
  FiDollarSign, FiGift, FiCreditCard, FiRepeat, FiSearch, FiBell
} from "react-icons/fi";
import { MdMiscellaneousServices, MdOutlineCancel } from "react-icons/md";

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

  const [showInvoicePopup, setShowInvoicePopup] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState("");
  const [serviceDropdownIdx, setServiceDropdownIdx] = useState(-1);
  const [serviceNameQuery, setServiceNameQuery] = useState("");
  const allServiceNames = Array.from(
    new Set(
      Object.values(SERVICES_BY_SPECIALIZATION)
        .flat()
        .map(name => name.trim())
        .map(name => name.toLowerCase())
    )
  ).map(name =>
    name
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  )

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

  const pendingAppointments = appointmentsToday.filter(a => a.status === "pending");
  const [pendingIndex, setPendingIndex] = useState(0);

  const serviceIntervalRef = useRef({});
  const [serviceTimers, setServiceTimers] = useState({});
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.push("/login");
        return;
      }
      setUser(firebaseUser);
      setLoading(true);
      await fetchData(firebaseUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchData(user);
    }, 60000); // 1 phút cập nhật 1 lần
    return () => clearInterval(interval);
  }, [user]);

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
    if (!invoiceForm) return;
    const total = invoiceForm.services.reduce((sum, s) => sum + Number(s.price || 0), 0);
    let totalDuration = 0;
    if (invoiceForm.actual_start_at && invoiceForm.actual_end_at) {
      const d1 = dayjs(invoiceForm.actual_start_at, "YYYY-MM-DD HH:mm:ss");
      const d2 = dayjs(invoiceForm.actual_end_at, "YYYY-MM-DD HH:mm:ss");
      totalDuration = d2.diff(d1, "minute");
    }
    const tip = Number(invoiceForm.tip || 0);
    const amountPaid = Number(invoiceForm.amount_paid || 0);
    let change = amountPaid - (total + tip);
    if (change < 0) change = 0;
    setInvoiceForm(f => ({
      ...f,
      total_amount: total,
      total_duration: totalDuration,
      change: change,
    }));
    // eslint-disable-next-line
  }, [
    invoiceForm?.services,
    invoiceForm?.actual_start_at,
    invoiceForm?.actual_end_at,
    invoiceForm?.tip,
    invoiceForm?.amount_paid,
  ]);


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
  function formatTimeUntilNextWithLate(appointmentDate) {
    if (!appointmentDate) return "";
    const now = dayjs();
    const target = dayjs(appointmentDate.replace("Z", ""));
    let diff = target.diff(now, "second");

    if (diff > 0) {
      const days = Math.floor(diff / (60 * 60 * 24));
      diff -= days * 60 * 60 * 24;
      const hours = Math.floor(diff / (60 * 60));
      diff -= hours * 60 * 60;
      const minutes = Math.floor(diff / 60);

      if (days > 0) {
        return `In ${days}d${hours > 0 ? ` ${hours}h` : ""}`;
      } else if (hours > 0) {
        return `In ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
      } else {
        return `In ${minutes} minute${minutes !== 1 ? "s" : ""}`;
      }
    } else {
      // Quá giờ, đang trễ
      const lateMinutes = Math.abs(target.diff(now, "minute"));
      return `🔴 Late ${lateMinutes} min`;
    }
  }
  const completedCountToday = appointmentsToday?.filter(a => a.status === "completed").length || 0;

  // Tổng tiền doanh thu hôm nay
  const todayRevenue = appointmentsToday.filter(a => a.status === "completed")
    .reduce((sum, a) => sum + (a.services?.reduce((s, srv) => s + (srv.price || 0), 0) || 0), 0);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading...</div>;
  if (error) return <div className="text-center text-red-500 py-8">{error}</div>;

  return (
    <div className="min-h-screen text-white px-4 py-6 font-mono sm:font-['Pacifico', cursive]">
      <Navbar />
      {showInvoicePopup && invoiceForm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form
            className="bg-gradient-to-r from-emerald-100 via-yellow-50 to-pink-50 backdrop-blur-xl
 rounded-2xl p-6 shadow-2xl max-w-md w-full relative border-t-4 border-pink-400 text-gray-800"
            onSubmit={async (e) => {
              e.preventDefault();
              const totalDue = invoiceForm.total_amount + (invoiceForm.tip || 0);
              if (
                invoiceForm.amount_paid === null ||
                invoiceForm.amount_paid === undefined ||
                invoiceForm.amount_paid === "" ||
                invoiceForm.amount_paid < totalDue
              ) {
                setSaveInvoiceError("Customer has not paid enough!");
                return;
              }
              setSavingInvoice(true);
              setSaveInvoiceError("");
              try {
                const token = await user.getIdToken();
                const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointment-invoices", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    ...invoiceForm,
                    tip: invoiceForm.tip,
                    amount_paid: invoiceForm.amount_paid,
                    change: invoiceForm.change,
                  }),
                });
                if (!res.ok) {
                  const data = await res.json();
                  setSaveInvoiceError(data.error || "Failed to save invoice.");
                  setSavingInvoice(false);
                  return;
                }
                setShowInvoicePopup(false);
                setSavingInvoice(false);
                // Reload lại appointmentsToday và nowServing
                await fetchData(user);
              } catch (err) {
                setSaveInvoiceError("Network error. Please try again.");
                setSavingInvoice(false);
              }
            }}
          >
            <button
              type="button"
              className="absolute top-2 right-3 text-pink-400 text-xl font-bold"
              onClick={() => setShowInvoicePopup(false)}
              aria-label="Close"
              disabled={savingInvoice}
            >
              ×
            </button>
            <h2 className="text-xl font-bold text-emerald-600 mb-4 text-center">Appointment Invoice</h2>

            {/* Customer info */}
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label className="block text-pink-700 font-bold text-sm mb-1 flex items-center gap-2">
                  <FiUser className="text-pink-600" />
                  Customer Name
                </label>
                <input
                  type="text"
                  className="w-full rounded-2xl p-1 border border-gray-300 text-gray-900 bg-pink-50 text-center text-xs"
                  value={invoiceForm.customer_name}
                  readOnly
                />
              </div>
              <div>
                <label className="block text-pink-700 font-bold text-sm mb-1 flex items-center gap-2">
                  <FiPhone className="text-pink-600" />
                  Phone
                </label>
                <input
                  type="text"
                  className="w-full rounded-2xl p-1 border border-gray-300 text-gray-900 bg-pink-50 text-center text-xs"
                  value={invoiceForm.customer_phone}
                  readOnly
                />
              </div>
            </div>

            {/* Actual Start/End & Duration */}
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label className="block text-pink-700 font-bold text-sm mb-1 flex items-center gap-2">
                  <FiPlayCircle className="text-emerald-500" />
                  Actual Start
                </label>

                <div className="bg-pink-50 border border-gray-200 rounded-2xl px-2 py-1 text-gray-800 text-center text-xs select-text">
                  {dayjs.utc(invoiceForm.actual_start_at).format("YYYY-MM-DD HH:mm:ss")}
                </div>
              </div>
              <div>
                <label className="block text-pink-700 font-bold text-sm mb-1 flex items-center gap-2">
                  <FiStopCircle className="text-pink-500" />
                  Actual End
                </label>

                <div className="bg-pink-50 border border-gray-200 rounded-2xl px-2 py-1 text-gray-800 text-center text-xs select-text">
                  {invoiceForm.actual_end_at}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end mb-2">
              <span className="text-xs text-pink-700 mr-1 flex items-center gap-1">
                <FiClock className="text-pink-700 text-sm" />
                Service time:
              </span>

              <span className="font-bold text-xs text-emerald-600">
                {invoiceForm.total_duration || invoiceForm.total_duration === 0
                  ? (() => {
                    const h = Math.floor(invoiceForm.total_duration / 60);
                    const m = invoiceForm.total_duration % 60;
                    if (h > 0) return `${h}h ${m}min`;
                    return `${m}min`;
                  })()
                  : "--"}
              </span>
            </div>

            {/* Services (compact) */}
            <div className="mb-2">
              <label className="block text-pink-700 font-bold text-sm mb-1 flex items-center gap-2">
                <MdMiscellaneousServices className="text-pink-600 text-base" />
                Services
              </label>

              <div className="space-y-1">
                {invoiceForm.services.map((srv, idx) => (
                  <div key={idx} className="flex gap-2 items-center px-1 py-1 text-xs w-full">
                    <div className="relative flex-1 min-w-0">
                      <input
                        type="text"
                        className="w-full pl-4 rounded-2xl border border-gray-300 p-1 text-gray-900 bg-white text-xs"
                        value={srv.name}
                        autoComplete="off"
                        onFocus={() => setServiceDropdownIdx(idx)}
                        onBlur={() => setTimeout(() => setServiceDropdownIdx(-1), 200)}
                        onChange={e => {
                          const value = e.target.value;
                          const services = [...invoiceForm.services];
                          services[idx].name = value;
                          setInvoiceForm(f => ({ ...f, services }));
                          setServiceNameQuery(value);
                          setServiceDropdownIdx(idx);
                        }}
                        required
                      />
                      {serviceDropdownIdx === idx && serviceNameQuery.length > 0 && (
                        <div
                          className="absolute z-30 left-0 mt-1 w-44 max-h-32 overflow-y-auto bg-white border border-gray-300 rounded-xl shadow-lg text-xs"
                          style={{ minWidth: 90 }}
                        >
                          {allServiceNames
                            .filter(name => name.toLowerCase().includes(serviceNameQuery.toLowerCase()))
                            .slice(0, 15)
                            .map(name => (
                              <div
                                key={name}
                                className="px-2 py-1 hover:bg-emerald-100 cursor-pointer text-gray-900"
                                onMouseDown={() => {
                                  const services = [...invoiceForm.services];
                                  services[idx].name = name;
                                  setInvoiceForm(f => ({ ...f, services }));
                                  setServiceDropdownIdx(-1);
                                }}
                              >
                                {name}
                              </div>
                            ))}
                          {allServiceNames.filter(name =>
                            name.toLowerCase().includes(serviceNameQuery.toLowerCase())
                          ).length === 0 && (
                              <div className="px-2 py-1 text-gray-400 italic">No match</div>
                            )}
                        </div>
                      )}
                    </div>
                    {/* Price */}
                    <span className="text-yellow-600" title="Price">💵</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="w-16 rounded-2xl border border-gray-300 p-1 text-gray-900 bg-white text-xs text-center"
                      value={srv.price}
                      onChange={e => {
                        const services = [...invoiceForm.services];
                        services[idx].price = Number(e.target.value);
                        setInvoiceForm(f => ({ ...f, services }));
                      }}
                      required
                    />
                    <button
                      type="button"
                      className="text-red-500 text-lg ml-1"
                      onClick={() => {
                        const services = invoiceForm.services.filter((_, i) => i !== idx);
                        setInvoiceForm(f => ({ ...f, services }));
                      }}
                      disabled={invoiceForm.services.length === 1}
                      title="Remove service"
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold underline mt-1"
                  onClick={() => setInvoiceForm(f => ({
                    ...f,
                    services: [...f.services, { name: "", price: 0 }]
                  }))}
                >+ Add Service</button>
              </div>
            </div>

            {/* Total Amount, Tip, Amount Paid, Change */}
            <div className="border-t-4 pl-6 border-pink-200 rounded-2xl shadow-2xl px-3 py-2 mb-2">
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-emerald-700 flex items-center gap-2">
                  <FiDollarSign className="text-emerald-700 text-base" />
                  Total Amount
                </span>

                <span className="font-bold text-base text-emerald-700">
                  ${invoiceForm.total_amount ? invoiceForm.total_amount.toFixed(2) : "0.00"}
                </span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-gray-600 flex items-center gap-2">
                  <FiGift className="text-yellow-500 text-base" />
                  Tip
                </span>

                <div className="relative w-20">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-900 pointer-events-none text-sm">$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="pl-5 w-full rounded-2xl border border-gray-300 p-1 text-gray-900 bg-white text-sm"
                    value={invoiceForm.tip || ""}
                    onChange={e => setInvoiceForm(f => ({ ...f, tip: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-gray-600 flex items-center gap-2">
                  <FiCreditCard className="text-pink-400 text-base" />
                  Amount Paid
                </span>

                <div className="relative w-20">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-900 pointer-events-none text-sm">$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="pl-5 w-full rounded-2xl border border-gray-300 p-1 text-gray-900 bg-white text-sm"
                    value={invoiceForm.amount_paid || ""}
                    onChange={e => {
                      const val = e.target.value;
                      setInvoiceForm(f => ({
                        ...f,
                        amount_paid: val === "" ? null : Number(val)
                      }));
                      setSaveInvoiceError("");
                    }}
                  />
                </div>
              </div>
              {typeof invoiceForm.amount_paid === "number" &&
                invoiceForm.amount_paid < invoiceForm.total_amount + (invoiceForm.tip || 0) &&
                <div className="text-red-500 text-xs text-right mb-1">
                  Customer has not paid enough!
                </div>
              }
              <div className="flex justify-between items-center mt-1">
                <span className="font-semibold text-gray-600 flex items-center gap-2">
                  <FiRepeat className="text-purple-500 text-base" />
                  Change
                </span>

                <span className="font-bold text-emerald-700">
                  ${invoiceForm.change ? invoiceForm.change.toFixed(2) : "0.00"}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div className="mb-2">
              <label className="block text-pink-700 font-bold text-sm mb-1">Notes</label>
              <textarea
                className="w-full rounded-2xl border border-gray-300  p-2 text-gray-900 bg-white text-xs"
                rows={2}
                value={invoiceForm.notes}
                onChange={e => setInvoiceForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            {/* Error */}
            {saveInvoiceError && <div className="text-red-500 mb-2">{saveInvoiceError}</div>}

            <button
              type="submit"
              className={`w-full mt-2 py-2 rounded-2xl bg-gradient-to-r from-emerald-400 via-yellow-300 to-pink-400 font-bold text-lg text-white shadow-lg ${savingInvoice ? "opacity-50" : ""}`}
              disabled={savingInvoice}
            >
              {savingInvoice ? "Saving..." : "Complete & Save Invoice"}
            </button>
          </form>
        </div>
      )}

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

        {/* Tổng doanh thu hôm nay*/}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 p-6 flex flex-col items-center">
            <div className="text-5xl font-extrabold text-emerald-500 drop-shadow">${todayRevenue.toLocaleString()}</div>
            <div className="mt-2 text-yellow-600 text-sm">
              {completedCountToday} appointment{completedCountToday !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* Appointments & Next Client: nằm cùng dòng trên desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2 items-stretch">
          {/* Appointments Card */}
          <Card
            className="h-full flex flex-col"
            icon={<FiCalendar />}
            title="New Appointments"
            value={
              pendingAppointments.length > 0
                ? dayjs.utc(pendingAppointments[pendingIndex].appointment_date).format("hh:mm A")
                : ""
            }
            sub={
              pendingAppointments.length > 0 ? (
                <div className="flex flex-col gap-2 p-4 rounded-xl w-full">
                  {/* Tên khách hàng */}
                  <div className="flex items-center gap-2 font-bold text-yellow-200 capitalize truncate">
                    <span className="text-pink-300">👤</span>
                    {pendingAppointments[pendingIndex].customer_name}
                  </div>

                  {/* Dịch vụ */}
                  <div className="flex items-center gap-2 text-xs text-emerald-300 capitalize truncate">
                    <span className="text-yellow-300">💇‍♀️</span>
                    {pendingAppointments[pendingIndex].services?.map(s => s.name).join(", ")}
                  </div>

                  {/* Estimated Time */}
                  <div className="flex items-center gap-2 text-xs text-blue-400">
                    <span className="text-blue-300">⏱</span>
                    <span>
                      Estimated Time:{" "}
                      <span className="font-semibold text-emerald-200">
                        {pendingAppointments[pendingIndex].services?.reduce(
                          (sum, s) => sum + (s.duration || s.duration_minutes || 0),
                          0
                        )}{" "}
                        min
                      </span>
                    </span>
                  </div>

                  {/* Nút xác nhận */}
                  <button
                    className={`mt-3 w-full md:w-auto self-start px-8 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-3xl font-bold shadow transition text-lg flex items-center justify-center gap-2
                ${processingApptId === pendingAppointments[pendingIndex].id ? "opacity-60 cursor-not-allowed" : ""}
              `}
                    disabled={processingApptId === pendingAppointments[pendingIndex].id}
                    onClick={async () => {
                      const appointment = pendingAppointments[pendingIndex];
                      try {
                        setProcessingApptId(appointment.id);
                        const token = await user.getIdToken();
                        await fetch(
                          `https://crypto-manager-backend.onrender.com/api/appointments/${appointment.id}`,
                          {
                            method: "PATCH",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${token}`,
                            },
                            body: JSON.stringify({ status: "confirmed" }),
                          }
                        );
                        await fetchData(user); // hoặc loadAppointments(...)
                      } catch (err) {
                        console.error("Confirm failed:", err);
                        alert("Failed to confirm appointment. Please try again.");
                      }
                      setProcessingApptId(null);
                    }}
                  >
                    {processingApptId === pendingAppointments[pendingIndex].id ? (
                      <>
                        <Loader2 className="animate-spin w-5 h-5" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6 mr-1" fill="none" viewBox="0 0 24 24">
                          <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                        </svg>
                        Accept
                      </>
                    )}
                  </button>

                  {/* Điều hướng nhiều lịch hẹn */}
                  {pendingAppointments.length > 1 && (
                    <div className="flex gap-2 mt-2 items-center justify-center">
                      <button
                        onClick={() =>
                          setPendingIndex(idx =>
                            idx > 0 ? idx - 1 : pendingAppointments.length - 1
                          )
                        }
                        className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                        aria-label="Previous appointment"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                      <span className="mx-2 text-xs text-pink-400">
                        {`${pendingIndex + 1} / ${pendingAppointments.length}`}
                      </span>
                      <button
                        onClick={() =>
                          setPendingIndex(idx =>
                            idx < pendingAppointments.length - 1 ? idx + 1 : 0
                          )
                        }
                        className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                        aria-label="Next appointment"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full p-4 rounded-xl flex flex-col items-center justify-center gap-3 text-white/70 text-center">
                  {/* 🌐 Radar Scan Icon */}
                  <div className="relative w-20 h-20">
                    <svg viewBox="0 0 100 100" className="w-full h-full">
                      <circle cx="50" cy="50" r="45" stroke="#f472b6" strokeWidth="4" fill="none" className="opacity-50" />
                      <circle cx="50" cy="50" r="30" stroke="#facc15" strokeWidth="1" fill="none" className="opacity-30" />
                      <line
                        x1="50"
                        y1="50"
                        x2="95"
                        y2="50"
                        stroke="#f472b6"
                        strokeWidth="1"
                        className="origin-center animate-rotate"
                      />
                    </svg>
                    {/* Center pulse */}
                    <div className="absolute top-1/2 left-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-pink-500 rounded-full animate-ping" />
                  </div>
                  <div className="text-sm text-pink-200 font-semibold flex items-center justify-center gap-1">
                    Looking for appointments
                    <span className="dot-flash">.</span>
                    <span className="dot-flash delay-1">.</span>
                    <span className="dot-flash delay-2">.</span>
                  </div>

                </div>
              )
            }
            extra={
              <AppointmentNotification
                pendingCount={appointmentsToday.filter(a => a.status === "pending").length}
                cancelledCount={appointmentsToday.filter(a => a.status === "cancelled").length}
                messageCount={0}
              />
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
              className="h-full flex flex-col"
              icon={<FiClock />}
              title="Next Client"
              value={
                nextClients.length > 0
                  ? dayjs.utc(nextClients[nextClientIndex].appointment_date).format("hh:mm A")
                  : (
                    ""
                  )
              }
              sub={
                nextClients.length > 0 ? (
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
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                      </svg>
                      <span className="text-sm text-emerald-200 font-semibold">
                        {formatTimeUntilNextWithLate(nextClients[nextClientIndex]?.appointment_date)}
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
                ) : (
                  <div className="flex flex-col items-center justify-center text-sm text-white/70 p-4">
                    {/* Animated energy wave bar */}
                    <div className="flex gap-[4px] items-end h-8 mb-3 overflow-hidden">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <div
                          key={i}
                          className="w-[4px] rounded-sm bg-pink-400 animate-rise"
                          style={{
                            animationDelay: `${i * 0.1}s`,
                            animationDuration: `1.2s`
                          }}
                        />
                      ))}
                    </div>
                    <span className="font-semibold text-pink-200">Wating for next client</span>
                    <span className="text-xs text-white/40 mt-1 animate-pulse">No upcoming appointments</span>
                  </div>

                )
              }

            />
          </div>

        </div>

        {/* Now Serving Card */}
        <div className="mt-4 mb-4">
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
                        {nowServing[currentNowSlide]?.customer_name || "--"}
                      </div>
                      <div className="text-sm text-emerald-300 mb-1">
                        {nowServing[currentNowSlide]?.services?.map(s => s.name).join(", ")}
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
                        onClick={() => {
                          const appt = nowServing[currentNowSlide];
                          console.log(appt);
                          console.log("stylist_id:", appt.stylist_id, typeof appt.stylist_id);
                          setInvoiceForm({
                            appointment_id: appt.id,
                            customer_name: appt.customer_name,
                            customer_phone: appt.customer_phone,
                            stylist_id: appt.stylist_id,
                            stylist_name: getFreelancerInfo(appt.stylist_id).name || "Staff",
                            salon_id: appt.salon_id,
                            services: appt.services.map(s => ({
                              id: s.id,
                              name: s.name,
                              price: s.price,
                              duration: s.duration || s.duration_minutes,
                              quantity: 1,
                            })),
                            total_amount: appt.services.reduce((sum, s) => sum + (s.price || 0), 0),
                            total_duration: Math.round(
                              dayjs().diff(dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss"), "minute")
                            ),
                            actual_start_at: appt.started_at,
                            actual_end_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                            notes: appt.note || "",
                            tip: 0,
                            amount_paid: null,
                            change: 0,
                          });
                          setShowInvoicePopup(true);
                        }}

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
                        console.log("DEBUG", a);
                        return (
                          <div key={a.id} className="min-w-[220px] mb-8 border-r-4 border-t-1 border-l-4 border-b-1 border-white/20 rounded-2xl shadow-lg p-4 flex flex-col items-center mx-1">
                            <img src={emp.avatar_url || "/default-avatar.png"} className="w-14 h-14 rounded-full mb-1" alt={emp.name} />
                            <div className="font-bold text-base text-emerald-100">{emp.name || "Staff"}</div>
                            <div className="text-xs text-yellow-400">
                              Start: {a.started_at ? dayjs(a.started_at, "YYYY-MM-DD HH:mm:ss").format("hh:mm A") : "--"}
                            </div>
                            <div className="text-xs text-pink-200">{a.customer_name || "Customer"}</div>
                            <div className="text-xs text-emerald-300 mb-1">
                              {a.services?.map(s => s.name).join(", ")}
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
                              onClick={() => {
                                // Lấy appointment đang phục vụ (a)
                                setInvoiceForm({
                                  appointment_id: a.id,
                                  customer_name: a.customer_name,
                                  customer_phone: a.customer_phone,
                                  stylist_id: a.stylist_id,
                                  stylist_name: getFreelancerInfo(a.stylist_id).name || "Staff",
                                  salon_id: a.salon_id,
                                  services: a.services.map(s => ({
                                    id: s.id,
                                    name: s.name,
                                    price: s.price,
                                    duration: s.duration || s.duration_minutes,
                                    quantity: 1,
                                  })),
                                  total_amount: a.services.reduce((sum, s) => sum + (s.price || 0), 0),
                                  total_duration: Math.round(
                                    (dayjs().diff(dayjs(a.started_at, "YYYY-MM-DD HH:mm:ss"), "minute"))
                                  ),
                                  actual_start_at: a.started_at,
                                  actual_end_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                                  notes: a.note || "",
                                  tip: 0,
                                  amount_paid: null,
                                  change: 0,
                                });
                                setShowInvoicePopup(true);
                              }}

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
function Card({ icon, title, value, sub, children, className = "", extra }) {
  return (
    <div
      className={`relative ${className} bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-2 border-b-2 border-pink-400 rounded-2xl shadow-lg p-4 sm:p-5 mb-3 transition-all`}
    >
      {/* 🔔 EXTRA content (ví dụ: thông báo) */}
      {extra && (
        <div className="absolute top-3 right-4 z-10">
          {extra}
        </div>
      )}

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

function AppointmentNotification({ pendingCount = 0, cancelledCount = 0, messageCount = 0 }) {
  const [showPopup, setShowPopup] = useState(false);
  const total = pendingCount + cancelledCount + messageCount;

  return (
    <>
      {/* 🔔 Nút chuông nổi trong thẻ */}
      <div className="relative">
        <button
          onClick={() => setShowPopup(true)}
          className="relative w-8 h-8 rounded-full bg-pink-500 flex items-center justify-center shadow hover:scale-105 transition"
        >
          <FiBell className="text-white text-base" />
          {total > 0 && (
            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow">
              {total}
            </div>
          )}
        </button>
      </div>

      {/* 🧾 Popup Detail */}
      {showPopup && (
        <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 relative animate-fadeIn">
            {/* Close */}
            <button
              className="absolute top-2 right-2 text-gray-500 hover:text-red-500"
              onClick={() => setShowPopup(false)}
            >
              <MdOutlineCancel className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-emerald-600 mb-4 text-center">
              Appointment Notifications
            </h3>

            <ul className="space-y-3 text-sm">
              <li className="flex justify-between items-center">
                <span className="text-gray-700">🟡 Pending Confirmations</span>
                <span className="font-bold text-emerald-600">{pendingCount}</span>
              </li>
              <li className="flex justify-between items-center">
                <span className="text-gray-700">🔴 Cancelled Appointments</span>
                <span className="font-bold text-pink-500">{cancelledCount}</span>
              </li>
              <li className="flex justify-between items-center">
                <span className="text-gray-700">💬 Customer Messages</span>
                <span className="font-bold text-blue-500">{messageCount}</span>
              </li>
            </ul>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowPopup(false)}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-emerald-400 via-yellow-300 to-pink-400 text-white font-semibold shadow hover:brightness-110 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}