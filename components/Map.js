import { GoogleMap, Marker, useJsApiLoader, InfoWindow, OverlayView } from "@react-google-maps/api";
import { useState, useEffect } from "react";

const containerStyle = {
    width: "100%",
    height: "600px",
    borderRadius: "1.5rem", // rounded-3xl
    backgroundColor: "rgba(16, 185, 129, 0.08)", // tương đương bg-white/10
    backdropFilter: "blur(16px)", // backdrop-blur-md
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
    overflow: "hidden",
};


const centerDefault = {
    lat: 37.7749,
    lng: -122.4194,
};

export default function Map({ stylists }) {
    const [selectedStylist, setSelectedStylist] = useState(null);
    const [userLocation, setUserLocation] = useState(null);

    const { isLoaded } = useJsApiLoader({
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
        libraries: ["places"],
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
                stylers: [{ color: "#2c2b3f" }] // ✅ nền tím than ngọc trầm
            },
            {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#30475e" }] // ✅ xanh ngọc trầm cho nước
            },
            {
                elementType: "labels",
                stylers: [{ visibility: "off" }]
            },
            {
                featureType: "road",
                stylers: [{ visibility: "off" }]
            },
            {
                featureType: "poi",
                stylers: [{ visibility: "off" }]
            },
            {
                featureType: "administrative",
                stylers: [{ visibility: "off" }]
            },
            {
                featureType: "all",
                elementType: "all",
                stylers: [{ saturation: -100 }, { lightness: -10 }]
            }
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
            zoom={13}
            options={mapOptions}
        >
            {/* 📍 Vị trí người dùng */}
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

            {/* 💇‍♀️ Marker stylist kiểu balloon */}
            {stylists.map((s) => (
                <OverlayView
                    key={s.id}
                    position={{
                        lat: s.latitude + (Math.random() * 0.0002 - 0.0001),
                        lng: s.longitude + (Math.random() * 0.0002 - 0.0001),
                    }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                    <div
                        onClick={() => setSelectedStylist(s)}
                        style={{
                            transform: "translate(-50%, -100%)",
                            cursor: "pointer",
                        }}
                    >
                        <div className="relative flex flex-col items-center group">
                            <div className="text-4xl">💇‍♀️</div>
                            <div className="w-3 h-3 bg-pink-500 rotate-45 mt-[-6px] shadow-sm"></div>
                        </div>
                    </div>
                </OverlayView>
            ))}

            {/* Popup thông tin stylist */}
            {selectedStylist && (
                <InfoWindow
                    position={{ lat: selectedStylist.latitude, lng: selectedStylist.longitude }}
                    onCloseClick={() => setSelectedStylist(null)}
                >
                    <div className="min-w-[220px] p-4 rounded-2xl bg-white/90 dark:bg-zinc-900/80 backdrop-blur-lg border border-pink-400 shadow-xl transition-all duration-300 ease-in-out animate-fade-in">
                        {/* Avatar */}
                        <div className="flex items-center gap-3 mb-3">
                            <img
                                src={
                                    selectedStylist.avatar_url?.startsWith("http")
                                        ? selectedStylist.avatar_url
                                        : `https://crypto-manager-backend.onrender.com${selectedStylist.avatar_url}`
                                }
                                alt="avatar"
                                className="w-12 h-12 rounded-full border-2 border-white shadow-md"
                            />
                            <div>
                                <p className="text-emerald-700 dark:text-emerald-300 font-bold text-base leading-tight">
                                    {selectedStylist.name}
                                </p>
                                <p className="text-xs italic text-gray-500 dark:text-gray-300">
                                    {selectedStylist.specialization}
                                </p>
                            </div>
                        </div>

                        {/* Info */}
                        <p className="text-xs text-pink-600 mb-1">{selectedStylist.gender}</p>
                        <p className="text-xs text-yellow-500 flex items-center gap-1">
                            ⭐ {selectedStylist.rating || "N/A"}
                        </p>
                    </div>
                </InfoWindow>

            )}
        </GoogleMap>
    );
}
