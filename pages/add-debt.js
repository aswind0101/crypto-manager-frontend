// pages/add-debt.js
import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";

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
    <div className="bg-[#1C1F26] min-h-screen text-white p-4 font-mono">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">➕ Add New Debt</h1>

      <form onSubmit={handleAddDebt} className="max-w-xl mx-auto p-6 rounded-2xl space-y-4 mb-6 
      shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
        <div className="relative w-full">
          <select
            value={selectedLenderId}
            onChange={(e) => setSelectedLenderId(e.target.value)}
            className="bg-[#1C1F26] border border-gray-800 text-white rounded-xl px-4 py-2 w-full outline-none appearance-none transition pr-10"
            required
          >
            <option value="">👤 Select lender</option>
            {lenders.map((lender) => (
              <option key={lender.id} value={lender.id}>{lender.name}</option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <div className="w-full mt-1 text-left">
          <button
            type="button"
            onClick={() => router.push("/lenders")}
            className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition"
          >
            ➕ Add New Lender
          </button>
        </div>
        <input
          type="number"
          placeholder="Total amount borrowed"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="any"
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
        <input
          type="date"
          value={createdDate}
          onChange={(e) => setCreatedDate(e.target.value)}
          className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none custom-date"
          required
        />

        <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl">
          Add
        </button>
        {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
        <button
          type="button"
          onClick={() => router.push("/debts")}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl"
        >
          Close
        </button>
      </form>
    </div>
  );
}

export default withAuthProtection(AddDebt);
