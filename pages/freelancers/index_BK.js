// ✅ FULL FILE: freelancers/index.js
import { useEffect, useState, useRef } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import { useRouter } from "next/router";
import {
  FiUser,
  FiDollarSign,
  FiClock,
  FiCalendar,
  FiMessageSquare,
  FiExternalLink,
  FiList
} from "react-icons/fi";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { checkFreelancerExists } from "../../components/utils/checkFreelancer";
import { Eye, EyeOff } from "lucide-react";


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
  const [showPopup, setShowPopup] = useState(false);
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
  const [updatingServices, setUpdatingServices] = useState(false);
  const [savingStatus, setSavingStatus] = useState(""); // "" | "saving" | "saved"
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
        soundLoopRef
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
        soundLoopRef            // ✅ đối số 9
      );
    };
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);

  }, [user]);

  function isTodayCalifornia(isoDate) {
    const now = new Date();
    const appointmentDate = new Date(isoDate);
    const nowLocal = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    );
    const apptLocal = new Date(
      appointmentDate.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
      })
    );
    return (
      nowLocal.getFullYear() === apptLocal.getFullYear() &&
      nowLocal.getMonth() === apptLocal.getMonth() &&
      nowLocal.getDate() === apptLocal.getDate()
    );
  }

  //const isComplete = onboarding?.isQualified === true || onboarding?.isqualified === true;

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

  const now = dayjs();
  const completedToday = appointmentsToday.filter(a => a.status === "completed").length;

  const pendingToday = appointmentsToday.filter(a => {
    const time = dayjs(a.appointment_date.replace("Z", ""));
    return a.status === "pending" && time.isAfter(now);
  }).length;

  const upcomingToday = appointmentsToday.filter(a => {
    const time = dayjs(a.appointment_date.replace("Z", ""));
    return a.status === "confirmed" && time.isAfter(now);
  }).length;

  const missedToday = appointmentsToday.filter(a => {
    const time = dayjs(a.appointment_date.replace("Z", ""));
    return (a.status === "pending" || a.status === "confirmed") && time.isBefore(now);
  }).length;


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
          soundLoopRef
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
          soundLoopRef
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
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6 mt-8">
        {/* Welcome Block */}
        <div className="col-span-12 md:col-span-6 bg-white/10 backdrop-blur-md border-t-4 border-pink-500 rounded-3xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-emerald-300 mb-2">
            🌟 Welcome back, {user?.displayName || "Freelancer"}!
          </h2>
          <p className="text-gray-300">Let’s check your schedule and income today.</p>
        </div>
        {/* Rating */}
        <Card className="col-span-12 md:col-span-6" icon={<FiMessageSquare />} title="Rating" value="4.8 ⭐" sub="124 reviews" />
        {/* Your Available Services */}
        <div className="col-span-12 bg-white/5 backdrop-blur-lg border-t-4 border-pink-500 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-bold text-yellow-300">💈 Your Available Services</h3>
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
                    {selectedServiceIds.length}
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
                      <label key={srv.id} className="flex items-start gap-3 bg-white/10 p-3 rounded-xl shadow hover:bg-white/20 transition cursor-pointer capitalize">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const newIds = checked
                              ? selectedServiceIds.filter((id) => id !== srv.id)
                              : [...selectedServiceIds, srv.id];
                            setSelectedServiceIds(newIds);
                          }}
                          className="accent-pink-500 mt-1"
                        />
                        <div className="flex flex-col">
                          <span className="font-semibold text-pink-300">{srv.name}</span>
                          <span className="text-xs text-emerald-300">${srv.price} – {srv.duration_minutes} min</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Earnings */}
        <Card className="col-span-12 md:col-span-3" icon={<FiDollarSign />} title="Today's Earnings" value="$145.00" sub="3 appointments" />

        {/* Next Client */}
        <Card
          className="col-span-12 md:col-span-3 capitalize"
          icon={<FiClock />}
          title="Next Client"
          value={
            confirmedNextClient
              ? dayjs(confirmedNextClient.appointment_date.replace("Z", "")).format("hh:mm A")
              : "No upcoming"
          }
          sub={
            confirmedNextClient?.customer_name
              ? `${confirmedNextClient.customer_name} – ${confirmedNextClient.services?.map(s => s.name).join(", ")}${timeUntilNext ? ` ${timeUntilNext}` : ""}`
              : "No upcoming"
          }
        />

        {/* Appointments */}
        <Card
          className="col-span-12 md:col-span-6"
          icon={<FiCalendar />}
          title="Appointments"
          value={`${appointmentsToday.filter(a => a.status !== "cancelled").length} Today`}
          sub={
            <>
              ✅ Completed: {completedToday} <br />
              🟡 Pending: {pendingToday} <br />
              ⏳ Upcoming: {upcomingToday} <br />
              ❌ Missed: {missedToday}
            </>
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



        {/* Quick Actions */}
        <div className="col-span-12">
          <h3 className="text-lg font-bold mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <ActionButton label="📅 My Schedule" onClick={() => router.push("/freelancers/schedule")} />
            <ActionButton label="🧾 Appointments" />
            <ActionButton label="💬 Chat with Client" />
            <ActionButton label="💸 Withdraw" />
          </div>
        </div>
      </div>

    </div>
  );
}
function Card({ icon, title, value, sub, children, className = "" }) {
  return (
    <div className={`relative ${className} bg-white/5 backdrop-blur-lg border-t-4 border-pink-500 rounded-2xl p-5 shadow-xl transition-all`}>
      <div className="text-3xl text-yellow-300 mb-1">{icon}</div>
      <h4 className="text-lg font-bold text-pink-300">{title}</h4>
      <div className="text-2xl font-extrabold text-white">{value}</div>
      <p className="text-sm text-white/80">{sub}</p>
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
  const confirmedUpcoming = apptData
    .filter((a) =>
      a.status === "confirmed" &&
      dayjs(a.appointment_date.replace("Z", "")).isAfter(now)
    )
    .sort((a, b) =>
      dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
    );

  setConfirmedNextClient(confirmedUpcoming[0] || null);

  // ⏳ Cập nhật đồng hồ đếm thời gian tới lịch gần nhất (dành cho hiển thị next)
  if (confirmedUpcoming[0]) {
    const apptTime = dayjs(confirmedUpcoming[0].appointment_date.replace("Z", ""));
    const diffMinutes = apptTime.diff(now, "minute");

    let timeUntil = "";
    if (diffMinutes > 0) {
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;
      timeUntil = hours > 0
        ? `⏳ In ${hours}h ${minutes}m`
        : `⏳ In ${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    setTimeUntilNext(timeUntil);
  } else {
    setTimeUntilNext("");
  }
}


function clearSoundLoop(soundLoopRef) {
  if (soundLoopRef.current) {
    clearInterval(soundLoopRef.current);
    soundLoopRef.current = null;
  }
}
