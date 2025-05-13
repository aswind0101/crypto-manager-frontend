// pages/salons/freelancers-approval.js
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import { auth } from "../../firebase";

export default function SalonFreelancerApproval() {
    const [freelancers, setFreelancers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState(null);

    const fetchFreelancers = async (user) => {
        try {
            const token = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees/freelancers-pending", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (res.ok) setFreelancers(json);
            else console.warn("⚠️", json.error);
        } catch (err) {
            console.error("❌ Error fetching freelancers:", err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (id, action) => {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees/freelancers-approve", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ employee_id: id, action }),
            });
            const json = await res.json();
            if (res.ok) {
                setFreelancers((prev) => prev.filter((f) => f.id !== id));
                alert(`✅ Freelancer ${action}d successfully!`);
            } else {
                alert("❌ " + (json.error || "Action failed"));
            }
        } catch (err) {
            alert("❌ Network error");
            console.error(err.message);
        }
    };

    const handleDocumentStatusChange = async (employeeId, type, newStatus) => {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees/update-status", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ employee_id: employeeId, type, status: newStatus }),
            });
            const data = await res.json();
            if (res.ok) {
                setFreelancers((prev) =>
                    prev.map((f) =>
                        f.id === employeeId ? { ...f, [type]: newStatus } : f
                    )
                );
            } else {
                alert("❌ " + (data.error || "Update failed"));
            }
        } catch (err) {
            alert("❌ Network error");
        }
    };

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchFreelancers(user);
            }
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-10 text-gray-800 dark:text-gray-100">
            <Navbar />
            <div className="max-w-6xl mx-auto backdrop-blur-md rounded-3xl p-2">
                <h1 className="text-3xl font-bold text-center text-emerald-700 dark:text-emerald-300 mb-6">
                    🧾 Approve Freelancers for Your Salon
                </h1>

                {loading ? (
                    <p className="text-center text-yellow-400">Loading...</p>
                ) : freelancers.length === 0 ? (
                    <p className="text-center text-gray-600">✅ No pending freelancers.</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {freelancers.map((f) => (
                            <div key={f.id} className="bg-white/30 dark:bg-black/30 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-xl space-y-4 transition hover:shadow-2xl hover:scale-[1.01]">
                                {/* Avatar + Info */}
                                <div className="flex items-center gap-4">
                                    <img
                                        src={f.avatar_url ? `https://crypto-manager-backend.onrender.com${f.avatar_url}` : "/no-avatar.png"}
                                        className="w-32 h-32 rounded-full object-cover border-2 border-white shadow"
                                        alt="avatar"
                                    />
                                    <div>
                                        <p className="font-bold text-lg">{f.name}</p>
                                        <p className="text-xs text-gray-700 dark:text-gray-300">{f.email}</p>
                                        <p className="text-xs text-gray-500 mt-1">💼 <strong>{f.role}</strong></p>
                                    </div>
                                </div>

                                {/* License + ID Sections */}
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-sm text-gray-800 dark:text-gray-100">
                                    {/* License */}
                                    <div className="rounded-xl">
                                        <div className="flex justify-between items-center mb-2">
                                            <p className="font-semibold">📄 License</p>
                                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${f.certification_status === "Approved" ? "bg-green-500 text-white"
                                                : f.certification_status === "Rejected" ? "bg-red-500 text-white"
                                                    : "bg-yellow-400 text-black"
                                                }`}>
                                                {f.certification_status}
                                            </span>
                                        </div>
                                        {f.certifications?.[0]?.endsWith(".pdf") ? (
                                            <a href={`https://crypto-manager-backend.onrender.com${f.certifications[0]}`} target="_blank" className="text-blue-300 underline">📄 View PDF</a>
                                        ) : (
                                            <img
                                                src={`https://crypto-manager-backend.onrender.com${f.certifications[0]}`}
                                                alt="license"
                                                className="w-full h-full rounded-xl border border-white/20 object-cover cursor-pointer transition hover:scale-105"
                                                style={{ maxHeight: "180px" }}
                                                onClick={() => window.open(`https://crypto-manager-backend.onrender.com${f.certifications[0]}`, "_blank")}
                                            />

                                        )}
                                        <select
                                            value={f.certification_status}
                                            onChange={e => handleDocumentStatusChange(f.id, "certification_status", e.target.value)}
                                            className="w-full mt-2 rounded text-sm"
                                        >
                                            <option>In Review</option>
                                            <option>Approved</option>
                                            <option>Rejected</option>
                                        </select>
                                    </div>

                                    {/* ID Document */}
                                    <div className="rounded-xl">
                                        <div className="flex justify-between items-center mb-2">
                                            <p className="font-semibold">🆔 ID Document</p>
                                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${f.id_document_status === "Approved" ? "bg-green-500 text-white"
                                                : f.id_document_status === "Rejected" ? "bg-red-500 text-white"
                                                    : "bg-yellow-400 text-black"
                                                }`}>
                                                {f.id_document_status}
                                            </span>
                                        </div>
                                        {f.id_documents?.[0]?.endsWith(".pdf") ? (
                                            <a href={`https://crypto-manager-backend.onrender.com${f.id_documents[0]}`} target="_blank" className="text-blue-300 underline">📄 View PDF</a>
                                        ) : (
                                            <img
                                                src={`https://crypto-manager-backend.onrender.com${f.id_documents[0]}`}
                                                alt="id doc"
                                                className="w-full h-full rounded-xl border border-white/20 object-cover cursor-pointer transition hover:scale-105"
                                                style={{ maxHeight: "180px" }}
                                                onClick={() => window.open(`https://crypto-manager-backend.onrender.com${f.id_documents[0]}`, "_blank")}
                                            />
                                        )}
                                        <select
                                            value={f.id_document_status}
                                            onChange={e => handleDocumentStatusChange(f.id, "id_document_status", e.target.value)}
                                            className="w-full mt-2 rounded text-sm"
                                        >
                                            <option>In Review</option>
                                            <option>Approved</option>
                                            <option>Rejected</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Approve / Reject buttons */}
                                <div className="flex gap-3 pt-3">
                                    <button
                                        onClick={() => handleAction(f.id, "approve")}
                                        className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded-xl font-semibold shadow"
                                    >
                                        ✅ Approve
                                    </button>

                                    <button
                                        onClick={() => handleAction(f.id, "reject")}
                                        className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl font-semibold shadow"
                                    >
                                        ❌ Reject
                                    </button>
                                </div>
                            </div>

                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
