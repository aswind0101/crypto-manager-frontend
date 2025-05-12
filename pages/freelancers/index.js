import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Navbar from "../../components/Navbar";

export default function FreelancerDashboard() {
    const [user, setUser] = useState(null);
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [salonList, setSalonList] = useState([]);
    const [selectedSalonId, setSelectedSalonId] = useState("");
    const [selectingSalon, setSelectingSalon] = useState(false);
    const [selectedSalonInfo, setSelectedSalonInfo] = useState(null);
    const [licenseUrl, setLicenseUrl] = useState(null);
    const [idDocUrl, setIdDocUrl] = useState(null);

    const fullURL = (url) =>
        url?.startsWith("http") ? url : `https://crypto-manager-backend.onrender.com${url}`;



    const [steps, setSteps] = useState({
        has_avatar: false,
        has_license: false,
        has_id: false,
        has_salon: false,
        has_payment: false,
    });
    const [status, setStatus] = useState({
        license_status: "",
        id_doc_status: "",
    });
    const [uploading, setUploading] = useState({
        avatar: false,
        license: false,
        id: false,
    });

    const StatusBadge = ({ value }) => {
        const map = {
            Approved: "bg-green-500",
            "In Review": "bg-yellow-500",
            Rejected: "bg-red-500",
            Pending: "bg-gray-400",
        };

        return (
            <span className={`ml-2 px-2 py-0.5 rounded text-white text-xs ${map[value] || "bg-gray-400"}`}>
                {value || "Pending"}
            </span>
        );
    };
    const badgeColor = (status) => {
        const colorMap = {
            Approved: "bg-green-500 text-white",
            "In Review": "bg-yellow-400 text-black",
            Rejected: "bg-red-500 text-white",
            Pending: "bg-gray-400 text-white"
        };
        return colorMap[status] || "bg-gray-400 text-white";
    };

    const router = useRouter();
    const auth = getAuth();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
                const userData = { ...storedUser, ...currentUser };
                setUser(userData);

                try {
                    const token = await currentUser.getIdToken();
                    const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/onboarding", {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    });

                    const data = await res.json();

                    if (res.ok) {
                        setSteps({
                            has_avatar: data.has_avatar,
                            has_license: data.has_license,
                            has_id: data.has_id,
                            has_salon: data.has_salon,
                            has_payment: data.has_payment,
                        });
                        setStatus({
                            license_status: data.license_status || "Pending",
                            id_doc_status: data.id_doc_status || "Pending"
                        });

                        // ✅ Lưu URL file vào state
                        setAvatarUrl(data.avatar_url || null);
                        setLicenseUrl(data.license_url || null);
                        setIdDocUrl(data.id_doc_url || null);
                        if (!data.has_salon) {
                            loadSalonList();
                        }
                        if (data.has_salon) {
                            try {
                                const token = await currentUser.getIdToken();
                                const resSalon = await fetch("https://crypto-manager-backend.onrender.com/api/salons/by-id", {
                                    headers: { Authorization: `Bearer ${token}` },
                                });
                                const salonData = await resSalon.json();
                                if (resSalon.ok) {
                                    setSelectedSalonInfo(salonData); // Gồm: name, address, phone
                                } else {
                                    console.warn("⚠️ Failed to load salon by ID:", salonData.error);
                                }
                            } catch (err) {
                                console.error("❌ Error loading selected salon:", err.message);
                            }
                        }

                        if (data.avatar_url) {
                            setAvatarUrl(data.avatar_url);
                        }
                    } else {
                        console.warn("⚠️ Failed to load onboarding state:", data.error);
                    }
                } catch (err) {
                    console.error("❌ Error loading onboarding state:", err.message);
                }
            } else {
                router.push("/login");
            }
        });

        return () => unsubscribe();
    }, []);
    const refreshOnboardingStatus = async () => {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/onboarding", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok) {
                setSteps({
                    has_avatar: data.has_avatar,
                    has_license: data.has_license,
                    has_id: data.has_id,
                    has_salon: data.has_salon,
                    has_payment: data.has_payment,
                });
                setStatus({
                    license_status: data.license_status,
                    id_doc_status: data.id_doc_status,
                });
            } else {
                console.warn("⚠️ Failed to refresh onboarding:", data.error);
            }
        } catch (err) {
            console.error("❌ Error refreshing onboarding:", err.message);
        }
    };

    const loadSalonList = async () => {
        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons/active");
            const data = await res.json();
            if (res.ok) {
                setSalonList(data);
            } else {
                console.warn("⚠️ Failed to load salons:", data.error);
            }
        } catch (err) {
            console.error("❌ Error loading salons:", err.message);
        }
    };

    const uploadAvatar = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading((prev) => ({ ...prev, avatar: true }));

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
                await refreshOnboardingStatus();
                setSteps((prev) => ({ ...prev, has_avatar: true }));
                setAvatarUrl(data.avatar_url); // Ví dụ: "/uploads/avatars/abc.jpg"

            } else {
                alert("❌ Upload failed: " + data.error);
            }
        } catch (err) {
            console.error("Upload error:", err.message);
            alert("❌ Upload failed.");
        } finally {
            setUploading((prev) => ({ ...prev, avatar: false }));
        }
    };
    const uploadId = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading((prev) => ({ ...prev, id: true }));
        const token = await auth.currentUser.getIdToken();
        const formData = new FormData();
        formData.append("id_doc", file);

        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/upload/id", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            });

            const data = await res.json();
            if (res.ok) {
                alert("✅ ID Document uploaded!");
                await refreshOnboardingStatus();
                setSteps((prev) => ({ ...prev, has_id: true }));    
                setIdDocUrl(data.id_doc_url);     
            } else {
                alert("❌ Upload failed: " + data.error);
            }
        } catch (err) {
            console.error("❌ Upload ID error:", err.message);
            alert("❌ Upload failed.");
        } finally {
            setUploading((prev) => ({ ...prev, id: false }));
        }
    };

    const uploadLicense = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading((prev) => ({ ...prev, license: true }));
        const token = await auth.currentUser.getIdToken();
        const formData = new FormData();
        formData.append("license", file);

        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/upload/license", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            });

            const data = await res.json();
            if (res.ok) {
                alert("✅ License uploaded!");
                await refreshOnboardingStatus();
                setSteps((prev) => ({ ...prev, has_license: true }));
                setLicenseUrl(data.license_url);
            } else {
                alert("❌ Upload failed: " + data.error);
            }
        } catch (err) {
            console.error("❌ Upload license error:", err.message);
            alert("❌ Upload failed.");
        } finally {
            setUploading((prev) => ({ ...prev, license: false }));
        }
    };

    const onboardingSteps = [
        {
            key: "has_avatar",
            title: "Upload your Avatar",
            description: (
                <>
                    <p>Add a professional photo to build trust.</p>
                    {steps.has_avatar && avatarUrl && (
                        <div className="mt-3">
                            <img
                                src={fullURL(avatarUrl)}
                                alt="Avatar"
                                className="w-24 h-24 rounded-full border-2 border-white shadow-lg"
                            />
                        </div>
                    )}
                </>
            ),

            button: "Upload Avatar",
            renderAction: () => (
                <label className="block w-full">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={uploadAvatar}
                        hidden
                    />
                    <span className="inline-flex justify-center w-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition cursor-pointer">
                        {uploading.avatar
                            ? "Uploading..."
                            : steps.has_avatar
                                ? "Uploaded ✅"
                                : "Upload Avatar"
                        }
                    </span>
                </label>
            ),

        },
        {
            key: "has_license",
            title: "Upload License",
            description: (
                <>
                    <p>Attach your Nail/Hair license (PDF or Image).</p>

                    {steps.has_license && licenseUrl && status.license_status !== "Pending" && (
                        <div className="mt-3">
                            {licenseUrl.endsWith(".pdf") ? (
                                <a
                                    href={fullURL(licenseUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-300 underline"
                                >
                                    📄 View License (PDF)
                                </a>
                            ) : (
                                <img
                                    src={fullURL(licenseUrl)}
                                    alt="License"
                                    className="w-32 h-20 rounded-xl border border-white/20 shadow-lg"
                                />
                            )}
                        </div>
                    )}
                </>
            ),

            badge: status.license_status,
            badgeColor: badgeColor(status.license_status),
            button: steps.has_license ? "Uploaded ✅" : "Upload License",
            renderAction: () => (
                <label className="block w-full">
                    <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={uploadLicense}
                        hidden
                    />
                    <span className="inline-flex justify-center items-center w-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition cursor-pointer">
                        {uploading.license
                            ? "Uploading..."
                            : steps.has_license
                                ? "Uploaded ✅"
                                : "Upload License"
                        }

                    </span>
                </label>
            ),
        }
        ,
        {
            key: "has_id",
            title: "Upload ID",
            description: (
                <>
                    <p>Add Passport or Government-issued ID.</p>
                    {steps.has_id && status.id_doc_status !== "Pending" && (
                        <div className="mt-2">
                            {idDocUrl && (
                                idDocUrl.endsWith(".pdf") ? (
                                    <a
                                        href={fullURL(idDocUrl)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-300 underline"
                                    >
                                        📄 View ID Document (PDF)
                                    </a>
                                ) : (
                                    <img
                                        src={fullURL(idDocUrl)}
                                        alt="ID Document"
                                        className="w-32 h-20 mt-2 rounded-xl border border-white/20 shadow-lg"
                                    />
                                )
                            )}
                        </div>
                    )}
                </>
            ),
            badge: status.id_doc_status,
            badgeColor: badgeColor(status.id_doc_status),
            button: steps.has_id ? "Uploaded ✅" : "Upload ID",
            renderAction: () => (
                <label className="block w-full">
                    <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={uploadId}
                        hidden
                    />
                    <span className="inline-flex justify-center items-center w-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition cursor-pointer">
                        {uploading.id
                            ? "Uploading..."
                            : steps.has_id
                                ? "Uploaded ✅"
                                : "Upload ID"
                        }

                    </span>
                </label>
            ),
        }
        ,
        {
            key: "has_salon",
            title: steps.has_salon ? "Your selected Salon" : "Select Your Salon",
            description: steps.has_salon && selectedSalonInfo ? (
                <div className="text-sm space-y-1">
                    <p><strong>🏠 Name:</strong> {selectedSalonInfo.name}</p>
                    <p><strong>📍 Address:</strong> {selectedSalonInfo.address}</p>
                    <p><strong>📞 Phone:</strong> {selectedSalonInfo.phone}</p>
                </div>
            ) : "Choose where you're currently working.",
            badge: steps.has_salon ? "Completed" : null,
            badgeColor: steps.has_salon ? "bg-green-500 text-white" : "",
            button: steps.has_salon ? "✅ Confirmed" : "Select Salon",
            renderAction: () => (
                steps.has_salon ? (
                    <button
                        disabled
                        className="w-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md cursor-default"
                    >
                        Confirmed ✅
                    </button>
                ) : (
                    <div className="space-y-2">
                        <select
                            value={selectedSalonId}
                            onChange={(e) => setSelectedSalonId(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-white"
                        >
                            <option value="">-- Select Salon --</option>
                            {salonList.map((salon) => (
                                <option key={salon.id} value={salon.id}>
                                    {salon.name} — {salon.address}
                                </option>
                            ))}
                        </select>

                        <button
                            onClick={async () => {
                                if (!selectedSalonId) {
                                    alert("❗ Please select a salon.");
                                    return;
                                }
                                setSelectingSalon(true);
                                const token = await auth.currentUser.getIdToken();
                                try {
                                    const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/select-salon", {
                                        method: "PATCH",
                                        headers: {
                                            Authorization: `Bearer ${token}`,
                                            "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({ salon_id: selectedSalonId }),
                                    });
                                    const data = await res.json();
                                    if (res.ok) {
                                        alert("✅ Salon selected successfully!");
                                        setSteps((prev) => ({ ...prev, has_salon: true }));

                                        // ⏬ Sau khi xác nhận, lấy salon info
                                        const resSalon = await fetch("https://crypto-manager-backend.onrender.com/api/salons/by-id", {
                                            headers: { Authorization: `Bearer ${token}` }
                                        });
                                        const salonInfo = await resSalon.json();
                                        if (resSalon.ok) setSelectedSalonInfo(salonInfo);

                                    } else {
                                        alert("❌ " + (data.error || "Selection failed"));
                                    }
                                } catch (err) {
                                    alert("❌ Error selecting salon");
                                } finally {
                                    setSelectingSalon(false);
                                }
                            }}
                            className="bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition w-full"
                            disabled={selectingSalon}
                        >
                            {selectingSalon ? "Submitting..." : "Confirm Salon"}
                        </button>
                    </div>
                )
            )
        }
        ,
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
                                    badge={step.badge}
                                    badgeColor={step.badgeColor}
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

function StepCard({ title, description, completed, buttonLabel, onClick, renderAction, badge, badgeColor }) {
    return (
        <div className="relative bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between">

            {/* ✅ Badge hiển thị cố định ở góc trên phải */}
            {badge && (
                <div className="absolute top-3 right-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${badgeColor}`}>
                        {badge}
                    </span>
                </div>
            )}

            <h3 className="text-lg font-semibold text-emerald-700 dark:text-emerald-300 mb-2">{title}</h3>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{description}</p>

            {renderAction ? (
                <div>{renderAction}</div>
            ) : (
                <button
                    onClick={onClick}
                    className="bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition"
                >
                    {buttonLabel}
                </button>
            )}
        </div>
    );
}

