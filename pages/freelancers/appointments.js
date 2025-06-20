// 📁 pages/freelancers/appointments.js
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import dayjs from "dayjs";
import withAuthProtection from "../../hoc/withAuthProtection";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import { FiUser, FiCheckCircle, FiClock, FiXCircle } from "react-icons/fi";
dayjs.extend(isSameOrAfter);

function groupByDay(list) {
  return list.reduce((acc, appt) => {
    const day = dayjs(appt.appointment_date.replace("Z", "")).format("YYYY-MM-DD");
    if (!acc[day]) acc[day] = [];
    acc[day].push(appt);
    return acc;
  }, {});
}

const statusColor = {
  pending: "bg-gray-100 text-yellow-700 border-yellow-400",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-400",
  cancelled: "bg-red-100 text-red-700 border-red-400",
};

function StatusBadge({ status }) {
  const txt = status[0].toUpperCase() + status.slice(1);
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-xs font-bold border shadow-sm ${statusColor[status] || "bg-gray-100 text-gray-700 border-gray-200"}`}
    >
      {txt}
    </span>
  );
}

function FreelancerAppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("upcoming"); // all | upcoming
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCancelPopup, setShowCancelPopup] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  const router = useRouter();
  const highlightedId = router.query.id;
  const { id: queryId } = router.query;

  const auth = getAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      setUser(u);
      const token = await u.getIdToken();
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/freelancer", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (Array.isArray(data)) {
        setAppointments(data);
        setError("");
      } else {
        setAppointments([]);
        setError("You must complete your freelancer profile before viewing appointments.");
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const now = dayjs();

    const filteredList = appointments.filter((a) => {
      const apptTime = dayjs(a.appointment_date.replace("Z", ""));

      const matchesSearch =
        a.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        apptTime.format("YYYY-MM-DD HH:mm").includes(searchTerm);

      // 🟡 Nếu có query id → override filter, chỉ show đúng lịch đó
      if (queryId && (a.id === queryId || a.id === Number(queryId))) {
        return true;
      }

      // ✅ Bình thường: lọc theo filter
      const isFuture = apptTime.isSameOrAfter(now);
      const matchesFilter =
        filter === "all" ||
        (filter === "upcoming" &&
          isFuture &&
          (a.status === "pending" || a.status === "confirmed"));

      return matchesSearch && matchesFilter;
    });

    setFiltered(filteredList);
  }, [appointments, searchTerm, filter, queryId]);

  const scrollRefs = useRef({});

  useEffect(() => {
    if (highlightedId && scrollRefs.current[highlightedId]) {
      scrollRefs.current[highlightedId].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedId]);

  const handleConfirm = async (id) => {
    const token = await user.getIdToken();
    const res = await fetch(`https://crypto-manager-backend.onrender.com/api/appointments/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "confirmed" }),
    });
    const data = await res.json();
    if (res.ok) {
      alert("✅ Appointment confirmed");
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "confirmed" } : a)));
    } else {
      alert("❌ " + (data.error || "Failed to confirm"));
    }
  };

  const handleCancel = async (id) => {
    const token = await user.getIdToken();
    const res = await fetch(`https://crypto-manager-backend.onrender.com/api/appointments/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "cancelled" }),
    });
    const data = await res.json();
    if (res.ok) {
      alert("❌ Appointment cancelled");
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
    } else {
      alert("❌ " + (data.error || "Failed to cancel"));
    }
  };

  if (error) {
    return (
      <div className="text-center text-red-400 font-semibold py-10">
        {error}
        <div className="mt-4">
          <button
            onClick={() => window.location.href = "/freelancers/register"}
            className="bg-yellow-400 text-black px-6 py-2 rounded-lg font-semibold hover:bg-yellow-300 transition"
          >
            Register Freelancer Profile
          </button>
        </div>
      </div>
    );
  }

  // Group by date, show "Today"/"Tomorrow"/date for section title
  const grouped = groupByDay(filtered);

  function formatDateLabel(date) {
    const d = dayjs(date);
    if (d.isSame(dayjs(), "day")) return "Today";
    if (d.isSame(dayjs().add(1, "day"), "day")) return "Tomorrow";
    return d.format("ddd, MMM D, YYYY");
  }


  return (
    <div className="min-h-screen text-white px-2 sm:px-4 py-4 font-mono">
      <Navbar />
      {showCancelPopup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 max-w-sm w-[90%] text-black shadow-xl">
            <h2 className="text-lg font-bold text-red-600 mb-3">Cancel Appointment</h2>
            <p className="mb-2">Please select a reason for cancellation:</p>
            <select
              className="w-full border px-3 py-2 rounded-lg mb-4"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            >
              <option value="">-- Select reason --</option>
              <option value="Customer no-show">Customer no-show</option>
              <option value="Unexpected delay">Unexpected delay</option>
              <option value="Double booking">Double booking</option>
              <option value="Other">Other</option>
            </select>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelPopup(false)}
                className="px-4 py-2 bg-gray-300 rounded-lg"
              >
                Close
              </button>
              <button
                disabled={!cancelReason}
                onClick={async () => {
                  const token = await user.getIdToken();
                  const res = await fetch(`https://crypto-manager-backend.onrender.com/api/appointments/${cancelTargetId}`, {
                    method: "PATCH",
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ status: "cancelled", cancel_reason: cancelReason })
                  });
                  const data = await res.json();
                  if (res.ok) {
                    alert("❌ Appointment cancelled");
                    setAppointments(prev => prev.map(a =>
                      a.id === cancelTargetId ? { ...a, status: "cancelled", cancel_reason: cancelReason } : a
                    ));
                    setShowCancelPopup(false);
                    setCancelReason("");
                    setCancelTargetId(null);
                  } else {
                    alert("❌ " + (data.error || "Failed to cancel"));
                  }
                }}
                className={`px-4 py-2 rounded-lg font-bold text-white ${cancelReason ? "bg-red-500 hover:bg-red-600" : "bg-gray-400 cursor-not-allowed"}`}
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4 text-center text-pink-400">📅 Manage Appointments</h1>
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8">
          <input
            type="text"
            placeholder="🔍 Search by customer name or date"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 rounded-3xl bg-white/20 border border-white/30 text-white placeholder-pink-200 w-full sm:w-1/2
            focus:outline-none focus:ring-1 focus:ring-pink-300"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1 rounded-full text-sm font-semibold border transition ${filter === "all"
                ? "bg-yellow-400 text-black border-yellow-400"
                : "bg-white/20 text-pink-400 border-white/10 hover:bg-pink-200 hover:text-pink-700"
                }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("upcoming")}
              className={`px-3 py-1 rounded-full text-sm font-semibold border transition ${filter === "upcoming"
                ? "bg-emerald-400 text-black border-emerald-400"
                : "bg-white/20 text-emerald-400 border-white/10 hover:bg-emerald-200 hover:text-emerald-700"
                }`}
            >
              Pending & Future
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-pink-400 font-semibold">⏳ Loading appointments...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-10">No matching appointments.</div>
        ) : (
          Object.entries(grouped).map(([date, appts]) => (
            <div key={date} className="mb-8">
              <h2 className="text-xl font-bold text-emerald-500 mb-3 pl-2">{formatDateLabel(date)}</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {appts.map((a) => (
                  <div
                    key={a.id}
                    ref={(el) => (scrollRefs.current[a.id] = el)}
                    className={`relative bg-white/10 backdrop-blur-xl border-t-4 ${statusColor[a.status] || "border-gray-300"} rounded-3xl p-5 shadow-xl flex flex-col gap-3 group hover:scale-[1.025] transition-transform ${highlightedId === a.id ? "ring-2 ring-yellow-400 bg-yellow-100/20" : ""
                      }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {/* Avatar hoặc icon */}
                      <div className="w-14 h-14 bg-pink-500 rounded-full flex items-center justify-center shadow-inner">
                        <FiUser className="text-white text-3xl" />
                      </div>
                      <div>
                        <p className="font-bold text-lg text-pink-300">{a.customer_name}</p>
                        <StatusBadge status={a.status} />
                      </div>
                    </div>
                    <p className="text-sm text-yellow-500 flex items-center gap-2 font-semibold">
                      <FiClock /> {dayjs(a.appointment_date.replace("Z", "")).format("hh:mm A")}
                      <span className="text-emerald-400 font-bold ml-4"><FiCheckCircle /> {a.duration_minutes} min</span>
                    </p>
                    <div className="text-sm text-emerald-200 capitalize mb-2">
                      Services:{" "}
                      <span className="font-semibold">{a.services.map((s) => s.name).join(", ")}</span>
                    </div>
                    {a.status === "cancelled" && a.cancel_reason && (
                      <div className="text-sm text-red-300 bg-red-500/10 p-3 rounded-xl border border-red-400 mt-1">
                        📌 <span className="font-semibold text-red-400">Cancelled Reason:</span> <em>{a.cancel_reason}</em>
                      </div>
                    )}
                    <div className="flex flex-col gap-3 mt-2">
                      {(a.status === "pending" || a.status === "confirmed") &&
                        dayjs(a.appointment_date.replace("Z", "")).isSameOrAfter(dayjs()) && (
                          <div className="flex gap-2 justify-end">
                            {a.status === "pending" && (
                              <button
                                onClick={() => handleConfirm(a.id)}
                                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-400 to-green-500 hover:from-emerald-600 hover:to-green-400 text-white font-semibold px-6 py-2 rounded-full shadow-md transition-all duration-150"
                              >
                                <FiCheckCircle className="text-xl" /> Confirm
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setCancelTargetId(a.id);
                                setShowCancelPopup(true);
                              }}
                              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-pink-400 to-red-400 hover:from-red-500 hover:to-pink-400 text-white font-semibold px-6 py-2 rounded-full shadow-md transition-all duration-150"
                            >
                              <FiXCircle className="text-xl" /> Cancel
                            </button>
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default withAuthProtection(FreelancerAppointmentsPage);
