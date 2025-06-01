import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
const auth = getAuth();
const weekdays = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

const hours = Array.from({ length: 24 }).map((_, i) => `${i.toString().padStart(2, "0")}:00`);

export default function SchedulePage() {
    const [schedule, setSchedule] = useState([]);
    const [user, setUser] = useState(null);
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
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const data = await res.json();

                if (Array.isArray(data)) {
                    setSchedule(data); // mỗi phần tử: { id, weekday, start_time, end_time }
                } else {
                    console.warn("⚠️ Schedule fetch failed:", data.error);
                }
            } catch (err) {
                console.error("❌ Error loading schedule:", err.message);
            }
        });

        return () => unsubscribe();
    }, []);

    const getTime = (day, field) =>
        schedule.find((s) => s.weekday === day)?.[field] || "";

    const handleChange = (day, field, value) => {
        setSchedule((prev) => {
            const existing = prev.find((s) => s.weekday === day);
            if (existing) {
                return prev.map((s) =>
                    s.weekday === day ? { ...s, [field]: value } : s
                );
            } else {
                return [...prev, { weekday: day, start_time: "", end_time: "", id: null, [field]: value }];
            }
        });
    };


    const saveDay = async (day) => {
        const item = schedule.find((s) => s.weekday === day);
        if (!item || !item.start_time || !item.end_time) return;

        const token = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                weekday: day,
                start_time: item.start_time,
                end_time: item.end_time,
            }),
        });

        const msg = await res.json();
        alert(msg.message || "Updated");
    };

    const clearDay = async (day) => {
        const item = schedule.find((s) => s.weekday === day);
        if (!item || !item.id) {
            // chỉ xóa local
            setSchedule((prev) => prev.filter((s) => s.weekday !== day));
            return;
        }

        const token = await user.getIdToken();
        await fetch(`https://crypto-manager-backend.onrender.com/api/freelancer-schedule/${item.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });

        setSchedule((prev) => prev.filter((s) => s.weekday !== day));
    };

    return (
        <div className="min-h-screen p-6">
            <div className="max-w-3xl mx-auto bg-white/30 dark:bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl shadow-xl p-6">
                <h1 className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mb-6">📅 Weekly Schedule</h1>

                <div className="grid grid-cols-1 gap-4">
                    {weekdays.map((label, idx) => (
                        <div
                            key={idx}
                            className="flex flex-col sm:flex-row sm:items-center justify-between bg-white/10 p-4 rounded-xl shadow text-sm text-yellow-500 space-y-3 sm:space-y-0"
                        >
                            <div className="font-semibold text-pink-300 w-32">{label}</div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={getTime(idx, "start_time")}
                                    onChange={(e) => handleChange(idx, "start_time", e.target.value)}
                                    className="rounded-lg px-2 py-1 bg-white/10 border border-white/20 focus:outline-none"
                                >
                                    <option value="">Start</option>
                                    {hours.map((h) => (
                                        <option key={h} value={h}>{h}</option>
                                    ))}
                                </select>

                                <span className="text-white">–</span>

                                <select
                                    value={getTime(idx, "end_time")}
                                    onChange={(e) => handleChange(idx, "end_time", e.target.value)}
                                    className="rounded-lg px-2 py-1 bg-white/10 border border-white/20 focus:outline-none"
                                >
                                    <option value="">End</option>
                                    {hours.map((h) => (
                                        <option key={h} value={h}>{h}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex gap-2 mt-2 sm:mt-0">
                                <button
                                    onClick={() => saveDay(idx)}
                                    className="bg-emerald-400 hover:bg-emerald-500 text-black font-bold px-3 py-1 rounded-full text-xs shadow"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => clearDay(idx)}
                                    className="bg-red-400 hover:bg-red-500 text-black font-bold px-3 py-1 rounded-full text-xs shadow"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
