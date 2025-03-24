import { useEffect, useState } from "react";
import axios from "axios";

export function useCoinIcons() {
    const [icons, setIcons] = useState({});

    useEffect(() => {
        async function fetchIcons() {
            try {
                const res = await axios.get(
                    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1"
                );
                const map = {};
                res.data.forEach((coin) => {
                    map[coin.symbol.toUpperCase()] = coin.image;
                });
                setIcons(map);
            } catch (error) {
                console.error("⚠️ Failed to fetch coin icons:", error.message);
                // fallback: empty map
                setIcons({});
            }
        }

        fetchIcons();
    }, []);

    return icons;
}
