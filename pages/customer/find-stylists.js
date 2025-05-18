import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Navbar from "../../components/Navbar";

// Lazy load bản đồ (Google hoặc Leaflet tùy bạn chọn)
const Map = dynamic(() => import("../../components/Map"), { ssr: false });

export default function FindStylists() {
  const [stylists, setStylists] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStylists = async () => {
      try {
        const res = await fetch("https://crypto-manager-backend.onrender.com/api/stylists/online");
        const data = await res.json();
        if (res.ok) setStylists(data);
        else console.warn("⚠️ Failed to load stylists:", data.error);
      } catch (err) {
        console.error("❌ Error loading stylists:", err.message);
      }
      setLoading(false);
    };

    fetchStylists();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-300 via-sky-200 to-pink-300 dark:from-emerald-900 dark:via-sky-800 dark:to-pink-800 text-gray-900 dark:text-white">
      <Navbar />
      <div className="max-w-6xl mx-auto py-8 px-4">
        <h1 className="text-3xl font-extrabold text-center text-emerald-800 dark:text-emerald-300 mb-6">
          💇‍♀️ Explore Stylists Near You
        </h1>

        {loading ? (
          <p className="text-center">⏳ Loading stylist map...</p>
        ) : (
          <Map stylists={stylists} />
        )}
      </div>
    </div>
  );
}
