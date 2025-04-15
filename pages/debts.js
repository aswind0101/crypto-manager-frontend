import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";

function Debts() {
    const [debts, setDebts] = useState([]);
    const [lender, setLender] = useState("");
    const [amount, setAmount] = useState("");
    const [note, setNote] = useState("");
    const [status, setStatus] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [selectedDebtId, setSelectedDebtId] = useState(null);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentNote, setPaymentNote] = useState("");


    useEffect(() => {
        const auth = getAuth();
        const unsub = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchDebts(user);
            }
        });
        return () => unsub();
    }, []);

    const fetchDebts = async (user) => {
        const idToken = await user.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/debts", {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        setDebts(data);
    };
    const handleAddPayment = async (e, debtId) => {
        e.preventDefault();
        if (!debtId || !paymentAmount) {
            setStatus("❗ Please enter amount.");
            return;
        }

        const idToken = await currentUser.getIdToken();
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/debt-payments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                debt_id: debtId,
                amount_paid: parseFloat(paymentAmount),
                note: paymentNote,
            }),
        });

        if (res.ok) {
            setPaymentAmount("");
            setPaymentNote("");
            setSelectedDebtId(null);
            setStatus("✅ Payment recorded!");
            fetchDebts(currentUser);
        } else {
            const err = await res.json();
            setStatus("❌ " + err.error);
        }
    };


    const handleAdd = async (e) => {
        e.preventDefault();
        if (!lender || !amount) {
            setStatus("❗ Please enter lender name and amount.");
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
                lender_name: lender.trim(),
                total_amount: parseFloat(amount),
                note,
            }),
        });

        if (res.ok) {
            setLender("");
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

            {/* Form thêm khoản nợ */}
            <form onSubmit={handleAdd} className="bg-[#1a2f46] max-w-xl mx-auto p-6 rounded-2xl border border-[#2c4069] space-y-4 shadow-lg mb-6">
                <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Debt</h2>
                <input
                    type="text"
                    placeholder="Lender name (e.g., Mom, Bank)"
                    value={lender}
                    onChange={(e) => setLender(e.target.value)}
                    className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
                    required
                />
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
                <button
                    type="submit"
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-full"
                >
                    Add Debt
                </button>
                {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
            </form>

            {/* Danh sách khoản nợ */}
            <div className="overflow-x-auto rounded-xl border border-[#2c4069] shadow-lg max-w-4xl mx-auto">
                <table className="min-w-full text-sm text-white">
                    <thead className="bg-[#183b69] text-yellow-300">
                        <tr>
                            <th className="px-4 py-2 text-left">Lender</th>
                            <th className="px-4 py-2 text-left">Borrowed</th>
                            <th className="px-4 py-2 text-left">Paid</th>
                            <th className="px-4 py-2 text-left">Remaining</th>
                            <th className="px-4 py-2 text-left">Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {debts.map((d) => (
                            <>
                                <tr key={d.id} className="border-t border-gray-700 hover:bg-[#162330]">
                                    <td className="px-4 py-2 font-bold text-yellow-300">{d.lender_name}</td>
                                    <td className="px-4 py-2">${parseFloat(d.total_amount).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-green-400">${parseFloat(d.total_paid).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-red-400">${parseFloat(d.remaining).toFixed(2)}</td>
                                    <td className="px-4 py-2">{d.note || "-"}</td>
                                </tr>

                                {/* Form trả tiền */}
                                <tr>
                                    <td colSpan={5}>
                                        <form
                                            onSubmit={(e) => handleAddPayment(e, d.id)}
                                            className="flex flex-col md:flex-row gap-2 px-4 py-2 items-center bg-[#101d33]"
                                        >
                                            <input
                                                type="number"
                                                placeholder="Amount"
                                                value={selectedDebtId === d.id ? paymentAmount : ""}
                                                onChange={(e) => {
                                                    setSelectedDebtId(d.id);
                                                    setPaymentAmount(e.target.value);
                                                }}
                                                step="any"
                                                className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none w-full md:w-40"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Note (optional)"
                                                value={selectedDebtId === d.id ? paymentNote : ""}
                                                onChange={(e) => {
                                                    setSelectedDebtId(d.id);
                                                    setPaymentNote(e.target.value);
                                                }}
                                                className="bg-[#1f2937] text-white px-4 py-2 rounded-full outline-none w-full md:w-60"
                                            />
                                            <button
                                                type="submit"
                                                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-full text-white font-medium text-sm"
                                            >
                                                Record Payment
                                            </button>
                                        </form>
                                    </td>
                                </tr>
                            </>
                        ))}

                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default withAuthProtection(Debts);
