import { GoogleMap, Marker, useJsApiLoader, InfoWindow } from "@react-google-maps/api";
import { useState } from "react";

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
                <Marker
                    key={s.id}
                    position={{ lat: s.latitude, lng: s.longitude }}
                    onClick={() => setSelectedStylist(s)}
                    icon={{
                        url: fullURL(s.avatar_url) || "/default-avatar.png",
                        scaledSize: new window.google.maps.Size(48, 48),
                        origin: new window.google.maps.Point(0, 0),
                        anchor: new window.google.maps.Point(24, 24),
                    }}
                />
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
