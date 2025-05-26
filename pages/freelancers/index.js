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


dayjs.extend(utc);
dayjs.extend(timezone);


export default function FreelancerDashboard() {
  const [user, setUser] = useState(null);
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

  const [confirmedNextClient, setConfirmedNextClient] = useState(null); // 🟢 Next Client
  const [pendingUpcomingAppointment, setPendingUpcomingAppointment] = useState(null); // 🔔 Popup
  const [isConfirmed, setIsConfirmed] = useState(false);

  const auth = getAuth();
  const router = useRouter();
  const sliderRef = useRef(null);
  const sliderMax = 200; // chiều dài vuốt tối đa (điều chỉnh theo giao diện)

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

      const token = await currentUser.getIdToken();
      setUser(currentUser);

      const res = await fetch(
        "https://crypto-manager-backend.onrender.com/api/freelancers/onboarding",
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();
      setOnboarding(data);

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

  const isComplete = onboarding?.isQualified === true || onboarding?.isqualified === true;

  if (loading) {
    return <div className="text-center py-20 text-gray-600">⏳ Loading dashboard...</div>;
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
        if (res.ok) {
          if (soundLoopRef.current) {
            clearInterval(soundLoopRef.current);
            soundLoopRef.current = null;
          }
          setShowPopup(false);
        }

      }
    } catch (err) {
      console.error("❌ Error cancelling appointment:", err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-pink-300 to-yellow-200 dark:from-emerald-900 dark:via-pink-800 dark:to-yellow-700 text-gray-800 dark:text-white px-4 py-6">
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
          <h2 className="text-lg mt-4 font-bold text-emerald-700">📢 New Appointment</h2>

          {/* Tên khách */}
          <p className="font-semibold text-pink-600">{pendingUpcomingAppointment.customer_name}</p>

          {/* Ngày giờ */}
          <p className="text-sm text-gray-700">
            📅{" "}
            {dayjs(pendingUpcomingAppointment.appointment_date.replace("Z", "")).format("MMM D, hh:mm A")}
          </p>

          {/* Dịch vụ */}
          <p className="text-sm text-emerald-600">
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

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        <div className="col-span-1 md:col-span-2 bg-white/20 backdrop-blur-md border border-white/20 rounded-3xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-emerald-800 dark:text-emerald-300 mb-2">
            🌟 Welcome back, {user?.displayName || "Freelancer"}!
          </h2>
          <p className="text-gray-700 dark:text-gray-300">Let’s check your schedule and income today.</p>
        </div>

        <Card icon={<FiDollarSign />} title="Today's Earnings" value="$145.00" sub="3 appointments" />

        <Card
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
        <Card
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
          {/* Icon điều hướng – nằm trong card */}
          <button
            onClick={() => router.push("/freelancers/appointments")}
            className="absolute top-2 right-2 text-white hover:text-yellow-400 text-xl"
            title="Manage Appointments"
          >
            <FiExternalLink />
          </button>

        </Card>

        <Card icon={<FiMessageSquare />} title="Rating" value="4.8 ⭐" sub="124 reviews" />

        <div className="col-span-1 md:col-span-3">
          <h3 className="text-xl font-bold mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ActionButton label="📅 My Schedule" />
            <ActionButton label="🧾 Appointments" />
            <ActionButton label="💬 Chat with Client" />
            <ActionButton label="💸 Withdraw" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ icon, title, value, sub, children }) {
  return (
    <div className="relative bg-white/30 dark:bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-5 shadow-md flex flex-col gap-2">
      {/* Nếu có children (ví dụ nút điều hướng) sẽ render lên trên */}
      {children}

      <div className="text-2xl text-emerald-500">{icon}</div>
      <h4 className="text-lg font-semibold">{title}</h4>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{sub}</p>
    </div>
  );
}


function ActionButton({ label }) {
  return (
    <button className="w-full py-3 rounded-2xl bg-gradient-to-r from-pink-400 via-amber-300 to-emerald-400 dark:from-pink-600 dark:via-yellow-500 dark:to-emerald-500 text-white font-semibold shadow-md hover:scale-105 transition">
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
  setAppointments(apptData || []);

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
