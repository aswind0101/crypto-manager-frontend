import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import Navbar from "../../components/Navbar";
import { auth } from "../../firebase";

export default function FreelancersReviewPage() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const auth = getAuth();
    const [currentUser, setCurrentUser] = useState(null);

    // ✅ Fetch function nhận user
    const fetchPendingDocs = async (user) => {
        try {
            const token = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/pending-docs", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const json = await res.json();
            if (res.ok) {
                setData(json);
            } else {
                console.warn("⚠️", json.error);
            }
        } catch (err) {
            console.error("❌ Error loading freelancers:", err.message);
        } finally {
            setLoading(false);
        }
    };

    // ✅ useEffect khởi tạo và set interval
    useEffect(() => {
        const auth = getAuth();
        let intervalId;

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchPendingDocs(user); // 🔁 lần đầu
                intervalId = setInterval(() => fetchPendingDocs(user), 10000); // ⏰ mỗi 10 giây
            }
        });

        return () => {
            unsubscribe();
            if (intervalId) clearInterval(intervalId);
        };
    }, []);

    const updateStatus = async (email, field, status) => {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/verify-doc", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ email, field, status }),
            });
            const json = await res.json();
            if (res.ok) {
                setData((prev) =>
                    prev.map((f) =>
                        f.email === email ? { ...f, [`${field}_status`]: status } : f
                    )
                );
                alert(`✅ ${field} marked as ${status}`);
            } else {
                alert("❌ " + (json.error || "Update failed"));
            }
        } catch (err) {
            alert("Network error");
            console.error(err.message);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-10 text-gray-800 dark:text-gray-100">
            <Navbar />
            <div className="max-w-6xl mx-auto bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8">
                <h1 className="text-3xl font-bold text-center text-emerald-700 dark:text-emerald-300 mb-6">
                    🧾 Freelancers Document Review
                </h1>

                {loading ? (
                    <p className="text-center text-yellow-400">Loading...</p>
                ) : data.length === 0 ? (
                    <p className="text-center text-gray-600">✅ No pending documents.</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {data.map((freelancer) => (
                            <div
                                key={freelancer.id}
                                className="w-full bg-white/30 dark:bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-5 shadow-md flex flex-col gap-4"
                            >
                                {/* Avatar + Info */}
                                <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                                    <img
                                        src={freelancer.avatar_url ? freelancer.avatar_url : "/no-avatar.png"}
                                        alt="avatar"
                                        className="w-14 h-14 rounded-full object-cover border-2 border-white"
                                    />
                                    <div className="flex flex-col overflow-hidden">
                                        <p className="font-bold text-base truncate">{freelancer.name}</p>
                                        <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                                            {freelancer.email}
                                        </p>
                                    </div>
                                </div>

                                {/* License Section */}
                                <div>
                                    <p className="text-sm font-medium">💳 License</p>
                                    <p className="text-xs mb-1">Status: <span className="font-semibold">{freelancer.license_status}</span></p>
                                    {freelancer.license_url && (
                                        <a
                                            href={freelancer.license_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-blue-700 underline text-xs inline-block mb-2"
                                        >
                                            📄 View License
                                        </a>
                                    )}
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => updateStatus(freelancer.email, "license", "Approved")}
                                            className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded shadow"
                                        >
                                            ✅ Approve
                                        </button>
                                        <button
                                            onClick={() => updateStatus(freelancer.email, "license", "Rejected")}
                                            className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded shadow"
                                        >
                                            ❌ Reject
                                        </button>
                                    </div>
                                </div>

                                {/* ID Section */}
                                <div>
                                    <p className="text-sm font-medium">🪪 ID Document</p>
                                    <p className="text-xs mb-1">Status: <span className="font-semibold">{freelancer.id_doc_status}</span></p>
                                    {freelancer.id_doc_url && (
                                        <a
                                            href={freelancer.id_doc_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-blue-700 underline text-xs inline-block mb-2"
                                        >
                                            🖼 View ID
                                        </a>
                                    )}
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => updateStatus(freelancer.email, "id_doc", "Approved")}
                                            className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded shadow"
                                        >
                                            ✅ Approve
                                        </button>
                                        <button
                                            onClick={() => updateStatus(freelancer.email, "id_doc", "Rejected")}
                                            className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded shadow"
                                        >
                                            ❌ Reject
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

}
