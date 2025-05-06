import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";

function AddSalon() {
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [ownerUserId, setOwnerUserId] = useState("");
    const [status, setStatus] = useState("active");
    const [currentUser, setCurrentUser] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [msg, setMsg] = useState("");
    const router = useRouter();

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                setOwnerUserId(user.displayName || user.uid); // Tự động gán UID
            }
        });
        return () => unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !address || !phone || !email || !ownerUserId || !status) {
            setMsg("❗ Please fill in all required fields.");
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                setMsg("❗ Invalid email format.");
                return;
            }
        setIsSubmitting(true);
        try {
            const idToken = await currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    name,
                    address,
                    phone,
                    email,
                    owner_user_id: ownerUserId,
                    status
                })
            });
 
            if (res.ok) {
                setMsg("✅ Salon added successfully!");
                setTimeout(() => {
                    router.push("/salons");
                }, 1500);
            } else {
                const error = await res.json();
                setMsg("❌ " + error.error);
            }
        } catch (err) {
            console.error("❌ Error:", err.message);
            setMsg("❌ Something went wrong.");
        }
        setIsSubmitting(false);
    };

    return (
        <div className="bg-[#1C1F26] min-h-screen text-white p-4 font-mono">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">➕ Add Salon</h1>

            <form onSubmit={handleSubmit} className="max-w-xl mx-auto p-6 rounded-2xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] space-y-4 mb-6">
                <input
                    type="text"
                    placeholder="Salon Name *"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    required
                />
                <input
                    type="text"
                    placeholder="Address *"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    required
                />
                <input
                    type="text"
                    placeholder="Phone *"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    required
                />
                <input
                    type="email"
                    placeholder="Email *"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    required
                />
                <input
                    type="text"
                    placeholder="Owner UID *"
                    value={ownerUserId}
                    onChange={(e) => setOwnerUserId(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    required
                />
                <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full bg-[#1C1F26]"
                >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>

                <div className="flex flex-col sm:flex-row justify-center gap-4 mt-4 w-full max-w-md mx-auto">
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`flex-1 font-semibold py-2 rounded-xl transition
                            ${isSubmitting
                                ? "bg-green-400 cursor-not-allowed"
                                : "bg-green-600 hover:bg-green-700 text-white"}`}
                    >
                        {isSubmitting ? "Saving..." : "Add"}
                    </button>

                    <button
                        type="button"
                        onClick={() => router.push('/salons')}
                        className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 rounded-xl transition"
                    >
                        Cancel
                    </button>
                </div>

                {msg && <p className="text-yellow-300 text-sm text-center mt-2">{msg}</p>}
            </form>
        </div>
    );
}

export default withAuthProtection(AddSalon);