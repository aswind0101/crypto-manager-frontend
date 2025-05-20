import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import { getDistanceInKm } from "../../utils/distance"; // bạn sẽ tạo helper này ở bước sau.

export default function FindStylists() {
  const [stylists, setStylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState(null);
  const [flippedId, setFlippedId] = useState(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn("❌ Could not get location:", err);
        setUserLocation(null);
      }
    );
  }, []);

  useEffect(() => {
    const fetchStylists = async () => {
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/stylists/online");
      const data = await res.json();

      const flatStylists = data.flatMap((salon) =>
        salon.stylists.map((stylist) => ({
          ...stylist,
          salon_name: salon.salon_name,
          salon_address: salon.salon_address,
          lat: salon.latitude,
          lng: salon.longitude,
        }))
      );

      if (userLocation) {
        flatStylists.forEach((s) => {
          s.distance = getDistanceInKm(userLocation.lat, userLocation.lng, s.lat, s.lng);
        });
        flatStylists.sort((a, b) => a.distance - b.distance);
      }

      setStylists(flatStylists);
      setLoading(false);
    };

    if (userLocation !== null) {
      fetchStylists();
    }
  }, [userLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-pink-300 to-yellow-200 dark:from-emerald-900 dark:via-pink-800 dark:to-yellow-800 text-gray-800 dark:text-white">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-extrabold text-center mb-8 text-emerald-800 dark:text-emerald-300">
          ✨ Available Stylists Near You
        </h1>

        {loading ? (
          <p className="text-center">⏳ Loading stylists...</p>
        ) : stylists.length === 0 ? (
          <p className="text-center text-gray-500">No stylist online nearby.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stylists.map((s) => (
              <div
                key={s.id}
                className="relative perspective-[1500px]"
              >
                <div
                  className={`transition-transform duration-700 transform-style-preserve-3d ${
                    flippedId === s.id ? "rotate-y-180" : ""
                  }`}
                >
                  {/* Mặt trước */}
                  <div className="absolute w-full h-full rounded-2xl backface-hidden bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 p-4 shadow-md">
                    <img
                      src={
                        s.avatar_url?.startsWith("http")
                          ? s.avatar_url
                          : `https://crypto-manager-backend.onrender.com${s.avatar_url}`
                      }
                      className="w-24 h-24 rounded-full border-2 border-white mx-auto mb-3"
                      alt={s.name}
                    />
                    <h2 className="text-center font-bold text-lg text-pink-500">{s.name}</h2>
                    <p className="text-center text-sm text-gray-600 dark:text-gray-300 italic">{s.specialization}</p>
                    <p className="text-center text-xs mt-1 text-yellow-400">⭐ {s.rating || "N/A"}</p>
                    <p className="text-center text-xs mt-1">🏠 {s.salon_name}</p>
                    <p className="text-center text-[11px] text-gray-400">{s.salon_address}</p>
                    <p className="text-center text-xs text-emerald-500 mt-1">
                      📍 {s.distance?.toFixed(2) || "?"} km away
                    </p>
                    <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 text-center">
                      ✂️ Available for appointments now!
                    </p>

                    <div className="flex justify-center mt-4">
                      <button
                        onClick={() => setFlippedId(s.id)}
                        className="bg-gradient-to-r from-pink-500 via-yellow-400 to-emerald-400 text-white font-bold px-4 py-2 rounded-full shadow hover:scale-105 transition"
                      >
                        Đặt hẹn
                      </button>
                    </div>
                  </div>

                  {/* Mặt sau */}
                  <div className="absolute w-full h-full rounded-2xl backface-hidden rotate-y-180 bg-white/80 dark:bg-zinc-800/90 border border-white/20 p-4 shadow-md text-center">
                    <h3 className="text-xl font-bold text-emerald-600 dark:text-emerald-300 mb-4">
                      📅 Coming soon...
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300">Booking form will appear here soon!</p>
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
