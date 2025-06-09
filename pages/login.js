// 📁 pages/login.js
import { useEffect, useRef, useState } from "react";
import {
    getAuth,
    signInWithPopup,
    signInWithRedirect,
    setPersistence,
    browserLocalPersistence,
    GoogleAuthProvider,
    onAuthStateChanged
} from "firebase/auth";
import { useRouter } from "next/router";
import { app } from "../firebase";
import ResendVerifyEmail from "../components/ResendVerifyEmail";

export default function Login() {
    const router = useRouter();
    const auth = getAuth(app);
    const loginClicked = useRef(false);
    const [showVerifyWarning, setShowVerifyWarning] = useState(false);
    const [pendingEmail, setPendingEmail] = useState("");
    const [loginError, setLoginError] = useState("");

    const handleLogin = async () => {
        loginClicked.current = true;
        setLoginError(""); // Nếu bạn vẫn dùng state này
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        try {
            await setPersistence(auth, browserLocalPersistence);
            if (window.matchMedia('(display-mode: standalone)').matches) {
                await signInWithRedirect(auth, provider);
            } else {
                await signInWithPopup(auth, provider);
            }
        } catch (error) {
            if (
                error.code === "auth/cancelled-popup-request" ||
                error.code === "auth/popup-closed-by-user"
            ) {
                // Không làm gì cả! (Không hiển thị lỗi)
                return;
            }
            // Các lỗi khác (tuỳ bạn), ví dụ:
            setLoginError("Login failed. Please try again.");
            if (process.env.NODE_ENV === "development") {
                console.warn("Login error:", error);
            }
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const userData = {
                    uid: user.uid,
                    name: user.displayName,
                    email: user.email,
                    photo: user.photoURL
                };
                localStorage.setItem("user", JSON.stringify(userData));

                try {
                    const idToken = await user.getIdToken();
                    const fromBooking = localStorage.getItem("from_booking") === "true";
                    if (fromBooking) {
                        try {
                            await fetch("https://crypto-manager-backend.onrender.com/api/register-customer", {
                                method: "POST",
                                headers: { Authorization: `Bearer ${idToken}` }
                            });
                        } catch (err) { }
                        localStorage.removeItem("from_booking");
                    }
                    const resRole = await fetch("https://crypto-manager-backend.onrender.com/api/user-role", {
                        headers: { Authorization: `Bearer ${idToken}` }
                    });
                    if (resRole.ok) {
                        const data = await resRole.json();
                        const role = (data.role || "").toLowerCase();
                        const updatedUserData = { ...userData, role: data.role };
                        localStorage.setItem("user", JSON.stringify(updatedUserData));
                        if (role === "salon_freelancers") {
                            try {
                                const checkRes = await fetch(`https://crypto-manager-backend.onrender.com/api/freelancers/check?email=${user.email}`);
                                const checkData = await checkRes.json();
                                if (checkData.exists && checkData.is_verified) {
                                    router.push("/freelancers");
                                } else {
                                    setShowVerifyWarning(true);
                                    setPendingEmail(user.email);
                                }
                            } catch (err) {
                                router.push("/home");
                            }
                        } else if (role === "salon_chu") {
                            router.push("/salon");
                        } else if (role === "salon_customer") {
                            router.push("/customer/find-stylists");
                        } else if (role === "salon_all" || role === "salon_nhanvien") {
                            router.push("/freelancers");
                        } else {
                            router.push("/home");
                        }
                    } else {
                        router.push("/home");
                    }
                } catch (err) {
                    router.push("/home");
                }
            }
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden font-mono sm:font-['Pacifico', cursive]">
            {/* Hiệu ứng glass + particle */}
            <div className="absolute inset-0 z-0 pointer-events-none"></div>
            {/* Card Login */}
            <div className="relative z-10 bg-white/5 backdrop-blur-2xl border-t-8 border-white/10 rounded-3xl px-6 py-10 max-w-[95vw] sm:max-w-[480px] w-full flex flex-col items-center">
                <div className="w-20 h-20 bg-gradient-to-br from-emerald-300 via-yellow-200 to-pink-300 rounded-full flex items-center justify-center shadow-xl mb-6">
                    <svg viewBox="0 0 48 48" width="40" height="40" fill="none">
                        <circle cx="24" cy="24" r="22" stroke="#a7f3d0" strokeWidth="3" fill="#fff0" />
                        <path d="M13 33c0-6 8-8 11-8s11 2 11 8" stroke="#fbbf24" strokeWidth="2" />
                        <circle cx="24" cy="18" r="7" fill="#a7f3d0" stroke="#fbbf24" strokeWidth="2" />
                    </svg>
                </div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-emerald-400 tracking-tight drop-shadow-lg text-center">
                    Welcome to <span className="font-extrabold">OneTool.IT.COM</span>
                </h1>
                <p className="text-gray-200 mb-6 text-xs text-center max-w-xs">
                    Sign in to manage your freelance stylist dashboard, appointments, and more...
                </p>
                <button
                    onClick={handleLogin}
                    className="bg-gradient-to-r from-yellow-400 via-pink-400 to-emerald-400 hover:brightness-120 text-black font-bold text-lg py-2 px-8 rounded-3xl shadow-xl transition-all duration-200 mb-4"
                >
                    <span className="inline-flex items-center gap-2">
                        <svg width="24" height="24" viewBox="0 0 256 262" xmlns="http://www.w3.org/2000/svg"><g fill="none"><path d="M255.9 133.5c0-11.2-1-22-2.8-32.4H130.6v61.4h70.4c-3 16.2-12 29.8-25.4 39v32h41c24.2-22.4 38.3-55.4 38.3-100z" fill="#4285F4" /><path d="M130.6 262c34.6 0 63.6-11.4 84.8-31.1l-41-32c-11.4 7.6-25.8 12-43.8 12-33.6 0-62-22.7-72.1-53.2h-42.3v33.2C37.2 230.4 81.4 262 130.6 262z" fill="#34A853" /><path d="M58.5 157.7C56 151.1 54.5 144 54.5 136.5c0-7.4 1.5-14.6 4-21.2v-33.2h-42.3c-8.5 17-13.3 36-13.3 56.2s4.8 39.2 13.3 56.2l42.3-33.2z" fill="#FBBC05" /><path d="M130.6 51.8c19.2 0 36.4 6.6 49.9 19.7l37.2-37.2C194.2 13 165.2 0 130.6 0 81.4 0 37.2 31.6 16.2 77.8l42.3 33.2c10-30.5 38.4-53.2 72.1-53.2z" fill="#EA4335" /></g></svg>
                        Sign in with Google
                    </span>
                </button>
                {/* Thông báo lỗi đăng nhập, đặt ngay dưới nút */}
                {loginError && (
                    <div className="mb-2 text-center bg-red-100 border border-red-300 text-red-700 font-semibold px-4 py-2 rounded-xl animate-fade-in">
                        {loginError}
                    </div>
                )}
                {showVerifyWarning && (
                    <div className="mt-6 text-center bg-yellow-300/30 border border-yellow-400 text-yellow-900 font-semibold px-4 py-2 rounded-xl">
                        <p className="mb-2">❌ Your account is not verified yet.</p>
                        <ResendVerifyEmail email={pendingEmail} />
                    </div>
                )}
            </div>
            {/* Footer bản quyền */}
            <div className="absolute bottom-4 left-0 right-0 text-center text-xs text-gray-400 z-20">
                © {new Date().getFullYear()} OneTool Salon – All rights reserved.
            </div>
        </div>
    );
}
