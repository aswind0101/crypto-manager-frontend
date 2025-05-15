import { useState } from "react";
import { useRouter } from "next/router";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { Phone, Mail, User, Lock, CalendarDays, MapPin } from "lucide-react"; // icon gợi ý
import { MessageCircle } from "lucide-react";
import { Briefcase } from "lucide-react";


export default function FreelancerRegister() {
  const router = useRouter();
  const [workingAtSalon, setWorkingAtSalon] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState({});

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
    specialization: "",
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const requiredFields = [
      "name", "email", "password", "phone", "address",
      "gender", "birthday", "about", "experience", "specialization"
    ];

    const newErrors = {};
    for (let field of requiredFields) {
      if (!form[field]) {
        newErrors[field] = true;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setMsg("❌ Please fill in all required fields.");
      return;
    }

    setErrors({}); // xoá lỗi nếu đã hợp lệ
    const phoneNumber = parsePhoneNumberFromString(form.phone, 'US');
    if (!phoneNumber || !phoneNumber.isValid()) {
      setMsg("❗ Invalid US phone number.");
      return;
    }
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
  const handlePhoneChange = (value) => {
    let digitsOnly = value.replace(/\D/g, "");
    let hasCountryCode = digitsOnly.startsWith("1");

    if (hasCountryCode) {
      if (digitsOnly.length > 11) digitsOnly = digitsOnly.slice(0, 11);
    } else {
      if (digitsOnly.length > 10) digitsOnly = digitsOnly.slice(0, 10);
    }

    if (digitsOnly.length === 0) {
      setForm((prev) => ({ ...prev, phone: "" }));
      return;
    }

    if ((hasCountryCode && digitsOnly.length <= 4) || (!hasCountryCode && digitsOnly.length <= 3)) {
      setForm((prev) => ({ ...prev, phone: digitsOnly }));
      return;
    }

    const formatter = new AsYouType('US');
    formatter.input(digitsOnly);
    let formatted = formatter.formattedOutput;

    if (hasCountryCode && !formatted.startsWith('+')) {
      formatted = `+${formatted}`;
    }

    setForm((prev) => ({ ...prev, phone: formatted }));
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

        <Input name="name" label="Full Name" value={form.name} onChange={handleChange} required errors={errors} />
        <Input name="email" label="Email" type="email" value={form.email} onChange={handleChange} required errors={errors} />
        <Input name="password" label="Password" type="password" value={form.password} onChange={handleChange} required errors={errors} />
        <Input name="phone" label="Phone" value={form.phone} onChange={(e) => handlePhoneChange(e.target.value)} required errors={errors} />
        <Input name="address" label="Address" value={form.address} onChange={handleChange} required errors={errors} />
        <Select
          name="gender"
          label="Gender"
          value={form.gender}
          onChange={handleChange}
          options={[
            { label: "Male", value: "Male" },
            { label: "Female", value: "Female" },
            { label: "Other", value: "Other" },
          ]} required errors={errors} />
        <Input name="birthday" label="Birthday" type="date" value={form.birthday} onChange={handleChange} required errors={errors} />
        <Textarea name="about" label="About Me" value={form.about} onChange={handleChange} required errors={errors} />
        <Input name="experience" label="Years of Experience" type="number" value={form.experience} onChange={handleChange} required errors={errors} />
        <Select
          name="specialization"
          label="Your Specialization"
          value={form.specialization}
          onChange={handleChange}
          options={[
            { label: "Nail Technician", value: "nail_tech" },
            { label: "Hair Stylist", value: "hair_stylist" },
            { label: "Barber", value: "barber" },
            { label: "Esthetician", value: "esthetician" },
            { label: "Lash Technician", value: "lash_tech" },
            { label: "Massage Therapist", value: "massage_therapist" },
            { label: "Makeup Artist", value: "makeup_artist" },
            { label: "Receptionist", value: "receptionist" },
          ]} required errors={errors}
        />

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


function Input({ name, label, required, errors, type = "text", ...props }) {
  const hasError = errors?.[name];
  const iconMap = {
    name: <User className="w-4 h-4 text-pink-400" />,
    email: <Mail className="w-4 h-4 text-pink-400" />,
    password: <Lock className="w-4 h-4 text-pink-400" />,
    phone: <Phone className="w-4 h-4 text-pink-400" />,
    birthday: <CalendarDays className="w-4 h-4 text-pink-400" />,
    address: <MapPin className="w-4 h-4 text-pink-400" />,
    experience: <Briefcase className="w-4 h-4 text-pink-400" />,
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <div className="absolute left-3 top-2.5">{iconMap[name]}</div>
        <input
          name={name}
          type={type}
          {...props}
          className={`pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 backdrop-blur-md border ${hasError ? "border-red-500" : "border-white/20"
            } text-gray-800 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 ${hasError ? "focus:ring-red-400" : "focus:ring-emerald-400"
            }`}
        />
      </div>
    </div>
  );
}


function Select({ name, label, value, onChange, options, required, errors }) {
  const hasError = errors?.[name];

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <select
          name={name}
          value={value}
          onChange={onChange}
          className={`pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 backdrop-blur-md border ${hasError ? "border-red-500" : "border-white/20"
            } text-gray-800 dark:text-white focus:outline-none focus:ring-2 ${hasError ? "focus:ring-red-400" : "focus:ring-emerald-400"
            } appearance-none`}
        >
          <option value="">Select</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute left-3 top-2.5">
          <User className="w-4 h-4 text-pink-300" />
        </div>
      </div>
    </div>
  );
}




function Textarea({ name, label, value, onChange, required, errors }) {
  const hasError = errors?.[name];

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <div className="absolute left-3 top-2.5">
          <MessageCircle className="w-4 h-4 text-pink-400" />
        </div>
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={3}
          className={`pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 backdrop-blur-md border ${hasError ? "border-red-500" : "border-white/20"
            } text-gray-800 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 ${hasError ? "focus:ring-red-400" : "focus:ring-emerald-400"
            }`}
        />
      </div>
    </div>
  );
}


