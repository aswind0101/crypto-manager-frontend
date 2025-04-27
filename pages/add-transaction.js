import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth } from "firebase/auth";
import { useRouter } from "next/router";


function AddTransaction() {
  const [coinSymbol, setCoinSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [type, setType] = useState("buy");
  const [status, setStatus] = useState("");

  const [coinList, setCoinList] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const router = useRouter();


  useEffect(() => {
    const fetchCoinList = async () => {
      const cache = localStorage.getItem("coinList");
      const cacheTime = localStorage.getItem("coinListUpdated");
      const now = Date.now();
      const oneDay = 86400000;
      const cacheExpired = !cacheTime || now - parseInt(cacheTime) > oneDay;

      if (cache) {
        try {
          const parsed = JSON.parse(cache);
          setCoinList(parsed);
        } catch (err) {
          console.warn("⚠️ Corrupted coinList cache", err);
        }
      }

      if (cacheExpired) {
        try {
          const res = await fetch("https://api.coingecko.com/api/v3/coins/list");
          if (!res.ok) throw new Error("CoinGecko fetch failed");
          const freshData = await res.json();
          localStorage.setItem("coinList", JSON.stringify(freshData));
          localStorage.setItem("coinListUpdated", now.toString());
          setCoinList(freshData);
        } catch (err) {
          console.warn("⚠️ Failed to fetch new coinList:", err.message);
        }
      }
    };
    fetchCoinList();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const storedUser = localStorage.getItem("user");
    const user = storedUser ? JSON.parse(storedUser) : null;

    if (!coinSymbol || !quantity || !price || !type || !user) {
      setStatus("❗ Please fill in all fields and make sure you're logged in.");
      return;
    }

    // ✅ Kiểm tra không bán quá số lượng hiện có
    if (type === "sell") {
      const uid = user.uid;
      const cached = localStorage.getItem(`portfolio_${uid}`);
      if (!cached) {
        setStatus("❗ You don't have any holdings. Please add a buy transaction first.");
        return;
      }

      try {
        const portfolio = JSON.parse(cached);
        const coin = portfolio.find(c => c.coin_symbol.toUpperCase() === coinSymbol.toUpperCase());
        if (!coin || coin.total_quantity <= 0) {
          setStatus("❗ You don't own this coin. Please buy first.");
          return;
        }
        if (isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
          setStatus("❗ Quantity must be greater than 0.");
          return;
        }
        if (parseFloat(quantity) > coin.total_quantity) {
          setStatus(`❗ You only have ${coin.total_quantity.toLocaleString()} ${coinSymbol.toUpperCase()}.`);
          return;
        }
      } catch (err) {
        console.error("❌ Error checking portfolio:", err);
        setStatus("❗ Unable to verify your holdings. Please try again later.");
        return;
      }
    }

    try {
      const auth = getAuth();
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        setStatus("❗ User not authenticated");
        return;
      }

      const idToken = await firebaseUser.getIdToken();
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          coin_symbol: coinSymbol,
          quantity: parseFloat(quantity),
          price: parseFloat(price),
          transaction_type: type,
        })
      });

      if (res.ok) {
        setStatus("✅ Transaction added successfully!");
        setCoinSymbol("");
        setQuantity("");
        setPrice("");
        setType("buy");
      } else {
        const err = await res.json();
        setStatus("❌ Error: " + err.error);
      }
    } catch (err) {
      console.error(err);
      setStatus("❌ Failed to connect to server.");
    }
  };

  return (
    <div className="w-full p-4 bg-[#1C1F26] min-h-screen text-white font-mono">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 my-6">➕ Add New Transaction</h1>

      <form onSubmit={handleSubmit} className="bg-[#1C1F26]  max-w-md mx-auto p-6 rounded-xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] transition-all space-y-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">Coin Symbol</label>
          <input
            type="text"
            value={coinSymbol}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setCoinSymbol(val);
              if (val.length >= 1) {
                const filtered = coinList.filter(c => c.symbol.toUpperCase().startsWith(val)).slice(0, 10);
                setSuggestions(filtered);
                setShowSuggestions(true);
              } else {
                setSuggestions([]);
                setShowSuggestions(false);
              }
            }}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="e.g., NEAR"
            className="w-full px-4 py-2 border border-gray-800 rounded-xl text-white outline-none"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="bg-gray-800 border border-gray-700 rounded-xl mt-1 max-h-40 overflow-y-auto text-sm text-white z-10 relative">
              {suggestions.map((coin) => (
                <li
                  key={coin.id}
                  onClick={() => {
                    setCoinSymbol(coin.symbol.toUpperCase());
                    setShowSuggestions(false);
                  }}
                  className="px-4 py-2 hover:bg-yellow-500 hover:text-black cursor-pointer"
                >
                  {coin.symbol.toUpperCase()} – {coin.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Transaction Type</label>
          <div className="relative w-full">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="bg-[#1C1F26] border border-gray-800 text-white rounded-xl px-4 py-2 w-full outline-none appearance-none transition pr-10"
            >
              <option value="buy">🟢 Buy</option>
              <option value="sell">🔴 Sell</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>


        <div>
          <label className="block text-sm text-gray-300 mb-1">Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g., 100"
            className="w-full px-4 py-2 border border-gray-800 rounded-xl text-white outline-none"
            step="any"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Price per Coin (USD)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g., 2.5"
            className="w-full px-4 py-2 border border-gray-800 rounded-xl text-white outline-none"
            step="any"
          />
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 shadow-[4px_4px_8px_#0b0f17,_-4px_-4px_8px_#1e2631] text-white font-semibold py-2 rounded-xl transition"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => router.push("/transactions")}
            className="w-full bg-red-500 hover:bg-red-600 shadow-[4px_4px_8px_#0b0f17,_-4px_-4px_8px_#1e2631] text-white font-semibold py-2 rounded-xl transition"
          >
            Close
          </button>
        </div>
        {status && <p className="text-center mt-2 text-sm text-yellow-300">{status}</p>}
      </form>
    </div>
  );
}

export default withAuthProtection(AddTransaction);
