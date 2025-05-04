import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { useRouter } from "next/router";
import { FaSignInAlt } from "react-icons/fa";

export default function SalonLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      localStorage.setItem("salon_token", token);
      router.push("/salon-dashboard");
    } catch (err) {
      console.error(err);
      setError("Sai email hoặc mật khẩu");
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-pink-50 to-purple-100 p-4 font-mono">
      <form
        onSubmit={handleLogin}
        className="bg-white/80 backdrop-blur-md p-8 rounded-2xl shadow-xl w-full max-w-sm"
      >
        <h2 className="text-3xl font-bold mb-6 text-center text-purple-600 flex items-center justify-center gap-2">
          <FaSignInAlt /> Salon Login
        </h2>

        {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}

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
          Đăng nhập
        </button>

        <p className="mt-4 text-center text-sm">
          Chưa có tài khoản?{" "}
          <a href="/salon-register" className="text-purple-500 hover:underline">
            Đăng ký
          </a>
        </p>
      </form>
    </div>
  );
}
