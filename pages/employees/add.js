import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";

function AddEmployee() {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("stylist");
    const [currentUser, setCurrentUser] = useState(null);
    const [msg, setMsg] = useState("");
    const router = useRouter();

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) setCurrentUser(user);
        });
        return () => unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !role) {
            setMsg("❗ Please fill all required fields.");
            return;
        }

        try {
            const idToken = await currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    salon_id: 9,
                    name,
                    phone,
                    email,
                    role
                })
            });

            if (res.ok) {
                setMsg("✅ Employee added successfully!");
                setTimeout(() => router.push("/employees"), 1500);
            } else {
                const error = await res.json();
                setMsg("❌ " + error.error);
            }
        } catch (err) {
            console.error("Error:", err.message);
            setMsg("❌ Something went wrong.");
        }
    };

    return (
        <div className="bg-[#1C1F26] min-h-screen text-white p-4 font-mono">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-6 text-center">➕ Add Employee</h1>

            <form
                onSubmit={handleSubmit}
                className="max-w-xl mx-auto p-6 rounded-2xl shadow-[2px_2px_6px_#0b0f17,_-2px_-2px_6px_#1e2631] bg-[#2f374a] space-y-4"
            >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block mb-1 text-sm">Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-[#1C1F26] border border-gray-700 outline-none"
                            placeholder="Employee name"
                            required
                        />
                    </div>

                    <div>
                        <label className="block mb-1 text-sm">Phone</label>
                        <input
                            type="text"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-[#1C1F26] border border-gray-700 outline-none"
                            placeholder="e.g. +14085551234"
                        />
                    </div>
                </div>

                <div>
                    <label className="block mb-1 text-sm">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-2 rounded-xl bg-[#1C1F26] border border-gray-700 outline-none"
                        placeholder="example@email.com"
                    />
                </div>

                <div>
                    <label className="block mb-1 text-sm">Role</label>
                    <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full px-4 py-2 rounded-xl bg-[#1C1F26] border border-gray-700 outline-none"
                    >
                        <option value="stylist">Stylist</option>
                        <option value="nail_tech">Nail Tech</option>
                        <option value="receptionist">Receptionist</option>
                    </select>
                </div>

                {msg && (
                    <p className={`text-center text-sm ${msg.startsWith("✅") ? "text-green-400" : "text-yellow-400"}`}>
                        {msg}
                    </p>
                )}

                <div className="flex gap-4 justify-center">
                    <button
                        type="submit"
                        className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl transition"
                    >
                        ➕ Add Employee
                    </button>
                    <button
                        type="button"
                        onClick={() => router.push("/employees")}
                        className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-xl transition"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
}

export default withAuthProtection(AddEmployee);
