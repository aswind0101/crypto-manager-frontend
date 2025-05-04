import withSalonAuth from "../hoc/withAuthProtection";

function SalonDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-r from-pink-50 to-purple-100 p-6">
      <div className="max-w-4xl mx-auto bg-white/90 backdrop-blur-lg rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-purple-700 mb-4">Salon Dashboard</h1>
        <p className="text-gray-700 text-lg mb-6">
          Chào mừng trở lại! Đây là bảng điều khiển của bạn. Bạn có thể quản lý lịch hẹn, nhân viên, và nhiều hơn nữa.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl p-6 shadow hover:shadow-lg transition-all">
            <h3 className="text-xl font-semibold mb-2">Lịch hẹn</h3>
            <p className="text-sm">Xem và quản lý lịch hẹn khách hàng của bạn.</p>
          </div>
          <div className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl p-6 shadow hover:shadow-lg transition-all">
            <h3 className="text-xl font-semibold mb-2">Nhân viên</h3>
            <p className="text-sm">Xem danh sách nhân viên và phân quyền.</p>
          </div>
          <div className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl p-6 shadow hover:shadow-lg transition-all">
            <h3 className="text-xl font-semibold mb-2">Báo cáo</h3>
            <p className="text-sm">Xem báo cáo doanh thu và hiệu suất.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withSalonAuth(SalonDashboard);
