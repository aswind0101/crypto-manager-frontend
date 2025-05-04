// components/SalonNavbar.js (Cập nhật menu đóng/mở giữ nguyên như cũ để tái sử dụng) 
import { useRouter } from "next/router";
import { FaHome, FaCalendarAlt, FaUsers, FaCog, FaSignOutAlt } from "react-icons/fa";

export default function SalonNavbar() {
  const router = useRouter();

  const menuItems = [
    { label: "Bảng điều khiển", icon: <FaHome />, path: "/salon-dashboard" },
    { label: "Lịch hẹn", icon: <FaCalendarAlt />, path: "/salon-appointments" },
    { label: "Nhân viên", icon: <FaUsers />, path: "/salon-staff" },
    { label: "Cài đặt", icon: <FaCog />, path: "/salon-settings" },
  ];

  const handleLogout = () => {
    localStorage.removeItem("salon_token");
    router.push("/salon-login");
  };

  return (
    <aside className="w-60 bg-white/80 backdrop-blur-lg shadow-lg p-6 flex flex-col justify-between min-h-screen">
      <div>
        <h2 className="text-2xl font-bold text-purple-700 mb-8 text-center">Quản lý Salon</h2>
        <nav className="space-y-4">
          {menuItems.map((item, idx) => (
            <button
              key={idx}
              onClick={() => router.push(item.path)}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-purple-700 hover:bg-purple-100 transition text-left"
            >
              <span className="text-lg">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-500 hover:bg-red-100 transition"
      >
        <FaSignOutAlt className="text-lg" />
        <span className="font-medium">Đăng xuất</span>
      </button>
    </aside>
  );
}
