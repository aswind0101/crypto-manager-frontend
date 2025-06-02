// Đã cập nhật: Auto-save chính xác khi chọn giờ bằng cách truyền dữ liệu mới vào save
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import Navbar from "../../components/Navbar";

const auth = getAuth();
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hours = Array.from({ length: 24 }).map((_, i) => `${i.toString().padStart(2, "0")}:00`);

export default function SchedulePage() {
    const [schedule, setSchedule] = useState([]);
    const [user, setUser] = useState(null);
    const [statusMessage, setStatusMessage] = useState({});
    const router = useRouter();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (!currentUser) {
                router.push("/login");
                return;
            }
            setUser(currentUser);

            try {
                const token = await currentUser.getIdToken();
                const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (Array.isArray(data)) {
                    const normalized = data.map((s) => ({
                        ...s,
                        weekday: parseInt(s.weekday),
                        start_time: s.start_time?.slice(0, 5),
                        end_time: s.end_time?.slice(0, 5),
                    }));
                    setSchedule(normalized);
                }
            } catch (err) {
                console.error("❌ Error loading schedule:", err.message);
            }
        });
        return () => unsubscribe();
    }, []);

    const saveDayDirect = async (item) => {
        if (!item.start_time || !item.end_time || !user) return;

        try {
            setStatusMessage((prev) => ({ ...prev, [item.weekday]: "saving" }));
            const token = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    weekday: item.weekday,
                    start_time: item.start_time,
                    end_time: item.end_time,
                }),
            });
            await res.json();
            setStatusMessage((prev) => ({ ...prev, [item.weekday]: "saved" }));
            setTimeout(() => setStatusMessage((prev) => ({ ...prev, [item.weekday]: "" })), 1500);
        } catch (err) {
            setStatusMessage((prev) => ({ ...prev, [item.weekday]: "error" }));
        }
    };

    const handleChange = (day, field, value) => {
        setSchedule((prev) => {
            const existing = prev.find((s) => s.weekday === day);
            const updatedItem = existing
                ? { ...existing, [field]: value }
                : { weekday: day, start_time: "", end_time: "", id: null, [field]: value };

            const updated = existing
                ? prev.map((s) => (s.weekday === day ? updatedItem : s))
                : [...prev, updatedItem];

            saveDayDirect(updatedItem);
            return updated;
        });
    };

    const clearDay = async (day) => {
        if (!window.confirm("Are you sure you want to clear this schedule?")) return;

        const item = schedule.find((s) => s.weekday === day);
        if (!item) return;

        try {
            const token = await user.getIdToken();

            // Nếu có ID thì xoá hẳn
            if (item.id) {
                await fetch(`https://crypto-manager-backend.onrender.com/api/freelancer-schedule/${item.id}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                });
            } else {
                // Nếu không có ID thì update = null (reset)
                await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        weekday: day,
                        start_time: null,
                        end_time: null,
                    }),
                });
            }

            setSchedule((prev) => prev.filter((s) => s.weekday !== day));
            setStatusMessage((prev) => ({ ...prev, [day]: "cleared" }));
            setTimeout(() => setStatusMessage((prev) => ({ ...prev, [day]: "" })), 2000);
        } catch (err) {
            console.error("❌ Clear error:", err);
            setStatusMessage((prev) => ({ ...prev, [day]: "error" }));
        }
    };


    const copyToAll = (sourceDay) => {
        const item = schedule.find((s) => s.weekday === sourceDay);
        if (!item || !item.start_time || !item.end_time) {
            alert("⚠️ Nothing to copy.");
            return;
        }
        const newSchedule = weekdays.map((_, i) => ({
            weekday: i,
            start_time: item.start_time,
            end_time: item.end_time,
            id: i === sourceDay ? item.id : null,
        }));
        setSchedule(newSchedule);
        setStatusMessage({});
    };
    const saveAll = () => {
        schedule.forEach((item) => {
            if (item.start_time && item.end_time) saveDayDirect(item);
        });
    };
    return (
        <div className="bg-[#1C1F26] min-h-screen text-yellow-500 font-mono">
            <Navbar />
            <div className="max-w-4xl mx-auto p-6">
                <h1 className="text-2xl font-bold text-emerald-400 mb-6 text-center">📅 Weekly Schedule (Auto Save)</h1>
                <div className="text-right mb-4">
                    <button
                        onClick={saveAll}
                        className="bg-green-500 hover:bg-green-600 text-white font-bold px-4 py-2 rounded-lg shadow"
                    >
                        💾 Save All
                    </button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/10 shadow">
                    <table className="min-w-[600px] w-full text-xs sm:text-sm text-center border-collapse">
                        <thead>
                            <tr className="bg-white/10 text-amber-300">
                                <th className="py-2">Day</th>
                                <th>Start</th>
                                <th>End</th>
                                <th>Actions</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {weekdays.map((label, idx) => (
                                <tr key={idx} className="border-t border-white/20">
                                    <td className="py-2 font-semibold text-pink-300">{label}</td>
                                    <td>
                                        <select
                                            value={schedule.find((s) => s.weekday === idx)?.start_time || ""}
                                            onChange={(e) => handleChange(idx, "start_time", e.target.value)}
                                            className="rounded px-2 py-1 bg-white/10"
                                        >
                                            <option value="">Start</option>
                                            {hours.map((h) => (
                                                <option key={h} value={h}>{h}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        <select
                                            value={schedule.find((s) => s.weekday === idx)?.end_time || ""}
                                            onChange={(e) => handleChange(idx, "end_time", e.target.value)}
                                            className="rounded px-2 py-1 bg-white/10"
                                        >
                                            <option value="">End</option>
                                            {hours.map((h) => (
                                                <option key={h} value={h}>{h}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        <div className="flex justify-center gap-2 flex-wrap">
                                            <button
                                                onClick={() => clearDay(idx)}
                                                className="bg-red-400 px-3 py-1 rounded-full text-xs font-bold text-black"
                                            >
                                                Clear
                                            </button>
                                            <button
                                                onClick={() => copyToAll(idx)}
                                                className="bg-blue-400 px-3 py-1 rounded-full text-xs font-bold text-black"
                                            >
                                                📋
                                            </button>
                                        </div>
                                    </td>
                                    <td>
                                        {statusMessage[idx] === "saving" && <span className="text-pink-300 text-xs">Saving...</span>}
                                        {statusMessage[idx] === "saved" && <span className="text-emerald-300 text-xs">✔ Saved</span>}
                                        {statusMessage[idx] === "cleared" && <span className="text-yellow-300 text-xs">🧹</span>}
                                        {statusMessage[idx] === "error" && <span className="text-red-400 text-xs">❌</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
