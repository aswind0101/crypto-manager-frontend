import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import { parsePhoneNumberFromString, AsYouType } from "libphonenumber-js";
import AddressAutocomplete from "../../components/AddressAutocomplete";



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
            }
        });
        return () => unsubscribe();
    }, []);

    const handlePhoneChange = (value) => {
        // Remove all non-digit characters
        let digitsOnly = value.replace(/\D/g, "");

        let hasCountryCode = false;

        // Kiểm tra nếu bắt đầu bằng 1
        if (digitsOnly.startsWith("1")) {
            hasCountryCode = true;
        }

        // ✅ Giới hạn:
        if (hasCountryCode) {
            if (digitsOnly.length > 11) {
                digitsOnly = digitsOnly.slice(0, 11);
            }
        } else {
            if (digitsOnly.length > 10) {
                digitsOnly = digitsOnly.slice(0, 10);
            }
        }

        // Khi không còn số nào ➔ clear
        if (digitsOnly.length === 0) {
            setPhone("");
            return;
        }

        // Nếu chỉ còn <= 3 số (chỉ area code) ➔ giữ nguyên số để user xoá thoải mái
        if (
            (hasCountryCode && digitsOnly.length <= 4) ||  // ví dụ: 1 + 3 số local
            (!hasCountryCode && digitsOnly.length <= 3)    // ví dụ: chỉ 3 số local
        ) {
            setPhone(digitsOnly);
            return;
        }

        // Format khi đủ số
        const formatter = new AsYouType('US');
        formatter.input(digitsOnly);
        let formatted = formatter.formattedOutput;

        // Thêm + nếu cần
        if (hasCountryCode && !formatted.startsWith('+')) {
            formatted = `+${formatted}`;
        }

        setPhone(formatted);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !address || !phone || !email || !status) {
            setMsg("❗ Please fill in all required fields.");
            return;
        }

        // ✅ Kiểm tra email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setMsg("❗ Invalid email format.");
            return;
        }

        // ✅ Kiểm tra số điện thoại Mỹ
        const phoneNumber = parsePhoneNumberFromString(phone, 'US');
        if (!phoneNumber || !phoneNumber.isValid()) {
            setMsg("❗ Invalid US phone number.");
            return;
        }

        // ✅ Chuẩn hoá số điện thoại (luôn gửi dạng E.164 ví dụ +1...)
        const formattedPhone = phoneNumber.number;

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
                    phone: formattedPhone,
                    email,
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
                <AddressAutocomplete
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter salon address..."
                />
                <input
                    type="text"
                    value={phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    required
                    placeholder="Phone"
                />

                <input
                    type="email"
                    placeholder="Email *"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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