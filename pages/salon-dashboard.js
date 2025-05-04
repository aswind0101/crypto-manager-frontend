// pages/salon-dashboard.js
import { useEffect, useState } from "react";
import Link from "next/link";
import SwipeDashboard from "../components/SwipeDashboard"; // giữ nguyên nếu đã có
import { FaCalendarAlt, FaUser, FaWrench } from "react-icons/fa";
import axios from "axios";
import '../firebase';
import { getAuth } from "firebase/auth";

export default function SalonDashboard() {
  const [token, setToken] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const baseUrl = "https://crypto-manager-backend.onrender.com"


  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) {
          console.log('Chưa đăng nhập.');
          setLoading(false);
          return;
        }
        const token = await user.getIdToken();

        // Giả sử bạn có salonId lấy từ user info hoặc truyền tạm
        const salonId = 2; // đổi thành đúng salon_id của bạn nếu cần

        const res = await axios.get(`${baseUrl}/api/staff?salon_id=${salonId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        setStaffList(res.data);
      } catch (err) {
        console.error('Lỗi lấy staff:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStaff();
  }, []);


  useEffect(() => {
    const t = localStorage.getItem('salon_token');
    setToken(t);
  }, []);

  const staffsDummy = [
    {
      id: 1,
      name: "Nguyễn Thị A",
      avatar: "",
      skills: ["Nail", "Hair"],
      status: "Đang làm"
    },
    {
      id: 2,
      name: "Trần Văn B",
      avatar: "",
      skills: ["Spa", "Facial"],
      status: "Đang chờ"
    },
    {
      id: 3,
      name: "Lê Thị C",
      avatar: "",
      skills: ["Makeup"],
      status: "Không có khách"
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-100 to-pink-50 p-6">
      {!token ? (
        <div className="flex flex-col items-center justify-center text-center p-8 bg-white/70 backdrop-blur-2xl rounded-2xl shadow-lg hover:shadow-2xl transition-all w-full max-w-md mx-auto">
          <h2 className="text-2xl font-bold text-pink-500 mb-4">Chào mừng đến Salon!</h2>
          <p className="text-gray-600 mb-6">Bạn chưa đăng nhập. Đặt lịch hẹn nhanh chóng ngay bây giờ 💅.</p>
          <Link
            href="/book-appointment"
            className="inline-block bg-gradient-to-r from-pink-400 to-purple-400 text-white font-semibold px-8 py-3 rounded-full shadow hover:from-pink-500 hover:to-purple-500 transition-all"
          >
            Đặt hẹn ngay
          </Link>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto">
          {/* Swipe Dashboard */}
          <div className="mb-8">
            <SwipeDashboard portfolio={[]} />
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Link href="/appointments" className="bg-white/70 backdrop-blur-lg rounded-2xl p-4 shadow-lg hover:shadow-xl transition-all flex flex-col items-center text-center">
              <FaCalendarAlt className="text-4xl text-pink-400 mb-2" />
              <h3 className="text-lg font-semibold text-pink-500">Quản lý lịch hẹn</h3>
              <p className="text-sm text-gray-500 mt-1">Xem & quản lý tất cả lịch hẹn.</p>
            </Link>
            <Link href="/book-appointment" className="bg-white/70 backdrop-blur-lg rounded-2xl p-4 shadow-lg hover:shadow-xl transition-all flex flex-col items-center text-center">
              <FaUser className="text-4xl text-pink-400 mb-2" />
              <h3 className="text-lg font-semibold text-pink-500">Đặt hẹn mới</h3>
              <p className="text-sm text-gray-500 mt-1">Tạo lịch hẹn mới cho khách hàng.</p>
            </Link>
            <Link href="/staff" className="bg-white/70 backdrop-blur-lg rounded-2xl p-4 shadow-lg hover:shadow-xl transition-all flex flex-col items-center text-center">
              <FaWrench className="text-4xl text-pink-400 mb-2" />
              <h3 className="text-lg font-semibold text-pink-500">Quản lý nhân viên</h3>
              <p className="text-sm text-gray-500 mt-1">Xem và quản lý danh sách nhân viên.</p>
            </Link>
          </div>

          {/* Staff list */}
          <h2 className="text-2xl font-bold text-pink-500 mb-4 flex items-center gap-2">
            👥 Danh sách nhân viên
          </h2>
          {loading ? (
            <p className="text-gray-500">Đang tải dữ liệu nhân viên...</p>
          ) : staffList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {staffList.map((staff) => {
                const skills = Array.isArray(staff.skills)
                  ? staff.skills
                  : JSON.parse(staff.skills || '[]');
                return (
                  <div key={staff.staff_id} className="bg-white rounded-2xl p-4 shadow flex flex-col items-center text-center">
                    <img
                      src={'/default-avatar.png'}
                      alt={staff.full_name}
                      className="w-24 h-24 rounded-full mb-3 object-cover border border-gray-300"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/default-avatar.png';
                      }}
                    />
                    <h4 className="text-lg font-semibold text-pink-500">{staff.full_name}</h4>
                    <p className="text-sm text-gray-500 mb-1">{staff.position || 'Nhân viên'}</p>
                    <p className="text-sm text-gray-500 mb-1">
                      {staff.gender} - {staff.is_freelancer ? 'Freelancer' : 'Nội bộ'}
                    </p>
                    <p className="text-sm text-gray-500 mb-1">Kỹ năng: {skills.join(', ')}</p>
                    <p className="text-sm text-gray-500 mb-1">Kinh nghiệm: {staff.experience_years} năm</p>
                    <p className="text-sm text-yellow-500 mb-1">
                      ⭐ {staff.rating ? Number(staff.rating).toFixed(1) : 'N/A'}
                    </p>

                    <p className="text-xs italic text-gray-400 mt-2">{staff.bio || 'Chưa có mô tả.'}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500">Chưa có nhân viên nào.</p>
          )}
        </div>
      )}
    </div>
  );
}
