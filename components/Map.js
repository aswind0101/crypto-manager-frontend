import { GoogleMap, Marker, useJsApiLoader, InfoWindow } from "@react-google-maps/api";
import { useState } from "react";
import { OverlayView } from "@react-google-maps/api";


const containerStyle = {
    width: "100%",
    height: "600px",
    borderRadius: "1rem",
};

const centerDefault = {
    lat: 37.7749,
    lng: -122.4194,
};

export default function Map({ stylists }) {
    const [selectedStylist, setSelectedStylist] = useState(null);

    const { isLoaded } = useJsApiLoader({
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
        libraries: ["places"],
    });

    const fullURL = (url) =>
        url?.startsWith("http") ? url : `https://crypto-manager-backend.onrender.com${url}`;

    if (!isLoaded) return <p>Loading Google Map...</p>;
    const mapOptions = {
        styles: [
            {
                elementType: "geometry",
                stylers: [{ color: "#e9e9e9" }],
            },
            {
                elementType: "labels.text.fill",
                stylers: [{ color: "#777" }],
            },
            {
                elementType: "labels.text.stroke",
                stylers: [{ color: "#ffffff" }],
            },
            {
                featureType: "administrative",
                elementType: "geometry",
                stylers: [{ visibility: "off" }],
            },
            {
                featureType: "poi",
                stylers: [{ visibility: "off" }],
            },
            {
                featureType: "road",
                stylers: [{ color: "#ffffff" }],
            },
            {
                featureType: "transit",
                stylers: [{ visibility: "off" }],
            },
            {
                featureType: "water",
                stylers: [{ color: "#c0e4f3" }],
            },
        ],
        disableDefaultUI: true,
        zoomControl: true,
    };
    const containerStyle = {
        width: "100%",
        height: "600px",
        borderRadius: "1.25rem",
        boxShadow: "0 0 20px rgba(0,0,0,0.1)",
        overflow: "hidden",
    };

    return (
        <GoogleMap mapContainerStyle={containerStyle} center={centerDefault} zoom={11} options={mapOptions}>
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
                            <div className="bg-white text-3xl shadow-lg px-4 py-2 rounded-xl border-2 border-pink-500">
                                💇‍♀️
                            </div>
                            <div className="w-3 h-3 bg-pink-500 rotate-45 mt-[-6px]"></div>
                        </div>
                    </div>
                </OverlayView>

            ))}

            {selectedStylist && (
                <InfoWindow
                    position={{ lat: selectedStylist.latitude, lng: selectedStylist.longitude }}
                    onCloseClick={() => setSelectedStylist(null)}
                >
                    <div className="text-sm text-gray-800 dark:text-white px-3 py-2 rounded-xl shadow-lg bg-white/90 dark:bg-white/10 border border-pink-300 min-w-[160px]">
                        <p className="font-bold text-emerald-600 dark:text-emerald-300 truncate">
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
