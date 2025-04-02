import { useEffect, useState } from "react";
import axios from "axios";

export function useCoinIcons() {
  const [icons, setIcons] = useState({});

  useEffect(() => {
    async function fetchIcons() {
      try {
        // 1. Lấy danh sách coin đang đầu tư
        const storedUser = localStorage.getItem("user");
        const storedPortfolio = storedUser
          ? JSON.parse(localStorage.getItem("portfolio_" + JSON.parse(storedUser).uid))
          : [];

        const symbols = storedPortfolio.map((coin) => coin.coin_symbol.toUpperCase());
        const uniqueSymbols = [...new Set(symbols)];

        const iconMap = {};

        const symbolsToFetch = [];

        // 2. Kiểm tra cache icon
        uniqueSymbols.forEach((symbol) => {
          const cached = localStorage.getItem(`icon_${symbol}`);
          if (cached) {
            iconMap[symbol] = cached;
          } else {
            symbolsToFetch.push(symbol);
          }
        });

        // 3. Nếu còn symbol chưa có icon → fetch từ API
        if (symbolsToFetch.length > 0) {
          // 3.1 Lấy coinList từ cache hoặc API
          let coinList = null;
          const cache = localStorage.getItem("coinList");
          const cacheTime = localStorage.getItem("coinListUpdated");
          const now = Date.now();

          if (cache && cacheTime && now - parseInt(cacheTime) < 86400000) {
            coinList = JSON.parse(cache);
          } else {
            const res = await axios.get("https://api.coingecko.com/api/v3/coins/list");
            coinList = res.data;
            localStorage.setItem("coinList", JSON.stringify(coinList));
            localStorage.setItem("coinListUpdated", now.toString());
          }

          // 3.2 Lấy ID ứng với symbol
          const matchedIds = [];
          const symbolToIds = {};
          symbolsToFetch.forEach((symbol) => {
            const matches = coinList.filter((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
            if (matches.length > 0) {
              const ids = matches.map((m) => m.id);
              matchedIds.push(...ids);
              symbolToIds[symbol] = ids;
            }
          });

          if (matchedIds.length > 0) {
            const idsParam = matchedIds.join(",");
            const marketRes = await axios.get(
              `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${idsParam}`
            );
            const marketData = marketRes.data;

            // 3.3 Gán icon tốt nhất
            for (const symbol of symbolsToFetch) {
              const ids = symbolToIds[symbol];
              const candidates = marketData.filter((c) => ids.includes(c.id));

              if (candidates.length === 0) continue;

              const best = candidates.reduce((a, b) =>
                (a.market_cap || 0) > (b.market_cap || 0) ? a : b
              );

              iconMap[symbol] = best.image;
              localStorage.setItem(`icon_${symbol}`, best.image); // ✅ cache icon
            }
          }
        }

        setIcons(iconMap);
      } catch (err) {
        console.error("⚠️ Failed to fetch coin icons:", err.message);
        setIcons({});
      }
    }

    fetchIcons();
  }, []);

  return icons;
}
