import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";

export default function FreelancerDashboard() {
    const [user, setUser] = useState(null);
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [steps, setSteps] = useState({
        has_avatar: false,
        has_license: false,
        has_id: false,
        has_salon: false,
        has_payment: false,
    });

    const router = useRouter();
    const auth = getAuth();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
                setUser({ ...storedUser, ...currentUser });
                // ❗(Tùy chọn): gọi API để load avatar đã có và cập nhật steps
            } else {
                router.push("/login");
            }
        });
        return () => unsubscribe();
    }, []);

    const uploadAvatar = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const token = await auth.currentUser.getIdToken();
        const formData = new FormData();
        formData.append("avatar", file);

        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/upload/avatar", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            const data = await res.json();
            if (res.ok) {
                alert("✅ Avatar uploaded!");
                setSteps((prev) => ({ ...prev, has_avatar: true }));
                setAvatarUrl(data.avatar_url); // Ví dụ: "/uploads/avatars/abc.jpg"
            } else {
                alert("❌ Upload failed: " + data.error);
            }
        } catch (err) {
            console.error("Upload error:", err.message);
            alert("❌ Upload failed.");
        }
    };


    const onboardingSteps = [
        {
            key: "has_avatar",
            title: "Upload your Avatar",
            description: "Add a professional photo to build trust.",
            button: "Upload Avatar",
            renderAction: () => (
                <input
                    type="file"
                    accept="image/*"
                    onChange={uploadAvatar}
                    className="text-sm file:mr-4 file:py-1.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold
                   file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 transition cursor-pointer"
                />
            ),
        },
        {
            key: "has_license",
            title: "Upload License",
            description: "Attach your Nail/Hair license (PDF or Image).",
            button: "Upload License",
        },
        {
            key: "has_id",
            title: "Upload ID",
            description: "Add Passport or Government-issued ID.",
            button: "Upload ID",
        },
        {
            key: "has_salon",
            title: "Select Your Salon",
            description: "Choose where you're currently working.",
            button: "Select Salon",
        },
        {
            key: "has_payment",
            title: "Add Payment Method",
            description: "Connect Stripe, PayPal or enter bank info.",
            button: "Add Payment",
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-8 text-gray-800 dark:text-gray-100">
            <Navbar />

            <div className="max-w-3xl mx-auto bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8">
                <h1 className="text-3xl font-extrabold text-center text-emerald-700 dark:text-emerald-300 mb-6">
                    🌟 Welcome, Freelancer!
                </h1>

                {user ? (
                    <>
                        <div className="text-center space-y-4 text-sm mb-6">
                            <p>Hello <span className="font-bold">{user.name}</span>!</p>
                            <p>Email: <span className="font-mono">{user.email}</span></p>
                            <p className="text-yellow-400">Role: {user.role}</p>
                            <p className="italic text-gray-600 dark:text-gray-400">
                                Let’s complete your onboarding below to go online.
                            </p>
                        </div>

                        {avatarUrl && (
                            <div className="flex justify-center mb-6">
                                <img
                                    src={`https://crypto-manager-backend.onrender.com${avatarUrl}`}
                                    alt="Your Avatar"
                                    className="w-28 h-28 rounded-full object-cover border-4 border-white shadow-md"
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {onboardingSteps.map((step) => (
                                <StepCard
                                    key={step.key}
                                    title={step.title}
                                    description={step.description}
                                    completed={steps[step.key]}
                                    buttonLabel={step.button}
                                    renderAction={step.renderAction ? step.renderAction() : null}
                                    onClick={() => console.log(`Handle: ${step.key}`)}
                                />
                            ))}
                        </div>
                    </>
                ) : (
                    <p className="text-center text-yellow-500">⏳ Loading user...</p>
                )}
            </div>
        </div>
    );
}

function StepCard({ title, description, completed, buttonLabel, onClick, renderAction }) {
    return (
        <div className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">{title}</h3>
                <span className={`text-sm font-medium ${completed ? "text-green-500" : "text-yellow-400"}`}>
                    {completed ? "✅ Completed" : "⏳ Pending"}
                </span>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{description}</p>
            {renderAction ? (
                <div>{renderAction}</div>
            ) : (
                <button
                    onClick={onClick}
                    className="bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 dark:from-emerald-600 dark:via-yellow-500 dark:to-pink-500 text-white py-1.5 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition"
                >
                    {buttonLabel}
                </button>
            )}
        </div>
    );
}
