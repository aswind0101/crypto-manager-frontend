import { MapPin } from "lucide-react"; // icon gợi ý
import { useEffect, useState } from "react";
import usePlacesAutocomplete, { getGeocode } from "use-places-autocomplete";

export default function AddressAutocomplete({ value, onChange, placeholder = "Enter address..." }) {
    const [showDropdown, setShowDropdown] = useState(false);

    const {
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
        try {
            const results = await getGeocode({ address });
            const first = results[0];
            if (!first) return address;

            const components = first.address_components;
            const zipcodeObj = components.find((c) => c.types.includes("postal_code"));
            const zipcode = zipcodeObj?.long_name;

            if (zipcode && !address.includes(zipcode)) {
                return `${address}, ${zipcode}`;
            }

            return address;
        } catch (err) {
            return address;
        }
    };

    const handleSelect = async (selectedAddress) => {
        const fullAddress = await extractFullAddressWithZip(selectedAddress);
        setValue(fullAddress);
        setShowDropdown(false); // ✅ Ngắt dropdown
        clearSuggestions();
        onChange({ target: { name: "address", value: fullAddress } });
    };

    return (
        <div className="relative">
            <input
                name="address"
                value={inputValue}
                onChange={(e) => {
                    setValue(e.target.value);
                    setShowDropdown(true); // ✅ Mở dropdown khi user gõ
                    onChange(e);
                }}
                onBlur={() => {
                    setTimeout(() => {
                        setShowDropdown(false); // ✅ Ẩn dropdown sau blur
                        clearSuggestions();
                    }, 150);
                }}
                placeholder={placeholder}
                className="pl-10 pr-4 py-2 w-full rounded-xl bg-white/30 dark:bg-white/10 border border-white/20 text-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
            <div className="absolute left-3 top-2.5">
                <MapPin className="w-4 h-4 text-pink-300" />
            </div>

            {/* ✅ Dropdown chỉ hiển thị khi showDropdown === true */}
            {showDropdown && status === "OK" && data.length > 0 && (
                <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg text-sm max-h-56 overflow-y-auto">
                    {data.map(({ place_id, description }) => (
                        <li
                            key={place_id}
                            onMouseDown={() => handleSelect(description)}
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
