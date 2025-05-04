// pages/salon-login.js
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function SalonLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      localStorage.setItem('salon_token', token);
      router.push('/salon-dashboard');
    } catch (err) {
      console.error(err);
      setError('Sai email hoặc mật khẩu.');
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-pink-100 to-purple-200 p-4">
      <div className="w-full max-w-md bg-white/90 backdrop-blur-lg rounded-2xl shadow-lg p-8">
        <h2 className="text-3xl font-bold text-center text-purple-700 mb-6">Đăng nhập Salon</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-pink-400 focus:border-pink-400 focus:outline-none transition-all"
              placeholder="Nhập email..."
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-pink-400 focus:border-pink-400 focus:outline-none transition-all"
              placeholder="Nhập mật khẩu..."
            />
          </div>
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold rounded-xl hover:from-pink-600 hover:to-purple-600 transition-all shadow-lg disabled:opacity-50"
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-700">
          Chưa có tài khoản?{' '}
          <Link href="/salon-register" className="text-purple-500 hover:underline">
            Đăng ký
          </Link>
        </p>
      </div>
    </div>
  );
}
