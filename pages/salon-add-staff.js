// pages/salon-add-staff.js
import { useState } from "react";
import { useRouter } from "next/router";
import SalonNavbar from "../components/SalonNavbar";
import withSalonAuth from "../hoc/withAuthProtection";
import axios from "axios";

function AddStaff() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    position: "",
    skills: "",
    avatar: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("salon_token");
      await axios.post(
        "/api/staff",
        formData,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      router.push("/salon-staff");
    } catch (err) {
      console.error(err);
      setError("Đã xảy ra lỗi khi thêm nhân viên.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e1628] text-white flex flex-col">
      <SalonNavbar />
      <main className="flex-1 p-4 md:p-8 max-w-2xl mx-auto w-full">
        <div className="bg-[#19223e] rounded-2xl shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-6">Thêm nhân viên mới</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm mb-1">Tên nhân viên</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full p-3 rounded-lg bg-[#0e1628] border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Vị trí</label>
              <input
                type="text"
                name="position"
                value={formData.position}
                onChange={handleChange}
                required
                className="w-full p-3 rounded-lg bg-[#0e1628] border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Kỹ năng</label>
              <input
                type="text"
                name="skills"
                value={formData.skills}
                onChange={handleChange}
                required
                className="w-full p-3 rounded-lg bg-[#0e1628] border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Ảnh đại diện (URL)</label>
              <input
                type="text"
                name="avatar"
                value={formData.avatar}
                onChange={handleChange}
                placeholder="https://..."
                className="w-full p-3 rounded-lg bg-[#0e1628] border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 bg-yellow-400 text-black font-semibold py-3 px-6 rounded-lg hover:bg-yellow-300 transition disabled:opacity-50"
            >
              {loading ? "Đang lưu..." : "Thêm nhân viên"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default withSalonAuth(AddStaff);
