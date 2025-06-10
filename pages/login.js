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
                        if (
                            role === "salon_freelancers" ||
                            role === "salon_nhanvien" ||
                            role === "salon_all"
                        ) {
                            try {
                                const checkRes = await fetch(
                                    `https://crypto-manager-backend.onrender.com/api/freelancers/check?email=${user.email}`
                                );
                                const checkData = await checkRes.json();

                                if (checkData.exists) {
                                    if (checkData.is_verified) {
                                        router.push("/freelancers");
                                    } else {
                                        setShowVerifyWarning(true);
                                        setPendingEmail(user.email);
                                    }
                                } else {
                                    router.push("/freelancers");
                                }
                            } catch (err) {
                                router.push("/home");
                            }
                        } else if (role === "salon_chu") {
                            router.push("/salon");
                        } else if (role === "salon_customer") {
                            router.push("/customer/find-stylists");
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
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden font-mono">
            <div className="absolute inset-0 z-0 pointer-events-none"></div>
            <div className="relative z-10 px-6 py-10 max-w-[95vw] sm:max-w-[480px] w-full flex flex-col items-center">
                {showVerifyWarning ? (
                    // Chỉ hiển thị cảnh báo verify, ẩn login hoàn toàn
                    <div className="w-full">
                        {/* Block showVerifyWarning ở đây, copy code UI đẹp như trên */}
                        <div className="mt-8 w-full max-w-md w-full mx-auto text-center flex flex-col items-center gap-3 animate-fade-in">
                            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 via-yellow-300 to-emerald-400 shadow-lg mb-2">
                                {/* ...icon X đỏ... */}
                                <svg width="32" height="32" fill="none" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="11" stroke="#FBBF24" strokeWidth="2" fill="#181A20" />
                                    <path d="M9 9l6 6M15 9l-6 6" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-pink-400 to-emerald-400 drop-shadow-sm mb-1">
                                Your account is not verified yet
                            </h3>
                            <p className="text-sm text-gray-300 mb-2">
                                To use your stylist dashboard, please check your email and click the verification link we've sent.<br />
                                <span className="block mt-2 text-yellow-200 font-mono text-xs">{pendingEmail}</span>
                            </p>
                            <div className="text-xs text-gray-400 mb-1">
                                Didn&apos;t receive the verification email? Check your spam folder or&nbsp;
                                <span className="underline text-yellow-400">update your email</span> if needed.
                            </div>
                            <button
                                onClick={async () => {
                                    const res = await fetch(
                                        `https://crypto-manager-backend.onrender.com/api/freelancers/resend-verify?email=${encodeURIComponent(pendingEmail)}`,
                                        { method: "GET" }
                                    );
                                    const data = await res.json();
                                    alert(data.message || "Verification email resent!");
                                }}
                                className="w-full bg-gradient-to-r from-yellow-400 via-pink-400 to-emerald-400 text-black font-bold py-2 rounded-xl shadow-md hover:scale-105 hover:brightness-110 transition-all"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
                                        <path d="M3 10v6a2 2 0 002 2h10a2 2 0 002-2v-6" stroke="#181A20" strokeWidth="2" strokeLinecap="round" />
                                        <path d="M17 6l-7 7-7-7" stroke="#181A20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    Resend Verification Email
                                </span>
                            </button>
                        </div>
                    </div>
                ) : (
                    // Toàn bộ UI login gốc của bạn (logo, slogan, nút Google, v.v.)
                    <>
                        <div className="w-20 h-20 bg-gradient-to-br from-emerald-300 via-yellow-200 to-pink-300 rounded-full flex items-center justify-center shadow-xl mb-6">
                            {/* ...icon login... */}
                        </div>
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-emerald-400 tracking-tight drop-shadow-lg text-center">
                            Welcome to <span className="font-extrabold">OneTool.IT.COM</span>
                        </h1>
                        <p className="text-gray-200 mb-6 text-xs text-center max-w-xs">
                            Sign in to manage your freelance stylist dashboard, appointments, and more...
                        </p>
                        <button
                            onClick={handleLogin}
                            className="bg-gradient-to-r from-yellow-400 via-pink-400 to-emerald-400 hover:brightness-120 text-black font-bold text-lg py-2 px-8 rounded-3xl shadow-3xl transition-all duration-200 mb-4"
                        >
                            <span className="inline-flex items-center gap-2">
                                {/* ...icon Google... */}
                                Sign in with Google
                            </span>
                        </button>
                        {/* ...thông báo lỗi nếu có... */}
                    </>
                )}
            </div>
            {/* Footer bản quyền giữ nguyên */}
            <div className="absolute bottom-4 left-0 right-0 text-center text-xs text-gray-400 z-20">
                © {new Date().getFullYear()} OneTool Salon – All rights reserved.
            </div>
        </div>
    );

}
