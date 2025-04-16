import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";

function Lenders() {
  const [lenders, setLenders] = useState([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

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
      }
    } catch (err) {
      console.error("❌ Delete lender error:", err.message);
      alert("❌ Something went wrong.");
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">👥 Lenders</h1>

      {/* Form thêm người cho vay */}
      <form onSubmit={handleAdd} className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6">
        <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Lender</h2>
        <input
          type="text"
          placeholder="Lender name (e.g., Dad, Bank)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
          required
        />
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
        />
        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-full"
        >
          Add Lender
        </button>
        {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
      </form>

      {/* Danh sách người cho vay */}
      <div className="overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg max-w-4xl mx-auto">
        <table className="min-w-full text-sm text-white">
          <thead className="bg-[#183b69] text-yellow-300">
            <tr>
              <th className="px-4 py-2 text-left whitespace-nowrap">Name</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">Note</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">Date</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {lenders.map((l) => (
              <tr key={l.id} className="border-t border-gray-700 hover:bg-[#162330]">
                <td className="px-4 py-2 font-bold text-yellow-300 text-center align-middle whitespace-nowrap">{l.name}</td>
                <td className="px-4 py-2 text-center align-middle whitespace-nowrap">{l.note || "-"}</td>
                <td className="px-4 py-2 text-center align-middle whitespace-nowrap">{new Date(l.created_at).toLocaleDateString()}</td>
                <button
                  className="text-red-400 hover:text-red-600 text-xs underline ml-4"
                  onClick={() => handleDeleteLender(l.id)}
                >
                  🗑️ Delete
                </button>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default withAuthProtection(Lenders);
