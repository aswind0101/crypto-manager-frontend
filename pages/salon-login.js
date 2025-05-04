// pages/salon-login.js
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { FaLeaf } from "react-icons/fa";

export default function SalonLogin() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const [hasSubmitted, setHasSubmitted] = useState(false);


    const handleSubmit = async (e) => {
        e.preventDefault();
        setHasSubmitted(true);
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
        <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-pink-100 via-purple-200 to-pink-100 p-4 text-gray-800 font-sans">

            <div className="w-full max-w-md bg-white/80 backdrop-blur-lg rounded-3xl shadow-2xl p-8">
                <h2 className="text-3xl font-bold mb-2 text-center text-pink-600 flex items-center justify-center gap-2">
                    <FaLeaf /> Salon Login
                </h2>

                <p className="text-center text-sm text-gray-500 italic mb-4">
                    Đăng nhập để bắt đầu quản lý salon chuyên nghiệp 💅
                </p>

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-pink-400 focus:border-pink-400 focus:outline-none transition-all"
                            placeholder="Nhập email..."
                            required
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
                            required
                        />
                    </div>
                    {hasSubmitted && error && (
                        <p className="text-red-500 text-sm text-center">{error}</p>
                    )}

                    <button
                        type="submit"
                        required
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
