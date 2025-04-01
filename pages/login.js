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
    const loginClicked = useRef(false); // ✅ Đánh dấu trạng thái click login

    const handleLogin = async () => {
        loginClicked.current = true; // ✅ User đã click login

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" }); // ✅ Bắt buộc hiện chọn tài khoản

        try {
            await setPersistence(auth, browserLocalPersistence); // ✅ Đảm bảo session được lưu
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            localStorage.setItem("user", JSON.stringify({
                uid: user.uid,
                name: user.displayName,
                email: user.email,
                photo: user.photoURL
            }));

            router.push("/home");
        } catch (error) {
            console.error("Login failed:", error);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && !loginClicked.current) {
                localStorage.setItem("user", JSON.stringify({
                    uid: user.uid,
                    name: user.displayName,
                    email: user.email,
                    photo: user.photoURL
                }));
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
