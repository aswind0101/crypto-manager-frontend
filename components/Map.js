import { GoogleMap, Marker, useJsApiLoader, InfoWindow, OverlayView } from "@react-google-maps/api";
import { useState, useEffect } from "react";

const containerStyle = {
    width: "100%",
    height: "600px",
    borderRadius: "1.25rem",
    boxShadow: "0 0 20px rgba(0,0,0,0.1)",
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
                stylers: [{ color: "#f9f6f2" }],
            },
            {
                elementType: "labels.text.fill",
                stylers: [{ color: "#8a8a8a" }],
            },
            {
                elementType: "labels.text.stroke",
                stylers: [{ color: "#ffffff" }],
            },
            {
                featureType: "road",
                elementType: "geometry",
                stylers: [{ color: "#ffffff" }],
            },
            {
                featureType: "road.highway",
                elementType: "geometry",
                stylers: [{ color: "#ffd1dc" }],
            },
            {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#c0f0f8" }],
            },
            {
                featureType: "poi",
                stylers: [{ visibility: "off" }],
            },
            {
                featureType: "transit",
                stylers: [{ visibility: "off" }],
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
            zoom={13}
            options={mapOptions}
        >
            {/* 📍 Vị trí người dùng */}
            {userLocation && (
                <Marker
                    position={userLocation}
                    icon={{
                        url: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
                        scaledSize: new window.google.maps.Size(36, 36),
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
                    <div className="text-sm px-3 py-2 rounded-xl shadow-xl bg-white/90 dark:bg-white/10 border border-pink-300 min-w-[160px] backdrop-blur-md">
                        <p className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                            {selectedStylist.name}
                        </p>
                        <p className="text-xs italic text-gray-500 dark:text-gray-300">
                            {selectedStylist.specialization}
                        </p>
                        <p className="text-xs text-pink-500">{selectedStylist.gender}</p>
                        <p className="text-xs mt-1">⭐ {selectedStylist.rating || "N/A"}</p>
                    </div>
                </InfoWindow>
            )}
        </GoogleMap>
    );
}
