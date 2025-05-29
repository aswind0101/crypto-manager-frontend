import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import { AsYouType } from "libphonenumber-js";
import Select from "react-select";


function AddEmployee() {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("nail_tech");
    const [salonId, setSalonId] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [msg, setMsg] = useState("");
    const router = useRouter();


    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                const token = await user.getIdToken();
                try {
                    const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons/me", {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setSalonId(data.id);
                    } else {
                        setMsg("❌ Failed to fetch salon info.");
                    }
                } catch (err) {
                    setMsg("❌ Error fetching salon info.");
                }
            }
        });
        return () => unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !role || !salonId) {
            setMsg("❗ Please fill all required fields and wait for salon info.");
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
                    salon_id: salonId,
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
            setMsg("❌ Something went wrong.");
        }
    };
    const handlePhoneChange = (value) => {
        let digitsOnly = value.replace(/\D/g, "");
        let hasCountryCode = digitsOnly.startsWith("1");

        if (hasCountryCode) {
            if (digitsOnly.length > 11) digitsOnly = digitsOnly.slice(0, 11);
        } else {
            if (digitsOnly.length > 10) digitsOnly = digitsOnly.slice(0, 10);
        }

        if (digitsOnly.length === 0) {
            setPhone("");
            return;
        }

        if (
            (hasCountryCode && digitsOnly.length <= 4) ||
            (!hasCountryCode && digitsOnly.length <= 3)
        ) {
            setPhone(digitsOnly);
            return;
        }

        const formatter = new AsYouType("US");
        formatter.input(digitsOnly);
        let formatted = formatter.formattedOutput;

        if (hasCountryCode && !formatted.startsWith("+")) {
            formatted = `+${formatted}`;
        }

        setPhone(formatted);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-800 via-sky-700 to-pink-700 flex flex-col p-4">
            <Navbar />
            <div className="flex-grow flex items-center justify-center">
                <form
                    onSubmit={handleSubmit}
                    className="glass-box max-w-lg w-full space-y-6"
                    style={{ minWidth: 350 }}
                >
                    <h1 className="text-3xl font-extrabold text-emerald-300 mb-2 text-center">
                        ➕ Add Employee
                    </h1>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block mb-1 text-sm font-semibold text-green-300">Name *</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/30 outline-none text-pink-300"
                                placeholder="Employee name"
                                required
                            />
                        </div>

                        <div>
                            <label className="block mb-1 text-sm font-semibold text-green-300">Phone</label>
                            <input
                                type="text"
                                value={phone}
                                onChange={(e) => handlePhoneChange(e.target.value)}
                                className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/30 outline-none text-pink-300"
                                placeholder="e.g. (408) 555-1234"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block mb-1 text-sm font-semibold text-green-300">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/30 outline-none text-pink-300"
                            placeholder="example@email.com"
                        />
                    </div>

                    <div>
                        <label className="block mb-1 text-sm font-semibold text-green-300">Role</label>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/30 outline-none text-pink-300 "
                        >
                            <option value="nail_tech">Nail Technician</option>
                            <option value="hair_stylist">Hair Stylist</option>
                            <option value="barber">Barber</option>
                            <option value="esthetician">Esthetician</option>
                            <option value="lash_tech">Lash Technician</option>
                            <option value="massage_therapist">Massage Therapist</option>
                            <option value="makeup_artist">Makeup Artist</option>
                            <option value="receptionist">Receptionist</option>
                        </select>
                    </div>

                    {msg && (
                        <p
                            className={`text-center text-sm ${msg.startsWith("✅")
                                ? "text-green-400"
                                : "text-pink-500"
                                }`}
                        >
                            {msg}
                        </p>
                    )}

                    <div className="flex gap-4 justify-center">
                        <button
                            type="submit"
                            className="bg-gradient-to-r from-emerald-500 via-amber-400 to-pink-400 text-white px-6 py-2 rounded-full font-semibold shadow-lg hover:brightness-110"
                        >
                            ➕ Add Employee
                        </button>
                        <button
                            type="button"
                            onClick={() => router.push("/employees")}
                            className="bg-red-500 text-white px-6 py-2 rounded-full font-semibold shadow-lg hover:bg-red-600"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default withAuthProtection(AddEmployee);
