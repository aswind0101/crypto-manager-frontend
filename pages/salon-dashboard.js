import { useState } from "react";
import withSalonAuth from "../hoc/withAuthProtection";
import { FaBars, FaTimes, FaCalendarAlt, FaUsers, FaChartBar } from "react-icons/fa";
import SalonNavbar from "../components/SalonNavbar";

function SalonDashboard() {
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  return (
    <div className="flex min-h-screen bg-gradient-to-r from-pink-50 to-purple-100">
      {/* Thanh điều hướng */}
      <div className={`${isMenuOpen ? 'block' : 'hidden'} md:block`}>
        <SalonNavbar />
      </div>

      {/* Nội dung chính */}
      <main className="flex-1 p-6 md:p-10">
        {/* Nút đóng/mở menu */}
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="mb-4 p-3 bg-purple-500 text-white rounded-full shadow-lg md:hidden"
        >
          {isMenuOpen ? <FaTimes /> : <FaBars />}
        </button>

        <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-lg p-8">
          <h1 className="text-3xl font-bold text-purple-700 mb-4">Bảng điều khiển Salon</h1>
          <p className="text-gray-700 text-lg mb-6">
            Chào mừng bạn quay lại! Đây là bảng điều khiển chính, nơi bạn có thể quản lý lịch hẹn, nhân viên và các chức năng khác.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-2xl p-6 shadow-lg hover:scale-105 hover:shadow-2xl transition-all flex flex-col items-start gap-3 cursor-pointer">
              <FaCalendarAlt className="text-4xl" />
              <h3 className="text-xl font-semibold">Quản lý lịch hẹn</h3>
              <p className="text-sm">Xem và quản lý các lịch hẹn của khách hàng.</p>
            </div>
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-2xl p-6 shadow-lg hover:scale-105 hover:shadow-2xl transition-all flex flex-col items-start gap-3 cursor-pointer">
              <FaUsers className="text-4xl" />
              <h3 className="text-xl font-semibold">Quản lý nhân viên</h3>
              <p className="text-sm">Xem danh sách nhân viên và phân quyền quản lý.</p>
            </div>
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-2xl p-6 shadow-lg hover:scale-105 hover:shadow-2xl transition-all flex flex-col items-start gap-3 cursor-pointer">
              <FaChartBar className="text-4xl" />
              <h3 className="text-xl font-semibold">Báo cáo & Thống kê</h3>
              <p className="text-sm">Xem báo cáo doanh thu và hiệu suất làm việc.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default withSalonAuth(SalonDashboard);
