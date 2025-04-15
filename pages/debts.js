import { useEffect, useState } from "react";
import React from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";

function Debts() {
    const [debts, setDebts] = useState([]);
    const [amount, setAmount] = useState("");
    const [note, setNote] = useState("");
    const [status, setStatus] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [createdDate, setCreatedDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split("T")[0];
    });
    const [lenders, setLenders] = useState([]);
    const [selectedLenderId, setSelectedLenderId] = useState("");
    const [groupedDebts, setGroupedDebts] = useState([]);
    const [expandedLender, setExpandedLender] = useState(null);

    useEffect(() => {
        const auth = getAuth();
        const unsub = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchDebts(user);
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

    const fetchDebts = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/debts", {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        setDebts(data);
        const grouped = groupDebtsByLender(data);
        setGroupedDebts(grouped);
    };

    const groupDebtsByLender = (debts) => {
        const grouped = {};

        debts.forEach((d) => {
            const lenderId = d.lender_id;
            if (!grouped[lenderId]) {
                grouped[lenderId] = {
                    lender_id: d.lender_id,
                    lender_name: d.lender_name,
                    total_amount: 0,
                    total_paid: 0,
                    details: [],
                };
            }

            grouped[lenderId].total_amount += parseFloat(d.total_amount || 0);
            grouped[lenderId].total_paid += parseFloat(d.total_paid || 0);
            grouped[lenderId].details.push(d);
        });

        return Object.values(grouped).map((item) => ({
            ...item,
            remaining: item.total_amount - item.total_paid,
        }));
    };

    const handleAdd = async (e) => {
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
            fetchDebts(currentUser);
        } else {
            const err = await res.json();
            setStatus("❌ " + err.error);
        }
    };

    return (
        <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">💳 Debt Manager</h1>

            <form onSubmit={handleAdd} className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6">
                <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Debt</h2>
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
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                    step="any"
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
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                    required
                />
                <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-full">
                    Add Debt
                </button>
                {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
            </form>

            <div className="overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg max-w-4xl mx-auto">
                <table className="min-w-full text-sm text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left">Lender</th>
                            <th className="px-4 py-2 text-left">Total Borrowed</th>
                            <th className="px-4 py-2 text-left">Total Paid</th>
                            <th className="px-4 py-2 text-left">Remaining</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedDebts.map((d) => (
                            <React.Fragment key={d.lender_id}>
                                <tr
                                    className="border-t border-gray-700 hover:bg-[#162330] cursor-pointer"
                                    onClick={() => setExpandedLender(expandedLender === d.lender_id ? null : d.lender_id)}
                                >
                                    <td className="px-4 py-2 font-bold text-yellow-300">{d.lender_name}</td>
                                    <td className="px-4 py-2">${parseFloat(d.total_amount || 0).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-green-400">${parseFloat(d.total_paid || 0).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-red-400">${parseFloat(d.remaining || 0).toFixed(2)}</td>
                                </tr>

                                {expandedLender === d.lender_id &&
                                    d.details.map((detail) => (
                                        <tr key={detail.id} className="bg-[#101d33] border-t border-gray-800 text-sm">
                                            <td className="px-8 py-2" colSpan={4}>
                                                📅 {new Date(detail.created_at).toLocaleDateString()} | 💵 ${parseFloat(detail.total_amount || 0).toFixed(2)} | 🧾 {detail.note || "No note"}
                                            </td>
                                        </tr>
                                    ))}
                            </React.Fragment>
                        ))}
                    </tbody>

                </table>
            </div>
        </div>
    );
}

export default withAuthProtection(Debts);