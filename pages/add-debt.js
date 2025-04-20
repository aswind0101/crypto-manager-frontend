// pages/add-debt.js
import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";

function AddDebt() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [createdDate, setCreatedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [lenders, setLenders] = useState([]);
  const [selectedLenderId, setSelectedLenderId] = useState("");
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

  const handleAddDebt = async (e) => {
    e.preventDefault();
    if (!selectedLenderId || !amount) {
      setStatus("❗ Please select lender and enter amount.");
      return;
    }

    const idToken = await currentUser.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/debts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        lender_id: selectedLenderId,
        total_amount: parseFloat(amount),
        note,
        created_at: createdDate,
      }),
    });

    if (res.ok) {
      setAmount("");
      setNote("");
      setStatus("✅ Debt added!");
      setTimeout(() => setStatus(""), 3000);
    } else {
      const err = await res.json();
      setStatus("❌ " + err.error);
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">➕ Add New Debt</h1>

      <form onSubmit={handleAddDebt} className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6">
        <select
          value={selectedLenderId}
          onChange={(e) => setSelectedLenderId(e.target.value)}
          className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
          required
        >
          <option value="">-- Select Lender --</option>
          {lenders.map((lender) => (
            <option key={lender.id} value={lender.id}>{lender.name}</option>
          ))}
        </select>

        <input
          type="number"
          placeholder="Total amount borrowed"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="any"
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
        <input
          type="date"
          value={createdDate}
          onChange={(e) => setCreatedDate(e.target.value)}
          className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none custom-date"
          required
        />

        <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-full">
          Add
        </button>
        {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
        <button
          type="button"
          onClick={() => window.location.href = '/debts'}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-full"
        >
          Close
        </button>
      </form>
    </div>
  );
}

export default withAuthProtection(AddDebt);
