// 📁 pages/salon/services.js
import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import { auth } from "../../firebase";
import { SERVICES_BY_SPECIALIZATION } from "../../constants/servicesBySpecialization";

import { onAuthStateChanged } from "firebase/auth";
import {
    FaCut,
    FaClock,
    FaTags,
    FaFileAlt,
    FaDollarSign,
    FaTools,
} from "react-icons/fa";

export default function SalonServicesPage() {
    const [services, setServices] = useState([]);
    const [filteredServices, setFilteredServices] = useState([]);
    const [selectedSpecialization, setSelectedSpecialization] = useState("all");
    const [editingService, setEditingService] = useState(null);

    const specializations = [
        "nail_tech",
        "hair_stylist",
        "barber",
        "esthetician",
        "lash_tech",
        "massage_therapist",
        "makeup_artist",
        "receptionist",
    ];

    const defaultForm = {
        specialization: "nail_tech",
        name: "",
        description: "",
        price: "",
        duration_minutes: "",
        promotion: "",
    };

    const [form, setForm] = useState(defaultForm);

    const fetchServices = async (token) => {
        try {
            const res = await fetch(
                "https://crypto-manager-backend.onrender.com/api/services?me=1",
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            const data = await res.json();
            setServices(data || []);
            setFilteredServices(data || []);
        } catch (err) {
            console.error("❌ Error loading services:", err.message);
        }
    };

    const handleFilterChange = (value) => {
        setSelectedSpecialization(value);
        if (value === "all") {
            setFilteredServices(services);
        } else {
            setFilteredServices(
                services.filter((s) => s.specialization === value)
            );
        }
    };
    const handleDelete = async (serviceId) => {
        const confirmDelete = window.confirm("Are you sure you want to delete this service?");
        if (!confirmDelete) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(
                `https://crypto-manager-backend.onrender.com/api/services/${serviceId}`,
                {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            const data = await res.json();

            if (res.ok) {
                const updated = services.filter((s) => s.id !== serviceId);
                setServices(updated);
                setFilteredServices(
                    selectedSpecialization === "all"
                        ? updated
                        : updated.filter((s) => s.specialization === selectedSpecialization)
                );
                alert("✅ Service deleted.");
            } else {
                alert("❌ Delete failed: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            console.error("❌ Delete error:", err.message);
            alert("❌ Network error.");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // ❗ Kiểm tra trùng tên tuyệt đối (same name + specialization)
        const isExactDuplicate = services.some(
            (s) =>
                s.name.trim().toLowerCase() === form.name.trim().toLowerCase() &&
                s.specialization === form.specialization &&
                (!editingService || s.id !== editingService.id)
        );

        if (isExactDuplicate && !editingService) {
            alert("❌ This service name already exists for the selected specialization.");
            return;
        }

        // ⚠️ Kiểm tra tên gần giống (ví dụ: chứa chuỗi hoặc khớp gần đầu)
        const similarService = services.find(
            (s) =>
                s.specialization === form.specialization &&
                s.name.toLowerCase().includes(form.name.trim().toLowerCase().slice(0, 4)) &&
                (!editingService || s.id !== editingService.id)
        );

        if (similarService && !editingService) {
            const confirmSimilar = window.confirm(
                `⚠️ A similar service "${similarService.name}" already exists.\nDo you still want to add this service?`
            );
            if (!confirmSimilar) return;
        }

        try {
            const user = auth.currentUser;
            const token = await user.getIdToken();

            const method = editingService ? "PATCH" : "POST";
            const url = editingService
                ? `https://crypto-manager-backend.onrender.com/api/services/${editingService.id}`
                : `https://crypto-manager-backend.onrender.com/api/services`;

            const res = await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    ...form,
                    name: form.name.trim(), // đảm bảo không có khoảng trắng
                    price: parseFloat(form.price),
                    duration_minutes: parseInt(form.duration_minutes),
                }),
            });

            const data = await res.json();
            if (res.ok) {
                const updatedList = editingService
                    ? services.map((s) => (s.id === data.id ? data : s))
                    : [data, ...services];

                setServices(updatedList);
                setFilteredServices(
                    selectedSpecialization === "all"
                        ? updatedList
                        : updatedList.filter(
                            (s) => s.specialization === selectedSpecialization
                        )
                );

                setForm(defaultForm);
                setEditingService(null);
                alert(editingService ? "✅ Service updated!" : "✅ Service added!");
            } else {
                alert("❌ " + (data.error || "Something went wrong"));
            }
        } catch (err) {
            console.error("❌ Error submitting service:", err.message);
            alert("❌ Network error");
        }
    };


    const startEdit = (service) => {
        setForm({ ...service });
        setEditingService(service);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const token = await user.getIdToken();
                fetchServices(token);
            }
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen px-4 py-10 font-mono sm:font-['Pacifico', cursive]">
            <Navbar />
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-center text-emerald-300 mb-18">
                    💈 Salon Services
                </h1>

                <form
                    onSubmit={handleSubmit}
                    className="p-2 mb-4"
                >

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* LEFT: specialization + list service */}
                        <div className="bg-white/5 border-t-4 border-pink-500 p-4 rounded-2xl">
                            <label className="block text-pink-400 font-semibold mb-1 flex items-center gap-1"><FaTools /> Specialization</label>
                            <select
                                name="specialization"
                                value={form.specialization}
                                onChange={(e) => {
                                    const specialization = e.target.value;
                                    setForm({
                                        specialization,
                                        name: "",
                                        price: "",
                                        duration_minutes: "",
                                        promotion: "",
                                        description: "",
                                    });
                                }}
                                className="rounded-2xl p-2 pl-4 text-yellow-600 w-full bg-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-400 capitalize"
                            >
                                {specializations.map((s) => (
                                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                                ))}
                            </select>
                            {form.specialization && SERVICES_BY_SPECIALIZATION[form.specialization] && (
                                <div className="mt-2 p-4 mb-2">
                                    <div className="font-semibold text-emerald-200 mb-2 text-center drop-shadow">
                                        Typical Services
                                    </div>
                                    <div
                                        className="scroll-services-mobile"
                                        style={{
                                            maxHeight: 320,
                                            overflowY: "auto",
                                            WebkitOverflowScrolling: "touch",
                                            overscrollBehavior: "contain",
                                            touchAction: "pan-y",
                                            scrollbarWidth: "thin"
                                        }}
                                    >
                                        <ul className="space-y-1 overflow-y-auto pr-2">
                                            {SERVICES_BY_SPECIALIZATION[form.specialization].map((svc) => {
                                                const isActive = form.name === svc;
                                                return (
                                                    <li
                                                        key={svc}
                                                        className={`
                                                        cursor-pointer text-sm px-2 py-1 border-t-1 border-white/20 text-gray-400 rounded transition
                                                        ${isActive
                                                                ? "bg-emerald-200 text-emerald-900 font-bold ring-2 ring-emerald-400"
                                                                : "hover:bg-white/10 hover:font-semibold hover:text-emerald-400"
                                                            }
                                                        `}
                                                        onClick={() => setForm({ ...form, name: svc })}
                                                    >
                                                        {svc}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>

                                    <div className="text-xs text-yellow-300 mt-4">*  Click any service to fill &quot;Service Name&quot;.</div>
                                </div>

                            )}
                        </div>

                        {/* RIGHT: Gom tất cả trường lại 1 card */}
                        <div className="bg-white/5 border-t-4 border-pink-500 p-4 rounded-2xl flex flex-col gap-4">
                            <label className="block text-pink-400 font-semibold mb-1 flex items-center gap-1">
                                <FaCut /> Service Name
                            </label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                required
                                className="rounded-2xl text-yellow-600 p-2 pl-4 w-full bg-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-400 capitalize"
                                placeholder="Select or enter service name"
                            />

                            <label className="block text-pink-400 font-semibold mb-1 flex items-center gap-1">
                                <FaDollarSign /> Price ($)
                            </label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-yellow-600 font-bold pointer-events-none">$</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={form.price}
                                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                                    required
                                    className="rounded-2xl text-yellow-600 p-2 pl-8 w-full bg-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                    placeholder="Price"
                                />
                            </div>

                            <label className="block text-pink-400 font-semibold mb-1 flex items-center gap-1">
                                <FaClock /> Duration (minutes)
                            </label>
                            <input
                                type="number"
                                value={form.duration_minutes}
                                onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                                required
                                className="rounded-2xl  text-yellow-600 p-2 pl-4 w-full bg-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            />

                            <label className="block text-pink-400 font-semibold mb-1 flex items-center gap-1">
                                <FaTags /> Promotion (optional)
                            </label>
                            <input
                                type="text"
                                value={form.promotion}
                                onChange={(e) => setForm({ ...form, promotion: e.target.value })}
                                className="rounded-2xl text-yellow-600 p-2 pl-4 w-full bg-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            />

                            <label className="block text-pink-400 font-semibold mb-1 flex items-center gap-1">
                                <FaFileAlt /> Description (optional)
                            </label>
                            <textarea
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="rounded-2xl mb-4 text-yellow-600 p-2 pl-4 w-full bg-white/5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            />
                        </div>
                    </div>


                    <div className="mt-4 flex gap-4">
                        <button
                            type="submit"
                            className="bg-yellow-400 text-black px-6 py-2 rounded-2xl hover:bg-yellow-500 font-bold"
                        >
                            {editingService ? "✏️ Update Service" : "➕ Add Service"}
                        </button>
                        {editingService && (
                            <button
                                type="button"
                                onClick={() => {
                                    setForm(defaultForm);
                                    setEditingService(null);
                                }}
                                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                            >
                                ❌ Cancel
                            </button>
                        )}
                    </div>
                </form>

                {/* Bộ lọc specialization */}
                <div className="mb-6">
                    <label className="font-semibold mr-3 text-pink-400">
                        🔍 Filter by Specialization:
                    </label>
                    <select
                        value={selectedSpecialization}
                        onChange={(e) => handleFilterChange(e.target.value)}
                        className="rounded p-2 text-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 capitalize"
                    >
                        <option value="all">All</option>
                        {specializations.map((s) => (
                            <option key={s} value={s}>
                                {s.replace("_", " ")}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Danh sách dịch vụ */}
                <div
                    className="scroll-services-mobile custom-scrollbar rounded-2xl"
                    style={{
                        maxHeight: 320,
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                        overscrollBehavior: "contain",
                        touchAction: "pan-y"
                    }}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {filteredServices.length === 0 ? (
                            <p className="text-center text-white col-span-2">No services found.</p>
                        ) : (
                            filteredServices.map((s) => (
                                <div
                                    key={s.id}
                                    className="bg-white/5 backdrop-blur-md border-t-4 border-white/20 p-4 rounded-2xl shadow-xl"
                                >
                                    <h3 className="text-lg font-bold text-yellow-300 capitalize">{s.name}</h3>
                                    <p className="text-sm text-pink-300 italic mb-1 capitalize">
                                        {s.specialization.replace("_", " ")}
                                    </p>
                                    <p className="text-sm">{s.description}</p>
                                    <p className="text-sm mt-1">
                                        💲 <strong>${s.price}</strong> • ⏱ {s.duration_minutes} min
                                    </p>
                                    {s.promotion && (
                                        <p className="text-xs text-pink-300 mt-1">
                                            🎁 {s.promotion}
                                        </p>
                                    )}

                                    <div className="flex justify-between items-center mt-3">
                                        <button
                                            onClick={() => startEdit(s)}
                                            className="text-sm text-cyan-300 hover:underline"
                                        >
                                            ✏️ Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(s.id)}
                                            className="text-sm text-red-400 hover:underline"
                                        >
                                            🗑️ Delete
                                        </button>
                                    </div>

                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
