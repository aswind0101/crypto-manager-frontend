// ✅ FULL FILE: freelancers/index.js
import { useEffect, useState, useRef } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import { useRouter } from "next/router";
import {
  FiDollarSign,
  FiClock,
  FiCalendar,
  FiExternalLink,
  FiCheckCircle,
  FiUser,
  FiScissors,
  FiTag,
} from "react-icons/fi";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { checkFreelancerExists } from "../../components/utils/checkFreelancer";
import { Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);
dayjs.extend(timezone);


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

  const [showPopup, setShowPopup] = useState(false);
  const [latePopup, setLatePopup] = useState(null); // chứa appointment & logic chờ
  const [waitMinutes, setWaitMinutes] = useState(5); // mặc định 5 phút chờ
  const waitingTimeout = useRef(null);
  const [hideLatePopupUntil, setHideLatePopupUntil] = useState(null);
  const [serviceTimers, setServiceTimers] = useState({});
  const serviceIntervalRef = useRef({});
  const [processingApptId, setProcessingApptId] = useState(null); // id đang xử lý (start/complete)
  const [actionError, setActionError] = useState(""); // text lỗi (nếu có)


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
    if (!user) return;
    const refresh = async () => {
      const token = await user.getIdToken();
      if (user && user.role === "Salon_NhanVien") {
        checkFreelancerExists(user).then(setHasFreelancerProfile);
      }
      await loadAppointments(
        token,
        setAppointments,
        setAppointmentsToday,
        setConfirmedNextClient,
        setPendingUpcomingAppointment,
        setTimeUntilNext,            // ✅ Đây!
        setShowPopup,
        setNewAppointment,
        soundRef,
        soundLoopRef,
        setUpcomingAppointments,    // Thêm dòng này
        setNextClientIndex          // Thêm dòng này            // ✅ đối số 9
      );
    };
    const interval = setInterval(refresh, 60000);
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
    if (!appointments || appointments.length === 0) return;
    const processingAppointments = appointments.filter(a =>
      a.status === "processing" &&
      a.started_at &&
      !a.end_at &&
      Array.isArray(a.services)
    );
    processingAppointments.forEach(appt => {
      const estimateMinutes = appt.services.reduce(
        (sum, s) => sum + (s.duration || s.duration_minutes || 0),
        0
      );
      if (estimateMinutes < 10) return; // Bảo vệ nếu không có dịch vụ hoặc estimateMinutes quá nhỏ
      const started = dayjs(appt.started_at, "YYYY-MM-DD HH:mm:ss");
      const now = dayjs();
      if (started.isAfter(now)) return;
      const servedMinutes = now.diff(started, "minute");
      console.log('DEBUG auto-complete:', {
        id: appt.id,
        started_at: appt.started_at,
        now: now.format("YYYY-MM-DD HH:mm:ss"),
        servedMinutes,
        estimateMinutes
      });
      if (servedMinutes > estimateMinutes + 30) {
        completeAppointmentById(appt.id);
      }
    });
  }, [appointments]);



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

        setShowPopup(false);                         // ✅ Tắt popup
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
          setUpcomingAppointments,    // Thêm dòng này
          setNextClientIndex          // Thêm dòng này
        );


      }
    } catch (err) {
      console.error("❌ Error confirming appointment:", err.message);
    }
  };

  const handleCancelAppointment = async (appointmentId) => {
    try {
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
        clearSoundLoop(soundLoopRef); // ✅ Tắt âm thanh nếu đang lặp
        setShowPopup(false);          // ✅ Tắt popup

        // ✅ Load lại lịch hẹn để cập nhật ngay UI
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

      <div className="max-w-6xl mx-auto p-1">
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
                {[...Array(5)].map((_, i) => (
                  <svg key={i} viewBox="0 0 20 20" fill={i < Number(onboarding?.rating || 0) ? "#facc15" : "#d1d5db"} className="w-4 h-4">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.974a1 1 0 00.95.69h4.184c.969 0 1.371 1.24.588 1.81l-3.39 2.46a1 1 0 00-.364 1.118l1.286 3.974c.3.921-.755 1.688-1.538 1.118l-3.39-2.46a1 1 0 00-1.176 0l-3.39 2.46c-.783.57-1.838-.197-1.539-1.118l1.287-3.974a1 1 0 00-.364-1.118L2.04 9.401c-.783-.57-.38-1.81.588-1.81h4.183a1 1 0 00.951-.69l1.287-3.974z" />
                  </svg>
                ))}
                <span className="ml-1">{(Number(onboarding?.rating) || 0).toFixed(1)}</span>
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


          {/* Appointments */}
          <Card
            className="col-span-12 md:col-span-6"
            icon={<FiCalendar />}
            title="Appointments"
            value={
              <span>
                {appointmentsToday.filter(a => a.status !== "cancelled").length}
                <span className="ml-2 font-normal text-[16px]">Today</span>
              </span>
            }
            sub={
              <div>
                {/* Dòng Today - cách dưới ra xa */}
                <div className="mb-3" />
                {/* Group trạng thái, lùi vào trái */}
                <div className="flex flex-col gap-2 pl-4 text-sm">
                  <span>✅ Completed: {completedToday}</span>
                  <span>👩‍🔧 Serving: {appointmentsToday.filter(a => a.status === "processing").length}</span>
                  <span>🟡 Pending: {pendingToday}</span>
                  <span>⏳ Upcoming: {upcomingToday}</span>

                </div>
              </div>
            }
          >
            <button
              onClick={() => router.push("/freelancers/appointments")}
              className="absolute top-2 right-2 text-white hover:text-yellow-400 text-xl"
              title="Manage Appointments"
            >
              <FiExternalLink />
            </button>
          </Card>


          {/* Next Client */}
          <Card
            className="col-span-12 md:col-span-6 capitalize h-full"
            icon={<FiClock />}
            title="Next Client"
            value={
              upcomingAppointments.length > 0
                ? dayjs(upcomingAppointments[nextClientIndex].appointment_date.replace("Z", "")).format("hh:mm A")
                : "No upcoming"
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
                      {(() => {
                        const apptTime = dayjs(upcomingAppointments[nextClientIndex].appointment_date.replace("Z", ""));
                        const diffMinutes = apptTime.diff(now, "minute");
                        if (diffMinutes > 0) {
                          const hours = Math.floor(diffMinutes / 60);
                          const minutes = diffMinutes % 60;
                          return hours > 0
                            ? `In ${hours}h ${minutes}m`
                            : `In ${minutes} minute${minutes > 1 ? "s" : ""}`;
                        } else {
                          return `🔴 Late ${Math.abs(diffMinutes)} min`;
                        }
                      })()}
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
              ) : "No upcoming"
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
                      const appt = inProgressAppointments[inProgressIndex];
                      await completeAppointmentById(appt.id);
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
          <div className="col-span-12 bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-4 border-b-4 border-pink-400 shadow-lg rounded-2xl p-5">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    {availableServices.map((srv) => {
                      const checked = selectedServiceIds.includes(srv.id);
                      return (
                        <label
                          key={srv.id}
                          className={`flex items-start gap-3 bg-white/10 p-3 rounded-xl shadow hover:bg-white/20 transition cursor-pointer capitalize relative`}
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

    </div>
  );
}

function Card({ icon, title, value, sub, children, className = "" }) {
  return (
    <div className={`relative ${className} bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] border-t-4 border-b-4 border-pink-400 rounded-2xl shadow-lg p-5 transition-all`}>
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
