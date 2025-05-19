import { GoogleMap, Marker, useJsApiLoader, InfoWindow, OverlayView } from "@react-google-maps/api";
import { useState, useEffect } from "react";

const containerStyle = {
    width: "100%",
    height: "600px",
    borderRadius: "1.5rem", // rounded-3xl
    backgroundColor: "rgba(255, 255, 255, 0.05)", // tương đương bg-white/10
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
                stylers: [{ color: "#1c1c1c" }]
            },
            {
                elementType: "labels",
                stylers: [{ visibility: "off" }]
            },
            {
                featureType: "all",
                elementType: "all",
                stylers: [{ saturation: -100 }, { lightness: -20 }]
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
                            <div className="bg-white text-4xl shadow-lg px-5 py-2 rounded-2xl border-2 border-pink-500">
                                💇‍♀️
                            </div>
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
                    <div className="bg-white/80 dark:bg-zinc-800 backdrop-blur-md rounded-xl p-3 shadow-xl border border-pink-300 w-48">
                        <div className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
                            {selectedStylist.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-300 italic">
                            {selectedStylist.specialization}
                        </div>
                        <div className="text-xs text-pink-500 mt-1">{selectedStylist.gender}</div>
                        <div className="text-xs mt-1">⭐ {selectedStylist.rating || "N/A"}</div>
                    </div>
                </InfoWindow>

            )}
        </GoogleMap>
    );
}
