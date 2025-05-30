// 📁 pages/login.js
import { useEffect, useRef, useState } from "react";
import {
    getAuth,
    signInWithPopup,
    signInWithRedirect,
    setPersistence,
    browserLocalPersistence,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut
} from "firebase/auth";
import { useRouter } from "next/router";
import { app } from "../firebase";
import ResendVerifyEmail from "../components/ResendVerifyEmail"; // nhớ tạo component như hướng dẫn trên


export default function Login() {
    const router = useRouter();
    const auth = getAuth(app);
    const loginClicked = useRef(false);
    const [showVerifyWarning, setShowVerifyWarning] = useState(false);
    const [pendingEmail, setPendingEmail] = useState("");
    const handleLogin = async () => {
        loginClicked.current = true;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        try {
            await setPersistence(auth, browserLocalPersistence);

            if (window.matchMedia('(display-mode: standalone)').matches) {
                // 📱 Nếu là PWA ➔ dùng redirect
                await signInWithRedirect(auth, provider);
            } else {
                // 🖥️ Nếu web thường ➔ dùng popup
                await signInWithPopup(auth, provider);
            }
        } catch (error) {
            console.error("Login failed:", error);
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

                    // ✅ 1️⃣ Nếu đến từ Book Appointment ➝ đăng ký customer trước
                    const fromBooking = localStorage.getItem("from_booking") === "true";
                    if (fromBooking) {
                        try {
                            await fetch("https://crypto-manager-backend.onrender.com/api/register-customer", {
                                method: "POST",
                                headers: {
                                    Authorization: `Bearer ${idToken}`,
                                },
                            });
                            console.log("✅ Registered Salon_Customer");
                        } catch (err) {
                            console.error("❌ Failed to register Salon_Customer:", err.message);
                        }
                        localStorage.removeItem("from_booking"); // 🔁 Chỉ gọi một lần
                    }

                    // ✅ 2️⃣ Gọi API lấy role sau khi đảm bảo đã đăng ký đúng
                    const resRole = await fetch("https://crypto-manager-backend.onrender.com/api/user-role", {
                        headers: {
                            Authorization: `Bearer ${idToken}`
                        }
                    });

                    if (resRole.ok) {
                        const data = await resRole.json();
                        const role = (data.role || "").toLowerCase();

                        const updatedUserData = { ...userData, role: data.role };
                        localStorage.setItem("user", JSON.stringify(updatedUserData));

                        // ✅ 3️⃣ Chuyển hướng theo role
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
                                console.error("❌ Error verifying freelancer:", err);
                                router.push("/home");
                            }
                        } else if (role === "salon_chu") {
                            router.push("/salon");
                        } else if (role === "salon_customer") {
                            router.push("/customer/find-stylists");
                        } else if (role === "salon_all") {
                            router.push("/freelancers");
                        }else if (role === "salon_nhanvien") {
                            router.push("/freelancers");
                        } else {
                            router.push("/home");
                        }
                    } else {
                        console.warn("⚠️ Failed to fetch user role");
                        router.push("/home");
                    }
                } catch (err) {
                    console.error("❌ Error during login process:", err);
                    router.push("/home");
                }
            }
        });

        return () => unsubscribe();
    }, []);

    return (
        <div className="flex items-center justify-center h-screen bg-black text-white">
            <div className="bg-[#0e1628] p-8 rounded-lg shadow-lg text-center w-full max-w-md">
                <h1 className="text-3xl font-bold mb-6 text-yellow-400">Crypto Manager</h1>
                <button
                    onClick={handleLogin}
                    className="bg-yellow-400 text-black font-bold py-2 px-6 rounded hover:bg-yellow-500 transition"
                >
                    Sign in with Google
                </button>
                {showVerifyWarning && (
                    <div className="mt-6 text-center">
                        <p className="text-red-500 font-semibold">
                            ❌ Your account is not verified yet.
                        </p>
                        <ResendVerifyEmail email={pendingEmail} />
                    </div>
                )}
            </div>
        </div>
    );
}
