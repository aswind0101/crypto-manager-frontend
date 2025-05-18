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
    
    return (
        <GoogleMap mapContainerStyle={containerStyle} center={centerDefault} zoom={11}>
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
                    <div className="text-sm text-gray-800">
                        <img
                            src={fullURL(selectedStylist.avatar_url)}
                            alt={selectedStylist.name}
                            className="w-16 h-16 rounded-full border mb-1"
                        />
                        <p className="font-bold">{selectedStylist.name}</p>
                        <p>{selectedStylist.specialization}</p>
                        <p>{selectedStylist.gender}</p>
                        <p>⭐ {selectedStylist.rating || "N/A"}</p>
                    </div>
                </InfoWindow>
            )}
        </GoogleMap>
    );
}
