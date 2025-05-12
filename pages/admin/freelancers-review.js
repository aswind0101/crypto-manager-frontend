import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { useRouter } from "next/router";
import { auth } from "../../firebase";

export default function FreelancersReviewPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const auth = getAuth();

  useEffect(() => {
    const fetchPendingDocs = async () => {
      try {
        const user = auth.currentUser;
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
          console.warn(json.error || "Failed to load");
        }
      } catch (err) {
        console.error("Fetch error:", err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchPendingDocs();
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
    <div className="min-h-screen px-4 py-8 bg-gradient-to-br from-emerald-100 to-pink-100 text-gray-800">
      <h1 className="text-2xl font-bold mb-6">📄 Freelancers Document Review</h1>
      {loading ? (
        <p>Loading...</p>
      ) : data.length === 0 ? (
        <p className="text-gray-500">✅ No pending documents.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white rounded-xl shadow">
            <thead>
              <tr className="bg-emerald-100 text-sm">
                <th className="px-4 py-2 text-left">Avatar</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-center">License</th>
                <th className="px-4 py-2 text-center">ID</th>
              </tr>
            </thead>
            <tbody>
              {data.map((freelancer) => (
                <tr key={freelancer.id} className="border-t">
                  <td className="px-4 py-2">
                    {freelancer.avatar_url ? (
                      <img
                        src={`https://crypto-manager-backend.onrender.com${freelancer.avatar_url}`}
                        alt="avatar"
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-gray-400">No avatar</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{freelancer.name}</td>
                  <td className="px-4 py-2">{freelancer.email}</td>

                  {/* License */}
                  <td className="px-4 py-2 text-center">
                    <p className="text-xs mb-1">{freelancer.license_status}</p>
                    {freelancer.license_url && (
                      <a
                        href={`https://crypto-manager-backend.onrender.com${freelancer.license_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 underline text-xs block mb-1"
                      >
                        View
                      </a>
                    )}
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => updateStatus(freelancer.email, "license", "Approved")}
                        className="bg-green-500 text-white px-2 py-1 text-xs rounded hover:bg-green-600"
                      >
                        ✅
                      </button>
                      <button
                        onClick={() => updateStatus(freelancer.email, "license", "Rejected")}
                        className="bg-red-500 text-white px-2 py-1 text-xs rounded hover:bg-red-600"
                      >
                        ❌
                      </button>
                    </div>
                  </td>

                  {/* ID Document */}
                  <td className="px-4 py-2 text-center">
                    <p className="text-xs mb-1">{freelancer.id_doc_status}</p>
                    {freelancer.id_doc_url && (
                      <a
                        href={`https://crypto-manager-backend.onrender.com${freelancer.id_doc_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 underline text-xs block mb-1"
                      >
                        View
                      </a>
                    )}
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => updateStatus(freelancer.email, "id_doc", "Approved")}
                        className="bg-green-500 text-white px-2 py-1 text-xs rounded hover:bg-green-600"
                      >
                        ✅
                      </button>
                      <button
                        onClick={() => updateStatus(freelancer.email, "id_doc", "Rejected")}
                        className="bg-red-500 text-white px-2 py-1 text-xs rounded hover:bg-red-600"
                      >
                        ❌
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
