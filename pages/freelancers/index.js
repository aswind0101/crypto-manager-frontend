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

  const auth = getAuth();
  const router = useRouter();

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
        setNextAppointment,
        setTimeUntilNext,
        nextAppointment,       // ✅ đối số 6
        setShowPopup,          // ✅ đối số 7 — rất quan trọng!
        setNewAppointment,     // ✅ đối số 8
        soundRef               // ✅ đối số 9
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
        setNextAppointment,
        setTimeUntilNext,
        nextAppointment,       // ✅ đối số 6
        setShowPopup,          // ✅ đối số 7 — rất quan trọng!
        setNewAppointment,     // ✅ đối số 8
        soundRef               // ✅ đối số 9
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
  const completedToday = appointmentsToday.filter((a) => a.status === "completed").length;
  const upcomingToday = appointmentsToday.filter((a) => {
    const apptTime = dayjs(a.appointment_date.replace("Z", ""));
    return apptTime.isAfter(now) && (a.status === "pending" || a.status === "confirmed");
  }).length;
  const missedToday = appointmentsToday.filter((a) => {
    const apptTime = dayjs(a.appointment_date.replace("Z", ""));
    return apptTime.isBefore(now) && (a.status === "pending" || a.status === "confirmed");
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
        setShowPopup(false);
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
        setShowPopup(false);
      }
    } catch (err) {
      console.error("❌ Error cancelling appointment:", err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-pink-300 to-yellow-200 dark:from-emerald-900 dark:via-pink-800 dark:to-yellow-700 text-gray-800 dark:text-white px-4 py-6">
      <Navbar />
      <audio ref={soundRef} src="/notification.wav" preload="auto" />
      {showPopup && newAppointment && (
        <div className="fixed bottom-6 right-6 z-50 bg-white text-black rounded-xl px-5 py-4 shadow-xl border-l-8 border-emerald-500 animate-popup max-w-sm w-[90%] sm:w-auto space-y-2">
          <h2 className="text-lg font-bold text-emerald-700">📢 New Appointment</h2>
          <p className="font-semibold text-pink-600">{newAppointment.customer_name}</p>
          <p className="text-sm text-gray-700">
            {dayjs(newAppointment.appointment_date.replace("Z", "")).format("MMM D, hh:mm A")}
          </p>
          <p className="text-sm text-emerald-600">
            Services: {newAppointment.services?.map(s => s.name).join(", ")}
          </p>

          {/* Slide to confirm */}
          <div className="relative mt-3 bg-gray-200 rounded-full h-10 overflow-hidden">
            <button
              onClick={() => handleConfirmAppointment(newAppointment.id)}
              className="absolute left-0 top-0 h-full px-4 text-white font-semibold bg-emerald-500 rounded-full hover:bg-emerald-600 transition-all"
            >
              ✅ Confirm
            </button>
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              Slide to confirm
            </div>
          </div>

          {/* Cancel button */}
          <button
            onClick={() => handleCancelAppointment(newAppointment.id)}
            className="text-sm text-red-500 underline mt-1"
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
            nextAppointment
              ? dayjs(nextAppointment.appointment_date.replace("Z", "")).format("hh:mm A")
              : "No upcoming"
          }
          sub={
            nextAppointment?.customer_name
              ? `${nextAppointment.customer_name} – ${nextAppointment.services?.map(s => s.name).join(", ")}${timeUntilNext ? ` (${timeUntilNext})` : ""}`
              : "No upcoming"
          }
        />

        <Card
          icon={<FiCalendar />}
          title="Appointments"
          value={`${appointmentsToday.length} Today`}
          sub={`✅ ${completedToday} completed • ⏳ ${upcomingToday} upcoming • ❌ ${missedToday} missed`}
        />

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

function Card({ icon, title, value, sub }) {
  return (
    <div className="bg-white/30 dark:bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-5 shadow-md flex flex-col gap-2">
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

async function loadAppointments(token, setAppointments, setAppointmentsToday, setNextAppointment, setTimeUntilNext, prevNextAppointment, setShowPopup, setNewAppointment, soundRef) {
  const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/freelancer", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const apptData = await res.json();
  setAppointments(apptData || []);

  const now = dayjs();
  const todayFiltered = apptData.filter((appt) =>
    new Date(appt.appointment_date).toDateString() === new Date().toDateString()
  );
  setAppointmentsToday(todayFiltered);

  const upcoming = apptData.filter((appt) => {
    const apptTime = dayjs(appt.appointment_date.replace("Z", ""));
    return appt.status === "pending" && apptTime.isAfter(now);
  });


  if (upcoming.length > 0) {
    const sorted = upcoming.sort((a, b) =>
      dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
    );
    const next = sorted[0];

    // Nếu có appointment mới khác appointment hiện tại
    if (!prevNextAppointment || prevNextAppointment.id !== next.id) {
      setNewAppointment(next);
      setShowPopup(true);
      soundRef.current?.play(); // Phát lần đầu

      const soundLoop = setInterval(() => {
        soundRef.current?.play(); // Phát mỗi 3s
      }, 3000);

      // Tắt popup cùng lúc với âm thanh
      setTimeout(() => {
        clearInterval(soundLoop);
        setShowPopup(false);
      }, 15000); // Lặp ~3 lần là vừa
    }


    setNextAppointment(next);

    const apptTime = dayjs(next.appointment_date.replace("Z", ""));
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
    setNextAppointment(null);
    setTimeUntilNext("");
  }
}
