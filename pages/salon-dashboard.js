import withSalonAuth from "../hoc/withAuthProtection";
import { FaHome } from "react-icons/fa";

function SalonDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-100 p-6">
      <div className="max-w-4xl mx-auto bg-white/80 backdrop-blur-md rounded-2xl shadow-lg p-8">
        <h2 className="text-3xl font-bold text-center text-purple-600 flex items-center justify-center gap-2 mb-4">
          <FaHome /> Salon Dashboard
        </h2>
        <p className="text-center text-gray-700 text-lg">
          Chào mừng bạn đến trang quản lý Salon! 🎉<br />
          Hãy chọn menu bên trên để bắt đầu quản lý lịch hẹn, nhân viên, và nhiều hơn nữa.
        </p>
      </div>
    </div>
  );
}

export default withSalonAuth(SalonDashboard);
