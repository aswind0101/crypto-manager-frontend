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
      <div className="max-w-6xl mx-auto bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8">
        <h1 className="text-3xl font-bold text-center text-emerald-700 dark:text-emerald-300 mb-6">
          🧾 Approve Freelancers for Your Salon
        </h1>

        {loading ? (
          <p className="text-center text-yellow-400">Loading...</p>
        ) : freelancers.length === 0 ? (
          <p className="text-center text-gray-600">✅ No pending freelancers.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {freelancers.map((f) => (
              <div key={f.id} className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 shadow-md space-y-3">
                <div className="flex items-center gap-3">
                  <img
                    src={f.avatar_url ? `https://crypto-manager-backend.onrender.com${f.avatar_url}` : "/no-avatar.png"}
                    className="w-12 h-12 rounded-full object-cover border"
                    alt="avatar"
                  />
                  <div>
                    <p className="font-bold truncate">{f.name}</p>
                    <p className="text-xs text-gray-700 dark:text-gray-300">{f.email}</p>
                  </div>
                </div>

                <p className="text-sm">💼 Role: <strong>{f.role}</strong></p>

                <div className="text-xs text-gray-600 dark:text-gray-300">
                  <p>License Status: {f.certification_status}</p>
                  <p>ID Status: {f.id_document_status}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(f.id, "approve")}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white py-1 rounded"
                  >✅ Approve</button>

                  <button
                    onClick={() => handleAction(f.id, "reject")}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white py-1 rounded"
                  >❌ Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
