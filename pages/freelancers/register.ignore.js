import { useState } from "react";
import { useRouter } from "next/router";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { Phone, Mail, User, CalendarDays, MapPin, MessageCircle, Briefcase } from "lucide-react";
import { FaLeaf } from "react-icons/fa";
import AddressAutocomplete from "../../components/AddressAutocomplete";
import { getAuth, signOut, getApps } from "firebase/auth";

import { getAuth, signOut } from "firebase/auth";
import { getApps } from "firebase/app";

export default function FreelancerRegister() {
  const router = useRouter();
  const [workingAtSalon, setWorkingAtSalon] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState({});
  const [showVerifySent, setShowVerifySent] = useState(false);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    emailConfirm: "",
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
    specialization: [],
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    const requiredFields = [
      "name", "email", "emailConfirm", "phone", "address",
      "gender", "birthday", "about", "experience", "specialization"
    ];

    const newErrors = {};
    for (let field of requiredFields) {
      if (field === "specialization") {
        if (!Array.isArray(form.specialization) || form.specialization.length === 0) {
          newErrors[field] = true;
        }
      } else {
        if (!form[field]) {
          newErrors[field] = true;
        }
      }
    }

    // Validate email khớp
    if (form.email !== form.emailConfirm) {
      newErrors.emailConfirm = true;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setMsg(newErrors.emailConfirm
        ? "❌ Emails do not match. Please re-enter your email address."
        : "❌ Please fill in all required fields."
      );
      setLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setErrors({});
    const phoneNumber = parsePhoneNumberFromString(form.phone, 'US');
    if (!phoneNumber || !phoneNumber.isValid()) {
      setMsg("❗ Invalid US phone number.");
      setLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Xoá trường emailConfirm khỏi payload gửi lên backend
    const payload = { ...form };
    delete payload.emailConfirm;

    try {
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setShowVerifySent(true);
        setMsg(data.message || "Freelancer registered. Please check your email to verify.");
        try {
          if (getApps().length > 0) {
            const auth = getAuth();
            await signOut(auth).catch(() => { });
          }
        } catch (e) {}
        localStorage.removeItem("user");
      } else {
        setMsg(data.error || "❌ Đăng ký thất bại");
      }
      setLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setMsg("❌ Đã xảy ra lỗi kết nối server.");
      setLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleResend = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `https://crypto-manager-backend.onrender.com/api/freelancers/resend-verify?email=${encodeURIComponent(form.email)}`
      );
      const data = await res.json();
      setMsg(data.message || "Verification email resent!");
    } catch (err) {
      setMsg("❌ Could not resend verification email.");
    }
    setLoading(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      {showVerifySent ? (
        <div className="bg-[#22232a] border border-yellow-400 rounded-2xl p-8 mt-6 max-w-md w-full text-gray-100 shadow-2xl flex flex-col items-center animate-fade-in">
          <span className="text-5xl mb-4">✉️</span>
          <h2 className="text-2xl font-bold text-yellow-300 mb-3">Almost there!</h2>
          <p className="mb-4 text-center text-base text-gray-300">
            Your account has been created.<br />
            Please check your email and verify your account to activate.<br />
            <span className="block mt-2 text-yellow-200 text-sm">{form.email}</span>
          </p>
          <button
            onClick={handleResend}
            disabled={loading}
            className="bg-yellow-400 text-black w-full px-6 py-2 rounded-lg font-semibold hover:bg-yellow-300 transition text-lg shadow"
          >
            {loading ? "Sending..." : "Resend verification email"}
          </button>
          {msg && <div className="mt-2 text-green-500 text-sm">{msg}</div>}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8 w-full max-w-lg space-y-8"
        >
          <div className="flex items-center justify-center gap-2 mb-4">
            <FaLeaf className="w-12 h-12 text-pink-400" />
            <h1 className="text-3xl font-extrabold text-emerald-700 dark:text-emerald-300">
              Join as a Freelancer
            </h1>
          </div>
          {msg && (
            <p className={`text-center ${msg.startsWith("❌") ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>{msg}</p>
          )}
          <Input name="name" label="Full Name" value={form.name} onChange={handleChange} required errors={errors} />
          <Input name="email" label="Email" type="email" value={form.email} onChange={handleChange} required errors={errors} />
          <Input name="emailConfirm" label="Re-enter Email" type="email" value={form.emailConfirm} onChange={handleChange} required errors={errors} />
          <Input name="phone" label="Phone" value={form.phone} onChange={(e) => handlePhoneChange(e.target.value)} required errors={errors} />
          <div>
            <AddressAutocomplete
              value={form.address}
              onChange={handleChange}
              placeholder="Enter your address..."
            />
          </div>
          <Select
            name="gender"
            label="Gender"
            value={form.gender}
            onChange={handleChange}
            options={[
              { label: "Male", value: "Male" },
              { label: "Female", value: "Female" },
              { label: "Other", value: "Other" },
            ]}
            required
            errors={errors}
          />
          <Input name="birthday" label="Birthday" type="date" value={form.birthday} onChange={handleChange} required errors={errors} />
          <Textarea name="about" label="Briefly introduce yourself to clients. . ." value={form.about} onChange={handleChange} required errors={errors} />
          <Input name="experience" label="Years of Experience" type="number" value={form.experience} onChange={handleChange} required errors={errors} />
          <div className="space-y-2">
            <label className="text-sm font-semibold text-pink-400">Your Specializations</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Nail Technician", value: "nail_tech" },
                { label: "Hair Stylist", value: "hair_stylist" },
                { label: "Barber", value: "barber" },
                { label: "Esthetician", value: "esthetician" },
                { label: "Lash Technician", value: "lash_tech" },
                { label: "Massage Therapist", value: "massage_therapist" },
                { label: "Makeup Artist", value: "makeup_artist" },
                { label: "Receptionist", value: "receptionist" },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={opt.value}
                    checked={form.specialization.includes(opt.value)}
                    onChange={(e) => {
                      const selected = form.specialization.includes(opt.value)
                        ? form.specialization.filter((v) => v !== opt.value)
                        : [...form.specialization, opt.value];
                      setForm((prev) => ({ ...prev, specialization: selected }));
                    }}
                    className="accent-pink-500 w-4 h-4 rounded"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {workingAtSalon && (
            <div className="space-y-2">
              <Input name="temp_salon_name" label="Tên Salon" value={form.temp_salon_name} onChange={handleChange} />
              <Input name="temp_salon_address" label="Địa chỉ Salon" value={form.temp_salon_address} onChange={handleChange} />
              <Input name="temp_salon_phone" label="Số điện thoại Salon" value={form.temp_salon_phone} onChange={handleChange} />
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className={`w-full bg-gradient-to-r from-emerald-500 via-amber-400 to-pink-400 dark:from-emerald-600 dark:via-amber-500 dark:to-pink-500 text-white py-2 rounded-full font-semibold shadow-lg hover:shadow-xl hover:brightness-105 transition transform hover:scale-105 ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {loading ? "Registering..." : "🌟 Register Now 🚀"}
          </button>
        </form>
      )}
    </div>
  );
}

export function Input({ name, label, required, errors, type = "text", ...props }) {
  const hasError = errors?.[name];
  const iconMap = {
    name: <User className="w-4 h-4 text-pink-300" />,
    email: <Mail className="w-4 h-4 text-pink-300" />,
    emailConfirm: <Mail className="w-4 h-4 text-pink-300" />,
    phone: <Phone className="w-4 h-4 text-pink-300" />,
    birthday: <CalendarDays className="w-4 h-4 text-pink-300" />,
    address: <MapPin className="w-4 h-4 text-pink-300" />,
    experience: <Briefcase className="w-4 h-4 text-pink-300" />,
  };
  const value = props.value ?? "";

  return (
    <div>
      <div className="relative">
        <div className="absolute left-3 top-2.5">{iconMap[name]}</div>
        <input
          name={name}
          type={type}
          placeholder={type === "date" ? "" : label}
          {...props}
          className={`pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 border 
    ${hasError ? "border-red-500" : "border-white/20"} 
    ${value === "" ? "text-pink-300" : "text-pink-300"} 
    focus:outline-none focus:ring-2 ${hasError ? "focus:ring-red-300" : "focus:ring-pink-300"} 
    appearance-none`}
        />
      </div>
    </div>
  );
}

export function Select({ name, label, value, onChange, options, required, errors }) {
  const hasError = errors?.[name];
  return (
    <div>
      <div className="relative">
        <select
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          className={`pl-10 pr-4 py-2 w-full rounded-xl bg-white/40 dark:bg-white/10 border 
    ${hasError ? "border-red-500" : "border-white/20"} 
    ${value === "" ? "text-pink-300" : "text-pink-300"} 
    focus:outline-none focus:ring-2 ${hasError ? "focus:ring-red-300" : "focus:ring-pink-300"
            } appearance-none`}
        >
          <option value="" disabled hidden className="text-gray-400">-- {label} --</option>
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

export function Textarea({ name, label, value, onChange, required, errors }) {
  const hasError = errors?.[name];
  return (
    <div>
      <div className="relative">
        <div className="absolute left-3 top-2.5">
          <MessageCircle className="w-4 h-4 text-pink-300" />
        </div>
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={3}
          placeholder={label}
          className={`pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 border 
    ${hasError ? "border-red-500" : "border-white/20"} 
    ${value === "" ? "text-pink-300" : "text-pink-300"} 
    focus:outline-none focus:ring-2 ${hasError ? "focus:ring-red-300" : "focus:ring-pink-300"
            }`}
        />
      </div>
    </div>
  );
}
