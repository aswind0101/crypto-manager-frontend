import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";


function Lenders() {
  const [lenders, setLenders] = useState([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const router = useRouter();


  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        fetchLenders(user);
      }
    });
    return () => unsub();
  }, []);

  const fetchLenders = async (user) => {
    const idToken = await user.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/lenders", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json();
    setLenders(data);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name) {
      setStatus("❗ Please enter lender name.");
      return;
    }

    const idToken = await currentUser.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/lenders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ name: name.trim(), note }),
    });

    if (res.ok) {
      setName("");
      setNote("");
      setStatus("✅ Lender added!");
      fetchLenders(currentUser);
      setTimeout(() => setStatus(""), 3000);
    } else {
      const err = await res.json();
      setStatus("❌ " + err.error);
    }
  };
  const handleDeleteLender = async (lenderId) => {
    if (!confirm("Do you want to delete this lender?")) return;

    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`https://crypto-manager-backend.onrender.com/api/lenders/${lenderId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        alert("❌ " + data.error);
      } else {
        alert("✅ Lender deleted.");
        fetchLenders(currentUser); // reload danh sách
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      console.error("❌ Delete lender error:", err.message);
      alert("❌ Something went wrong.");
    }
  };

  return (
    <div className="bg-[#1C1F26] min-h-screen text-white p-4 font-mono">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">👥 Lenders</h1>

      {/* Form thêm người cho vay */}
      <form onSubmit={handleAdd} className="bg-[#1C1F26] max-w-xl mx-auto p-6 rounded-2xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] transition-all space-y-4 mb-6">
        <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Lender</h2>
        <input
          type="text"
          placeholder="Lender name (e.g., Dad, Bank)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
          required
        />
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
        />
        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl"
        >
          Add Lender
        </button>
        {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
        <button
          type="button"
          onClick={() => router.push("/add-debt")}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl mt-2"
        >
          🔙 Back to Add Debt
        </button>
      </form>

      {/* Danh sách người cho vay */}
      <div className="overflow-x-auto rounded-2xl bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] max-w-[1200px] mx-auto">
        <table className="min-w-full text-sm text-white">
          <thead className="bg-yellow-700 text-white">
            <tr>
              <th className="px-4 py-2 text-left whitespace-nowrap">Name</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">Note</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">Date</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {lenders.map((l) => (
              <tr key={l.id} className="border-t border-white/4 hover:bg-[#162330]">
                <td className="px-4 py-2 font-bold text-yellow-300 text-left align-middle whitespace-nowrap">{l.name}</td>
                <td className="px-4 py-2 text-left align-middle whitespace-nowrap">{l.note || "-"}</td>
                <td className="px-4 py-2 text-left align-middle whitespace-nowrap">{l.created_at.slice(5, 7) + "/" + l.created_at.slice(8, 10) + "/" + l.created_at.slice(0, 4)}</td>
                <td className="px-4 py-2 text-right align-middle whitespace-nowrap">
                  <button
                    className="text-red-400 hover:text-red-600 text-xs"
                    onClick={() => handleDeleteLender(l.id)}
                  >
                    🗑️ Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default withAuthProtection(Lenders);
