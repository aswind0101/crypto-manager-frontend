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
    const [employeeStatus, setEmployeeStatus] = useState(null);




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
    const isUploadingAny = uploading.avatar || uploading.license || uploading.id;
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
            Pending: "bg-gray-400",
        };
        return colorMap[status] || "bg-gray-400 text-white";
    };

    const router = useRouter();
    const auth = getAuth();

    useEffect(() => {
        let intervalId;
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
                const userData = { ...storedUser, ...currentUser };
                setUser(userData);

                const loadAllData = async () => {
                    try {
                        const token = await currentUser.getIdToken();
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
                                license_status: data.license_status || "Pending",
                                id_doc_status: data.id_doc_status || "Pending",
                            });

                            setAvatarUrl(data.avatar_url || null);
                            setLicenseUrl(data.license_url || null);
                            setIdDocUrl(data.id_doc_url || null);

                            let empStatus = null;
                            if (data.has_salon) {
                                try {
                                    const resEmp = await fetch("https://crypto-manager-backend.onrender.com/api/employees/me", {
                                        headers: { Authorization: `Bearer ${token}` },
                                    });
                                    const empData = await resEmp.json();
                                    if (resEmp.ok) {
                                        empStatus = empData.status;
                                        setEmployeeStatus(empStatus);
                                    } else {
                                        console.warn("⚠️ Failed to get employee status");
                                    }
                                } catch (err) {
                                    console.error("❌ Error fetching employee status:", err.message);
                                }
                            }

                            if (!data.has_salon || empStatus === "rejected") {
                                loadSalonList();
                            }

                            if (data.has_salon) {
                                try {
                                    const resSalon = await fetch("https://crypto-manager-backend.onrender.com/api/salons/by-id", {
                                        headers: { Authorization: `Bearer ${token}` },
                                    });
                                    const salonData = await resSalon.json();
                                    if (resSalon.ok) {
                                        setSelectedSalonInfo(salonData);
                                    } else {
                                        console.warn("⚠️ Failed to load salon by ID:", salonData.error);
                                    }
                                } catch (err) {
                                    console.error("❌ Error loading selected salon:", err.message);
                                }
                            }
                        } else {
                            console.warn("⚠️ Failed to load onboarding state:", data.error);
                        }
                    } catch (err) {
                        console.error("❌ Error loading onboarding state:", err.message);
                    }
                };

                await loadAllData();
                intervalId = setInterval(loadAllData, 10000); // ⏱ tự động làm mới mỗi 10 giây
            } else {
                router.push("/login");
            }
        });

        return () => {
            unsubscribe();
            if (intervalId) clearInterval(intervalId);
        };
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
            const currentUser = auth.currentUser;
            if (!currentUser) return;

            const token = await currentUser.getIdToken();

            // ⚠️ Gọi API check xem nhân viên đang thuộc salon nào chưa
            const empRes = await fetch("https://crypto-manager-backend.onrender.com/api/employees/me", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const empData = await empRes.json();

            if (empRes.ok && empData?.salon_id) {
                // ✅ Nếu đã là nhân viên salon nào đó ➜ chỉ load đúng salon đó
                const salonRes = await fetch(`https://crypto-manager-backend.onrender.com/api/salons/${empData.salon_id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const salonInfo = await salonRes.json();

                if (salonRes.ok) {
                    setSalonList([salonInfo]);
                    setSelectedSalonId(salonInfo.id); // auto-select luôn nếu bạn muốn
                } else {
                    console.warn("⚠️ Failed to load specific salon info");
                    setSalonList([]);
                }
            } else {
                // ✅ Nếu không phải nhân viên salon nào ➜ load toàn bộ salon active
                const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons/active", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (res.ok) {
                    setSalonList(data);
                } else {
                    console.warn("⚠️ Failed to load salons:", data.error);
                    setSalonList([]);
                }
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
            badge: steps.has_avatar ? "Completed" : "Pending",
            badgeColor: steps.has_avatar ? "bg-green-500 text-white" : "bg-gray-400",
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

            badge:
                status.license_status === "Approved"
                    ? "Completed"
                    : status.license_status || "Pending",
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
            badge:
                status.id_doc_status === "Approved"
                    ? "Completed"
                    : status.id_doc_status || "Pending",
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

                    {employeeStatus === "inactive" && (
                        <p className="text-yellow-500 mt-2">⏳ Waiting for salon owner approval...</p>
                    )}
                </div>
            ) : "Choose where you're currently working.",

            badge: steps.has_salon
                ? employeeStatus === "active"
                    ? "Completed"
                    : employeeStatus === "rejected"
                        ? "Rejected"
                        : "In Review"
                : null,

            badgeColor: steps.has_salon
                ? employeeStatus === "active"
                    ? "bg-green-500 text-white"
                    : employeeStatus === "rejected"
                        ? "bg-red-500 text-white"
                        : "bg-yellow-400 text-black"
                : "",


            button: steps.has_salon ? "✅ Confirmed" : "Select Salon",
            renderAction: () => {
                const readyToSelect =
                    steps.has_avatar && steps.has_license && steps.has_id;

                const allowReselect = steps.has_salon && employeeStatus === "rejected";

                if (steps.has_salon && !allowReselect) {
                    return (
                        <button
                            disabled
                            className="w-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-pink-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md cursor-default"
                        >
                            {employeeStatus === "rejected" ? "Rejected ❌" : "Confirmed ✅"}
                        </button>
                    );
                }

                if (!readyToSelect) {
                    return (
                        <div className="text-sm text-red-500">
                            ⚠️ Please complete the following before selecting a salon:
                            <ul className="list-disc ml-6 mt-1">
                                {!steps.has_avatar && <li>Upload Avatar</li>}
                                {!steps.has_license && <li>Upload License</li>}
                                {!steps.has_id && <li>Upload ID Document</li>}
                            </ul>
                        </div>
                    );
                }

                return (
                    <div className="space-y-2">
                        {employeeStatus === "rejected" && (
                            <div className="text-sm text-yellow-500 mb-1">
                                ⚠️ Your previous salon selection was rejected. Please choose another salon.
                            </div>
                        )}
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
                            {selectingSalon ? "Submitting..." : allowReselect ? "Re-select Salon" : "Confirm Salon"}
                        </button>
                    </div>
                );
            }

        }
        ,
        {
            key: "has_payment",
            title: "Add Payment Method",
            description: "Add your preferred payment method to complete onboarding.",
            badge: steps.has_payment ? "Completed" : "Pending",
            badgeColor: steps.has_payment ? "bg-green-500 text-white" : "bg-gray-400 text-white",
            button: steps.has_payment ? "Added ✅" : "Add Payment Method",
            renderAction: () => (
                <button
                    onClick={async () => {
                        const token = await auth.currentUser.getIdToken();

                        const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/mark-payment-added", {
                            method: "PATCH",
                            headers: {
                                Authorization: `Bearer ${token}`,
                                "Content-Type": "application/json"
                            }
                        });

                        if (res.ok) {
                            alert("✅ Payment method saved!");
                            setSteps((prev) => ({ ...prev, has_payment: true }));
                        } else {
                            alert("❌ Failed to save payment method");
                        }
                    }}
                    className="w-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 text-white py-2 rounded-xl text-sm font-semibold shadow-md hover:brightness-105 hover:scale-105 transition"
                    disabled={steps.has_payment}
                >
                    {steps.has_payment ? "Added ✅" : "Add Payment Method"}
                </button>
            )
        }
        ,
    ];
    {
        isUploadingAny && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="bg-white/20 backdrop-blur-xl p-6 rounded-2xl shadow-lg flex flex-col items-center justify-center">
                    <svg className="animate-spin h-8 w-8 text-white mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <p className="text-white text-sm">Uploading... Please wait</p>
                </div>
            </div>
        )
    }

    return (
        <>
            {/* ✅ Overlay loading trung tâm khi đang upload */}
            {isUploadingAny && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white/20 backdrop-blur-xl p-6 rounded-2xl shadow-lg flex flex-col items-center justify-center">
                        <svg
                            className="animate-spin h-8 w-8 text-white mb-2"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                        >
                            <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                            ></circle>
                            <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            ></path>
                        </svg>
                        <p className="text-white text-sm">Uploading... Please wait</p>
                    </div>
                </div>
            )}

            {/* ✅ Giao diện chính, bị khóa nếu đang upload */}
            <div
                className={`min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-8 text-gray-800 dark:text-gray-100 ${isUploadingAny ? "pointer-events-none opacity-50" : ""
                    }`}
            >
                <Navbar />

                <div className="max-w-3xl mx-auto bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8">
                    <h1 className="text-3xl font-extrabold text-center text-emerald-700 dark:text-emerald-300 mb-6">
                        🌟 Welcome, Freelancer!
                    </h1>
                    <p className="text-sm text-gray-700 dark:text-gray-300 text-center mb-4">
                        Please complete the following <strong>5 steps</strong> to get qualified as a stylist.
                        Your license and ID need to be <strong>approved</strong> before you can go online.
                    </p>

                    {user ? (
                        <>
                            <div className="text-center space-y-4 text-sm mb-6">
                                <p>
                                    Hello <span className="font-bold">{user.name}</span>!
                                </p>
                                <p>
                                    Email: <span className="font-mono">{user.email}</span>
                                </p>
                                <p className="text-yellow-400">Role: {user.role}</p>
                                <p className="italic text-gray-600 dark:text-gray-400">
                                    Let’s complete your onboarding below to go online.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {onboardingSteps.map((step, index) => (
                                    <StepCard
                                        key={step.key}
                                        title={`Step ${index + 1}: ${step.title}`}
                                        description={step.description}
                                        completed={steps[step.key]}
                                        buttonLabel={step.button}
                                        renderAction={step.renderAction ? step.renderAction() : null}
                                        onClick={() => console.log(`Handle: ${step.key}`)}
                                        badge={step.badge}
                                        badgeColor={step.badgeColor}
                                        disabled={
                                            (step.key === "has_avatar" && uploading.avatar) ||
                                            (step.key === "has_license" && uploading.license) ||
                                            (step.key === "has_id" && uploading.id)
                                        }
                                    />
                                ))}
                            </div>

                        </>
                    ) : (
                        <p className="text-center text-yellow-500">⏳ Loading user...</p>
                    )}
                </div>
            </div>
        </>
    );

}

function StepCard({ title, description, completed, buttonLabel, onClick, renderAction, badge, badgeColor, disabled }) {
    return (
        <div
            className={`relative pt-8 pb-8 bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-xl flex flex-col justify-between transition ${disabled ? "opacity-50 pointer-events-none" : ""
                }`}
        >
            {badge && (
                <div className="absolute top-2 right-2">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-xl ${badgeColor}`}>
                        {badge}
                    </span>
                </div>
            )}
            <h3 className="text-lg font-semibold text-emerald-700 dark:text-emerald-300 mb-2">{title}</h3>
            <div className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                {description}
            </div>

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


