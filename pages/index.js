import { useEffect } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { app } from "../firebase";

export default function IndexPage() {
    const router = useRouter();
    const auth = getAuth(app);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                router.push("/home"); // Nếu đã đăng nhập, chuyển về trang home
            } else {
                router.push("/login"); // Nếu chưa, chuyển đến login
            }
        });

        return () => unsubscribe();
    }, []);

    return (
        <div className="flex items-center justify-center h-screen bg-black text-white">
            <p className="text-lg font-medium text-gray-400">Loading...</p>
        </div>
    );
}
