// ✅ find-stylists.js (Trang chính tìm stylist đã cải tiến)
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Navbar from "../../components/Navbar";

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
          <div className="flex justify-center items-center py-10">
            <svg className="animate-spin h-6 w-6 text-emerald-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0" />
            </svg>
            <span className="ml-2 text-gray-600 dark:text-gray-400">Loading stylist map...</span>
          </div>
        ) : stylists.length === 0 ? (
          <p className="text-center text-sm text-gray-500">
            😥 No stylists are currently online.<br />
            <span className="text-xs text-gray-400 italic">Try again later or explore salons manually.</span>
          </p>
        ) : (
          <Map salons={stylists} />
        )}
      </div>
    </div>
  );
}
