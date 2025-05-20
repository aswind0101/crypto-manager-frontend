// ✅ Map.js với animation nâng cao bằng framer-motion
import {
    GoogleMap,
    Marker,
    useJsApiLoader,
    OverlayView,
} from "@react-google-maps/api";
import { useState, useEffect, useRef } from "react";
import { useKeenSlider } from "keen-slider/react";
import "keen-slider/keen-slider.min.css";
import { AnimatePresence, motion } from "framer-motion";

const containerStyle = {
    width: "100%",
    height: "600px",
    borderRadius: "1.5rem",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
    overflow: "hidden",
};

const centerDefault = {
    lat: 37.7749,
    lng: -122.4194,
};

export default function Map({ salons }) {
    const [selectedSalon, setSelectedSalon] = useState(null);
    const [userLocation, setUserLocation] = useState(null);
    const [popupLoading, setPopupLoading] = useState(false);
    const mapRef = useRef(null);

    const { isLoaded } = useJsApiLoader({
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
        libraries: ["places"],
    });

    const [sliderRef, instanceRef] = useKeenSlider({
        loop: true,
        slides: { perView: 1, spacing: 8 },
    });

    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setUserLocation({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    });
                },
                (err) => console.error("❌ Error getting location:", err),
                { enableHighAccuracy: true }
            );
        }
    }, []);

    const mapOptions = {
        styles: [
            { elementType: "geometry", stylers: [{ color: "#2c2b3f" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#30475e" }] },
            { elementType: "labels", stylers: [{ visibility: "off" }] },
            { featureType: "road", stylers: [{ visibility: "off" }] },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "administrative", stylers: [{ visibility: "off" }] },
            { featureType: "all", elementType: "all", stylers: [{ saturation: -100 }, { lightness: -10 }] },
        ],
        disableDefaultUI: true,
        zoomControl: true,
    };

    const mapCenter = userLocation || centerDefault;

    if (!isLoaded) return <p>Loading Google Map...</p>;

    return (
        <GoogleMap
            mapContainerStyle={containerStyle}
            center={mapCenter}
            zoom={10}
            options={mapOptions}
            onLoad={(map) => (mapRef.current = map)}
        >
            {userLocation && (
                <Marker
                    position={userLocation}
                    icon={{
                        url: "https://maps.gstatic.com/mapfiles/ms2/micons/blue-pushpin.png",
                        scaledSize: new window.google.maps.Size(40, 40),
                        anchor: new window.google.maps.Point(10, 40),
                    }}
                />
            )}

            {salons.map((salon) => (
                <OverlayView
                    key={salon.salon_id}
                    position={{ lat: salon.latitude, lng: salon.longitude }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                    <div
                        onClick={() => {
                            setPopupLoading(true);
                            setTimeout(() => {
                                setSelectedSalon(salon);
                                setPopupLoading(false);
                                if (mapRef.current) {
                                    mapRef.current.panTo({ lat: salon.latitude, lng: salon.longitude });
                                    mapRef.current.setZoom(15);
                                }
                            }, 150);
                        }}
                        style={{ transform: "translate(-50%, -100%)", cursor: "pointer" }}
                        className="relative flex flex-col items-center"
                    >
                        {salon.stylists.length > 1 && (
                            <div className="absolute -top-3 bg-pink-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                                {salon.stylists.length}
                            </div>
                        )}

                        <div className="bg-white rounded-full shadow-lg w-12 h-12 flex items-center justify-center text-2xl border-2 border-pink-500">
                            💇‍♀️
                        </div>
                    </div>
                </OverlayView>
            ))}

            <AnimatePresence>
                {selectedSalon && !popupLoading && (
                    <OverlayView
                        position={{ lat: selectedSalon.latitude, lng: selectedSalon.longitude }}
                        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.9 }}
                            transition={{ duration: 0.3 }}
                            className="relative w-[260px] p-3 rounded-2xl bg-white/90 dark:bg-zinc-900/80 backdrop-blur-md shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]"
                        >
                            <button
                                onClick={() => instanceRef.current?.prev()}
                                className="absolute left-0 top-1/2 -translate-y-1/2 bg-pink-500 text-white w-6 h-6 rounded-full shadow-md hover:bg-pink-600 z-10"
                            >‹</button>

                            <button
                                onClick={() => setSelectedSalon(null)}
                                className="absolute top-2 right-2 text-gray-400 hover:text-pink-500 text-xl font-bold z-10"
                                aria-label="Close"
                            >✕</button>

                            <div ref={sliderRef} className="keen-slider">
                                {selectedSalon.stylists.map((stylist, idx) => (
                                    <motion.div
                                        key={idx}
                                        className="keen-slider__slide flex flex-col items-center text-sm"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: idx * 0.1 }}
                                    >
                                        <img
                                            src={stylist.avatar_url?.startsWith("http")
                                                ? stylist.avatar_url
                                                : `https://crypto-manager-backend.onrender.com${stylist.avatar_url}`}
                                            className="w-32 h-32 rounded-full border-2 border-white shadow-md mb-2"
                                            alt={stylist.name}
                                            onError={(e) => e.currentTarget.src = "/default-avatar.png"}
                                        />
                                        <p className="text-emerald-700 dark:text-emerald-300 font-semibold">{stylist.name}</p>
                                        <p className="text-xs italic text-gray-500 dark:text-gray-300">{stylist.specialization}</p>
                                        <p className="text-xs text-pink-600">{stylist.gender}</p>
                                        <p className="text-xs text-yellow-500">⭐ {stylist.rating || "N/A"}</p>
                                        <p className="text-xs text-cyan-600 mt-1 text-center">🏠 {selectedSalon.salon_name}</p>
                                        <p className="text-[11px] text-gray-500 text-center">📍 {selectedSalon.salon_address}</p>
                                        <button
                                            onClick={() => alert(`📅 Booking for ${stylist.name} coming soon!`)}
                                            className="mt-2 px-3 py-1 bg-pink-500 text-white text-xs rounded-full hover:bg-pink-600 transition"
                                        >
                                            Đặt hẹn
                                        </button>
                                    </motion.div>
                                ))}
                            </div>

                            <button
                                onClick={() => instanceRef.current?.next()}
                                className="absolute right-0 top-1/2 -translate-y-1/2 bg-pink-500 text-white w-6 h-6 rounded-full shadow-md hover:bg-pink-600 z-10"
                            >›</button>
                        </motion.div>
                    </OverlayView>
                )}
            </AnimatePresence>
        </GoogleMap>
    );
}
