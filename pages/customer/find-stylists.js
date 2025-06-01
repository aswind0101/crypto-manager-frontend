import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import { getDistanceInKm } from "../../components/utils/distance"; // bạn sẽ tạo helper này ở bước sau.
import { useRouter } from "next/router";
import Head from "next/head";
import { FaMale, FaFemale, FaGenderless } from "react-icons/fa";
import { getAuth } from "firebase/auth";
const auth = getAuth(); // hoặc lấy từ firebase.js nếu đã export sẵn
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
dayjs.extend(timezone);


export default function FindStylists() {
  const [stylists, setStylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState(null);
  const [flippedId, setFlippedId] = useState(null);
  const [geoError, setGeoError] = useState(false);
  const [hasAskedLocation, setHasAskedLocation] = useState(false);
  const [user, setUser] = useState(null);
  const router = useRouter();
  const [aboutExpanded, setAboutExpanded] = useState({});

  const [timeSlots, setTimeSlots] = useState([]);
  const [selectedTime, setSelectedTime] = useState(""); // HH:mm


  const [form, setForm] = useState({
    service_ids: [],
    appointment_date: "",
    duration_minutes: "",
    note: "",
  });
  const [filter, setFilter] = useState({
    specialization: "",
    gender: "",
    rating: "",
    price: "",
    duration: "",
    distance: "", // mới thêm
  });

  const [availableServices, setAvailableServices] = useState([]);
  const [submitting, setSubmitting] = useState(false);


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
    if (
      form.service_ids.length === 0 ||
      !form.appointment_date ||
      !selectedTime
    ) {
      alert("Please select service, date and time.");
      return;
    }

    try {
      setSubmitting(true);

      const user = auth.currentUser;
      if (!user) {
        alert("❌ Please login first.");
        return;
      }



      const localTime = dayjs.tz(
        `${form.appointment_date} ${selectedTime}`,
        "YYYY-MM-DD HH:mm",
        "America/Los_Angeles"
      );

      const appointment_date = localTime.format("YYYY-MM-DD HH:mm:ss");
      console.log("📦 Đặt lịch lúc (giờ địa phương):", appointment_date);


      const token = await user.getIdToken();
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
          appointment_date,
          duration_minutes: parseInt(form.duration_minutes || "60"),
          note: form.note,
        }),
      });

      const data = await res.json();
      if (res.status === 409) {
        alert("❌ This time slot has just been taken by another customer. Please choose another.");
        return;
      }

      if (res.ok) {
        alert("✅ Appointment booked successfully!");

        // ✅ Đợi 1 giây rồi chuyển sang trang customer/me
        setTimeout(() => {
          router.push("/customer/me");
        }, 1000);

        return; // ✅ Không cần reset form nếu đã chuyển trang
      } else {
        alert("❌ " + (data.error || "Booking failed."));
      }
    } catch (err) {
      alert("❌ Network error");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleServiceChange = (e, stylist) => {
    const selected = [...e.target.selectedOptions].map((opt) => parseInt(opt.value));
    const selectedServices = stylist.services.filter((srv) => selected.includes(srv.id));

    const totalDuration = selectedServices.reduce(
      (sum, srv) => sum + (srv.duration_minutes || 30),
      0
    );

    setForm((prev) => ({
      ...prev,
      service_ids: selected,
      duration_minutes: totalDuration,
    }));

    // ✅ Gọi trực tiếp với giá trị mới — KHÔNG dùng form.duration_minutes
    if (form.appointment_date) {
      fetchAvailabilityWithDuration(stylist.id, form.appointment_date, totalDuration);
    }
  };
  const fetchAvailabilityWithDuration = async (stylist_id, dateStr, duration) => {
    try {
      const res = await fetch(
        `https://crypto-manager-backend.onrender.com/api/appointments/availability?stylist_id=${stylist_id}&date=${dateStr}`
      );
      const data = await res.json();

      if (res.ok) {
        console.log("🧾 Appointments:", data);
        console.log("⏱️ Realtime duration passed in:", duration);

        const slots = getAvailableTimeSlots(data, dateStr, 30, "09:00", "23:30", duration);
        setTimeSlots(slots);
      } else {
        console.warn("⚠️ Failed to fetch availability:", data.error);
        setTimeSlots([]);
      }
    } catch (err) {
      console.error("❌ Error fetching availability:", err.message);
      setTimeSlots([]);
    }
  };

  const fetchAvailability = async (stylist_id, dateStr) => {
    try {
      const res = await fetch(
        `https://crypto-manager-backend.onrender.com/api/appointments/availability?stylist_id=${stylist_id}&date=${dateStr}`
      );
      const data = await res.json();

      if (res.ok) {
        console.log("🧾 Appointments:", data);
        const totalDuration = parseInt(form.duration_minutes || "30");
        const slots = getAvailableTimeSlots(
          data,
          dateStr,
          30,
          "09:00",
          "23:59",
          totalDuration
        );
        setTimeSlots(slots);
      } else {
        console.warn("⚠️ Failed to fetch availability:", data.error);
        setTimeSlots([]);
      }
    } catch (err) {
      console.error("❌ Error fetching availability:", err.message);
      setTimeSlots([]);
    }
  };


  function getAvailableTimeSlots(
    appointments,
    dateStr,
    interval = 30,
    workStart = "09:00",
    workEnd = "23:59",
    totalDuration = 30
  ) {
    console.log("📦 getAvailableTimeSlots called");
    console.log("🧾 Appointments:", appointments);
    console.log("⏱️ Total Duration:", totalDuration);

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

    // ✅ Nếu là hôm nay, bỏ qua khung giờ đã qua (theo giờ California)
    const now = dayjs().tz("America/Los_Angeles");
    const isToday = now.format("YYYY-MM-DD") === dateStr;
    const currentMinutes = now.hour() * 60 + now.minute();

    for (let m = workStartMin; m + totalDuration <= workEndMin; m += interval) {
      if (isToday && m < currentMinutes) continue; // ❌ Bỏ qua giờ đã trôi qua hôm nay
      slots.push({
        time: formatTime(m),
        startMin: m,
        endMin: m + totalDuration,
      });
    }

    console.log("🕒 All generated slots:", slots);

    const bookedRanges = appointments
      .map((appt) => {
        if (!appt || !appt.appointment_date || !appt.duration_minutes) return null;
        const [_, timePart] = appt.appointment_date.split("T");
        if (!timePart) return null;

        const [hourStr, minStr] = timePart.split(":");
        const start = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);
        const duration = parseInt(appt.duration_minutes, 10);
        const end = start + duration;

        return { start, end };
      })
      .filter(Boolean);

    console.log("📌 Booked Ranges:", bookedRanges);

    const filtered = slots.filter((slot) => {
      const hasConflict = bookedRanges.some((br) => {
        const conflict = !(slot.endMin <= br.start || slot.startMin >= br.end);
        if (conflict) {
          console.log(
            `❌ Blocked slot ${slot.time} (${slot.startMin}–${slot.endMin}) because overlaps with booking ${br.start}–${br.end}`
          );
        }
        return conflict;
      });

      return !hasConflict;
    });

    console.log("✅ Final Available Slots:", filtered.map((s) => s.time));

    return filtered;
  }

  const filteredStylists = stylists
    .filter((s) => {
      if (filter.specialization && !s.specialization.includes(filter.specialization)) return false;
      if (filter.gender && s.gender !== filter.gender) return false;
      if (filter.rating && parseFloat(s.rating || 0) < parseFloat(filter.rating)) return false;

      if (filter.price) {
        const hasMatchingService = s.services?.some((srv) => {
          const price = srv.price;
          if (filter.price === "lt40") return price < 40;
          if (filter.price === "40-60") return price >= 40 && price <= 60;
          if (filter.price === "gt60") return price > 60;
          return false;
        });

        if (!hasMatchingService) return false;
      }

      const avgDuration = s.services?.reduce((acc, srv) => acc + srv.duration_minutes, 0) / (s.services?.length || 1);
      if (filter.duration === "lt30" && avgDuration >= 30) return false;
      if (filter.duration === "30-60" && (avgDuration < 30 || avgDuration > 60)) return false;
      if (filter.duration === "gt60" && avgDuration <= 60) return false;

      if (filter.distance) {
        const distanceInMiles = s.distance * 0.621371; // km -> mi
        if (distanceInMiles > parseFloat(filter.distance)) return false;
      }


      return true;
    })
    .sort((a, b) => a.distance - b.distance); // sắp xếp stylist gần nhất lên đầu

  return (
    <div className="min-h-screen text-white font-mono sm:font-['Pacifico', cursive]">
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-10">
        <h1 className="text-2xl sm:text-4xl font-bold text-center mb-8 text-emerald-300 font-mono sm:font-['Pacifico', cursive]">
          ✨ Find Stylists Near You
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
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl mb-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-sm text-yellow-500">

          <select
            className="bg-white/10 p-2 rounded border border-white/20 focus:outline-none"
            onChange={(e) => setFilter({ ...filter, specialization: e.target.value })}
          >
            <option value="">All Specializations</option>
            <option value="nail_tech">Nail Technician</option>
            <option value="hair_stylist">Hair Stylist</option>
            <option value="barber">Barber</option>
            <option value="esthetician">Esthetician</option>
            <option value="lash_tech">Lash Technician</option>
            <option value="massage_therapist">Massage Therapist</option>
            <option value="makeup_artist">Makeup Artist</option>
            <option value="receptionist">Receptionist</option>
          </select>


          <select className="bg-white/10 p-2 rounded border border-white/20 focus:outline-none"
            onChange={(e) => setFilter({ ...filter, gender: e.target.value })}>
            <option value="">Any Gender</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
          </select>

          <select className="bg-white/10 p-2 rounded border border-white/20 focus:outline-none"
            onChange={(e) => setFilter({ ...filter, rating: e.target.value })}>
            <option value="">Any Rating</option>
            <option value="4">4★+</option>
            <option value="4.5">4.5★+</option>
            <option value="5">5★ Only</option>
          </select>

          <select className="bg-white/10 p-2 rounded border border-white/20 focus:outline-none"
            onChange={(e) => setFilter({ ...filter, price: e.target.value })}>
            <option value="">Any Price</option>
            <option value="lt40">Under $40</option>
            <option value="40-60">$40 - $60</option>
            <option value="gt60">Above $60</option>
          </select>

          <select className="bg-white/10 p-2 rounded border border-white/20 focus:outline-none"
            onChange={(e) => setFilter({ ...filter, duration: e.target.value })}>
            <option value="">Any Duration</option>
            <option value="lt30">Under 30 min</option>
            <option value="30-60">30 - 60 min</option>
            <option value="gt60">Above 60 min</option>
          </select>

          <select
            className="bg-white/10 p-2 rounded border border-white/20 focus:outline-none "
            onChange={(e) => setFilter({ ...filter, distance: e.target.value })}
          >
            <option value="">Any Distance</option>
            <option value="2">Within 2 mi</option>
            <option value="5">Within 5 mi</option>
            <option value="10">Within 10 mi</option>
            <option value="15">Within 15 mi</option>
          </select>

        </div>
        {loading ? (
          <p className="text-center">⏳ Loading stylists...</p>
        ) : stylists.length === 0 ? (
          <p className="text-center text-gray-400">📍 No stylist online nearby.</p>
        ) : filteredStylists.length === 0 ? (
          <p className="text-center text-yellow-300 mt-6 text-sm">🔍 No stylist matches your filters. Please adjust your selection.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStylists.map((s) => (
              <div key={s.id} className="relative w-full min-h-[620px] sm:min-h-[620px] h-auto perspective-[1500px]">
                <div className={`transition-transform duration-700 w-full h-full transform-style-preserve-3d ${flippedId === s.id ? "rotate-y-180" : ""}`}>
                  {/* Mặt trước */}
                  <div className="absolute w-full min-h-[620px] max-h-[620px] bg-white/10 rounded-2xl backface-hidden backdrop-blur-md border-b-8 border-t-8 border-pink-500 p-4 shadow-xl flex flex-col justify-between text-center glass-box">
                    {/* ⭐ Rating */}
                    <div className="absolute top-3 right-3 flex gap-[1px]">
                      {[...Array(5)].map((_, i) => (
                        <svg key={i} viewBox="0 0 20 20" fill={i < Math.round(s.rating) ? "#facc15" : "#d1d5db"} className="w-4 h-4">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.974a1 1 0 00.95.69h4.184c.969 0 1.371 1.24.588 1.81l-3.39 2.46a1 1 0 00-.364 1.118l1.286 3.974c.3.921-.755 1.688-1.538 1.118l-3.39-2.46a1 1 0 00-1.176 0l-3.39 2.46c-.783.57-1.838-.197-1.539-1.118l1.287-3.974a1 1 0 00-.364-1.118L2.04 9.401c-.783-.57-.38-1.81.588-1.81h4.183a1 1 0 00.951-.69l1.287-3.974z" />
                        </svg>
                      ))}
                    </div>
                    <div className="flex flex-col items-center gap-1 mt-2 mb-2">
                      {/* Avatar */}
                      <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full p-[3px] bg-gradient-to-r from-pink-400 via-yellow-300 to-emerald-400 shadow-xl">
                        <img
                          src={s.avatar_url}
                          alt={s.name}
                          onError={(e) => { e.currentTarget.src = "/default-avatar.png"; }}
                          className="w-full h-full object-cover rounded-full border-4 border-white shadow-inner"
                        />

                        {/* 🌿 Icon trang trí – nằm đè góc trái */}
                        <div className="absolute -top-3 -left-10 text-white rounded-full p-[6px] text-3xl rotate-[-10deg]">
                          🌸
                        </div>
                        <div className="absolute top-9 -right-12 text-white rounded-full p-[4px] text-3xl  rotate-12">
                          ✨
                        </div>
                        <div className="absolute top-22 -left-8 text-white rounded-full p-[6px] text-3xl rotate-[-10deg]">
                          🌸
                        </div>
                        <div className="absolute top-43 -right-12 text-white rounded-full p-[6px] text-3xl rotate-[-10deg]">
                          🌟
                        </div>
                        <div className="absolute top-110 -left-12 text-white rounded-full p-[6px] text-3xl rotate-[-10deg]">
                          🌸
                        </div>
                        <div className="absolute top-124 -right-24 text-white rounded-full p-[4px] text-3xl  rotate-12">
                          ✨
                        </div>
                      </div>


                      {/* Info */}
                      <h2 className="text-xl font-semibold text-pink-400 mt-2 mb-1 flex items-center justify-center gap-2">
                        {s.name}
                        {s.gender === "Female" && (
                          <FaFemale title="Female" className="text-pink-400 text-lg" />
                        )}
                        {s.gender === "Male" && (
                          <FaMale title="Male" className="text-blue-400 text-lg" />
                        )}
                        {s.gender && !["Male", "Female"].includes(s.gender) && (
                          <FaGenderless title="Other / Non-binary" className="text-purple-400 text-sm" />
                        )}
                      </h2>

                      <p className="text-xs bg-pink-600/40 text-white px-3 py-[2px] rounded-full inline-block">
                        {Array.isArray(s.specialization) ? s.specialization.map(formatSpecialization).join(", ") : formatSpecialization(s.specialization)}
                      </p>
                    </div>
                    <div className="text-sm mt-3 text-white/80 space-y-1">
                      <p className="text-yellow-300 font-semibold">{s.salon_name}</p>
                      <p>{s.salon_address}</p>
                      <p className="text-emerald-300">📍 {(s.distance * 0.621371).toFixed(2)} mi away</p>
                    </div>
                    {/* About section nếu có */}
                    {s.description && (
                      <div className="mt-3 text-sm text-white/80 italic px-3">
                        {aboutExpanded[s.id] ? (
                          <>
                            <div
                              id={`about-scroll-${s.id}`}
                              className="max-h-[100px] overflow-y-auto pr-1 rounded-md scroll-touch scrollbar-thin scrollbar-thumb-white/40 scrollbar-track-white/10 scrollbar-hide"
                              style={{
                                WebkitOverflowScrolling: "touch",
                                touchAction: "manipulation",
                                overscrollBehavior: "contain",
                              }}
                            >
                              <p className="whitespace-pre-line reveal-anim">{s.description}</p>
                            </div>
                            <button
                              onClick={() => {
                                setAboutExpanded({ ...aboutExpanded, [s.id]: false });

                                const el = document.getElementById(`about-scroll-${s.id}`);
                                if (el && el.dataset.rafId) {
                                  cancelAnimationFrame(parseInt(el.dataset.rafId));
                                  delete el.dataset.rafId;
                                }
                              }}

                              className="mt-1 text-emerald-300 underline text-[11px]"
                            >
                              Show less
                            </button>
                          </>
                        ) : (
                          <>
                            “{s.description.slice(0, 140)}...”
                            <button
                              onClick={() => {
                                setAboutExpanded({ ...aboutExpanded, [s.id]: true });

                                setTimeout(() => {
                                  const el = document.getElementById(`about-scroll-${s.id}`);
                                  if (!el) return;

                                  let scrollPos = el.scrollTop;
                                  const scrollSpeed = 0.13;

                                  const step = () => {
                                    scrollPos += scrollSpeed;
                                    el.scrollTop = scrollPos;

                                    // Nếu chạm đáy, cuộn lại đầu
                                    if (el.scrollTop + el.clientHeight >= el.scrollHeight) {
                                      scrollPos = 0;
                                    }

                                    const rafId = requestAnimationFrame(step);
                                    el.dataset.rafId = rafId; // lưu để dừng khi cần
                                  };

                                  step(); // bắt đầu cuộn
                                }, 100);
                              }}
                              className="ml-2 text-yellow-300 underline text-[11px]"
                            >
                              Show more
                            </button>
                          </>
                        )}
                      </div>

                    )}
                    <div className="mt-4 pt-4 border-t border-white/20">
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleBookClick(s.id)}
                          className="mt-2 mb-2 bg-gradient-to-r from-pink-500 via-pink-500 to-rose-400 hover:brightness-110 text-white font-bold px-6 py-2
      rounded-3xl shadow-md hover:shadow-pink-500/40 transition-transform duration-200 transform hover:scale-105 
      flex items-center justify-center gap-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                          Book Appointment
                        </button>
                      </div>
                    </div>

                  </div>

                  {/* Mặt sau */}
                  <div className="absolute w-full min-h-full h-auto bg-white/10 rounded-2xl backface-hidden rotate-y-180 border-b-8 border-t-8 border-pink-500 p-4 shadow-md flex flex-col justify-center text-center">
                    <h3 className="text-lg font-bold text-yellow-300 mb-3">
                      ✨ Book Your Appointment
                    </h3>

                    <div className="text-left space-y-3 text-sm px-2 sm:px-3">

                      {/* Step 1: Chọn dịch vụ */}
                      <div>
                        <p className="text-pink-400 font-bold mb-2 underline underline-offset-4 decoration-[1.5px] decoration-pink-400">
                          Step 1: Select Services
                        </p>

                        {/* Scrollable list of services */}
                        <div className="max-h-26 overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-pink-500 scrollbar-track-zinc-700 rounded-md">
                          {s.services?.length === 0 ? (
                            <div className="text-sm text-red-400 italic px-2 py-2 bg-white/5 rounded-lg">
                              ❌ This stylist has not selected any services yet.
                            </div>
                          ) : (
                            s.services.map((srv) => {
                              const isSelected = form.service_ids.includes(srv.id);
                              return (
                                <label
                                  key={srv.id}
                                  className={`flex items-center justify-between px-4 py-1 rounded-lg border-b cursor-pointer text-xs transition-all ${isSelected
                                    ? "text-white border-pink-400"
                                    : "text-pink-100 border-pink-300 hover:bg-white/5"
                                    }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        const selected = isSelected
                                          ? form.service_ids.filter((id) => id !== srv.id)
                                          : [...form.service_ids, srv.id];

                                        const selectedServices = s.services.filter((s) =>
                                          selected.includes(s.id)
                                        );
                                        const totalDuration = selectedServices.reduce(
                                          (sum, s) => sum + (s.duration_minutes || 30),
                                          0
                                        );

                                        setForm({
                                          ...form,
                                          service_ids: selected,
                                          duration_minutes: totalDuration,
                                        });

                                        if (form.appointment_date) {
                                          fetchAvailabilityWithDuration(s.id, form.appointment_date, totalDuration);
                                        }
                                      }}
                                      className="form-checkbox mt-1 h-4 w-4 text-emerald-500 accent-emerald-600"
                                    />
                                    <div className="text-left">
                                      <span className="block capitalize">{srv.name}</span>
                                      <span className="block text-xs text-yellow-500">${srv.price}</span>
                                    </div>
                                  </div>
                                </label>
                              );
                            })
                          )}
                        </div>


                        {/* Estimated duration */}
                        {form.duration_minutes > 0 && (
                          <p className="text-xs text-emerald-300 mt-2">
                            ⏱ Estimated total time: {form.duration_minutes} minutes
                          </p>
                        )}
                      </div>

                      {/* Step 2: Chọn ngày */}
                      <div>
                        <p className="text-pink-400 font-bold mb-2 underline underline-offset-4 decoration-[1.5px] decoration-pink-400 ">Step 2: Pick a Date</p>
                        <input
                          type="date"
                          value={form.appointment_date}
                          onChange={(e) => {
                            const dateOnly = e.target.value;
                            setForm({ ...form, appointment_date: dateOnly });
                            setSelectedTime("");
                            if (dateOnly) fetchAvailability(s.id, dateOnly);
                          }}
                          className="block w-full max-w-full bg-white/5 rounded-xl text-yellow-400
  px-3 py-1 h-[28px] leading-tight appearance-none border border-white/20 
  focus:outline-none focus:ring-2 focus:ring-pink-300 
  transition-all appearance-none box-border"

                        />
                      </div>
                      {/* Step 3: Choose Time */}
                      <div className="mt-4">
                        <p className="text-pink-400 font-bold mb-2 underline underline-offset-4 decoration-[1.5px] decoration-pink-400">
                          Step 3: Choose Time
                        </p>

                        {!form.appointment_date ? (
                          <select
                            disabled
                            className="block w-full bg-white/10 rounded-xl text-yellow-400 
                          px-3 py-1 h-[28px] leading-tight appearance-none border border-white/10 appearance-none cursor-not-allowed"
                          >
                            <option>Select a date first</option>
                          </select>
                        ) : timeSlots.length > 0 ? (
                          <select
                            value={selectedTime}
                            onChange={(e) => setSelectedTime(e.target.value)}
                            className="block w-full max-w-full bg-white/5 rounded-xl text-yellow-400
  px-3 py-1 h-[28px] leading-tight appearance-none border border-white/20 
  focus:outline-none focus:ring-2 focus:ring-pink-300 
  transition-all appearance-none box-border"
                          >
                            <option value="">Select time...</option>
                            {timeSlots.map((slot) => (
                              <option key={slot.time} value={slot.time}>
                                🕒 {slot.time}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-yellow-300 text-xs italic">
                            ⚠️ No available time slots for this date & duration.
                          </p>
                        )}
                      </div>

                      {/* Step 4: Ghi chú */}
                      <div>
                        <p className="text-pink-400 font-bold mb-2 underline underline-offset-4 decoration-[1.5px] decoration-pink-400">Step 4: Optional Notes</p>
                        <textarea
                          value={form.note}
                          onChange={(e) => setForm({ ...form, note: e.target.value })}
                          className="w-full rounded p-1 text-pink-100 text-xs focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
                          placeholder="Anything specific?"
                        />
                      </div>

                      {/* Thông tin đặt */}
                      {form.appointment_date && selectedTime && (
                        <div className="mt-3 px-2 py-2 rounded-lg text-pink-200 text-sm font-semibold text-center whitespace-nowrap overflow-x-auto">
                          📌 You selected:
                          <span className="ml-1 text-yellow-300 font-bold">{form.appointment_date}</span>
                          <span className="mx-1">at</span>
                          <span className="text-yellow-300 font-bold">{selectedTime}</span>
                        </div>
                      )}

                    </div>

                    {/* Gửi lịch hẹn */}
                    <button
                      disabled={submitting}
                      onClick={() => handleSubmitBooking(s)}
                      className="mt-4 w-full bg-yellow-600 hover:bg-yellow-500 text-white font-semibold py-2 rounded-3xl shadow-lg transition-all"
                    >
                      {submitting ? "⏳ Booking..." : "✅ Confirm Booking"}
                    </button>

                    {/* Quay lại */}
                    <button
                      onClick={() => setFlippedId(null)}
                      className="mt-4 bg-pink-500 hover:bg-pink-400 text-white font-semibold py-2 rounded-3xl px-4 shadow-lg transition-all"
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
