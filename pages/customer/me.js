// pages/customer/me.js
import { useEffect, useState, useRef } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import { Phone } from "lucide-react";
import dayjs from "dayjs"; // Đảm bảo đã import
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { CalendarDays } from "lucide-react";
import EmojiPicker from "emoji-picker-react";


// ⚠️ Bạn phải gọi các plugin trước khi sử dụng tz()
dayjs.extend(utc);
dayjs.extend(timezone);

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";
import { toast } from "react-hot-toast";


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

    const [openMessageModal, setOpenMessageModal] = useState(false);
    const [selectedAppt, setSelectedAppt] = useState(null);
    const [messageText, setMessageText] = useState("");
    const messagesEndRef = useRef(null);
    const initialMessageCountRef = useRef(0);
    const [isSending, setIsSending] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    const [showCancelPopup, setShowCancelPopup] = useState(false);
    const [cancelTargetId, setCancelTargetId] = useState(null);
    const [selectedReason, setSelectedReason] = useState("");



    useEffect(() => {
        if (!openMessageModal || !selectedAppt || !user) return;

        const interval = setInterval(async () => {
            const token = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/me", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            setAppointments(data || []);

            const updatedAppt = data.find(a => a.id === selectedAppt.id);
            if (updatedAppt) {
                setSelectedAppt(updatedAppt);
            }
        }, 5000); // mỗi 5 giây

        return () => clearInterval(interval);
    }, [openMessageModal, selectedAppt, user]);


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

    useEffect(() => {
        if (!openMessageModal) return;

        const current = selectedAppt?.messages?.length || 0;
        const initial = initialMessageCountRef.current;

        if (current > initial) {
            scrollToBottom();
            initialMessageCountRef.current = current; // cập nhật lại
        }
    }, [selectedAppt?.messages, openMessageModal]);
    useEffect(() => {
        if (!openMessageModal && selectedAppt) {
            const markAndRefresh = async () => {
                await markMessagesAsRead(selectedAppt.id); // ✅ đánh dấu đọc hết
                await fetchAppointments(); // ✅ load lại danh sách
            };
            markAndRefresh();
        }
    }, [openMessageModal]);

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

    const formatSpecialization = (code) => {
        const map = {
            nail_tech: "Nail Technician",
            hair_stylist: "Hair Stylist",
            barber: "Barber",
            esthetician: "Esthetician",
            lash_tech: "Lash Technician",
            massage_therapist: "Massage Therapist",
            makeup_artist: "Makeup Artist",
            receptionist: "Receptionist",
        };
        return map[code] || code;
    };
    const markMessagesAsRead = async (appointmentId) => {
        const token = await auth.currentUser.getIdToken();
        await fetch(`https://crypto-manager-backend.onrender.com/api/appointments/${appointmentId}/read-all`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ sender_role: "freelancer" })
        });
    };


    const handleSendMessage = async () => {
        if (!selectedAppt || !messageText.trim()) return;
        setIsSending(true); // ⏳ bật trạng thái gửi
        try {
            const token = await auth.currentUser.getIdToken();
            const created_at = dayjs().tz("America/Los_Angeles").format("YYYY-MM-DD HH:mm:ss");

            const res = await fetch(
                "https://crypto-manager-backend.onrender.com/api/appointments/messages",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        appointment_id: selectedAppt.id,
                        message: messageText.trim(),
                        created_at,
                    }),
                }
            );

            if (res.ok) {
                toast.success("Message sent!");
                setMessageText("");

                // 👉 Gọi lại appointments/me để cập nhật toàn bộ
                const resAll = await fetch("https://crypto-manager-backend.onrender.com/api/appointments/me", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const updated = await resAll.json();
                setAppointments(updated || []);

                // 👉 Gán lại cuộc hẹn đang chọn với bản mới
                const updatedAppt = updated.find(a => a.id === selectedAppt.id);
                if (updatedAppt) {
                    setSelectedAppt(updatedAppt);
                }
            } else {
                const data = await res.json();
                toast.error(data.error || "Failed to send message");
            }
        } catch (err) {
            console.error("Send failed:", err.message);
            toast.error("Something went wrong.");
        } finally {
            setIsSending(false); // ✅ luôn reset trạng thái
        }
    };
    const scrollToBottom = () => {
        setTimeout(() => {
            if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
            }
        }, 50); // Delay nhẹ để đảm bảo ref đã render
    };
    const cancellationReasons = [
        "I can't make it",
        "Found another stylist",
        "Booked by mistake",
        "Time conflict",
        "Other"
    ];
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
        <div className="min-h-screen text-white px-4 py-6 font-mono sm:font-['Pacifico', cursive]">
            <Navbar />
            <audio ref={soundConfirmRef} src="/confirmed.wav" preload="auto" />
            <audio ref={soundCancelRef} src="/cancelled.wav" preload="auto" />
            {showCancelPopup && (
                <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center">
                    <div className="bg-white text-black rounded-xl p-6 max-w-sm w-full shadow-xl space-y-4">
                        <h2 className="text-lg font-bold text-pink-500">Cancel Appointment</h2>
                        <p className="text-sm text-gray-600">Please select a reason:</p>
                        <select
                            value={selectedReason}
                            onChange={(e) => setSelectedReason(e.target.value)}
                            className="w-full border rounded px-3 py-2 text-sm"
                        >
                            <option value="">-- Choose a reason --</option>
                            {cancellationReasons.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowCancelPopup(false)}
                                className="text-sm text-gray-500 hover:underline"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={!selectedReason}
                                className="bg-red-500 text-white px-4 py-1 rounded shadow disabled:opacity-40"
                                onClick={async () => {
                                    const token = await user.getIdToken();
                                    const res = await fetch(`https://crypto-manager-backend.onrender.com/api/appointments/${cancelTargetId}`, {
                                        method: "DELETE",
                                        headers: {
                                            Authorization: `Bearer ${token}`,
                                            "Content-Type": "application/json"
                                        },
                                        body: JSON.stringify({ cancel_reason: selectedReason })
                                    });

                                    if (res.ok) {
                                        toast.success("Appointment cancelled!");
                                        setAppointments(prev => prev.filter(a => a.id !== cancelTargetId));
                                        setShowCancelPopup(false);
                                        setSelectedReason("");
                                    } else {
                                        toast.error("Failed to cancel appointment");
                                    }
                                }}
                            >
                                Confirm Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <Dialog open={openMessageModal} onOpenChange={setOpenMessageModal}>
                <DialogContent className="rounded-3xl border-t-4 border-b-4 border-pink-500 shadow-xl 
          bg-[#1f2937]/90 backdrop-blur font-mono sm:font-['Pacifico', cursive] text-sm">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg font-bold text-emerald-400">
                            📨 Chat with {selectedAppt?.stylist_name || "Stylist"}
                        </DialogTitle>
                        <p className="text-xs font-semibold text-pink-300 px-3 py-1 inline-flex items-center gap-2 mt-1">
                            <CalendarDays className="w-4 h-4 text-yellow-300" />
                            <span>
                                Appointment Date:&nbsp;
                                <span className="text-yellow-300 font-bold">
                                    {dayjs(selectedAppt?.appointment_date.replace("Z", "")).format("MMM D, hh:mm A")}
                                </span>
                            </span>
                        </p>


                    </DialogHeader>
                    {selectedAppt && (
                        <div className="space-y-3 text-sm max-h-[400px] overflow-y-auto scrollbar-hide">
                            <div className="space-y-4">
                                {selectedAppt.messages?.map((msg, i) => {
                                    const isYou = msg.sender_role === "customer"; // 👈 khách là "you"
                                    const senderLabel = isYou ? "You" : selectedAppt?.stylist_name || "Stylist";

                                    return (
                                        <div
                                            key={i}
                                            className={`rounded-xl px-4 py-2 max-w-[80%] text-sm shadow-md backdrop-blur-sm
                                        ${isYou
                                                    ? "bg-gradient-to-br from-emerald-600/50 to-emerald-800/40 text-white ml-auto text-right"
                                                    : "bg-gradient-to-br from-pink-600/50 to-pink-800/40 text-pink-200"
                                                }`}
                                        >
                                            <div className={"text-xs font-bold mb-1 text-yellow-300"}>{senderLabel}</div>
                                            {msg.message}
                                            <div className="text-[10px] text-gray-400 mt-1">
                                                {dayjs(msg.created_at).tz("America/Los_Angeles").format("MMM D, HH:mm")}
                                            </div>
                                        </div>
                                    );
                                })}
                                {/* ✅ Auto scroll target */}
                                <div ref={messagesEndRef} />
                            </div>

                            <Textarea
                                className="font-mono sm:font-['Pacifico', cursive] text-sm"
                                placeholder="Enter your message..."
                                value={messageText}
                                onChange={(e) => setMessageText(e.target.value)}
                            />

                            <Button
                                onClick={handleSendMessage}
                                disabled={!messageText.trim() || isSending}
                                className={"w-full bg-pink-500 text-white hover:bg-pink-600"}
                            >
                                {isSending ? "Sending..." : "Send"}
                            </Button>

                        </div>
                    )}
                </DialogContent>
            </Dialog>

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
                        {filteredAppointments.map((appt) => {
                            const hasUnread = appt.messages?.some(
                                m => m.sender_role === "freelancer" && m.is_read === false
                            );

                            return (
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
                                    {appt.status === "cancelled" && appt.cancel_reason && (
                                        <p className="mt-1 text-xs text-red-400 italic">
                                            ❌ Reason: {appt.cancel_reason}
                                        </p>
                                    )}
                                    {/* Stylist Info */}
                                    <div className="flex items-center gap-4 mb-3 mt-2">
                                        <img
                                            src={appt.stylist_avatar?.startsWith("http") ? appt.stylist_avatar : "/default-avatar.png"}
                                            alt={appt.stylist_name}
                                            className="w-16 h-16 rounded-full object-cover border-2 border-white shadow"
                                        />
                                        <div>
                                            <h2 className="text-lg font-bold text-pink-300 flex items-center gap-2">
                                                {appt.stylist_name}
                                                {appt.stylist_phone && (
                                                    <span className="text-blue-300 text-xs flex items-center gap-1 ml-2">
                                                        <Phone className="w-4 h-4 inline" /> {appt.stylist_phone}
                                                    </span>
                                                )}
                                            </h2>
                                            <p className="text-xs italic text-gray-200 capitalize">
                                                {Array.isArray(appt.stylist_specialization)
                                                    ? appt.stylist_specialization.map(formatSpecialization).join(", ")
                                                    : formatSpecialization(appt.stylist_specialization)}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Salon Info */}
                                    <div className="mb-2">
                                        <p className="text-sm text-yellow-300 flex items-center gap-1">
                                            🏠 {appt.salon_name}
                                        </p>
                                        {appt.salon_address && (
                                            <p className="text-xs text-yellow-200 flex items-center gap-1 ml-5">
                                                <span className="text-yellow-400">📍</span> {appt.salon_address}
                                            </p>
                                        )}
                                    </div>

                                    {/* Bảng dịch vụ */}
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

                                    {/* Cancel button 
                                    - Nếu muốn hiển thị cuộc hẹn ở quá khứ, thêm 
                                     dayjs(appt.appointment_date.replace("Z", "")).isAfter(dayjs()) &&
                                    */}
                                    {["pending", "confirmed"].includes(appt.status) &&
                                        (
                                            <button
                                                onClick={() => {
                                                    setCancelTargetId(appt.id);          // lưu ID cuộc hẹn muốn huỷ
                                                    setShowCancelPopup(true);            // mở popup lý do
                                                }}
                                                className="absolute bottom-2 left-2 hover:bg-red-500/20 text-red-400 hover:text-white text-[9px] px-4 py-[4px] rounded-3xl transition-all duration-200 flex items-center gap-1"
                                            >
                                                ❌ Click here to cancel
                                            </button>
                                        )}

                                    {/* Nút tin nhắn */}
                                    {appt.status === "confirmed" && (
                                        <button
                                            onClick={async () => {
                                                setSelectedAppt(appt);
                                                initialMessageCountRef.current = appt.messages?.length || 0;
                                                setTimeout(scrollToBottom, 100); // ✅ cuộn 1 lần lúc mở
                                                setOpenMessageModal(true);
                                                setTimeout(scrollToBottom, 100);
                                                await markMessagesAsRead(appt.id); // 👈 Đảm bảo phải `await`

                                                // ✅ Update lại trạng thái messages đã đọc
                                                setAppointments(prev =>
                                                    prev.map(a => {
                                                        if (a.id !== appt.id) return a;
                                                        return {
                                                            ...a,
                                                            messages: a.messages.map(m =>
                                                                m.sender_role === 'freelancer' ? { ...m, is_read: true } : m
                                                            )
                                                        };
                                                    })
                                                );
                                            }}


                                            className={`absolute bottom-2 right-2 flex items-center gap-1 px-3 py-[5px] rounded-full text-sm transition-all
                                            ${hasUnread
                                                    ? "bg-yellow-300 text-black animate-pulse shadow"
                                                    : "hover:bg-blue-500/20 text-blue-400 hover:text-white"
                                                }`}
                                            title={hasUnread ? "New message from stylist" : "View chat"}
                                        >
                                            {hasUnread ? "🔔 New Msg" : "📩 Chat"}
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                    </div>
                )}
            </div>
        </div>
    );
}

export default withAuthProtection(CustomerAppointmentsPage);
