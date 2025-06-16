// ✅ FULL FILE: freelancers/index.js
import { useEffect, useState, useRef } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import { useRouter } from "next/router";
import { SERVICES_BY_SPECIALIZATION } from "../../constants/servicesBySpecialization";
import {
  FiDollarSign,
  FiClock,
  FiCalendar,
  FiExternalLink,
  FiCheckCircle,
  FiUser,
  FiSearch,
  FiTag,
  FiBell,
  FiPhone,
  FiPlayCircle,
  FiStopCircle,
  FiGift,
  FiCreditCard,
  FiRepeat
} from "react-icons/fi";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);
dayjs.extend(timezone);

import { checkFreelancerExists } from "../../components/utils/checkFreelancer";
import { Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";
import { ChevronLeft, ChevronRight, ArrowUpRight, SquareArrowOutUpRight } from "lucide-react";
import { MdMiscellaneousServices, MdOutlineCancel } from "react-icons/md";



export default function FreelancerDashboard() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading] = useState(true);

  const [appointments, setAppointments] = useState([]);
  const [appointmentsToday, setAppointmentsToday] = useState([]);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [timeUntilNext, setTimeUntilNext] = useState("");
  const [newAppointment, setNewAppointment] = useState(null);

  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const [nextClientIndex, setNextClientIndex] = useState(0);
  const [inProgressIndex, setInProgressIndex] = useState(0);

  const [pendingAppointments, setPendingAppointments] = useState([]);
  const [pendingIndex, setPendingIndex] = useState(0);
  const [cancelingApptId, setCancelingApptId] = useState(null);


  const [showPopup, setShowPopup] = useState(false);
  const [latePopup, setLatePopup] = useState(null); // chứa appointment & logic chờ
  const [waitMinutes, setWaitMinutes] = useState(5); // mặc định 5 phút chờ
  const waitingTimeout = useRef(null);
  const [hideLatePopupUntil, setHideLatePopupUntil] = useState(null);
  const [serviceTimers, setServiceTimers] = useState({});
  const serviceIntervalRef = useRef({});
  const [processingApptId, setProcessingApptId] = useState(null); // id đang xử lý (start/complete)
  const [actionError, setActionError] = useState(""); // text lỗi (nếu có)

  const [overdueWarning, setOverdueWarning] = useState(null); // chứa appointment quá hạn
  const [snoozeUntil, setSnoozeUntil] = useState({}); // id: time - để ẩn cảnh báo tạm thời

  const [showInvoicePopup, setShowInvoicePopup] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(null); // chứa dữ liệu hóa đơn
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState("");
  const allServiceNames = Array.from(
    new Set(
      Object.values(SERVICES_BY_SPECIALIZATION)
        .flat()
        .map(name => name.trim())
        .map(name => name.toLowerCase()) // Loại trùng không phân biệt HOA thường
    )
  ).map(name =>
    // Đưa về chữ hoa đầu từ cho đẹp nếu cần
    name
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
  const [serviceNameQuery, setServiceNameQuery] = useState("");
  const [serviceDropdownIdx, setServiceDropdownIdx] = useState(-1); // nếu dùng arrow để chọn

  const soundRef = useRef(null);
  const soundLoopRef = useRef(null); // ✅ để lưu vòng lặp âm thanh
  const [isSliding, setIsSliding] = useState(false);
  const [sliderX, setSliderX] = useState(0);
  const [sliderValue, setSliderValue] = useState(0);
  const clearSoundLoop = () => {
    if (soundLoopRef.current) {
      clearInterval(soundLoopRef.current);
      soundLoopRef.current = null;
    }
  };
  const [availableServices, setAvailableServices] = useState([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [showServiceDetails, setShowServiceDetails] = useState(false);

  // 🟢 State để lưu trạng thái cập nhật dịch vụ
  const [savingStatus, setSavingStatus] = useState(""); // '' | 'saving' | 'saved' | 'error'
  const [updatingServiceId, setUpdatingServiceId] = useState(null); // service đang loading


  const hasMounted = useRef(false);

  const [confirmedNextClient, setConfirmedNextClient] = useState(null); // 🟢 Next Client
  const [pendingUpcomingAppointment, setPendingUpcomingAppointment] = useState(null); // 🔔 Popup
  const [isConfirmed, setIsConfirmed] = useState(false);

  const auth = getAuth();
  const router = useRouter();
  const sliderRef = useRef(null);
  const sliderMax = 200; // chiều dài vuốt tối đa (điều chỉnh theo giao diện)

  const [hasFreelancerProfile, setHasFreelancerProfile] = useState(null);

  const handleSlideStart = (e) => {
    setIsSliding(true);
  };

  const handleSlideMove = (e) => {
    if (!isSliding) return;

    const clientX = e.type.includes("mouse")
      ? e.clientX
      : e.touches[0].clientX;

    const rect = sliderRef.current.getBoundingClientRect();
    let newX = clientX - rect.left - 25;
    newX = Math.max(0, Math.min(newX, sliderMax));
    setSliderX(newX);
  };

  const handleSlideEnd = () => {
    setIsSliding(false);
    if (sliderX >= sliderMax - 10) {
      handleConfirmAppointment(newAppointment.id); // Gọi API xác nhận
    } else {
      setSliderX(0); // Reset
    }
  };
  const now = dayjs();
  const completedToday = appointmentsToday.filter(a => a.status === "completed").length;

  // Tính các appointments theo workflow mới
  const pendingToday = appointmentsToday.filter(a => {
    return a.status === "pending";
  }).length;
  const upcomingToday = appointmentsToday.filter(a => {
    // upcoming: status = "confirmed", chưa started, và CHƯA QUA GIỜ HẸN
    return a.status === "confirmed" &&
      !a.started_at &&
      dayjs(a.appointment_date.replace("Z", "")).isAfter(now);
  }).length;
  const missedToday = appointmentsToday.filter(a => {
    // missed: status = "confirmed", chưa started, ĐÃ QUA GIỜ HẸN
    return a.status === "confirmed" &&
      !a.started_at &&
      dayjs(a.appointment_date.replace("Z", "")).isBefore(now);
  }).length;
  const completedAppointmentsToday = appointmentsToday.filter(a => a.status === "completed");
  const totalSecondsToday = completedAppointmentsToday.reduce((sum, a) => {
    if (a.started_at && a.end_at) {
      const start = dayjs(a.started_at);
      const end = dayjs(a.end_at);
      const seconds = end.diff(start, "second");
      return sum + Math.max(0, seconds);
    }
    return sum;
  }, 0);
  const totalHoursToday = (totalSecondsToday / 3600).toFixed(2); // Ví dụ: 4.75 Hours
  const todayEarnings = completedAppointmentsToday.reduce((sum, a) =>
    sum + (a.services?.reduce((s, srv) => s + (srv.price || 0), 0) || 0),
    0
  );
  const totalAppointmentsToday = completedAppointmentsToday.length;
  const inProgressAppointments = appointments.filter(a => a.status === "processing");
  const nextClient = upcomingAppointments[nextClientIndex];
  const estimateMinutes =
    nextClient?.services?.reduce(
      (sum, srv) => sum + (srv.duration || srv.duration_minutes || 0),
      0
    ) || 0;

  const pendingCount = appointmentsToday.filter(a => a.status === "pending").length;
  const cancelledCount = appointmentsToday.filter(a => a.status === "cancelled").length;
  const messageCount = 0; // sau này bạn có thể gắn thật nếu có tin nhắn

  function checkOverdueAppointments() {
    if (!appointments || appointments.length === 0) return;
    const now = dayjs();
    let foundOverdue = null;

    appointments.forEach(appt => {
      if (
        appt.status === "processing" &&
        appt.started_at &&
        !appt.end_at &&
        Array.isArray(appt.services)
      ) {
        const estimateMinutes = appt.services.reduce(
          (sum, s) => sum + (s.duration || s.duration_minutes || 0),
          0
        );
        if (estimateMinutes < 10) return;
        const started = dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss");
        const servedMinutes = now.diff(started, "minute");
        const snoozeTime = snoozeUntil[appt.id];
        if (servedMinutes > estimateMinutes + 30) {
          if (!snoozeTime || now.isAfter(snoozeTime)) {
            foundOverdue = appt;
          }
        }
      }
    });

    setOverdueWarning(foundOverdue);
  }

  // Wake Lock để giữ màn hình luôn sáng (cho cả desktop & mobile)
  const wakeLockRef = useRef(null);
  useEffect(() => {
    // Hàm xin quyền giữ màn hình sáng
    async function requestWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
          console.log("🔋 Wake Lock active!");
          // Nếu wake lock bị mất (tab ẩn, minimize), có thể xin lại
          wakeLockRef.current.addEventListener("release", () => {
            console.log("🔋 Wake Lock was released");
          });
        } else {
          console.warn("Wake Lock API is not supported on this browser.");
        }
      } catch (err) {
        console.error("Failed to acquire wake lock:", err);
      }
    }

    // Gọi ngay khi component mount
    requestWakeLock();

    // Khi tab/trang được bật lại, xin lại quyền nếu đã mất
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Dọn dẹp khi component unmount
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);


  // Hàm kiểm tra và show popup late
  useEffect(() => {
    if (!appointments || appointments.length === 0) return;

    const now = dayjs();
    // Nếu đang trong thời gian chờ, không show popup
    if (hideLatePopupUntil && now.isBefore(hideLatePopupUntil)) return;

    const lateAppt = appointments.find(
      (a) =>
        a.status === "confirmed" &&
        now.isSameOrAfter(dayjs(a.appointment_date.replace("Z", ""))) && // CHỈ popup nếu ĐÃ đến hoặc QUA giờ hẹn
        !a.started_at
    );

    if (lateAppt && !latePopup) {
      setLatePopup(lateAppt);
    }
    if (!lateAppt && latePopup) {
      setLatePopup(null);
    }
  }, [appointments]);


  // Hàm clear timeout khi cần
  const clearWaitingTimeout = () => {
    if (waitingTimeout.current) {
      clearTimeout(waitingTimeout.current);
      waitingTimeout.current = null;
    }
  };



  useEffect(() => {
    if (!user || !Array.isArray(selectedServiceIds)) return;

    // ⛔️ Bỏ qua lần chạy đầu tiên
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    const saveServices = async () => {
      setSavingStatus("saving");
      try {
        const token = await user.getIdToken();
        await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/services", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ service_ids: selectedServiceIds }),
        });
        setSavingStatus("saved");
        setTimeout(() => setSavingStatus(""), 2000);
      } catch (err) {
        console.error("❌ Auto-save error:", err.message);
        setSavingStatus("error");
        setTimeout(() => setSavingStatus(""), 3000);
      }
    };

    saveServices();
  }, [selectedServiceIds]);

  useEffect(() => {
    if (sliderValue > 0 && sliderValue < 100) {
      const timeout = setTimeout(() => {
        setSliderValue(0);
      }, 2000); // ⏳ Sau 2 giây không kéo tiếp thì reset

      return () => clearTimeout(timeout); // Cleanup nếu user kéo tiếp
    }
  }, [sliderValue]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
        return;
      }
      setUser(currentUser);

      // 🟢 Lấy role CHUẨN
      let role = null;
      // 1. Thử lấy từ localStorage
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        role = parsedUser.role;
      }
      // 2. Nếu chưa có, fetch từ backend (làm 1 lần duy nhất)
      if (!role) {
        try {
          const token = await currentUser.getIdToken();
          const resRole = await fetch("https://crypto-manager-backend.onrender.com/api/user-role", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const dataRole = await resRole.json();
          role = dataRole.role;
        } catch (err) {
          console.error("❌ Error fetch user role", err);
        }
      }

      setUserRole(role);
      console.log("FE currentUser.uid:", user?.uid);
      // 🟢 Check freelancer profile
      const exists = await checkFreelancerExists(currentUser);
      setHasFreelancerProfile(exists);

      // ⚠️ Thêm debug ở đây
      console.log("DEBUG role =", role, "| hasFreelancerProfile =", exists);

      // 🛑 Nếu là nhân viên salon chưa có freelancer profile, DỪNG!
      if (role === "Salon_NhanVien" && !exists) {
        setLoading(false);
        setOnboarding(null);
        return;
      }

      // 5. Nếu đã có profile, tiếp tục fetch onboarding, appointments
      const token = await currentUser.getIdToken();
      const res = await fetch(
        "https://crypto-manager-backend.onrender.com/api/freelancers/onboarding",
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();
      setOnboarding(data);

      if (data?.salon_id && data?.specialization?.length > 0) {
        try {
          const res = await fetch(
            `https://crypto-manager-backend.onrender.com/api/salons/${data.salon_id}/services-by-specialization?specialization=${data.specialization.join(",")}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          const list = await res.json();
          setAvailableServices(list || []);
          setSelectedServiceIds(data.services || []);
        } catch (err) {
          console.error("❌ Failed to fetch services:", err.message);
        }
      }

      await loadAppointments(
        token,
        setAppointments,
        setAppointmentsToday,
        setConfirmedNextClient,
        setPendingUpcomingAppointment,
        setTimeUntilNext,
        setShowPopup,
        setNewAppointment,
        soundRef,
        soundLoopRef,
        setUpcomingAppointments,    // Thêm dòng này
        setNextClientIndex          // Thêm dòng này
      );

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !user.uid) return;
    const refresh = async () => {
      const token = await user.getIdToken();
      // Chỉ gọi check nếu chắc chắn là user từ Firebase (có uid)
      checkFreelancerExists(user).then(setHasFreelancerProfile);

      await loadAppointments(
        token,
        setAppointments,
        setAppointmentsToday,
        setConfirmedNextClient,
        setPendingUpcomingAppointment,
        setTimeUntilNext,
        setShowPopup,
        setNewAppointment,
        soundRef,
        soundLoopRef,
        setUpcomingAppointments,
        setNextClientIndex
      );
    };
    const interval = setInterval(refresh, 60000);
    refresh();
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    // Lấy tất cả appointments đang "processing"
    const inProgress = appointments.filter(a => a.status === "processing" && a.started_at);
    // Dừng các interval cũ
    Object.values(serviceIntervalRef.current).forEach(clearInterval);
    const timers = {};
    inProgress.forEach(appt => {
      const id = appt.id;
      // Sửa ở đây: parse started_at với custom format để đúng giờ local
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
    // Dọn dẹp interval khi appointments đổi
    return () => {
      Object.values(serviceIntervalRef.current).forEach(clearInterval);
      serviceIntervalRef.current = {};
    };
  }, [appointments]);

  useEffect(() => {
    // Kiểm tra ngay khi load lần đầu (để không bị trễ 5 phút đầu)
    checkOverdueAppointments();

    // Tạo interval kiểm tra lại mỗi 5 phút
    const interval = setInterval(() => {
      checkOverdueAppointments();
    }, 5 * 60 * 1000); // 5 phút

    // Dọn dẹp interval khi unmount hoặc appointments thay đổi
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, [appointments, snoozeUntil]); // phụ thuộc appointments và snooze

  // Đảm bảo có auto update tổng tiền khi services thay đổi:
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
  useEffect(() => {
    if (!appointmentsToday) return;
    const pending = appointmentsToday.filter(a => a.status === "pending");
    setPendingAppointments(pending);
  }, [appointmentsToday]);

  if (loading) {
    return <div className="text-center py-20 text-gray-600">⏳ Loading dashboard...</div>;
  }
  if (userRole === "Salon_NhanVien" && hasFreelancerProfile === false) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center p-6 bg-[#23242a]">
        <div className="flex flex-1 items-center justify-center w-full">
          <div className="bg-[#22232a] border border-yellow-400 rounded-2xl p-8 mt-6 max-w-md w-full text-gray-100 shadow-2xl flex flex-col items-center">
            <h2 className="text-2xl font-bold text-yellow-300 mb-3 flex items-center gap-2">
              <span className="text-3xl">⚠️</span>
              You haven&apos;t registered a freelancer profile
            </h2>
            <p className="mb-6 text-center text-base text-gray-300">
              To use the dashboard, please complete your freelancer profile.
            </p>
            <button
              onClick={() => router.push("/freelancers/register")}
              className="bg-yellow-400 text-black w-full px-6 py-2 rounded-lg font-semibold hover:bg-yellow-300 transition text-lg shadow"
            >
              Register now
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function completeAppointmentById(appointmentId, options = {}) {
    setProcessingApptId(appointmentId);
    setActionError("");
    try {
      const token = await user.getIdToken();
      await fetch(
        `https://crypto-manager-backend.onrender.com/api/appointments/${appointmentId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: "completed",
            end_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
          }),
        }
      );
      await loadAppointments(
        token,
        setAppointments,
        setAppointmentsToday,
        setConfirmedNextClient,
        setPendingUpcomingAppointment,
        setTimeUntilNext,
        setShowPopup,
        setNewAppointment,
        soundRef,
        soundLoopRef,
        setUpcomingAppointments,
        setNextClientIndex
      );
      if (inProgressIndex >= inProgressAppointments.length - 1) setInProgressIndex(0);

      // Nếu truyền onSuccess từ auto-complete hoặc popup thì gọi
      if (options.onSuccess) options.onSuccess();

    } catch (err) {
      setActionError("Error: Could not complete appointment. Please try again.");
    }
    setProcessingApptId(null);
  }

  const handleConfirmAppointment = async (appointmentId) => {
    try {
      setProcessingApptId(appointmentId); // 👉 Set loading
      const token = await user.getIdToken();
      const res = await fetch(
        `https://crypto-manager-backend.onrender.com/api/appointments/${appointmentId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: "confirmed" }),
        }
      );
      if (res.ok) {
        clearSoundLoop(soundLoopRef);
        setShowPopup(false); // ✅ Tắt popup
        await loadAppointments(
          await user.getIdToken(),
          setAppointments,
          setAppointmentsToday,
          setConfirmedNextClient,
          setPendingUpcomingAppointment,
          setTimeUntilNext,
          setShowPopup,
          setNewAppointment,
          soundRef,
          soundLoopRef,
          setUpcomingAppointments,
          setNextClientIndex
        );
      }
    } catch (err) {
      console.error("❌ Error confirming appointment:", err.message);
    } finally {
      setProcessingApptId(null); // 👉 Reset loading
    }
  };


  const handleCancelAppointment = async (appointmentId) => {
    try {
      setCancelingApptId(appointmentId); // 🌀 Loading

      const token = await user.getIdToken();
      const res = await fetch(
        `https://crypto-manager-backend.onrender.com/api/appointments/${appointmentId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: "cancelled" }),
        }
      );

      if (res.ok) {
        clearSoundLoop(soundLoopRef);
        setShowPopup(false);

        await loadAppointments(
          token,
          setAppointments,
          setAppointmentsToday,
          setConfirmedNextClient,
          setPendingUpcomingAppointment,
          setTimeUntilNext,
          setShowPopup,
          setNewAppointment,
          soundRef,
          soundLoopRef,
          setUpcomingAppointments,
          setNextClientIndex
        );
      }
    } catch (err) {
      console.error("❌ Error cancelling appointment:", err.message);
    } finally {
      setCancelingApptId(null); // 🔚 Stop loading
    }
  };


  const steps = {
    has_avatar: onboarding?.avatar_url,
    has_license: onboarding?.license_url && onboarding?.license_status === "Approved",
    has_id: onboarding?.id_doc_url && onboarding?.id_doc_status === "Approved",
    has_salon: onboarding?.salon_id && onboarding?.employee_status === "active",
    has_payment: onboarding?.has_payment,
  };

  const allSteps = [
    { key: "has_avatar", label: "Upload Avatar" },
    { key: "has_license", label: "Upload License" },
    { key: "has_id", label: "Upload ID Document" },
    { key: "has_salon", label: "Select Salon" },
    { key: "has_payment", label: "Connect Payment Method" },
  ];

  const isComplete = Object.values(steps).every(Boolean);
  console.log("🔥 Payment Connected?", onboarding?.payment_connected);

  if (!isComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white/10 border border-white/20 rounded-2xl p-6 max-w-lg w-full text-gray-100 shadow-lg">
          <h2 className="text-2xl font-bold text-yellow-300 mb-4">🚧 Onboarding Not Completed</h2>
          <p className="text-sm mb-4">
            To access your dashboard, please complete all the following steps:
          </p>
          <ul className="text-left text-sm space-y-2 mb-6">
            {allSteps.map((step, index) => {
              const isCompleted = steps[step.key];
              const isLicenseReview = step.key === "has_license" && onboarding?.license_status === "In Review";
              const isIdReview = step.key === "has_id" && onboarding?.id_doc_status === "In Review";

              return (
                <li key={step.key} className="flex items-start gap-2">
                  <span className="text-yellow-400 font-medium shrink-0">{`Step ${index + 1}`}</span>
                  <div className="flex-1 flex flex-wrap items-center gap-1">
                    <span className={isCompleted ? "text-green-400 font-medium" : "text-white"}>
                      {step.label}
                    </span>
                    {(isLicenseReview || isIdReview) && (
                      <span className="text-xs text-blue-300">(In Review)</span>
                    )}
                    {isCompleted && <span className="text-green-400 text-sm">✔️</span>}
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => router.push("/freelancers/me")}
            className="bg-gradient-to-r from-yellow-400 to-pink-500 hover:to-pink-600 text-white font-semibold px-6 py-2 rounded-xl shadow transition"
          >
            👉 Go to Complete Onboarding
          </button>
        </div>
      </div>
    );
  }
  console.log("user", user);
  console.log("hasFreelancerProfile", hasFreelancerProfile);
  console.log("onboarding", onboarding);

  return (
    <div className="min-h-screen text-white px-4 py-6 font-mono sm:font-['Pacifico', cursive]">
      <Navbar />
      <audio ref={soundRef} src="/notification.wav" preload="auto" />

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
                await loadAppointments(
                  token,
                  setAppointments,
                  setAppointmentsToday,
                  setConfirmedNextClient,
                  setPendingUpcomingAppointment,
                  setTimeUntilNext,
                  setShowPopup,
                  setNewAppointment,
                  soundRef,
                  soundLoopRef,
                  setUpcomingAppointments,
                  setNextClientIndex
                );
                setShowInvoicePopup(false);
                setSavingInvoice(false);
                // Reload lại appointmentsToday và nowServing

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
              {savingInvoice ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Saving...
                </div>
              ) : (
                "Complete & Save Invoice"
              )}

            </button>
          </form>
        </div>
      )}

      {overdueWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md w-full relative animate-fade-in border-4 border-pink-300">
            <button
              className="absolute top-2 right-3 text-pink-400 text-xl font-bold"
              onClick={() => setOverdueWarning(null)}
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-xl font-bold text-emerald-600 mb-4 flex items-center gap-2">
              ⏰ Service Time Overdue
            </h2>
            <div className="mb-4 text-gray-700">
              <b>{overdueWarning.customer_name}</b> has been in service for <b className="text-pink-400">
                {Math.round(dayjs().diff(dayjs(overdueWarning.started_at, "YYYY-MM-DD HH:mm:ss"), "minute") / 60)}h {dayjs().diff(dayjs(overdueWarning.started_at, "YYYY-MM-DD HH:mm:ss"), "minute") % 60} min
              </b>, which is over the estimated duration of <span className="font-semibold text-yellow-500">{overdueWarning.services.reduce((sum, s) => sum + (s.duration || s.duration_minutes || 0), 0)} min</span>.<br /><br />
              <span className="font-semibold text-pink-400">Please complete this appointment, or continue serving if you need more time.</span>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 py-2 rounded-lg shadow flex items-center justify-center gap-2"
                onClick={async () => {
                  // Lấy appointment đang serving
                  const appt = inProgressAppointments[inProgressIndex];
                  console.log(appt);
                  // Chuẩn bị dữ liệu hóa đơn mặc định
                  setInvoiceForm({
                    appointment_id: appt.id,
                    customer_name: appt.customer_name,
                    customer_phone: appt.customer_phone,
                    stylist_id: appt.stylist_id,
                    stylist_name: appt.customer_name || user?.displayName,
                    salon_id: appt.salon_id,
                    services: appt.services.map(s => ({
                      id: s.id,
                      name: s.name,
                      price: s.price,
                      duration: s.duration || s.duration_minutes,
                      quantity: 1, // mặc định 1
                    })),
                    total_amount: appt.services.reduce((sum, s) => sum + (s.price || 0), 0),
                    total_duration: Math.round(
                      (dayjs().diff(dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss"), "minute"))
                    ),
                    actual_start_at: appt.started_at,
                    actual_end_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                    notes: appt.note || "",
                  });
                  setShowInvoicePopup(true);
                  setOverdueWarning(null);
                }}
              >
                <svg className="w-5 h-5 mr-1" fill="none" viewBox="0 0 24 24">
                  <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                </svg>
                Complete
              </button>
              <button
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-black font-bold px-6 py-2 rounded-lg shadow"
                onClick={() => {
                  // Snooze this appointment's warning for 30 minutes
                  setSnoozeUntil(prev => ({
                    ...prev,
                    [overdueWarning.id]: dayjs().add(30, "minute")
                  }));
                  setOverdueWarning(null);
                }}
              >
                Keep Serving
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-4">
              This reminder will show again after 30 minutes if the appointment is still not completed.
            </div>
          </div>
        </div>
      )}

      {showPopup && pendingUpcomingAppointment && (
        <div className="fixed bottom-4 right-4 z-50 bg-white text-black rounded-xl px-8 py-2 shadow-xl border-l-8 border-emerald-500 animate-popup max-w-sm w-[90%] sm:w-auto space-y-2">

          {/* 💰 Tổng tiền góc trên phải */}
          <div className="absolute top-2 right-2 bg-yellow-400 text-black text-xs font-bold px-3 py-1 rounded-full shadow">
            💰 $
            {pendingUpcomingAppointment.services?.reduce((sum, s) => sum + (s.price || 0), 0)}
          </div>

          {/* Tiêu đề */}
          <h2 className="text-lg mt-6 font-bold text-emerald-700">📢 New Appointment</h2>

          {/* Tên khách */}
          <p className="font-semibold text-pink-600">{pendingUpcomingAppointment.customer_name}</p>

          {/* Ngày giờ */}
          <p className="text-sm text-gray-700">
            📅{" "}
            {dayjs(pendingUpcomingAppointment.appointment_date.replace("Z", "")).format("MMM D, hh:mm A")}
          </p>

          {/* Dịch vụ */}
          <p className="text-sm text-emerald-600 capitalize">
            💅 {pendingUpcomingAppointment.services?.map((s) => s.name).join(", ")}
          </p>

          {/* Tổng thời gian */}
          <p className="text-sm text-blue-500">
            ⏱ Estimated Time:{" "}
            {pendingUpcomingAppointment.services?.reduce(
              (total, s) => total + (s.duration || s.duration_minutes || 0),
              0
            )}{" "}
            minutes
          </p>

          {/* Note từ khách hàng (nếu có) */}
          {pendingUpcomingAppointment.note && (
            <p className="text-sm text-gray-800">
              💬 <span className="italic">{pendingUpcomingAppointment.note}</span>
            </p>
          )}

          {/* Slide-to-confirm */}
          <div className="mt-4">
            <input
              type="range"
              min="0"
              max="100"
              value={sliderValue}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                setSliderValue(value);

                if (value === 100) {
                  setIsConfirmed(true);
                  handleConfirmAppointment(pendingUpcomingAppointment.id);
                  setTimeout(() => {
                    setIsConfirmed(false);
                    setSliderValue(0);
                    setShowPopup(false);
                  }, 2000);
                }
              }}
              className="w-full h-10 bg-gray-200 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #10b981 0%, #10b981 ${sliderValue}%, #e5e7eb ${sliderValue}%, #e5e7eb 100%)`,
              }}
            />
            <p className="text-center text-sm text-gray-500 mt-2">
              {isConfirmed ? "✅ Confirmed!" : "Slide to Confirm"}
            </p>
            <div className="w-full h-2 bg-gray-200 rounded overflow-hidden mt-2">
              <div
                className="h-full bg-emerald-500 origin-left"
                style={{
                  transform: "scaleX(0)",
                  animation: "progressSlide 21s linear forwards",
                }}
              ></div>
            </div>
          </div>

          {/* Nút cancel */}
          <button
            onClick={() => handleCancelAppointment(pendingUpcomingAppointment.id)}
            className="text-sm text-red-500 underline mt-2"
          >
            ❌ Cancel Appointment
          </button>
        </div>
      )}
      {latePopup && (
        <div className="fixed bottom-6 right-3 z-50 bg-white text-gray-800 rounded-lg px-3 py-2 shadow-xl border-l-4 border-pink-400 animate-popup w-[95vw] max-w-xs sm:max-w-sm text-sm space-y-2">
          <h2 className="font-bold text-base text-pink-500 flex items-center gap-2">
            <FiClock className="text-lg" />
            Appointment Is Waiting!
          </h2>
          <div className="mb-1">
            <b>Client:</b> {latePopup.customer_name} <br />
            <b>Service:</b> {latePopup.services?.map((s) => s.name).join(", ")} <br />
            <b>Booked Time:</b> {dayjs(latePopup.appointment_date.replace("Z", "")).format("MMM D, HH:mm")}
            <br />
            <b>Late:</b>
            <span className="font-bold text-red-500 ml-1">
              {Math.max(
                0,
                now.diff(dayjs(latePopup.appointment_date.replace("Z", "")), "minute")
              )}{" "}
              min
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {/* Start service */}
            <button
              onClick={async () => {
                const token = await user.getIdToken();
                await fetch(
                  `https://crypto-manager-backend.onrender.com/api/appointments/${latePopup.id}`,
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
                clearWaitingTimeout();
                setLatePopup(null);
                setHideLatePopupUntil(null);

                // ⭐️ GỌI LẠI loadAppointments SAU KHI PATCH
                await loadAppointments(
                  token,
                  setAppointments,
                  setAppointmentsToday,
                  setConfirmedNextClient,
                  setPendingUpcomingAppointment,
                  setTimeUntilNext,
                  setShowPopup,
                  setNewAppointment,
                  soundRef,
                  soundLoopRef,
                  setUpcomingAppointments,
                  setNextClientIndex
                );
              }}
              className="bg-emerald-500 text-white px-3 py-1 rounded font-bold hover:bg-emerald-600 text-xs"
            >
              👉 Start Service Now
            </button>
            {/* Cancel appointment */}
            <button
              onClick={async () => {
                const token = await user.getIdToken();
                await fetch(
                  `https://crypto-manager-backend.onrender.com/api/appointments/${latePopup.id}`,
                  {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ status: "cancelled" }),
                  }
                );
                clearWaitingTimeout();
                setLatePopup(null);
                setHideLatePopupUntil(null);

                await loadAppointments(
                  token,
                  setAppointments,
                  setAppointmentsToday,
                  setConfirmedNextClient,
                  setPendingUpcomingAppointment,
                  setTimeUntilNext,
                  setShowPopup,
                  setNewAppointment,
                  soundRef,
                  soundLoopRef,
                  setUpcomingAppointments,
                  setNextClientIndex
                );
              }}
              className="bg-red-400 text-white px-3 py-1 rounded font-bold hover:bg-red-500 text-xs"
            >
              ❌ Cancel Appointment
            </button>
            {/* Wait more */}
            <div className="flex flex-row items-center gap-2">
              <span>⏳ Wait more: </span>
              <select
                value={waitMinutes}
                onChange={(e) => setWaitMinutes(Number(e.target.value))}
                className="border rounded px-2 py-1 text-xs"
              >
                {[5, 10, 15, 20].map((m) => (
                  <option value={m} key={m}>
                    {m} mins
                  </option>
                ))}
              </select>
              <button
                className="bg-yellow-400 hover:bg-yellow-500 text-black font-bold px-2 py-1 rounded text-xs"
                onClick={() => {
                  clearWaitingTimeout();
                  setLatePopup(null);
                  const until = dayjs().add(waitMinutes, "minute");
                  setHideLatePopupUntil(until);
                  waitingTimeout.current = setTimeout(() => setLatePopup(latePopup), waitMinutes * 60000);
                }}
              >
                Wait
              </button>
            </div>
            {/* Overlap warning giữ nguyên */}
            {(() => {
              const allUpcoming = appointments
                .filter(
                  (a) =>
                    a.status === "confirmed" &&
                    dayjs(a.appointment_date.replace("Z", "")).isAfter(
                      dayjs(latePopup.appointment_date.replace("Z", ""))
                    )
                )
                .sort(
                  (a, b) =>
                    dayjs(a.appointment_date.replace("Z", "")) -
                    dayjs(b.appointment_date.replace("Z", ""))
                );
              if (allUpcoming.length) {
                const nextAppt = allUpcoming[0];
                const estStart = now.add(waitMinutes, "minute");
                const estEnd = estStart.add(latePopup.duration_minutes || 30, "minute");
                if (
                  estEnd.isAfter(dayjs(nextAppt.appointment_date.replace("Z", "")))
                ) {
                  return (
                    <div className="text-red-600 font-bold mt-1 text-xs">
                      ⚠️ Warning: If you wait {waitMinutes} minutes, the next appointment (
                      {dayjs(nextAppt.appointment_date.replace("Z", "")).format("HH:mm")}
                      ) will be affected!
                    </div>
                  );
                }
              }
              return null;
            })()}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-2">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6 mt-1">
          {/* Welcome Block */}
          <div className="col-span-12 md:col-span-12 flex flex-col md:flex-row md:items-center gap-2 p-1 pb-2">
            {/* Avatar */}
            <div className="relative w-24 h-24 flex-shrink-0 flex items-center justify-center mb-1 md:mb-0">
              {/* Viền ngoài gradient 2 lớp */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 via-pink-400 to-yellow-400"></div>
              {/* Viền trắng trong */}
              <div className="absolute inset-1 rounded-full bg-white shadow-lg"></div>
              {/* Avatar */}
              <img
                src={onboarding?.avatar_url || "/default-avatar.png"}
                alt="Freelancer Avatar"
                className="relative w-20 h-20 rounded-full object-cover aspect-square border-2 border-white shadow-xl z-10"
                onError={e => { e.currentTarget.src = "/default-avatar.png"; }}
              />
              {/* Icon crown hoặc icon xịn nổi góc nếu muốn */}
              <div className="absolute bottom-2 right-2 bg-yellow-300 rounded-full shadow p-1">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-emerald-800">
                  <path d="M2.5 13.5L5 7l5 7 5-7 2.5 6.5-7.5 5z" />
                </svg>
              </div>
              <div className="absolute top-14 -right-12 text-white rounded-full p-[4px] text-2xl  rotate-12">
                ✨
              </div>
              <div className="absolute top-22 -right-55 text-white rounded-full p-[6px] text-3xl rotate-[-10deg]">
                ✨
              </div>
              <div className="absolute top-1 -right-40 text-white rounded-full p-[6px] text-xl rotate-[-10deg]">
                ✨
              </div>
            </div>
            <div className="text-base font-bold text-emerald-300">{user?.displayName || onboarding?.name || "Freelancer"}</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center bg-emerald-400/80 px-2 py-[2px] rounded-sm shadow text-yellow-100 font-bold text-sm">
                {[...Array(5)].map((_, i) => {
                  // Nếu rating > 0 thì show đúng số sao, còn lại luôn là 5 sao vàng
                  const starCount = onboarding?.rating > 0 ? Math.round(onboarding.rating) : 5;
                  return (
                    <svg
                      key={i}
                      viewBox="0 0 20 20"
                      fill={i < starCount ? "#facc15" : "#d1d5db"}
                      className="w-4 h-4"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.974a1 1 0 00.95.69h4.184c.969 0 1.371 1.24.588 1.81l-3.39 2.46a1 1 0 00-.364 1.118l1.286 3.974c.3.921-.755 1.688-1.538 1.118l-3.39-2.46a1 1 0 00-1.176 0l-3.39 2.46c-.783.57-1.838-.197-1.539-1.118l1.287-3.974a1 1 0 00-.364-1.118L2.04 9.401c-.783-.57-.38-1.81.588-1.81h4.183a1 1 0 00.951-.69l1.287-3.974z" />
                    </svg>
                  );
                })}
                {/* Hiển thị số điểm: nếu rating > 0 thì show điểm, ngược lại mặc định là 5.0 */}
                <span className="ml-1">
                  {onboarding?.rating > 0 ? Number(onboarding.rating).toFixed(1) : "5.0"}
                </span>
              </div>
              <span className="text-xs text-yellow-300 font-semibold ml-2">
                ⭐ {onboarding?.review_count || 0} reviews
              </span>
            </div>

            {/* Thông tin + Total earning */}
            <div className="flex-1 flex flex-col items-center justify-center gap-1 mt-4 mb-1">
              {/* Tên + Rating + Review */}
              <div className="flex flex-col items-center">

              </div>
              {/* Tổng tiền hôm nay */}
              <div className="flex items-center justify-center gap-2 mb-2 mt-2">
                <div className="relative inline-flex items-center justify-center px-6 py-2 rounded-2xl bg-gradient-to-r from-yellow-300 via-amber-200 to-yellow-400 shadow-xl border-2 border-yellow-400">
                  <FiDollarSign className="text-2xl text-emerald-700 drop-shadow-lg" />
                  <span className="text-3xl font-extrabold text-emerald-700 drop-shadow-lg tracking-wider" style={{ textShadow: "0 2px 12px #fde68a" }}>
                    {todayEarnings.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Thống kê appointments hôm nay */}
              <div className="flex gap-6 mt-2 w-full justify-center">
                <div className="text-xs font-medium text-white/90">
                  <FiCalendar className="inline-block mr-1 text-yellow-300" />
                  {totalAppointmentsToday} Appointment(s)
                </div>
                <div className="text-xs font-medium text-white/90">
                  <FiClock className="inline-block mr-1 text-emerald-300" />
                  {totalHoursToday} Hours
                </div>
              </div>
            </div>

          </div>

          <div className="relative col-span-12 md:col-span-6 h-full">
            {/* 🔗 Icon chuyển trang góc phải */}
            <button
              onClick={() => router.push("/freelancers/appointments")}
              className="absolute top-2 right-2 z-10 p-1 text-white/60 hover:text-pink-600 transition"
              title="View all appointments"
            >
              <SquareArrowOutUpRight className="w-4 h-4 text-pink-300 hover:text-pink-400" />
            </button>
            {/* Appointments */}
            <Card
              className="relative col-span-12 md:col-span-6 h-full"
              icon={<FiCalendar />}
              title="Appointments"
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

                    <div className="flex flex-col md:flex-row gap-2 mt-3 w-full">
                      {/* Confirm Button */}
                      <button
                        className={`flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-3xl font-bold shadow text-lg flex items-center justify-center gap-2
                          ${processingApptId === pendingAppointments[pendingIndex].id ? "opacity-60 cursor-not-allowed" : ""}
                        `}
                        disabled={processingApptId === pendingAppointments[pendingIndex].id}
                        onClick={() => handleConfirmAppointment(pendingAppointments[pendingIndex].id)}
                      >
                        {processingApptId === pendingAppointments[pendingIndex].id ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <svg className="w-6 h-6 mr-1" fill="none" viewBox="0 0 24 24">
                              <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                            </svg>
                            Confirm
                          </>
                        )}
                      </button>

                      {/* Cancel Button */}
                      <button
                        className={`flex-1 px-4 py-2 bg-red-400 hover:bg-red-500 text-white rounded-3xl font-bold shadow text-lg flex items-center justify-center gap-2
                        ${cancelingApptId === pendingAppointments[pendingIndex].id ? "opacity-60 cursor-not-allowed" : ""}
                        `}
                        disabled={cancelingApptId === pendingAppointments[pendingIndex].id}
                        onClick={() => handleCancelAppointment(pendingAppointments[pendingIndex].id)}
                      >
                        {cancelingApptId === pendingAppointments[pendingIndex].id ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Cancelling...
                          </>
                        ) : (
                          <>
                            <svg className="w-6 h-6 mr-1" fill="none" viewBox="0 0 24 24">
                              <path d="M6 18L18 6M6 6l12 12" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Cancel
                          </>
                        )}
                      </button>
                    </div>
                    {/* Điều hướng giữa nhiều appointment */}
                    {pendingAppointments.length > 1 && (
                      <div className="flex gap-2 mt-4 items-center justify-center">
                        <button
                          onClick={() =>
                            setPendingIndex((idx) => (idx > 0 ? idx - 1 : pendingAppointments.length - 1))
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
                            setPendingIndex((idx) => (idx < pendingAppointments.length - 1 ? idx + 1 : 0))
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
                        <circle cx="50" cy="50" r="45" stroke="#f472b6" strokeWidth="2" className="opacity-50" />
                        <circle cx="50" cy="50" r="30" stroke="#facc15" strokeWidth="1" className="opacity-30" />
                        <circle cx="50" cy="50" r="15" stroke="#facc15" strokeWidth="1" className="opacity-30" />
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
            />
          </div>

          {/* Next Client */}
          <Card
            className="col-span-12 md:col-span-6 capitalize h-full"
            icon={<FiClock />}
            title="Next Client"
            value={
              upcomingAppointments.length > 0 ? (
                formatNextAppointmentTime(upcomingAppointments[nextClientIndex].appointment_date)
              ) : (
                ""
              )
            }
            extra={
              <AppointmentNotification
                pendingCount={pendingCount}
                cancelledCount={cancelledCount}
                messageCount={messageCount}
              />
            }
            sub={
              upcomingAppointments.length > 0 ? (
                <div className="flex flex-col gap-2 p-4 rounded-xl card-animate-in w-full">
                  {/* Tên khách */}
                  <div className="flex items-center gap-2 font-bold text-yellow-200 capitalize truncate">
                    <FiUser className="w-5 h-5 text-pink-300" />
                    {upcomingAppointments[nextClientIndex].customer_name}
                  </div>
                  {/* Dịch vụ */}
                  <div className="flex items-center gap-2 text-xs text-emerald-300 capitalize truncate">
                    <FiTag className="w-4 h-4 text-yellow-300" />
                    {upcomingAppointments[nextClientIndex].services?.map(s => s.name).join(", ")}
                  </div>
                  {/* Estimate Time */}
                  {estimateMinutes > 0 && (
                    <div className="flex items-center gap-2 text-xs text-blue-400">
                      <FiClock className="w-4 h-4 text-blue-300" />
                      <span>
                        Estimated Time: <span className="font-semibold text-emerald-200">{estimateMinutes} min</span>
                      </span>
                    </div>
                  )}
                  {/* Thời gian chờ/lateness */}
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                    </svg>
                    <span className="text-sm text-emerald-200 font-semibold">
                      {upcomingAppointments.length > 0
                        ? formatTimeUntilNextWithLate(upcomingAppointments[nextClientIndex].appointment_date)
                        : ""}
                    </span>

                  </div>
                  {/* Nút Start Service */}
                  {!upcomingAppointments[nextClientIndex].started_at &&
                    upcomingAppointments[nextClientIndex].status === "confirmed" && (
                      <button
                        className={`mt-4 w-full md:w-auto self-start px-8 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-3xl font-bold shadow transition text-lg flex items-center justify-center md:justify-start gap-2
                     ${processingApptId === upcomingAppointments[nextClientIndex].id ? "opacity-60 cursor-not-allowed" : ""}
                      `}
                        disabled={processingApptId === upcomingAppointments[nextClientIndex].id}
                        onClick={async () => {
                          setProcessingApptId(upcomingAppointments[nextClientIndex].id);
                          setActionError("");
                          try {
                            const token = await user.getIdToken();
                            await fetch(
                              `https://crypto-manager-backend.onrender.com/api/appointments/${upcomingAppointments[nextClientIndex].id}`,
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
                            await loadAppointments(
                              token,
                              setAppointments,
                              setAppointmentsToday,
                              setConfirmedNextClient,
                              setPendingUpcomingAppointment,
                              setTimeUntilNext,
                              setShowPopup,
                              setNewAppointment,
                              soundRef,
                              soundLoopRef,
                              setUpcomingAppointments,
                              setNextClientIndex
                            );
                          } catch (err) {
                            setActionError("Đã có lỗi, thử lại!");
                          }
                          setProcessingApptId(null);
                        }}
                      >
                        {processingApptId === upcomingAppointments[nextClientIndex].id ? (
                          <>
                            <Loader2 className="animate-spin w-5 h-5" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24">
                              <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                            </svg>
                            Start
                          </>
                        )}
                      </button>
                    )}
                  {actionError && (
                    <div className="text-xs text-red-400 mt-1">{actionError}</div>
                  )}
                  {/* Điều hướng next/prev nếu có nhiều client */}
                  {upcomingAppointments.length > 1 && (
                    <div className="flex gap-2 mt-2 items-center justify-center">
                      <button
                        onClick={() => setNextClientIndex(idx => idx > 0 ? idx - 1 : upcomingAppointments.length - 1)}
                        className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                        aria-label="Previous client"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                      <span className="mx-2 text-xs text-pink-400">
                        {`${nextClientIndex + 1} / ${upcomingAppointments.length}`}
                      </span>
                      <button
                        onClick={() => setNextClientIndex(idx => idx < upcomingAppointments.length - 1 ? idx + 1 : 0)}
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
                  {/* Animated energy wave */}
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

                  <span className="font-semibold text-pink-200">Waiting for next client</span>
                  <span className="text-xs text-white/40 mt-1 animate-pulse">No upcoming appointments</span>
                </div>
              )
            }
          />

          {/* Danh sách appointments in progress */}
          {inProgressAppointments.length > 0 && (
            <Card
              className="col-span-12 md:col-span-12 h-full"
              icon={<FiUser />}
              title="Now Serving"
              value=""
              sub={
                <div className="flex flex-col gap-1 p-4 rounded-xl card-animate-in w-full">
                  {/* Info khách + dịch vụ + timer */}
                  <div className="flex items-center gap-2 font-bold text-yellow-200 capitalize truncate">
                    <FiUser className="w-5 h-5 text-pink-300" />
                    {inProgressAppointments[inProgressIndex]?.customer_name}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-emerald-300 capitalize truncate mt-1">
                    <FiTag className="w-4 h-4 text-yellow-300" />
                    {inProgressAppointments[inProgressIndex]?.services?.map(s => s.name).join(", ")}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <path d="M12 8v4l3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                    </svg>
                    <span className="text-sm text-emerald-200 font-semibold">
                      In Service: {formatSeconds(serviceTimers[inProgressAppointments[inProgressIndex]?.id])}
                    </span>
                  </div>
                  {/* Nút Complete ngay dưới info */}
                  <button
                    className={`mt-4 w-full md:w-auto self-start px-12 py-2 bg-gradient-to-r from-pink-500 via-yellow-400 to-emerald-400 hover:from-pink-600 text-white rounded-3xl font-bold shadow transition text-lg flex items-center justify-center md:justify-start gap-2
    ${processingApptId === inProgressAppointments[inProgressIndex]?.id ? "opacity-60 cursor-not-allowed" : ""}
  `}
                    disabled={processingApptId === inProgressAppointments[inProgressIndex]?.id}
                    onClick={async () => {
                      // Lấy appointment đang serving
                      const appt = inProgressAppointments[inProgressIndex];
                      console.log("DEBUG appt", appt);
                      // Chuẩn bị dữ liệu hóa đơn mặc định
                      setInvoiceForm({
                        appointment_id: appt.id,
                        customer_name: appt.customer_name,
                        customer_phone: appt.customer_phone,
                        stylist_id: appt.stylist_id,              // <-- ĐÚNG
                        stylist_name: appt.stylist_name || user?.displayName, // (có thể lấy từ getFreelancerInfo nếu muốn chuẩn hơn)
                        salon_id: appt.salon_id,
                        services: appt.services.map(s => ({
                          id: s.id,
                          name: s.name,
                          price: s.price,
                          duration: s.duration || s.duration_minutes,
                          quantity: 1, // mặc định 1
                        })),
                        total_amount: appt.services.reduce((sum, s) => sum + (s.price || 0), 0),
                        total_duration: Math.round(
                          (dayjs().diff(dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss"), "minute"))
                        ),
                        actual_start_at: appt.started_at,
                        actual_end_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                        notes: appt.note || "",
                      });
                      setShowInvoicePopup(true);
                    }}

                  >
                    {processingApptId === inProgressAppointments[inProgressIndex]?.id ? (
                      <>
                        <Loader2 className="animate-spin w-5 h-5" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <FiCheckCircle className="w-5 h-5" />
                        Complete
                      </>
                    )}
                  </button>
                  {actionError && (
                    <div className="text-xs text-red-400 mt-1">{actionError}</div>
                  )}

                  {/* Điều hướng trái/phải nếu có nhiều hơn 1 appointment */}
                  {inProgressAppointments.length > 1 && (
                    <div className="flex gap-2 mt-2 items-center justify-center">
                      <button
                        onClick={() => setInProgressIndex(idx => idx > 0 ? idx - 1 : inProgressAppointments.length - 1)}
                        className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                        aria-label="Previous in-progress"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                      <span className="mx-2 text-xs text-pink-400">
                        {`${inProgressIndex + 1} / ${inProgressAppointments.length}`}
                      </span>
                      <button
                        onClick={() => setInProgressIndex(idx => idx < inProgressAppointments.length - 1 ? idx + 1 : 0)}
                        className="p-1 rounded-full bg-pink-200/30 hover:bg-pink-400/80 text-pink-600 font-bold text-lg transition flex items-center"
                        aria-label="Next in-progress"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>
                    </div>
                  )}
                </div>
              }
            />

          )}
          <div className="col-span-12 bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-2 border-b-2 border-pink-400 shadow-lg rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-pink-300">💈 Services</h3>
              <button
                className="text-pink-300 hover:text-pink-200 transition"
                onClick={() => setShowServiceDetails((prev) => !prev)}
                title={showServiceDetails ? "Hide details" : "View selected services"}
              >
                {showServiceDetails ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <div className="flex items-center gap-1">
                    <Eye className="w-5 h-5" />
                    <span className="text-xs text-yellow-300 font-semibold">
                      {availableServices.length}
                    </span>
                  </div>
                )}
              </button>

            </div>

            {!showServiceDetails ? (
              <p className="text-sm text-white/80">
                You have selected <span className="font-semibold text-emerald-300">{selectedServiceIds.length}</span> service{selectedServiceIds.length !== 1 ? "s" : ""}.
              </p>
            ) : (
              <>
                {availableServices.length === 0 ? (
                  <p className="text-sm text-red-300 italic">No services found for your specialization.</p>
                ) : (
                  <div
                    className="custom-scrollbar max-h-[280px] overflow-y-auto pr-1"
                    style={{
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      touchAction: "pan-y",
                    }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      {availableServices.map((srv) => {
                        const checked = selectedServiceIds.includes(srv.id);
                        return (
                          <label
                            key={srv.id}
                            className={`flex items-start gap-3 bg-white/5 p-3 rounded-xl shadow hover:bg-white/10 transition cursor-pointer capitalize relative`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={savingStatus === "saving" || updatingServiceId === srv.id}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                const newIds = checked
                                  ? [...selectedServiceIds, srv.id]
                                  : selectedServiceIds.filter((id) => id !== srv.id);

                                setUpdatingServiceId(srv.id);
                                setSavingStatus("saving");
                                setSelectedServiceIds(newIds);

                                try {
                                  const token = await user.getIdToken();
                                  const res = await fetch(
                                    "https://crypto-manager-backend.onrender.com/api/freelancers/services",
                                    {
                                      method: "PATCH",
                                      headers: {
                                        Authorization: `Bearer ${token}`,
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({ service_ids: newIds }),
                                    }
                                  );
                                  if (!res.ok) throw new Error("Failed to update services");
                                  setSavingStatus("saved");
                                  setTimeout(() => setSavingStatus(""), 1200);
                                } catch (err) {
                                  setSavingStatus("error");
                                  setTimeout(() => setSavingStatus(""), 1500);
                                }
                                setUpdatingServiceId(null);
                              }}
                              className="accent-pink-500 mt-1"
                            />
                            <div className="flex flex-col">
                              <span className="font-semibold text-pink-300 flex items-center gap-2">
                                {srv.name}
                                {updatingServiceId === srv.id && savingStatus === "saving" && (
                                  <Loader2 className="animate-spin w-4 h-4 text-yellow-400 ml-1" />
                                )}
                                {checked && savingStatus === "saved" && updatingServiceId === null && (
                                  <CheckCircle className="ml-1 w-4 h-4 text-emerald-400 drop-shadow" />
                                )}
                              </span>
                              <span className="text-xs text-emerald-300">
                                ${srv.price} – {srv.duration_minutes} min
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {savingStatus === "error" && (
                      <div className="text-red-400 text-sm mt-2 animate-bounce-in">
                        Save failed! Please try again.
                      </div>
                    )}
                  </div>

                )}
              </>
            )}
          </div>
          {/* Quick Actions */}
          <div className="col-span-12">
            <h3 className="text-lg font-bold mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <ActionButton label="📅 My Schedule" onClick={() => router.push("/freelancers/schedule")} />
              <ActionButton label="🧾 Appointments" onClick={() => router.push("/freelancers/appointments")} />
              <ActionButton label="💬 Chat" onClick={() => router.push("/freelancers/chat")} />
              <ActionButton label="💸 Withdraw" onClick={() => router.push("/freelancers/withdraw")} />
            </div>
          </div>
        </div>
      </div>

    </div >
  );
}
function Card({ icon, title, value, sub, children, className = "", extra = null }) {
  return (
    <div
      className={`relative ${className} bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-2 border-b-2 border-pink-400 rounded-2xl shadow-lg p-5 transition-all`}
    >
      {/* Extra slot: ví dụ như chuông thông báo */}
      {extra && (
        <div className="absolute top-3 right-3 z-10">
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

async function loadAppointments(
  token,
  setAppointments,
  setAppointmentsToday,
  setConfirmedNextClient,
  setPendingUpcomingAppointment,
  setTimeUntilNext,
  setShowPopup,
  setNewAppointment,
  soundRef,
  soundLoopRef,
  setUpcomingAppointments,
  setNextClientIndex
) {
  const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/freelancer", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const apptData = await res.json();

  // --- BỔ SUNG KIỂM TRA ĐÂY ---
  if (!Array.isArray(apptData)) {
    console.error("appointments API trả về không phải array:", apptData);
    setAppointments([]);
    setAppointmentsToday([]);
    setConfirmedNextClient(null);
    setPendingUpcomingAppointment(null);
    setTimeUntilNext("");
    setShowPopup(false);
    setNewAppointment(null);
    return;
  }

  setAppointments(apptData);

  const now = dayjs();

  // 🔽 Lọc lịch hôm nay
  const todayFiltered = apptData.filter((appt) =>
    new Date(appt.appointment_date).toDateString() === new Date().toDateString()
  );
  setAppointmentsToday(todayFiltered);

  // 🔔 Lấy cuộc hẹn pending gần nhất trong tương lai → dùng cho popup
  const pendingUpcoming = apptData
    .filter((a) =>
      a.status === "pending" &&
      dayjs(a.appointment_date.replace("Z", "")).isAfter(now)
    )
    .sort((a, b) =>
      dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
    );

  const nextPending = pendingUpcoming[0] || null;
  setPendingUpcomingAppointment(nextPending);

  if (nextPending) {
    setNewAppointment(nextPending);
    setShowPopup(true);

    let elapsed = 0;
    const interval = 200; // ms mỗi bước
    const total = 21000; // tổng thời gian

    const progressTimer = setInterval(() => {
      elapsed += interval;
      const percent = Math.min(100, (elapsed / total) * 100);
    }, interval);

    setTimeout(() => {
      clearInterval(progressTimer);
      clearSoundLoop(soundLoopRef);
      setShowPopup(false);
    }, total);

    clearSoundLoop(soundLoopRef);
    soundRef.current?.play();
    soundLoopRef.current = setInterval(() => {
      soundRef.current?.play();
    }, 3000);

    setTimeout(() => {
      if (soundLoopRef.current) {
        clearInterval(soundLoopRef.current);
        soundLoopRef.current = null;
      }
      setShowPopup(false);
    }, 21000);
  }

  // 🟢 Lấy lịch đã confirmed gần nhất trong tương lai → dùng cho Next Client
  const confirmedUnstarted = apptData
    .filter((a) =>
      a.status === "confirmed" && !a.started_at
    )
    .sort((a, b) =>
      dayjs(a.appointment_date.replace("Z", "")).diff(dayjs(b.appointment_date.replace("Z", "")))
    );

  setUpcomingAppointments(confirmedUnstarted);
  setConfirmedNextClient(confirmedUnstarted[0] || null);
  setNextClientIndex(0); // reset về đầu mỗi khi reload data

  // ⏳ Cập nhật đồng hồ đếm thời gian tới lịch gần nhất (dành cho hiển thị next)
  if (confirmedUnstarted[0]) {
    const apptTime = dayjs(confirmedUnstarted[0].appointment_date.replace("Z", ""));
    const diffMinutes = apptTime.diff(now, "minute");

    let timeUntil = "";
    if (diffMinutes > 0) {
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;
      timeUntil = hours > 0
        ? `⏳ In ${hours}h ${minutes}m`
        : `⏳ In ${minutes} minute${minutes > 1 ? "s" : ""}`;
    } else {
      timeUntil = `🔴 Late ${Math.abs(diffMinutes)} min`;
    }
    setTimeUntilNext(timeUntil);
  } else {
    setTimeUntilNext("");
  }
}

function formatSeconds(sec) {
  if (sec == null) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function clearSoundLoop(soundLoopRef) {
  if (soundLoopRef.current) {
    clearInterval(soundLoopRef.current);
    soundLoopRef.current = null;
  }
}
function formatNextAppointmentTime(appointmentDate) {
  if (!appointmentDate) return "No upcoming";

  const now = dayjs();
  const date = dayjs(appointmentDate.replace("Z", ""));
  const diffHours = date.diff(now, "hour");
  const diffDays = date.diff(now, "day");

  if (diffHours < 24 && now.isSame(date, "day")) {
    // Hôm nay, show giờ
    return date.format("hh:mm A");
  } else if (diffDays === 1) {
    // Ngày mai
    return `Tomorrow, ${date.format("hh:mm A")}`;
  } else if (diffDays > 1 && diffDays < 7) {
    // Trong tuần này, show thứ
    return `${date.format("dddd")}, ${date.format("hh:mm A")}`;
  } else {
    // Lớn hơn 7 ngày, show ngày tháng
    return date.format("DD/MM/YYYY, hh:mm A");
  }
}

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