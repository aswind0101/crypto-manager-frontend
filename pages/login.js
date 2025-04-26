import { useEffect, useRef, useState } from "react";
import {
    getAuth,
    signInWithPopup,
    setPersistence,
    browserLocalPersistence,
    GoogleAuthProvider,
    onAuthStateChanged,
    getRedirectResult,
    signInWithRedirect
} from "firebase/auth";
import { useRouter } from "next/router";
import { app } from "../firebase";

export default function Login() {
    const router = useRouter();
    const auth = getAuth(app);
    const loginClicked = useRef(false);
    const [waitingRedirect, setWaitingRedirect] = useState(false);
    const [checkingLogin, setCheckingLogin] = useState(true);

    const handleLogin = async () => {
        loginClicked.current = true;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        try {
            await setPersistence(auth, browserLocalPersistence);

            const isStandalone =
                window.matchMedia("(display-mode: standalone)").matches ||
                window.navigator.standalone === true;

            if (isStandalone) {
                // 👉 Dùng redirect cho PWA
                await signInWithRedirect(auth, provider);
            } else {
                const result = await signInWithPopup(auth, provider);
                if (result.user) {
                    await saveUserAndRedirect(result.user);
                }
            }
        } catch (error) {
            console.error("Login failed:", error);
        }
    };

    const handleContinueLogin = async () => {
        try {
            const result = await getRedirectResult(auth);
            if (result?.user) {
                await saveUserAndRedirect(result.user);
            } else {
                setCheckingLogin(false); // Không có user
            }
        } catch (err) {
            console.error("❌ getRedirectResult error:", err);
            setCheckingLogin(false);
        }
    };

    const saveUserAndRedirect = async (user) => {
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
            console.log("✅ Init user-alerts:", result);
        } catch (err) {
            console.error("❌ Error calling /user-alerts/init:", err);
        }

        router.push("/home");
    };

    useEffect(() => {
        const isStandalone =
            typeof window !== "undefined" &&
            (window.matchMedia("(display-mode: standalone)").matches ||
                window.navigator.standalone === true);

        if (isStandalone) {
            // 🟡 PWA: Chờ user bấm nút để xử lý redirect
            setWaitingRedirect(true);
            setCheckingLogin(false);
        } else {
            // ✅ Trường hợp web: vẫn bắt session bình thường
            const unsubscribe = onAuthStateChanged(auth, async (user) => {
                if (user && !loginClicked.current) {
                    await saveUserAndRedirect(user);
                } else {
                    setCheckingLogin(false);
                }
            });

            return () => unsubscribe();
        }
    }, []);

    return (
        <div className="flex items-center justify-center h-screen bg-black text-white">
            <div className="bg-[#0e1628] p-8 rounded-lg shadow-lg text-center w-full max-w-md">
                <h1 className="text-3xl font-bold mb-6 text-yellow-400">Crypto Manager</h1>

                {checkingLogin ? (
                    <p className="text-yellow-300 text-sm">⏳ Checking login...</p>
                ) : waitingRedirect ? (
                    <button
                        onClick={handleContinueLogin}
                        className="bg-yellow-400 text-black font-bold py-2 px-6 rounded hover:bg-yellow-500 transition"
                    >
                        👉 Tap to continue login
                    </button>
                ) : (
                    <button
                        onClick={handleLogin}
                        className="bg-yellow-400 text-black font-bold py-2 px-6 rounded hover:bg-yellow-500 transition"
                    >
                        Sign in with Google
                    </button>
                )}
            </div>
        </div>
    );
}
