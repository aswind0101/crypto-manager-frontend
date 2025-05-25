import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import { useRouter } from "next/router";
import { FiUser, FiDollarSign, FiClock, FiCalendar, FiMessageSquare } from "react-icons/fi";

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


  const auth = getAuth();
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const token = await currentUser.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/onboarding", {
          headers: { Authorization: `Bearer ${token}` }
        });

        const data = await res.json();
        setUser(currentUser);
        setOnboarding(data);

        // ✅ Gọi dữ liệu appointment của freelancer
        const apptRes = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/freelancer", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const apptData = await apptRes.json();
        setAppointments(apptData || []);
        const filtered = apptData.filter(appt => isTodayCalifornia(appt.appointment_date));
        setAppointmentsToday(filtered);

        const now = dayjs().tz("America/Los_Angeles");

        const upcoming = apptData.filter((appt) => {
          const apptTime = dayjs(appt.appointment_date).tz("America/Los_Angeles");
          const valid = appt.status === "pending" || appt.status === "confirmed";
          const future = apptTime.isAfter(now);
          return valid && future;
        });

        console.log("✅ Filtered upcoming:", upcoming);

        if (upcoming.length > 0) {
          const sorted = upcoming.sort((a, b) =>
            dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
          );
          setNextAppointment(sorted[0]);
        } else {
          setNextAppointment(null);
        }


        if (upcoming.length > 0) {
          const sorted = upcoming.sort((a, b) =>
            dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
          );
          setNextAppointment(sorted[0]);
        } else {
          setNextAppointment(null);
        }


        if (upcoming.length > 0) {
          // Sắp xếp theo thời gian tăng dần
          const sorted = upcoming.sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date));
          setNextAppointment(sorted[0]);
        } else {
          setNextAppointment(null);
        }


        console.log("📅 Appointments:", appointments);
        setLoading(false);
      } else {
        router.push("/login");
      }
    });

    return () => unsubscribe();
  }, []);
  function isTodayCalifornia(isoDate) {
    const now = new Date();
    const appointmentDate = new Date(isoDate);

    const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const apptLocal = new Date(appointmentDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));

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

  if (!isComplete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-200 via-yellow-100 to-emerald-200 dark:from-rose-900 dark:via-yellow-900 dark:to-emerald-800 px-4 py-6 text-gray-800 dark:text-white">
        <Navbar />
        <div className="max-w-xl mx-auto mt-20 bg-white/20 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-lg p-6 text-center">
          <h2 className="text-2xl font-bold mb-2 text-red-500">⚠️ Onboarding Incomplete</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Please complete all onboarding steps before accessing the dashboard.
          </p>
          <button
            onClick={() => router.push("/freelancers/me")}
            className="bg-gradient-to-r from-pink-500 via-yellow-400 to-emerald-400 text-white font-semibold px-6 py-2 rounded-full shadow-lg hover:scale-105 transition"
          >
            Go to Complete Onboarding
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-pink-300 to-yellow-200 dark:from-emerald-900 dark:via-pink-800 dark:to-yellow-700 text-gray-800 dark:text-white px-4 py-6">
      <Navbar />

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        {/* Welcome */}
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
              ? dayjs(nextAppointment.appointment_date)
                .tz("America/Los_Angeles")
                .format("hh:mm A")
              : "No upcoming"
          }
          sub={
            nextAppointment?.customer_name
              ? `${nextAppointment.customer_name} - ${nextAppointment.services?.map(s => s.name).join(", ")}`
              : "No upcoming"
          }
        />
        <Card
          icon={<FiCalendar />}
          title="Appointments"
          value={`${appointmentsToday.length} Today`}
          sub={`${appointmentsToday.filter(a => a.status === "completed").length} completed, ${appointmentsToday.filter(a => a.status === "pending" || a.status === "confirmed").length} upcoming`}
        />

        <Card icon={<FiMessageSquare />} title="Rating" value="4.8 ⭐" sub="124 reviews" />

        {/* Actions */}
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
