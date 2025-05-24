// pages/customer/me.js
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";

export default function CustomerAppointmentsPage() {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const auth = getAuth();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) return;
            const token = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/me", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            setAppointments(data || []);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-pink-300 to-yellow-200 dark:from-emerald-900 dark:via-pink-800 dark:to-yellow-700 text-gray-800 dark:text-white px-4 py-6">
            <Navbar />
            <div className="max-w-5xl mx-auto mt-10">
                <h1 className="text-3xl font-bold text-center text-pink-500 mb-6">
                    📅 Your Appointments
                </h1>

                {loading ? (
                    <p className="text-center">⏳ Loading...</p>
                ) : appointments.length === 0 ? (
                    <p className="text-center text-gray-400">You haven’t booked any appointments yet.</p>
                ) : (
                    <div className="grid sm:grid-cols-2 gap-6">
                        {appointments.map((appt) => (
                            <div key={appt.id} className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-lg">
                                {/* Stylist Info */}
                                <div className="flex items-center gap-4 mb-3">
                                    <img
                                        src={appt.stylist_avatar?.startsWith("http") ? appt.stylist_avatar : "/default-avatar.png"}
                                        alt={appt.stylist_name}
                                        className="w-16 h-16 rounded-full object-cover border-2 border-white shadow"
                                    />
                                    <div>
                                        <h2 className="text-lg font-bold text-pink-300">{appt.stylist_name}</h2>
                                        <p className="text-xs italic text-gray-200">{appt.stylist_specialization}</p>
                                    </div>
                                </div>

                                {/* Salon Info */}
                                <p className="text-sm text-yellow-300 mb-2">🏠 {appt.salon_name}</p>

                                {/* Dịch vụ */}
                                <div className="text-xs text-pink-100 space-y-1 mb-2">
                                    {appt.services?.map((srv) => (
                                        <div key={srv.id} className="flex justify-between">
                                            <span>💅 {srv.name}</span>
                                            <span>${srv.price} - {srv.duration} min</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Ngày giờ */}
                                <p className="text-sm text-emerald-300">
                                    📅 {new Date(appt.appointment_date).toLocaleString()}
                                </p>

                                {/* Thời lượng + ghi chú */}
                                <p className="text-sm text-blue-200">⏱ {appt.duration_minutes} minutes</p>
                                {appt.note && (
                                    <p className="text-sm text-pink-100 mt-1">💬 Note: {appt.note}</p>
                                )}

                                {/* Trạng thái */}
                                <p className="mt-3 text-sm font-semibold text-yellow-400 uppercase">
                                    📌 Status: {appt.status}
                                </p>

                                {/* Nếu đang pending và chưa đến giờ thì hiện nút huỷ */}
                                {appt.status === "pending" &&
                                    new Date(appt.appointment_date) > new Date() && (
                                        <button
                                            onClick={async () => {
                                                if (!confirm("Are you sure you want to cancel this appointment?")) return;
                                                const token = await auth.currentUser.getIdToken();
                                                const res = await fetch(`https://crypto-manager-backend.onrender.com/api/appointments/${appt.id}`, {
                                                    method: "DELETE",
                                                    headers: { Authorization: `Bearer ${token}` },
                                                });
                                                const data = await res.json();
                                                if (res.ok) {
                                                    alert("✅ Appointment cancelled.");
                                                    setAppointments((prev) => prev.filter((a) => a.id !== appt.id));
                                                } else {
                                                    alert("❌ " + (data.error || "Failed to cancel."));
                                                }
                                            }}
                                            className="mt-3 text-xs bg-red-500 hover:bg-red-600 text-white px-4 py-1 rounded-full shadow transition"
                                        >
                                            ❌ Cancel Appointment
                                        </button>
                                    )}

                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
