// 📁 pages/freelancers/appointments.js
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import dayjs from "dayjs";
import withAuthProtection from "../../hoc/withAuthProtection";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
dayjs.extend(isSameOrAfter);


function FreelancerAppointmentsPage() {
    const [appointments, setAppointments] = useState([]);
    const [filtered, setFiltered] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [filter, setFilter] = useState("upcoming"); // all | upcoming
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

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
            setAppointments(data);
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

            const isFuture = apptTime.isSameOrAfter(now);
            const matchesFilter = filter === "all" || (filter === "upcoming" && isFuture && a.status === "pending");

            return matchesSearch && matchesFilter;
        });

        setFiltered(filteredList);
    }, [appointments, searchTerm, filter]);


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
            setAppointments((prev) =>
                prev.map((a) => (a.id === id ? { ...a, status: "confirmed" } : a))
            );
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
            setAppointments((prev) =>
                prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a))
            );
        } else {
            alert("❌ " + (data.error || "Failed to cancel"));
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-pink-900 to-yellow-900 text-white px-4 py-6">
            <Navbar />
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-4 text-center text-pink-300">📅 Manage Appointments</h1>

                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                    <input
                        type="text"
                        placeholder="Search by name or date..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="px-4 py-2 rounded-full bg-white/20 border border-white/30 text-white placeholder-gray-300 w-full sm:w-1/2"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={() => setFilter("all")}
                            className={`px-3 py-1 rounded-full text-sm ${filter === "all" ? "bg-yellow-400 text-black" : "bg-white/10 text-white"
                                }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter("upcoming")}
                            className={`px-3 py-1 rounded-full text-sm ${filter === "upcoming" ? "bg-yellow-400 text-black" : "bg-white/10 text-white"
                                }`}
                        >
                            Pending & Future
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className="text-center text-white">⏳ Loading appointments...</p>
                ) : filtered.length === 0 ? (
                    <p className="text-center text-gray-300">No matching appointments.</p>
                ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filtered.map((a) => (
                            <div key={a.id} className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 shadow">
                                <p className="text-lg font-bold text-yellow-300">{a.customer_name}</p>
                                <p className="text-sm text-gray-200 mb-1">
                                    {dayjs(a.appointment_date.replace("Z", "")).format("MMM D, YYYY – hh:mm A")}
                                </p>
                                <p className="text-sm text-emerald-300 capitalize">⏱ {a.duration_minutes} min</p>
                                <p className="text-sm text-pink-200 mt-1">
                                    Services: {a.services.map((s) => s.name).join(", ")}
                                </p>
                                <p className="mt-2 text-sm">
                                    📌 Status:{" "}
                                    <span
                                        className={`font-semibold ${a.status === "pending"
                                                ? "text-yellow-400"
                                                : a.status === "confirmed"
                                                    ? "text-green-400"
                                                    : a.status === "cancelled"
                                                        ? "text-red-400"
                                                        : ""
                                            }`}
                                    >
                                        {a.status}
                                    </span>
                                </p>

                                {/* ✅ Nút Confirm & Cancel giãn cách đều nhau */}
                                {(a.status === "pending" || a.status === "confirmed") && (
                                    <div className="mt-3 flex flex-wrap gap-3 justify-center sm:justify-start">
                                        {a.status === "pending" && (
                                            <button
                                                onClick={() => handleConfirm(a.id)}
                                                className="text-sm bg-green-500 hover:bg-green-600 text-white px-4 py-1 rounded-full min-w-[100px]"
                                            >
                                                ✅ Confirm
                                            </button>
                                        )}

                                        <button
                                            onClick={() => handleCancel(a.id)}
                                            className="text-sm bg-red-500 hover:bg-red-600 text-white px-4 py-1 rounded-full min-w-[100px]"
                                        >
                                            ❌ Cancel
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                )}
            </div>
        </div>
    );
}

export default withAuthProtection(FreelancerAppointmentsPage);
