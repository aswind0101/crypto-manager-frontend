import { useState, useEffect } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";
import withAuthProtection from "../../hoc/withAuthProtection";
import { AnimatePresence, motion } from "framer-motion";
import { parsePhoneNumberFromString, AsYouType } from "libphonenumber-js";


function EmployeeProfile() {
    const [employee, setEmployee] = useState(null);
    const [isFlipped, setIsFlipped] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [form, setForm] = useState({ name: "", phone: "" });
    const [msg, setMsg] = useState("");

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                const token = await user.getIdToken();
                try {
                    const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees/me", {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    const data = await res.json();
                    setEmployee(data);
                    setForm({ name: data.name || "", phone: data.phone || "" });
                } catch (err) {
                    console.error("Error fetching employee:", err);
                }
            }
        });
        return () => unsubscribe();
    }, []);

    const handlePhoneChange = (value) => {
        let digitsOnly = value.replace(/\D/g, "");
        let hasCountryCode = false;

        if (digitsOnly.startsWith("1")) {
            hasCountryCode = true;
        }

        if (hasCountryCode) {
            if (digitsOnly.length > 11) digitsOnly = digitsOnly.slice(0, 11);
        } else {
            if (digitsOnly.length > 10) digitsOnly = digitsOnly.slice(0, 10);
        }

        if (digitsOnly.length === 0) {
            setForm({ ...form, phone: "" });
            return;
        }

        if (
            (hasCountryCode && digitsOnly.length <= 4) ||
            (!hasCountryCode && digitsOnly.length <= 3)
        ) {
            setForm({ ...form, phone: digitsOnly });
            return;
        }

        const formatter = new AsYouType("US");
        formatter.input(digitsOnly);
        let formatted = formatter.formattedOutput;

        if (hasCountryCode && !formatted.startsWith("+")) {
            formatted = `+${formatted}`;
        }

        setForm({ ...form, phone: formatted });
    };


    const handleAvatarUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !currentUser) return;

        const formData = new FormData();
        formData.append('avatar', file);

        const token = await currentUser.getIdToken();

        try {
            const res = await fetch('https://crypto-manager-backend.onrender.com/api/employees/upload/avatar', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            });

            let data;
            try {
                data = await res.json();
            } catch (parseError) {
                console.error('❌ Failed to parse JSON:', parseError);
                setMsg('❌ Server error (non-JSON response)');
                return;
            }

            if (res.ok) {
                setEmployee({ ...employee, avatar_url: data.avatar_url });
                setMsg('✅ Avatar uploaded successfully!');
            } else {
                setMsg(`❌ ${data.error || 'Upload failed'}`);
            }
        } catch (err) {
            console.error('❌ Upload error:', err);
            setMsg('❌ Upload failed.');
        }

        setTimeout(() => setMsg(''), 3000);
    };

    const handleCertificationsUpload = (e) => {
        const files = Array.from(e.target.files);
        if (files.length) {
            // TODO: Gửi mảng files lên backend
            console.log("Certifications files:", files);
        }
    };

    const handleIdDocumentsUpload = (e) => {
        const files = Array.from(e.target.files);
        if (files.length) {
            // TODO: Gửi mảng files lên backend
            console.log("ID documents files:", files);
        }
    };

    const handleSave = async () => {
        if (!currentUser) return;
        const token = await currentUser.getIdToken();
        const phoneNumber = parsePhoneNumberFromString(form.phone, "US");
        if (!phoneNumber || !phoneNumber.isValid()) {
            setMsg("❗ Invalid US phone number.");
            setTimeout(() => setMsg(""), 3000);
            return;
        }

        // Gửi dạng E.164 lên server
        const formattedPhone = phoneNumber.number;

        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees/me", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(form),
            });
            if (res.ok) {
                const updated = await res.json();
                setEmployee(updated);
                setMsg("✅ Saved successfully!");
            } else {
                setMsg("❌ Failed to save.");
            }
        } catch (err) {
            console.error("Error saving employee:", err);
            setMsg("❌ Error occurred.");
        }
        // Auto clear message after 3 seconds
        setTimeout(() => setMsg(""), 3000);
    };

    if (!employee) {
        return <div className="bg-black min-h-screen text-white flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="bg-[#1C1F26] min-h-screen text-white font-mono">
            <Navbar />
            <div className="flex flex-col items-center justify-center mt-10">
                <motion.div
                    className={`relative w-80 h-96 bg-[#2f374a] rounded-xl shadow-lg`}
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ duration: 0.8 }}
                    style={{ transformStyle: "preserve-3d" }}
                >
                    {/* Front side */}
                    <div
                        className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] rounded-xl 
                        shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]
                        absolute  w-full h-full flex flex-col items-center p-6"
                        style={{
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                        }}
                    >
                        <img src={`https://crypto-manager-backend.onrender.com${employee.avatar_url || '/default-avatar.png'}`}
                            alt="Avatar"
                            className="w-32 h-32 rounded-full mb-4"
                        />
                        {/* New: Avatar Upload Button */}
                        <label className="text-xs text-gray-400 cursor-pointer mb-2 hover:text-yellow-400">
                            📸 Change Avatar
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleAvatarUpload}
                                className="hidden"
                            />
                        </label>

                        <h2 className="text-xl font-bold">{employee.name}</h2>
                        <p className="text-yellow-400">{employee.role}</p>
                        <p>⭐ {employee.rating_avg || 0} / 5 ({employee.rating_count || 0} ratings)</p>
                        <p>👥 {employee.total_customers || 0} customers</p>
                        <p>💰 {employee.commission_percent || 0}% commission</p>
                        <p>🕒 Active: {employee.status}</p>
                        <span
                            className="absolute bottom-4 text-xs text-gray-400 cursor-pointer"
                            onClick={() => setIsFlipped(true)}
                        >
                            Tap to edit ↺
                        </span>
                    </div>

                    {/* Back side */}
                    <div
                        className="bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] rounded-2xl 
                        shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]
                        absolute w-full h-full flex flex-col p-4 space-y-4 overflow-y-auto"
                        style={{
                            transform: "rotateY(180deg)",
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                        }}
                    >
                        <h2 className="text-xl font-bold text-center">Edit Profile</h2>

                        <div>
                            <label className="text-sm mb-1 block">👤 Full Name</label>
                            <input
                                type="text"
                                placeholder="Full Name"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="p-2 rounded-xl bg-[#1C1F26] text-xs border border-white/5 w-full"
                            />
                        </div>

                        {/* Phone */}
                        <div>
                            <label className="text-sm mb-1 block">📞 Phone Number</label>
                            <input
                                type="text"
                                placeholder="Phone"
                                value={form.phone}
                                onChange={(e) => handlePhoneChange(e.target.value)}
                                className="p-2 rounded-xl bg-[#1C1F26] text-xs border border-white/5 w-full"
                            />
                        </div>
                        {/* Certifications */}
                        <div>
                            <label className="text-sm mb-1 block">📁 Upload Certifications</label>
                            <input
                                type="file"
                                multiple
                                onChange={handleCertificationsUpload}
                                className="text-xs"
                            />
                        </div>

                        {/* ID Documents */}
                        <div>
                            <label className="text-sm mb-1 block">🪪 Upload ID Documents</label>
                            <input
                                type="file"
                                multiple
                                onChange={handleIdDocumentsUpload}
                                className="text-xs"
                            />
                        </div>

                        {/* Commission Status */}
                        {employee.is_freelancer && (
                            <p className="text-sm text-yellow-300">
                                💸 Payment Verified: {employee.payment_verified ? "✅ Yes" : "❌ No"}
                            </p>
                        )}

                        {/* Save Button */}
                        <button
                            onClick={handleSave}
                            className="bg-green-600 hover:bg-green-700 py-2 rounded-xl font-semibold text-white"
                        >
                            💾 Save Changes
                        </button>

                        {/* Message with animation */}
                        <AnimatePresence>
                            {msg && (
                                <motion.p
                                    className="text-center text-sm mt-2"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    {msg}
                                </motion.p>
                            )}
                        </AnimatePresence>

                        {/* Flip Back */}
                        <span
                            className="text-xs text-gray-400 text-center cursor-pointer mt-2"
                            onClick={() => setIsFlipped(false)}
                        >
                            ↺ Tap to flip back
                        </span>
                    </div>


                </motion.div>

            </div>
        </div>
    );
}

export default withAuthProtection(EmployeeProfile);
