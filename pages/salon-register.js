import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import axios from 'axios';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { FaLeaf } from 'react-icons/fa';

export default function SalonRegister() {
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
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
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const token = await userCredential.user.getIdToken();
            await axios.post(
                '/api/salon-register',
                {
                    firebase_uid: userCredential.user.uid,
                    full_name: fullName,
                    email,
                    phone,
                    role: 'staff',
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            router.push('/salon-dashboard');
        } catch (err) {
            console.error(err);
            setError('Đăng ký thất bại. Vui lòng thử lại.');
        }
        setLoading(false);
    };

    return (
        <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-pink-100 via-purple-200 to-pink-100 p-4 text-gray-800 font-sans">
            <form
                onSubmit={handleSubmit}
                className="bg-white/80 backdrop-blur-2xl border border-white/30 p-8 rounded-3xl shadow-2xl hover:shadow-xl shadow-pink-200/50 transition-all w-full max-w-sm"
            >
                <h2 className="text-3xl font-bold mb-2 text-center text-pink-600 flex items-center justify-center gap-2">
                    <FaLeaf /> Salon Register
                </h2>
                <p className="text-center text-sm text-gray-500 italic mb-4">
                    Đăng ký để quản lý salon chuyên nghiệp 💅
                </p>

                {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}

                <div className="flex flex-col gap-4">
                    <div>
                        <label className="block text-sm mb-1">Họ tên</label>
                        <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-400 placeholder-gray-400"
                            placeholder="Nhập họ tên..."
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Số điện thoại</label>
                        <input
                            type="text"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-400 placeholder-gray-400"
                            placeholder="Nhập số điện thoại..."
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-400 placeholder-gray-400"
                            placeholder="Nhập email..."
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-400 placeholder-gray-400"
                            placeholder="Nhập mật khẩu..."
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold w-full py-3 rounded-xl shadow transition-all duration-300 disabled:opacity-50"
                    >
                        {loading ? 'Đang đăng ký...' : 'Đăng ký'}
                    </button>
                </div>

                <p className="text-center text-sm text-gray-500 mt-4">
                    Đã có tài khoản?{' '}
                    <Link href="/salon-login" className="text-pink-500 hover:underline">
                        Đăng nhập
                    </Link>
                </p>
            </form>
        </div>
    );
}
