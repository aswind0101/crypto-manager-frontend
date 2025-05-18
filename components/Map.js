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
    const getIconURL = (specialization) => {
        switch (specialization) {
            case "nail_tech":
                return "https://cdn-icons-png.flaticon.com/512/1995/1995521.png";
            case "hair_stylist":
            case "barber":
                return "https://cdn-icons-png.flaticon.com/512/2876/2876633.png";
            case "esthetician":
            case "massage_therapist":
                return "https://cdn-icons-png.flaticon.com/512/2965/2965567.png";
            case "makeup_artist":
                return "https://cdn-icons-png.flaticon.com/512/3501/3501236.png";
            default:
                return "https://cdn-icons-png.flaticon.com/512/847/847969.png";
        }
    };

    return (
        <GoogleMap mapContainerStyle={containerStyle} center={centerDefault} zoom={11}>
            {stylists.map((s) => (
                <Marker
                    key={s.id}
                    position={{
                        lat: s.latitude + (Math.random() * 0.0002 - 0.0001),
                        lng: s.longitude + (Math.random() * 0.0002 - 0.0001),
                    }}
                    onClick={() => setSelectedStylist(s)}
                    icon={{
                        url: getIconURL(s.specialization),
                        scaledSize: new window.google.maps.Size(42, 42),
                        origin: new window.google.maps.Point(0, 0),
                        anchor: new window.google.maps.Point(21, 21),
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
