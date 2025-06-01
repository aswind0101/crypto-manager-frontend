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
    const router = useRouter();
    const [statusMessage, setStatusMessage] = useState({});

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
                console.log("🧪 schedule data from API:", data);

                if (Array.isArray(data)) {
                    const normalized = data.map(s => ({
                        ...s,
                        weekday: parseInt(s.weekday),
                        start_time: s.start_time?.slice(0, 5), // giữ lại HH:mm
                        end_time: s.end_time?.slice(0, 5),
                    }));
                    setSchedule(normalized);

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
        schedule.find((s) => parseInt(s.weekday) === day)?.[field] || "";

    const handleChange = (day, field, value) => {
        setSchedule((prev) => {
            const existing = prev.find((s) => parseInt(s.weekday) === day);
            if (existing) {
                return prev.map((s) =>
                    parseInt(s.weekday) === day ? { ...s, [field]: value } : s
                );
            } else {
                return [...prev, { weekday: day, start_time: "", end_time: "", id: null, [field]: value }];
            }
        });
    };

    const saveDay = async (day) => {
        const item = schedule.find((s) => parseInt(s.weekday) === day);
        if (!item || !item.start_time || !item.end_time) {
            alert("⚠️ Please select both start and end time.");
            return;
        }

        try {
            setStatusMessage((prev) => ({ ...prev, [day]: "saving" }));

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

            // Refetch để cập nhật id
            const refetch = await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await refetch.json();
            const normalized = data.map(s => ({
                ...s,
                weekday: parseInt(s.weekday),
                start_time: s.start_time?.slice(0, 5),
                end_time: s.end_time?.slice(0, 5),
            }));
            setSchedule(normalized);
            setStatusMessage((prev) => ({ ...prev, [day]: "saved" }));

            setTimeout(() => {
                setStatusMessage((prev) => ({ ...prev, [day]: "" }));
            }, 2000);
        } catch (err) {
            console.error("❌ Error saving schedule:", err.message);
            setStatusMessage((prev) => ({ ...prev, [day]: "error" }));
        }
    };

    const clearDay = async (day) => {
        const confirmClear = window.confirm("Are you sure you want to clear this schedule?");
        if (!confirmClear) return;

        const item = schedule.find((s) => parseInt(s.weekday) === day);
        if (!item) return;

        try {
            if (item.id) {
                const token = await user.getIdToken();
                const res = await fetch(`https://crypto-manager-backend.onrender.com/api/freelancer-schedule/${item.id}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                });
                const msg = await res.json();
                console.log("🧹 Deleted:", msg.message);
            }

            setSchedule((prev) => prev.filter((s) => parseInt(s.weekday) !== day));
            setStatusMessage((prev) => ({ ...prev, [day]: "cleared" }));

            setTimeout(() => {
                setStatusMessage((prev) => ({ ...prev, [day]: "" }));
            }, 2000);
        } catch (err) {
            console.error("❌ Error clearing:", err.message);
            setStatusMessage((prev) => ({ ...prev, [day]: "error" }));
        }
    };

    const copyToAll = (sourceDay) => {
        const item = schedule.find((s) => parseInt(s.weekday) === sourceDay);
        if (!item || !item.start_time || !item.end_time) {
            alert("⚠️ Nothing to copy.");
            return;
        }

        const newSchedule = [];

        for (let i = 0; i < 7; i++) {
            newSchedule.push({
                weekday: i,
                start_time: item.start_time,
                end_time: item.end_time,
                id: i === sourceDay ? item.id : null, // giữ id gốc, reset id cho ngày còn lại
            });
        }

        setSchedule(newSchedule);
        setStatusMessage({}); // reset message (nếu muốn)
    };
    const saveAllDays = async () => {
        if (!user) return;
        const token = await user.getIdToken();

        try {
            setStatusMessage((prev) => ({ ...prev, all: "saving" }));

            for (const s of schedule) {
                if (!s.start_time || !s.end_time) continue;

                const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        weekday: s.weekday,
                        start_time: s.start_time,
                        end_time: s.end_time,
                    }),
                });

                const result = await res.json();

                if (!res.ok) {
                    console.error(`❌ Failed to save weekday ${s.weekday}`, result);
                    throw new Error(result?.error || "Unknown error");
                }

                console.log(`✅ Saved weekday ${s.weekday}`, result.message);
            }

            // Refetch
            const refetch = await fetch("https://crypto-manager-backend.onrender.com/api/freelancer-schedule", {
                headers: { Authorization: `Bearer ${token}` },
            });

            const data = await refetch.json();
            const normalized = data.map(s => ({
                ...s,
                weekday: parseInt(s.weekday),
                start_time: s.start_time?.slice(0, 5),
                end_time: s.end_time?.slice(0, 5),
            }));

            setSchedule(normalized);
            setStatusMessage((prev) => ({ ...prev, all: "saved" }));

            setTimeout(() => {
                setStatusMessage((prev) => ({ ...prev, all: "" }));
            }, 2000);
        } catch (err) {
            console.error("❌ SaveAll failed:", err.message);
            setStatusMessage((prev) => ({ ...prev, all: "error" }));
        }
    };

    return (
        <div className="min-h-screen text-white font-mono">
            <Navbar />
            <div className="max-w-3xl mx-auto p-6">
                <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl p-6">
                    <h1 className="text-2xl font-bold text-emerald-400 mb-6 text-center">📅 Weekly Schedule</h1>

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
                                    <button
                                        onClick={() => copyToAll(idx)}
                                        className="bg-blue-400 hover:bg-blue-500 text-black font-bold px-3 py-1 rounded-full text-xs shadow"
                                    >
                                        📋 All
                                    </button>
                                </div>

                                {statusMessage[idx] === "saving" && <span className="text-xs text-pink-200 animate-pulse">Saving...</span>}
                                {statusMessage[idx] === "saved" && <span className="text-xs text-emerald-300">✔️ Saved</span>}
                                {statusMessage[idx] === "cleared" && <span className="text-xs text-yellow-300">🧹 Cleared</span>}
                                {statusMessage[idx] === "error" && <span className="text-xs text-red-400">❌ Error</span>}

                            </div>
                        ))}
                    </div>
                    <div className="text-right mt-4">
                        <button
                            onClick={saveAllDays}
                            className="bg-green-500 hover:bg-green-600 text-white font-bold px-4 py-2 rounded-lg shadow"
                        >
                            💾 Save All
                        </button>
                        {statusMessage.all === "saving" && <p className="text-pink-200 text-sm">⏳ Saving all days...</p>}
                        {statusMessage.all === "saved" && <p className="text-emerald-300 text-sm">✅ All days saved!</p>}
                        {statusMessage.all === "error" && <p className="text-red-400 text-sm">❌ Error saving all days.</p>}
                    </div>

                </div>
            </div>
        </div>
    );
}
