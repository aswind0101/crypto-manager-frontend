import { useState } from "react";
import { useRouter } from "next/router";

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
      <form
        onSubmit={handleSubmit}
        className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8 w-full max-w-lg space-y-4"
      >
        <h1 className="text-3xl font-extrabold text-center text-emerald-700 dark:text-emerald-300 mb-4">
          ✨ Join as a Freelancer
        </h1>

        <Input name="name" label="Full Name" value={form.name} onChange={handleChange} />
        <Input name="email" label="Email" type="email" value={form.email} onChange={handleChange} />
        <Input name="password" label="Password" type="password" value={form.password} onChange={handleChange} />
        <Input name="phone" label="Phone" value={form.phone} onChange={handleChange} />
        <Input name="address" label="Address" value={form.address} onChange={handleChange} />
        <Select name="gender" label="Gender" value={form.gender} onChange={handleChange} options={["Male", "Female", "Other"]} />
        <Input name="birthday" label="Birthday" type="date" value={form.birthday} onChange={handleChange} />
        <Textarea name="about" label="About Me" value={form.about} onChange={handleChange} />
        <Input name="experience" label="Years of Experience" type="number" value={form.experience} onChange={handleChange} />

        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 mt-2">
          <input
            type="checkbox"
            checked={workingAtSalon}
            onChange={(e) => {
              setWorkingAtSalon(e.target.checked);
              setForm({ ...form, is_freelancer: !e.target.checked });
            }}
            className="accent-emerald-500 w-4 h-4 rounded border-white/20"
          />
          Tôi đang làm tại một salon hiện tại
        </label>

        {workingAtSalon && (
          <div className="space-y-2">
            <Input name="temp_salon_name" label="Tên Salon" value={form.temp_salon_name} onChange={handleChange} />
            <Input name="temp_salon_address" label="Địa chỉ Salon" value={form.temp_salon_address} onChange={handleChange} />
            <Input name="temp_salon_phone" label="Số điện thoại Salon" value={form.temp_salon_phone} onChange={handleChange} />
          </div>
        )}

        {msg && <p className="text-center text-green-600 dark:text-green-400">{msg}</p>}

        <button
          type="submit"
          className="w-full bg-gradient-to-r from-emerald-500 via-amber-400 to-pink-400 dark:from-emerald-600 dark:via-amber-500 dark:to-pink-500 text-white py-2 rounded-full font-semibold shadow-lg hover:shadow-xl hover:brightness-105 transition transform hover:scale-105"
        >
          🌟 Register Now 🚀
        </button>
      </form>
    </div>
  );
}

function Input({ name, label, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">{label}</label>
      <input
        name={name}
        {...props}
        className="w-full px-4 py-2 rounded-xl bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 text-gray-800 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
      />
    </div>
  );
}

function Select({ name, label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">{label}</label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full px-4 py-2 rounded-xl bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <option value="">Select</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function Textarea({ name, label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">{label}</label>
      <textarea
        name={name}
        value={value}
        onChange={onChange}
        rows={3}
        className="w-full px-4 py-2 rounded-xl bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 text-gray-800 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
      />
    </div>
  );
}
