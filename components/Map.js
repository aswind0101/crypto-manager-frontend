// ✅ StylistsRadar.js — Hiển thị stylist theo khoảng cách trên nền ảnh đẹp như game
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function StylistsRadar({ salons }) {
  const [userLocation, setUserLocation] = useState(null);
  const [stylistsWithDistance, setStylistsWithDistance] = useState([]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(coords);
        },
        (err) => console.error("❌ Error getting location:", err),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  useEffect(() => {
    if (!userLocation) return;

    const allStylists = salons.flatMap((salon) =>
      salon.stylists.map((s) => ({
        ...s,
        salon_name: salon.salon_name,
        salon_address: salon.salon_address,
        lat: salon.latitude,
        lng: salon.longitude,
      }))
    );

    const stylistsWithDist = allStylists.map((s) => ({
      ...s,
      distance: getDistanceInKm(userLocation.lat, userLocation.lng, s.lat, s.lng),
    }));

    const sorted = stylistsWithDist.sort((a, b) => a.distance - b.distance);
    setStylistsWithDistance(sorted);
  }, [userLocation, salons]);

  const getDistanceInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  return (
    <div
      className="relative w-full h-[600px] rounded-2xl overflow-hidden"
      style={{
        backgroundImage: `url('/background-radar.jpg')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {userLocation && (
        <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
          <div className="w-16 h-16 rounded-full bg-blue-500 border-4 border-white shadow-lg flex items-center justify-center text-white font-bold">
            YOU
          </div>
        </div>
      )}

      {stylistsWithDistance.map((stylist, idx) => {
        const angle = (idx / stylistsWithDistance.length) * 2 * Math.PI;
        const radius = Math.min(250, stylist.distance * 20); // km * scale (tối đa 250px)
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);

        return (
          <motion.div
            key={stylist.id}
            className="absolute z-10"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.05 }}
            style={{
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="relative group">
              <img
                src={stylist.avatar_url?.startsWith("http")
                  ? stylist.avatar_url
                  : `https://crypto-manager-backend.onrender.com${stylist.avatar_url}`}
                alt={stylist.name}
                className="w-16 h-16 rounded-full border-2 border-pink-400 shadow-lg hover:scale-110 transition duration-300"
              />
              <div className="absolute left-1/2 -translate-x-1/2 mt-2 text-center text-white text-xs bg-black/60 px-2 py-1 rounded-lg hidden group-hover:block">
                {stylist.name} <br /> {stylist.distance.toFixed(1)} km
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
