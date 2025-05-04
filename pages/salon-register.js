import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "../firebase";
import { useRouter } from "next/router";
import axios from "axios";
import { FaUserPlus } from "react-icons/fa";

export default function SalonRegister() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: fullName });

      const token = await userCredential.user.getIdToken();
      localStorage.setItem("salon_token", token);

      await axios.post(
        "/api/salon-register",
        {
          firebase_uid: userCredential.user.uid,
          full_name: fullName,
          email,
          phone,
          role,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      router.push("/salon-dashboard");
    } catch (err) {
      console.error(err);
      setError("Có lỗi xảy ra, vui lòng thử lại");
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-pink-50 to-purple-100 p-4 text-gray-400 font-mono">
      <form
        onSubmit={handleRegister}
        className="bg-white/80 backdrop-blur-md p-8 rounded-2xl shadow-xl w-full max-w-sm"
      >
        <h2 className="text-3xl font-bold mb-6 text-center text-purple-600 flex items-center justify-center gap-2">
          <FaUserPlus /> Salon Register
        </h2>

        {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}

        <div className="mb-4">
          <label className="block mb-1 text-sm font-medium text-purple-600">Họ tên</label>
          <input
            type="text"
            placeholder="Nhập họ tên"
            className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-400 bg-white/90"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div className="mb-4">
          <label className="block mb-1 text-sm font-medium text-purple-600">Số điện thoại</label>
          <input
            type="tel"
            placeholder="Nhập số điện thoại"
            className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-400 bg-white/90"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>

        <div className="mb-4">
          <label className="block mb-1 text-sm font-medium text-purple-600">Vai trò</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-xl bg-white/90 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-400"
          >
            <option value="customer">Khách hàng</option>
            <option value="staff">Nhân viên</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="block mb-1 text-sm font-medium text-purple-600">Email</label>
          <input
            type="email"
            placeholder="Nhập email"
            className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-400 bg-white/90"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="mb-6">
          <label className="block mb-1 text-sm font-medium text-purple-600">Mật khẩu</label>
          <input
            type="password"
            placeholder="Nhập mật khẩu"
            className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-400 bg-white/90"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="bg-purple-500 hover:bg-purple-600 text-white font-semibold w-full py-3 rounded-xl shadow transition-all duration-300">
          Đăng ký
        </button>

        <p className="mt-4 text-center text-sm">
          Đã có tài khoản?{" "}
          <a href="/salon-login" className="text-purple-500 hover:underline">
            Đăng nhập
          </a>
        </p>
      </form>
    </div>
  );
}
