import {
    GoogleMap,
    Marker,
    useJsApiLoader,
    OverlayView,
} from "@react-google-maps/api";
import { useState, useEffect } from "react";
import { useKeenSlider } from "keen-slider/react";
import "keen-slider/keen-slider.min.css";



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
            {
                elementType: "geometry",
                stylers: [{ color: "#2c2b3f" }],
            },
            {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#30475e" }],
            },
            { elementType: "labels", stylers: [{ visibility: "off" }] },
            { featureType: "road", stylers: [{ visibility: "off" }] },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "administrative", stylers: [{ visibility: "off" }] },
            {
                featureType: "all",
                elementType: "all",
                stylers: [{ saturation: -100 }, { lightness: -10 }],
            },
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
            zoom={15}
            options={mapOptions}

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
                        onClick={() => setSelectedSalon(salon)}
                        style={{ transform: "translate(-50%, -100%)", cursor: "pointer" }}
                        className="relative flex flex-col items-center"
                    >
                        {/* Số lượng stylist */}
                        {salon.stylists.length > 1 && (
                            <div className="absolute -top-3 bg-pink-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                                {salon.stylists.length}
                            </div>
                        )}

                        {/* Icon */}
                        <div className="bg-white rounded-full shadow-lg w-14 h-14 flex items-center justify-center text-2xl border-2 border-pink-500">
                            💇‍♀️
                        </div>
                    </div>

                </OverlayView>
            ))}

            {selectedSalon && (
                <OverlayView
                    position={{
                        lat: selectedSalon.latitude,
                        lng: selectedSalon.longitude,
                    }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                    <div className="relative animate-fade-in w-[260px] p-3 rounded-2xl bg-white/90 dark:bg-zinc-900/80 backdrop-blur-md border border-pink-400 shadow-xl">
                        {/* Nút mũi tên trái */}
                        <button
                            onClick={() => instanceRef.current?.prev()}
                            className="absolute left-0 top-1/2 -translate-y-1/2 bg-pink-500 text-white w-6 h-6 rounded-full shadow-md hover:bg-pink-600 z-10"
                        >
                            ‹
                        </button>

                        {/* Nút đóng */}
                        <button
                            onClick={() => setSelectedSalon(null)}
                            className="absolute top-2 right-2 text-gray-400 hover:text-pink-500 text-xl font-bold z-10"
                            aria-label="Close"
                        >
                            ✕
                        </button>

                        {/* Slider */}
                        <div ref={sliderRef} className="keen-slider">
                            {selectedSalon.stylists.map((stylist, idx) => (
                                <div key={idx} className="keen-slider__slide flex flex-col items-center text-sm">
                                    <img
                                        src={
                                            stylist.avatar_url
                                                ? (stylist.avatar_url.startsWith("http")
                                                    ? stylist.avatar_url
                                                    : `https://crypto-manager-backend.onrender.com${stylist.avatar_url}`)
                                                : "/default-avatar.png"
                                        }
                                        className="w-24 h-24 rounded-full border-2 border-white shadow-md mb-2"
                                        alt={stylist.name}
                                    />

                                    <p className="text-emerald-700 dark:text-emerald-300 font-semibold">
                                        {stylist.name}
                                    </p>
                                    <p className="text-xs italic text-gray-500 dark:text-gray-300">
                                        {stylist.specialization}
                                    </p>
                                    <p className="text-xs text-pink-600">{stylist.gender}</p>
                                    <p className="text-xs text-yellow-500">
                                        ⭐ {stylist.rating || "N/A"}
                                    </p>
                                    <p className="text-xs text-cyan-600 mt-1 text-center">
                                        🏠 {selectedSalon.salon_name}
                                    </p>
                                    <p className="text-[11px] text-gray-500 text-center">
                                        📍 {selectedSalon.salon_address}
                                    </p>

                                    <button
                                        onClick={() => openBookingModal(stylist)}
                                        className="mt-2 px-3 py-1 bg-pink-500 text-white text-xs rounded-full hover:bg-pink-600 transition"
                                    >
                                        Đặt hẹn
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Nút mũi tên phải */}
                        <button
                            onClick={() => instanceRef.current?.next()}
                            className="absolute right-0 top-1/2 -translate-y-1/2 bg-pink-500 text-white w-6 h-6 rounded-full shadow-md hover:bg-pink-600 z-10"
                        >
                            ›
                        </button>
                    </div>

                </OverlayView>
            )}
        </GoogleMap>
    );
}
