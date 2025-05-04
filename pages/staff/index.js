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
      <h2 className="text-2xl mb-4">Danh sách nhân viên</h2>
      <div className="mb-4">
        <input placeholder="Salon ID" value={salonId} onChange={e => setSalonId(e.target.value)} className="border p-2 mr-2" />
        <input placeholder="Kỹ năng" value={skill} onChange={e => setSkill(e.target.value)} className="border p-2 mr-2" />
        <input placeholder="Rating tối thiểu" value={minRating} onChange={e => setMinRating(e.target.value)} className="border p-2 mr-2" />
        <button onClick={fetchStaff} className="bg-blue-500 text-white px-4 py-2 rounded">Tìm kiếm</button>
      </div>
      <div className="grid gap-4">
        {staffList.map(staff => (
          <div key={staff.staff_id} className="border p-4 rounded shadow">
            <h3 className="text-lg font-bold">{staff.full_name}</h3>
            <p>Vị trí: {staff.position}</p>
            <p>Kỹ năng: {JSON.stringify(staff.skills)}</p>
            <p>Rating: {staff.rating}</p>
            <Link href={`/staff/${staff.staff_id}`} className="text-blue-500">
              Xem chi tiết
            </Link>

          </div>
        ))}
      </div>
    </div>
  );
}
