import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import { getDistanceInKm } from "../../components/utils/distance"; // bạn sẽ tạo helper này ở bước sau.
import { useRouter } from "next/router";
import Head from "next/head";
import { getAuth } from "firebase/auth";
const auth = getAuth(); // hoặc lấy từ firebase.js nếu đã export sẵn


export default function FindStylists() {
  const [stylists, setStylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState(null);
  const [flippedId, setFlippedId] = useState(null);
  const [geoError, setGeoError] = useState(false);
  const [hasAskedLocation, setHasAskedLocation] = useState(false);
  const [user, setUser] = useState(null);
  const router = useRouter();

  const [form, setForm] = useState({
    service_ids: [],
    appointment_date: "",
    dateOnly: "",
    duration_minutes: "",
    note: "",
  });

  const [availableServices, setAvailableServices] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);


  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  useEffect(() => {
    if (hasAskedLocation) return;

    setHasAskedLocation(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn("❌ Location denied:", err);
        setGeoError(true);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [hasAskedLocation]);

  useEffect(() => {
    if (!userLocation) return;

    const fetchStylists = async () => {
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/stylists/online");
      const data = await res.json();

      const flat = data.flatMap((salon) =>
        salon.stylists.map((s) => ({
          ...s,
          salon_name: salon.salon_name,
          salon_address: salon.salon_address,
          lat: salon.latitude,
          lng: salon.longitude,
          services: s.services || [] // 👈 QUAN TRỌNG!
        }))
      );


      flat.forEach((s) => {
        s.distance = getDistanceInKm(userLocation.lat, userLocation.lng, s.lat, s.lng);
      });

      flat.sort((a, b) => a.distance - b.distance);
      setStylists(flat);
      console.log("✅ Stylists with services:", flat);

      setLoading(false);
    };

    fetchStylists();
    const interval = setInterval(fetchStylists, 10000); // gọi lại mỗi 10s

    return () => clearInterval(interval); // dọn dẹp khi unmount
  }, [userLocation]);

  const formatSpecialization = (code) => {
    const map = {
      nail_tech: "Nail Technician",
      hair_stylist: "Hair Stylist",
      barber: "Barber",
      esthetician: "Esthetician",
      lash_tech: "Lash Technician",
      massage_therapist: "Massage Therapist",
      makeup_artist: "Makeup Artist",
      receptionist: "Receptionist",
    };
    return map[code] || code;
  };

  const handleBookClick = (stylistId) => {
    if (!user) {
      localStorage.setItem("from_booking", "true");
      router.push("/login");
    } else {
      setFlippedId(stylistId);
    }
  };
  const handleSubmitBooking = async (stylist) => {
    if (form.service_ids.length === 0 || !form.appointment_date) {
      alert("Please select service and date.");
      return;
    }

    try {
      setSubmitting(true);

      const user = auth.currentUser;
      if (!user) {
        alert("❌ Please login first.");
        return;
      }

      const token = await user.getIdToken(); // ✅ chính xác
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/appointments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stylist_id: stylist.id,
          salon_id: stylist.salon_id,
          service_ids: form.service_ids,
          appointment_date: form.appointment_date,
          duration_minutes: parseInt(form.duration_minutes || "60"),
          note: form.note,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        alert("✅ Appointment booked successfully!");
        setFlippedId(null);
        setForm({ service_ids: [], appointment_date: "", duration_minutes: "", note: "" });
      } else {
        alert("❌ " + (data.error || "Booking failed."));
      }
    } catch (err) {
      alert("❌ Network error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleServiceChange = (e, stylist) => {
    const selected = [...e.target.selectedOptions].map((opt) => parseInt(opt.value));
    const selectedServices = stylist.services.filter((srv) => selected.includes(srv.id));

    const totalDuration = selectedServices.reduce(
      (sum, srv) => sum + (srv.duration_minutes || 30), // fallback 30 nếu không có duration
      0
    );

    setForm({
      ...form,
      service_ids: selected,
      duration_minutes: totalDuration,
    });
  };
  const fetchAvailableSlots = async (stylistId, selectedDate) => {
    try {
      const res = await fetch(
        `https://crypto-manager-backend.onrender.com/api/appointments/availability?stylist_id=${stylistId}&date=${selectedDate}`
      );
      const data = await res.json();
      const slots = getAvailableTimeSlots(data, selectedDate); // dùng hàm đã tạo ở bước 2
      setAvailableSlots(slots);
    } catch (err) {
      console.error("❌ Error loading slots:", err.message);
      setAvailableSlots([]);
    }
  };


  function getAvailableTimeSlots(appointments, dateStr, interval = 30, workStart = "09:00", workEnd = "18:00") {
    const slots = [];

    const toMinutes = (time) => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };

    const formatTime = (mins) => {
      const h = String(Math.floor(mins / 60)).padStart(2, "0");
      const m = String(mins % 60).padStart(2, "0");
      return `${h}:${m}`;
    };

    const workStartMin = toMinutes(workStart);
    const workEndMin = toMinutes(workEnd);

    // 📅 Tạo danh sách các slot
    for (let m = workStartMin; m + interval <= workEndMin; m += interval) {
      slots.push({
        time: formatTime(m),
        startMin: m,
        endMin: m + interval,
        isBooked: false,
      });
    }

    // ❌ Check và đánh dấu slot bị chiếm
    for (const appt of appointments) {
      const apptDate = new Date(appt.appointment_date);
      const startMin = apptDate.getHours() * 60 + apptDate.getMinutes();
      const endMin = startMin + appt.duration_minutes;

      for (const slot of slots) {
        if (
          !(slot.endMin <= startMin || slot.startMin >= endMin)
        ) {
          slot.isBooked = true;
        }
      }
    }

    return slots;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-pink-800 to-yellow-800 text-white font-mono sm:font-['Pacifico', cursive]">
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-8 text-emerald-300 font-mono sm:font-['Pacifico', cursive]">
          ✨ Available Stylists Near You
        </h1>

        {geoError && (
          <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-4 rounded-lg shadow-sm text-sm text-center max-w-xl mx-auto mb-6">
            <p className="font-semibold mb-2">📍 Location Access Required</p>
            <p className="mb-2">
              We couldn’t access your current location. Please enable location services to see nearby stylists.
            </p>
            <div className="text-left text-xs bg-white/60 text-gray-700 p-3 rounded-md mt-2">
              <p className="font-bold mb-1">📱 On Mobile:</p>
              <ul className="list-disc list-inside mb-2">
                <li><strong>Android:</strong> Go to Settings → Apps → Browser → Permissions → Allow Location</li>
                <li><strong>iOS:</strong> Go to <em>Settings → Privacy & Security → Location Services → Safari (or your browser)</em> → Allow Location Access.</li>
              </ul>
              <p className="font-bold mb-1">💻 On Desktop:</p>
              <p>Click the 🔒 icon near the address bar → Site settings → Location → Allow</p>
            </div>
            <p className="text-[11px] text-gray-500 mt-3">
              After enabling, please refresh this page.
            </p>
          </div>
        )}

        {loading ? (
          <p className="text-center">⏳ Loading stylists...</p>
        ) : stylists.length === 0 ? (
          <p className="text-center text-gray-400">No stylist online nearby.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stylists.map((s) => (
              <div key={s.id} className="relative w-full h-[440px] perspective-[1500px]">
                <div className={`transition-transform duration-700 w-full h-full transform-style-preserve-3d ${flippedId === s.id ? "rotate-y-180" : ""}`}>
                  {/* Mặt trước */}
                  <div className="absolute w-full h-full rounded-3xl backface-hidden bg-white/5 backdrop-blur-md border-b-4 border-t-4 border-pink-500 p-4 shadow-xl flex flex-col items-center justify-between text-center">
                    {/* ⭐ Rating */}
                    <div className="absolute top-3 right-3 flex gap-[1px]">
                      {[...Array(5)].map((_, i) => (
                        <svg key={i} viewBox="0 0 20 20" fill={i < Math.round(s.rating) ? "#facc15" : "#d1d5db"} className="w-4 h-4">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.974a1 1 0 00.95.69h4.184c.969 0 1.371 1.24.588 1.81l-3.39 2.46a1 1 0 00-.364 1.118l1.286 3.974c.3.921-.755 1.688-1.538 1.118l-3.39-2.46a1 1 0 00-1.176 0l-3.39 2.46c-.783.57-1.838-.197-1.539-1.118l1.287-3.974a1 1 0 00-.364-1.118L2.04 9.401c-.783-.57-.38-1.81.588-1.81h4.183a1 1 0 00.951-.69l1.287-3.974z" />
                        </svg>
                      ))}
                    </div>

                    {/* Avatar */}
                    <img
                      src={s.avatar_url?.startsWith("http") ? s.avatar_url : `https://crypto-manager-backend.onrender.com${s.avatar_url}`}
                      onError={(e) => { e.currentTarget.src = "/default-avatar.png"; }}
                      className="w-32 h-32 rounded-full object-cover border-2 border-white shadow mb-3"
                      alt={s.name}
                    />

                    <div className="w-full px-2 space-y-2">
                      <div>
                        <h2 className="text-xl font-bold text-pink-400">{s.name}</h2>
                        <p className="text-sm italic text-pink-200">
                          {Array.isArray(s.specialization) ? s.specialization.map(formatSpecialization).join(", ") : formatSpecialization(s.specialization)}
                        </p>
                      </div>

                      <div className="pt-2">
                        <p className="text-[10px] text-pink-300 uppercase tracking-widest mb-1">--SALON--</p>
                        <p className="text-sm text-yellow-300 font-medium">🏠 {s.salon_name}</p>
                        <p className="text-xs text-gray-300">{s.salon_address}</p>
                        <p className="text-xs text-emerald-300 mt-1">📍 {(s.distance * 0.621371).toFixed(2)} mi away</p>
                      </div>

                    </div>

                    <hr className="w-3/4 border-t border-white/20 my-1" />
                    <button
                      onClick={() => handleBookClick(s.id)}
                      className="mb-4 bg-gradient-to-r from-pink-500 via-yellow-400 to-emerald-400 text-white font-bold px-6 py-2 rounded-full shadow hover:scale-105 transition"
                    >
                      Book Appointment
                    </button>
                  </div>

                  {/* Mặt sau */}
                  <div className="absolute w-full h-full rounded-2xl backface-hidden rotate-y-180 bg-zinc-800/90 border-b-4 border-t-4 border-pink-500 p-4 shadow-md flex flex-col justify-center text-center">
                    <h3 className="text-lg font-bold text-yellow-300 mb-2">📅 Book Appointment</h3>

                    <div className="text-left space-y-2 text-sm">
                      <div>
                        <label>📋 Services:</label>
                        <select
                          multiple
                          value={form.service_ids}
                          onChange={(e) => handleServiceChange(e, s)}
                          className="w-full rounded p-1 text-black"
                        >
                          {s.services?.map((srv) => (
                            <option key={srv.id} value={srv.id}>
                              {srv.name} (${srv.price})
                            </option>
                          ))}
                        </select>

                        {form.duration_minutes > 0 && (
                          <p className="text-xs text-emerald-300 mt-1">
                            ⏱ Estimated total time: {form.duration_minutes} minutes
                          </p>
                        )}
                      </div>


                      <div>
                        <label>🕒 Date & Time:</label>
                        <input
                          type="date"
                          value={form.dateOnly}
                          onChange={(e) => {
                            const selectedDate = e.target.value;
                            setForm({
                              ...form,
                              dateOnly: selectedDate,
                              appointment_date: "", // reset ngày giờ cụ thể
                            });
                            fetchAvailableSlots(s.id, selectedDate); // ✅ gọi API lấy slot rảnh
                          }}
                          className="w-full rounded p-1 text-black"
                        />
                      </div>

                      <div>
                        <label>📝 Notes:</label>
                        <textarea
                          value={form.note}
                          onChange={(e) => setForm({ ...form, note: e.target.value })}
                          className="w-full rounded p-1 text-black"
                        />
                      </div>
                    </div>

                    <button
                      disabled={submitting}
                      onClick={() => handleSubmitBooking(s)}
                      className="mt-4 w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 rounded"
                    >
                      {submitting ? "Booking..." : "✅ Book Now"}
                    </button>

                    <button
                      onClick={() => setFlippedId(null)}
                      className="mt-6 bg-pink-500 text-white px-4 py-2 rounded-full shadow hover:bg-pink-600"
                    >
                      🔙 Go back
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>

  );
}
