// pages/staff/index.js
import { useState, useEffect } from 'react';
import Link from 'next/link';
import axios from 'axios';

export default function StaffList() {
  const [staffList, setStaffList] = useState([]);
  const [salonId, setSalonId] = useState('');
  const [skill, setSkill] = useState('');
  const [minRating, setMinRating] = useState('');

  const fetchStaff = async () => {
    try {
      const params = {};
      if (salonId) params.salon_id = salonId;
      if (skill) params.skill = skill;
      if (minRating) params.min_rating = minRating;

      const res = await axios.get('/api/staff', {
        headers: { Authorization: `Bearer ${localStorage.getItem('salon_token')}` },
        params
      });
      setStaffList(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchStaff(); }, []);

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold text-purple-600 mb-4">Danh sách nhân viên</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          placeholder="Salon ID"
          value={salonId}
          onChange={e => setSalonId(e.target.value)}
          className="border border-gray-300 p-2 rounded w-40"
        />
        <input
          placeholder="Kỹ năng"
          value={skill}
          onChange={e => setSkill(e.target.value)}
          className="border border-gray-300 p-2 rounded w-40"
        />
        <input
          placeholder="Rating tối thiểu"
          value={minRating}
          onChange={e => setMinRating(e.target.value)}
          className="border border-gray-300 p-2 rounded w-40"
        />
        <button
          onClick={fetchStaff}
          className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded shadow"
        >
          Tìm kiếm
        </button>
      </div>
      <div className="grid gap-4">
        {staffList.map(staff => (
          <div key={staff.staff_id} className="border border-gray-200 p-4 rounded-xl shadow bg-white/80 backdrop-blur-md">
            <h3 className="text-lg font-bold text-purple-600">{staff.full_name}</h3>
            <p className="text-gray-700">Vị trí: {staff.position || 'Chưa cập nhật'}</p>
            <p className="text-gray-700">Kỹ năng: {JSON.stringify(staff.skills) || 'Chưa có'}</p>
            <p className="text-gray-700">Rating: {staff.rating || 'N/A'}</p>
            <Link href={`/staff/${staff.staff_id}`}>
              <span className="text-purple-500 hover:underline inline-block mt-2">Xem chi tiết</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
