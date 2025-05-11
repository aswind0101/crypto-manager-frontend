import { useState } from "react";
import { useRouter } from "next/router";
import { FiUser, FiMail, FiLock, FiPhone, FiMapPin } from "react-icons/fi";

export default function FreelancerRegister() {
    const router = useRouter();
    const [workingAtSalon, setWorkingAtSalon] = useState(false);
    const [msg, setMsg] = useState("");

    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        phone: "",
        address: "",
        gender: "",
        birthday: "",
        about: "",
        experience: "",
        is_freelancer: true,
        temp_salon_name: "",
        temp_salon_address: "",
        temp_salon_phone: "",
    });

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const data = await res.json();
            if (res.ok) {
                setMsg(data.message);
                setTimeout(() => router.push("/login"), 3000);
            } else {
                setMsg(data.error || "❌ Đăng ký thất bại");
            }
        } catch (err) {
            console.error("❌ Error:", err.message);
            setMsg("❌ Đã xảy ra lỗi kết nối server.");
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-700 dark:via-sky-700 dark:to-pink-700 flex items-center justify-center px-4 py-8">
            <div className="bg-white dark:bg-gray-900 bg-opacity-90 dark:bg-opacity-90 rounded-3xl shadow-xl p-8 w-full max-w-lg max-w-[90%]">
                <h1 className="text-3xl font-extrabold text-center text-emerald-600 dark:text-emerald-300 mb-6">
                    🌟 Join as a Freelancer
                </h1>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <Input name="name" label="Full Name" icon={<FiUser />} value={form.name} onChange={handleChange} />
                    <Input name="email" label="Email" icon={<FiMail />} type="email" value={form.email} onChange={handleChange} />
                    <Input name="password" label="Password" icon={<FiLock />} type="password" value={form.password} onChange={handleChange} />
                    <Input name="phone" label="Phone" icon={<FiPhone />} value={form.phone} onChange={handleChange} />
                    <Input name="address" label="Address" icon={<FiMapPin />} value={form.address} onChange={handleChange} />
                    <Select name="gender" label="Gender" value={form.gender} onChange={handleChange} options={["Male", "Female", "Other"]} />
                    <Input name="birthday" label="Birthday" type="date" value={form.birthday} onChange={handleChange} />
                    <Textarea name="about" label="About Me" value={form.about} onChange={handleChange} />
                    <Input name="experience" label="Years of Experience" type="number" value={form.experience} onChange={handleChange} />

                    {/* Checkbox: làm việc tại salon */}
                    <div className="mt-4">
                        <label className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                            <input
                                type="checkbox"
                                checked={workingAtSalon}
                                onChange={(e) => {
                                    setWorkingAtSalon(e.target.checked);
                                    setForm({ ...form, is_freelancer: !e.target.checked });
                                }}
                            />
                            <span>Tôi đang làm tại một salon hiện tại</span>
                        </label>
                    </div>

                    {workingAtSalon && (
                        <div className="space-y-2 mt-2">
                            <Input name="temp_salon_name" label="Tên Salon" value={form.temp_salon_name} onChange={handleChange} />
                            <Input name="temp_salon_address" label="Địa chỉ Salon" value={form.temp_salon_address} onChange={handleChange} />
                            <Input name="temp_salon_phone" label="Số điện thoại Salon" value={form.temp_salon_phone} onChange={handleChange} />
                        </div>
                    )}

                    {msg && <p className="text-center text-green-600 dark:text-green-400">{msg}</p>}

                    <button
                        type="submit"
                        className="w-full bg-gradient-to-r from-emerald-500 via-amber-400 to-pink-400 dark:from-emerald-600 dark:via-amber-500 dark:to-pink-500 text-white py-2 rounded-full font-semibold shadow-lg hover:shadow-2xl transition transform hover:scale-105 flex items-center justify-center gap-2"
                    >
                        ✨ Register Now <span className="animate-bounce">🚀</span>
                    </button>
                </form>
            </div>
        </div>
    );
}

function Input({ name, label, icon, ...props }) {
    return (
        <div>
            <label className="block mb-1 font-medium text-gray-700 dark:text-gray-200">{label}</label>
            <div className="flex items-center bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-emerald-400">
                <div className="pl-3 text-emerald-500">{icon}</div>
                <input
                    name={name}
                    {...props}
                    className="w-full px-3 py-2 rounded-r-xl focus:outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                />
            </div>
        </div>
    );
}

function Select({ name, label, value, onChange, options }) {
    return (
        <div>
            <label className="block mb-1 font-medium text-gray-700 dark:text-gray-200">{label}</label>
            <select
                name={name}
                value={value}
                onChange={onChange}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-gray-700 dark:text-gray-200"
            >
                <option value="">Select</option>
                {options.map((opt) => (
                    <option key={opt} value={opt}>
                        {opt}
                    </option>
                ))}
            </select>
        </div>
    );
}

function Textarea({ name, label, value, onChange }) {
    return (
        <div>
            <label className="block mb-1 font-medium text-gray-700 dark:text-gray-200">{label}</label>
            <textarea
                name={name}
                value={value}
                onChange={onChange}
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-gray-700 dark:text-gray-200"
            />
        </div>
    );
}