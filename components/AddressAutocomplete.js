import { MapPin } from "lucide-react"; // icon gợi ý
import usePlacesAutocomplete, { getGeocode } from "use-places-autocomplete";
import { useEffect } from "react";

export default function AddressAutocomplete({ value, onChange, placeholder = "Enter address..." }) {
    const {
        ready,
        value: inputValue,
        setValue,
        suggestions: { status, data },
        clearSuggestions,
    } = usePlacesAutocomplete({
        requestOptions: { componentRestrictions: { country: "us" } },
        debounce: 300,
    });

    useEffect(() => {
        setValue(value || "");
    }, [value]);

    const extractFullAddressWithZip = async (address) => {
        const results = await getGeocode({ address });
        const first = results[0];

        if (!first) return address;

        const components = first.address_components;
        const zipcodeObj = components.find((c) => c.types.includes("postal_code"));
        const zipcode = zipcodeObj?.long_name;

        // If ZIP found and not already included
        if (zipcode && !address.includes(zipcode)) {
            return `${address}, ${zipcode}`;
        }

        return address;
    };

    const handleSelect = async (selectedAddress) => {
        clearSuggestions();
        const fullAddress = await extractFullAddressWithZip(selectedAddress);

        setValue(fullAddress, false);
        onChange({ target: { name: "address", value: fullAddress } });
    };

    return (
        <div className="relative">
            <input
                name="address"
                value={inputValue}
                onChange={(e) => {
                    setValue(e.target.value);
                    onChange(e);
                }}
                placeholder={placeholder}
                className="pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 border border-white/20 text-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
            <div className="absolute left-3 top-2.5">
                <MapPin className="w-4 h-4 text-pink-300" />
            </div>

            {status === "OK" && (
                <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg text-sm max-h-56 overflow-y-auto">
                    {data.map(({ place_id, description }) => (
                        <li
                            key={place_id}
                            onClick={() => handleSelect(description)}
                            className="px-4 py-2 cursor-pointer hover:bg-pink-100 text-gray-800"
                        >
                            {description}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
