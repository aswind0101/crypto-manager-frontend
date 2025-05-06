// 📁 pages/login.js
import { useEffect, useRef } from "react";
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

export default function Login() {
    const router = useRouter();
    const auth = getAuth(app);
    const loginClicked = useRef(false);

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
                    const res = await fetch("https://crypto-manager-backend.onrender.com/api/user-alerts/init", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            user_id: user.uid,
                            email: user.email
                        })
                    });

                    const result = await res.json();
                    console.log("✅ Session init /user-alerts/init:", result);
                } catch (err) {
                    console.error("❌ Error calling /api/user-alerts/init (session):", err);
                }
                try {
                    // 2️⃣ Gọi API lấy role
                    const idToken = await user.getIdToken();
                    const resRole = await fetch("https://crypto-manager-backend.onrender.com/api/user-role", {
                        headers: {
                            Authorization: `Bearer ${idToken}`
                        }
                    });
                    if (resRole.ok) {
                        const data = await resRole.json();
                        console.log("✅ User role:", data);
                        // Lưu role vào localStorage (cùng object user)
                        const updatedUserData = { ...userData, role: data.role };
                        localStorage.setItem("user", JSON.stringify(updatedUserData));
                    } else {
                        console.warn("⚠️ Failed to fetch user role");
                    }
                } catch (err) {
                    console.error("❌ Error calling /api/user-role:", err);
                }
                // ✅ Đợi chắc chắn đã login ➔ chuyển trang
                router.push("/home");
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
            </div>
        </div>
    );
}
