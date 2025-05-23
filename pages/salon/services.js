// 📁 pages/salon/services.js
import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { auth } from "../../firebase";

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
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/services?me=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
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
      setFilteredServices(services.filter((s) => s.specialization === value));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
            : updatedList.filter((s) => s.specialization === selectedSpecialization)
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
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4 py-10 text-gray-800 dark:text-gray-100">
      <Navbar />
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-emerald-700 dark:text-emerald-300 mb-8">
          💈 Salon Services
        </h1>

        {/* Form thêm/chỉnh sửa dịch vụ */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl p-6 mb-8"
        >
          <h2 className="text-xl font-bold mb-4 text-pink-100">
            {editingService ? "✏️ Edit Service" : "➕ Add New Service"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select
              name="specialization"
              value={form.specialization}
              onChange={(e) => setForm({ ...form, specialization: e.target.value })}
              className="rounded p-2 text-black"
            >
              {specializations.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Service Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="rounded p-2 text-black"
            />

            <input
              type="number"
              step="0.01"
              placeholder="Price ($)"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
              className="rounded p-2 text-black"
            />

            <input
              type="number"
              placeholder="Duration (minutes)"
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              required
              className="rounded p-2 text-black"
            />

            <input
              type="text"
              placeholder="Promotion (optional)"
              value={form.promotion}
              onChange={(e) => setForm({ ...form, promotion: e.target.value })}
              className="rounded p-2 text-black col-span-1 md:col-span-2"
            />

            <textarea
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded p-2 text-black col-span-1 md:col-span-2"
            />
          </div>

          <div className="mt-4 flex gap-4">
            <button
              type="submit"
              className="bg-yellow-400 text-black px-6 py-2 rounded hover:bg-yellow-500 font-bold"
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
          <label className="font-semibold mr-3 text-white">
            🔍 Filter by Specialization:
          </label>
          <select
            value={selectedSpecialization}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="rounded p-2 text-black"
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredServices.length === 0 ? (
            <p className="text-center text-white col-span-2">
              No services found.
            </p>
          ) : (
            filteredServices.map((s) => (
              <div
                key={s.id}
                className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl shadow-xl"
              >
                <h3 className="text-lg font-bold text-yellow-300">{s.name}</h3>
                <p className="text-sm text-white/90 italic mb-1">
                  {s.specialization.replace("_", " ")}
                </p>
                <p className="text-sm">{s.description}</p>
                <p className="text-sm mt-1">
                  💲 <strong>${s.price}</strong> • ⏱ {s.duration_minutes} min
                </p>
                {s.promotion && (
                  <p className="text-xs text-pink-300 mt-1">🎁 {s.promotion}</p>
                )}

                <button
                  onClick={() => startEdit(s)}
                  className="mt-3 text-sm text-cyan-300 hover:underline"
                >
                  ✏️ Edit
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
