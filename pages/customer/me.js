// pages/customer/me.js
import { useEffect, useState, useRef } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import dayjs from "dayjs"; // Đảm bảo đã import

const auth = getAuth(); // ✅ Đặt ngoài component

function CustomerAppointmentsPage() {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null); // ✅ lưu user để dùng khi huỷ
    const [statusFilter, setStatusFilter] = useState("upcoming");
    const now = dayjs();

    const [prevAppointments, setPrevAppointments] = useState([]);
    const [showConfirmPopup, setShowConfirmPopup] = useState(false);
    const [confirmedAppt, setConfirmedAppt] = useState(null);
    const soundRef = useRef(null);
    const shownAppointmentIdsRef = useRef(new Set());

    const soundConfirmRef = useRef(null);
    const soundCancelRef = useRef(null);


    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (u) => {
            if (!u) return;
            setUser(u); // ✅ lưu lại user
            const token = await u.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/me", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            setAppointments(data || []);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);
    useEffect(() => {
        if (!user) return;
        const interval = setInterval(() => {
            fetchAppointments();
        }, 30000); // ⏳ mỗi 30 giây

        return () => clearInterval(interval); // dọn sạch khi unmount
    }, [user]);

    const fetchAppointments = async () => {
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/me", {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setAppointments(data || []);

        const now = dayjs();
        // ✅ Ưu tiên confirmed trước
        const confirmed = (data || []).filter(
            (a) =>
                a.status === "confirmed" &&
                dayjs(a.appointment_date.replace("Z", "")).isAfter(now)
        ).sort((a, b) =>
            dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
        );

        const cancelled = (data || []).filter(
            (a) =>
                a.status === "cancelled" &&
                dayjs(a.appointment_date.replace("Z", "")).isAfter(now)
        ).sort((a, b) =>
            dayjs(a.appointment_date).diff(dayjs(b.appointment_date))
        );

        // 👉 Hiển thị confirmed nếu có, ngược lại mới show cancelled
        const upcomingTarget = confirmed[0] || cancelled[0];

        // ✅ Nếu chưa từng hiện thì mới show popup
        if (upcomingTarget && !shownAppointmentIdsRef.current.has(upcomingTarget.id)) {
            setConfirmedAppt(upcomingTarget);
            setShowConfirmPopup(true);

            // ✅ Phát âm thanh theo trạng thái
            if (upcomingTarget.status === "confirmed") {
                soundConfirmRef.current?.play();
            } else if (upcomingTarget.status === "cancelled") {
                soundCancelRef.current?.play();
            }

            shownAppointmentIdsRef.current.add(upcomingTarget.id); // ✅ đánh dấu đã show

            setTimeout(() => {
                setShowConfirmPopup(false);
            }, 10000);
        }
    };



    function parseLocalTimestamp(str) {
        // str = "2025-05-24 17:30:00" hoặc "2025-05-24T17:30:00"
        const clean = str.replace("T", " ");
        const [datePart, timePart] = clean.split(" ");
        const [year, month, day] = datePart.split("-").map(Number);
        const [hour, minute] = timePart.split(":").map(Number);
        return new Date(year, month - 1, day, hour, minute);
    }
    const filteredAppointments =
        statusFilter === "all"
            ? appointments
            : statusFilter === "upcoming"
                ? appointments.filter(
                    (a) =>
                        ["pending", "confirmed"].includes(a.status) &&
                        dayjs(a.appointment_date.replace("Z", "")).isAfter(now)
                )
                : appointments.filter((a) => a.status === statusFilter);
    return (
        <div className="min-h-screen text-white px-4 py-6">
            <Navbar />
            <audio ref={soundConfirmRef} src="/confirmed.wav" preload="auto" />
            <audio ref={soundCancelRef} src="/cancelled.wav" preload="auto" />
            {showConfirmPopup && confirmedAppt && (
                <div
                    className={`fixed bottom-6 right-6 z-50 px-5 py-4 max-w-sm w-[90%] sm:w-auto rounded-xl shadow-xl border-l-8 animate-popup space-y-2
      ${confirmedAppt.status === "confirmed"
                            ? "bg-green-100 border-green-500 text-green-900"
                            : "bg-red-100 border-red-500 text-red-900"
                        }`}
                >
                    {/* Tiêu đề + Icon */}
                    <div className="flex items-center gap-3">
                        <div className="text-3xl">
                            {confirmedAppt.status === "confirmed" ? "✅" : "❌"}
                        </div>
                        <h2 className="text-lg font-bold">
                            {confirmedAppt.status === "confirmed"
                                ? "Appointment Confirmed!"
                                : "Appointment Cancelled!"}
                        </h2>
                    </div>

                    {/* Stylist */}
                    <p className="font-semibold text-pink-600">{confirmedAppt.stylist_name}</p>

                    {/* Thời gian */}
                    <p className="text-sm">
                        📅{" "}
                        {dayjs(confirmedAppt.appointment_date.replace("Z", "")).format(
                            "MMM D, hh:mm A"
                        )}
                    </p>

                    {/* Dịch vụ */}
                    <p className="text-sm">
                        💅 {confirmedAppt.services?.map((s) => s.name).join(", ")}
                    </p>
                </div>
            )}

            <div className="max-w-5xl mx-auto mt-10">
                <h1 className="text-3xl font-bold text-center text-pink-500 mb-6">
                    📅 Your Appointments
                </h1>
                <div className="flex justify-center gap-2 mb-6 flex-wrap text-sm">
                    {["upcoming", "all", "pending", "confirmed", "completed", "cancelled"].map((status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-3 py-1 rounded-full font-medium transition ${statusFilter === status
                                ? "bg-pink-500 text-white"
                                : "bg-white/10 text-white hover:bg-white/20"
                                }`}
                        >
                            {status === "all"
                                ? "All"
                                : status === "upcoming"
                                    ? "Upcoming (P + C)"
                                    : status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    ))}
                </div>
                {loading ? (
                    <p className="text-center">⏳ Loading...</p>
                ) : filteredAppointments.length === 0 ? (
                    <p className="text-center text-gray-400">
                        {statusFilter === "all"
                            ? "You haven’t booked any appointments yet."
                            : statusFilter === "upcoming"
                                ? "You have no upcoming appointments."
                                : `You have no ${statusFilter} appointments.`}
                    </p>
                ) : (
                    <div className="grid sm:grid-cols-2 gap-6">
                        {filteredAppointments.map((appt) => (
                            <div key={appt.id} className="relative bg-white/10 backdrop-blur-md border-t-2 border-pink-500 rounded-2xl p-5 pt-4 pb-12 shadow-lg">
                                <span
                                    className={`absolute top-2 right-2 px-3 py-1 text-xs rounded-full font-semibold shadow ${appt.status === "pending"
                                        ? "bg-yellow-400 text-black"
                                        : appt.status === "confirmed"
                                            ? "bg-green-500 text-white"
                                            : appt.status === "completed"
                                                ? "bg-blue-500 text-white"
                                                : appt.status === "cancelled"
                                                    ? "bg-red-500 text-white"
                                                    : "bg-gray-400 text-white"
                                        }`}
                                >
                                    📌 {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
                                </span>

                                {/* Stylist Info */}
                                <div className="flex items-center gap-4 mb-3">
                                    <img
                                        src={appt.stylist_avatar?.startsWith("http") ? appt.stylist_avatar : "/default-avatar.png"}
                                        alt={appt.stylist_name}
                                        className="w-16 h-16 rounded-full object-cover border-2 border-white shadow"
                                    />
                                    <div>
                                        <h2 className="text-lg font-bold text-pink-300">{appt.stylist_name}</h2>
                                        <p className="text-xs italic text-gray-200 capitalize">{appt.stylist_specialization}</p>
                                    </div>
                                </div>

                                {/* Salon Info */}
                                <p className="text-sm text-yellow-300 mb-2">🏠 {appt.salon_name}</p>

                                {/* Dịch vụ - bảng gọn */}
                                <div className="text-xs text-pink-100 mb-2 capitalize space-y-1">
                                    <table className="w-full text-left text-xs text-pink-100">
                                        <thead>
                                            <tr className="text-pink-300 border-b border-pink-400">
                                                <th className="py-1">Service</th>
                                                <th className="py-1 text-right">Price</th>
                                                <th className="py-1 text-right">Duration</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {appt.services?.map((srv) => (
                                                <tr key={srv.id}>
                                                    <td className="py-1">💅 {srv.name}</td>
                                                    <td className="py-1 text-right">${srv.price}</td>
                                                    <td className="py-1 text-right">{srv.duration} min</td>
                                                </tr>
                                            ))}
                                            {/* 🔢 Dòng tổng */}
                                            <tr className="border-t border-pink-400 font-semibold text-yellow-300">
                                                <td className="py-1">🔢 Total</td>
                                                <td className="py-1 text-right">
                                                    ${appt.services?.reduce((sum, s) => sum + (s.price || 0), 0)}
                                                </td>
                                                <td className="py-1 text-right">
                                                    {appt.services?.reduce((sum, s) => sum + (s.duration || 0), 0)} min
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>

                                </div>

                                {/* Ngày giờ */}
                                <div className="mt-2 text-center">
                                    <p className="inline-block bg-gradient-to-r from-yellow-400 via-pink-400 to-emerald-400 text-black text-sm px-3 py-1 rounded-sm shadow font-semibold tracking-wide">
                                        📅 {appt.appointment_date.replace("T", " ").slice(0, 16)}
                                    </p>
                                </div>


                                {/* Ghi chú (nếu có) */}
                                {appt.note && (
                                    <p className="text-sm text-pink-100 mb-2 mt-4">💬 Note: {appt.note}</p>
                                )}

                                {/* Nút huỷ nếu điều kiện đúng */}
                                {["pending", "confirmed"].includes(appt.status) &&
                                    dayjs(appt.appointment_date.replace("Z", "")).isAfter(dayjs()) && (
                                        <button
                                            onClick={async () => {
                                                if (!confirm("Are you sure you want to cancel this appointment?")) return;
                                                const token = await user.getIdToken();
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
                                            className="absolute bottom-2 left-2 
                                            hover:bg-red-500/20 
                                            text-red-400 hover:text-white 
                                            text-[9px] px-4 py-[4px] 
                                            rounded-3xl transition-all duration-200 flex items-center gap-1"
                                        >
                                            ❌ Click here to cancel
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

export default withAuthProtection(CustomerAppointmentsPage);
