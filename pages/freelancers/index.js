// pages/freelancers/index.js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";

export default function FreelancerDashboard() {
    const [user, setUser] = useState(null);
    const router = useRouter();

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
                setUser({ ...storedUser, ...currentUser });
            } else {
                router.push("/login");
            }
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-8 text-gray-800 dark:text-gray-100">
            <Navbar />

            <div className="max-w-3xl mx-auto bg-white dark:bg-gray-900 bg-opacity-90 dark:bg-opacity-90 rounded-3xl shadow-xl p-8">
                <h1 className="text-3xl font-extrabold text-center text-emerald-600 dark:text-emerald-300 mb-6">
                    🌟 Welcome, Freelancer!
                </h1>

                {user ? (
                    <div className="text-center space-y-4 text-sm">
                        <p>Hello <span className="font-bold">{user.name}</span>!</p>
                        <p>Email: <span className="font-mono">{user.email}</span></p>
                        <p className="text-yellow-400">Role: {user.role}</p>
                        <p className="italic text-gray-500 dark:text-gray-400">
                            This is the Freelancer Dashboard. You can customize this page with onboarding steps, online toggle, profile status, and bookings.
                        </p>
                    </div>
                ) : (
                    <p className="text-center text-yellow-500">⏳ Loading user...</p>
                )}
            </div>
        </div>
    );
}
