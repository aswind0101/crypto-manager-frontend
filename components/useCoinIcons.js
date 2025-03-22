// components/useCoinIcons.js
import { useEffect, useState } from "react";
import axios from "axios";

export function useCoinIcons() {
    const [coinMap, setCoinMap] = useState({});

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
                setCoinMap(map);
            } catch (error) {
                console.error("Failed to load coin icons", error);
            }
        }

        fetchIcons();
    }, []);

    return coinMap;
}
