import { useEffect, useRef } from "react";
import {
    getAuth,
    signInWithPopup,
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
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // ✅ Lưu thông tin vào localStorage
            const userData = {
                uid: user.uid,
                name: user.displayName,
                email: user.email,
                photo: user.photoURL
            };
            localStorage.setItem("user", JSON.stringify(userData));

            // ✅ Gửi dữ liệu khởi tạo vào backend
            await fetch("https://crypto-manager-backend.onrender.com/api/user-alerts/init", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_id: user.uid,
                    email: user.email
                })
            });

            router.push("/home");
        } catch (error) {
            console.error("Login failed:", error);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user && !loginClicked.current) {
                const userData = {
                    uid: user.uid,
                    name: user.displayName,
                    email: user.email,
                    photo: user.photoURL
                };
                localStorage.setItem("user", JSON.stringify(userData));

                // ✅ Gửi API nếu login bằng session
                await fetch("https://crypto-manager-backend.onrender.com/api/user-alerts/init", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        user_id: user.uid,
                        email: user.email
                    })
                });

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
