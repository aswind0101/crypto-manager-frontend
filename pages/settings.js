import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import withAuthProtection from "../hoc/withAuthProtection";
import Navbar from "../components/Navbar";

function Settings() {
    const [threshold, setThreshold] = useState(10); // default 10%
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState("");
    const baseUrl = "https://crypto-manager-backend.onrender.com";

    useEffect(() => {
        const fetchAlertSettings = async () => {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) return;

            const token = await user.getIdToken();
            const res = await fetch(`${baseUrl}/api/user-alerts`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.ok) {
                const data = await res.json();
                if (data.email) setEmail(data.email);
                if (data.alert_threshold) setThreshold(data.alert_threshold);
            }
        };

        fetchAlertSettings();
    }, []);

    const handleSave = async () => {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        const res = await fetch(`${baseUrl}/api/user-alerts`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ alert_threshold: Number(threshold) })
        });

        if (res.ok) {
            setStatus("✅ Saved successfully");
        } else {
            setStatus("❌ Failed to save");
        }
    };

    const clearAllTargetCache = () => {
        let count = 0;
        Object.keys(localStorage).forEach((k) => {
            if (k.startsWith("target_")) {
                localStorage.removeItem(k);
                count++;
            }
        });
        setStatus(`🎯 Cleared ${count} target cache items.`);
        setTimeout(() => setStatus(""), 3000);
    };
    
    return (
        <div className="min-h-screen bg-[#0b1e3d] text-white">
            <Navbar />
            <div className="max-w-xl mx-auto p-6">
                <h1 className="text-2xl font-bold text-yellow-400 mb-4">⚙️ Email Alert Settings</h1>

                <div className="space-y-4 bg-[#1a2f46] p-6 rounded-xl shadow-lg border border-[#2c4069]">
                    <div>
                        <label className="text-sm text-gray-400">Email</label>
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full bg-gray-700 text-white px-4 py-2 rounded mt-1"
                        />
                    </div>

                    <div>
                        <label className="text-sm text-gray-400">
                            Alert Threshold (%) – Total P/L change
                        </label>
                        <input
                            type="number"
                            value={threshold}
                            onChange={(e) => setThreshold(e.target.value)}
                            className="w-full bg-gray-700 text-white px-4 py-2 rounded mt-1"
                            min="1"
                            step="1"
                        />
                    </div>

                    <button
                        onClick={handleSave}
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-full transition"
                    >
                        💾 Save
                    </button>

                    {status && <p className="text-sm text-yellow-300">{status}</p>}
                </div>
                {/*
                <div className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6 mt-4">
                    <button
                        onClick={clearAllTargetCache}
                        className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-full transition"
                    >
                        🗑️ Clear All Target Cache
                    </button>
                    {status && (
                        <p className="text-sm text-yellow-300 text-center mt-2">{status}</p>
                    )}
                </div>
                */}
            </div>
        </div>
    );
}

export default withAuthProtection(Settings);
