// /components/CoinAutoSuggest.jsx
import { useEffect, useMemo, useRef, useState } from "react";

/** Map id platform -> label đẹp */
const PLATFORM_LABEL = {
  "ethereum": "Ethereum",
  "binance-smart-chain": "BSC",
  "polygon-pos": "Polygon",
  "arbitrum-one": "Arbitrum",
  "optimistic-ethereum": "Optimism",
  "base": "Base",
  "avalanche": "Avalanche",
  "solana": "Solana",
  "tron": "TRON",
  "near-protocol": "NEAR",
  "bitcoin": "Bitcoin",
};

/** Decimals mặc định theo L1, EVM token = 18 */
const L1_DECIMALS = {
  BTC: 8,
  ETH: 18,
  NEAR: 24,
  SOL: 9,
  ATOM: 6,
  BNB: 18,
  TRX: 6,
  MATIC: 18,
};

function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function cgSearch(query) {
  if (!query?.trim()) return [];
  const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query.trim())}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.coins || []).slice(0, 12);
}

async function cgCoinDetail(id) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

async function findBinancePair(baseSymbol) {
  if (!baseSymbol) return null;
  const candidates = [`${baseSymbol}USDT`, `${baseSymbol}BUSD`, `${baseSymbol}USDC`];
  for (const s of candidates) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/exchangeInfo?symbol=${s}`);
      if (r.ok) return s; // tồn tại
    } catch {}
  }
  return null;
}

export default function CoinAutoSuggest({
  onSubmit,
  className = "",
  initial = { symbol: "", name: "", chain: "", contract_address: "", decimals: "", coingecko_id: "", binance_symbol: "" },
}) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);

  const [form, setForm] = useState(initial);
  const [platforms, setPlatforms] = useState([]); // [{id,label,contract}]
  const listRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  // gợi ý realtime
  const runSearch = useMemo(
    () =>
      debounce(async (q) => {
        setLoading(true);
        try {
          const items = await cgSearch(q);
          setResults(items);
        } finally {
          setLoading(false);
        }
      }, 300),
    []
  );

  useEffect(() => {
    if (search.trim().length >= 2) runSearch(search);
    else setResults([]);
  }, [search, runSearch]);

  // chọn 1 coin từ gợi ý
  const pickCoin = async (c) => {
    // Prefill nhanh
    const symbol = (c?.symbol || "").toUpperCase();
    setForm((f) => ({
      ...f,
      symbol,
      name: c?.name || f.name,
      coingecko_id: c?.id || f.coingecko_id,
    }));

    // Lấy chi tiết để suy luận chain/contract
    const detail = await cgCoinDetail(c.id);
    const plats = [];
    const mapping = detail?.platforms || {};
    Object.entries(mapping).forEach(([pid, contract]) => {
      if (!contract) return;
      plats.push({
        id: pid,
        label: PLATFORM_LABEL[pid] || pid,
        contract,
      });
    });
    setPlatforms(plats);

    // Suy luận L1 / decimals
    const upper = symbol.toUpperCase();
    const isL1 = plats.length === 0; // CoinGecko: L1 thường không có platforms
    const decimals =
      isL1
        ? (L1_DECIMALS[upper] || "")
        : 18; // Token EVM mặc định 18 (user vẫn sửa được)

    setForm((f) => ({
      ...f,
      chain: isL1 ? (PLATFORM_LABEL[detail?.asset_platform_id] || upper) : (plats[0]?.label || ""),
      contract_address: isL1 ? "" : plats[0]?.contract || "",
      decimals,
    }));

    // Tự dò Binance symbol
    const binance = await findBinancePair(upper);
    setForm((f) => ({ ...f, binance_symbol: binance || f.binance_symbol }));
  };

  const handleKeyDown = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
      listRef.current?.children?.[(activeIdx + 1) % results.length]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
      listRef.current?.children?.[(activeIdx - 1 + results.length) % results.length]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pickCoin(results[activeIdx]);
      setResults([]);
      setSearch("");
      setActiveIdx(-1);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (typeof onSubmit === "function") onSubmit(form);
  };

  return (
    <div className={className}>
      {/* Search box */}
      <label className="block text-sm text-gray-300 mb-1">🔎 Tìm coin theo tên hoặc symbol</label>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="vd: near, eth, sol, pepe…"
        className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white outline-none"
      />
      {loading && <div className="text-xs text-gray-400 mt-1">Đang tìm…</div>}
      {results.length > 0 && (
        <ul
          ref={listRef}
          className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/20 bg-[#171a22] text-sm text-white shadow-lg"
        >
          {results.map((c, i) => (
            <li
              key={c.id}
              onClick={() => {
                pickCoin(c);
                setResults([]);
                setSearch("");
                setActiveIdx(-1);
              }}
              className={`px-3 py-2 cursor-pointer hover:bg-white/10 flex items-center justify-between ${
                i === activeIdx ? "bg-white/10" : ""
              }`}
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-gray-400">({(c.symbol || "").toUpperCase()})</span>
            </li>
          ))}
        </ul>
      )}

      {/* Form đã prefill */}
      <form onSubmit={handleSubmit} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">SYMBOL *</label>
          <input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
            className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">NAME *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">CHAIN</label>
          {platforms.length > 0 ? (
            <select
              value={form.chain}
              onChange={(e) => {
                const label = e.target.value;
                const p = platforms.find((x) => x.label === label) || {};
                setForm({ ...form, chain: label, contract_address: p.contract || form.contract_address });
              }}
              className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            >
              {platforms.map((p) => (
                <option key={p.id} value={p.label}>{p.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={form.chain}
              onChange={(e) => setForm({ ...form, chain: e.target.value })}
              placeholder="NEAR / Bitcoin / Ethereum …"
              className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            />
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">CONTRACT ADDRESS (để trống nếu L1)</label>
          <input
            value={form.contract_address || ""}
            onChange={(e) => setForm({ ...form, contract_address: e.target.value })}
            className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            placeholder="0x…"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">DECIMALS</label>
          <input
            type="text"
            value={form.decimals ?? ""}
            onChange={(e) => setForm({ ...form, decimals: e.target.value.replace(/[^0-9]/g, "") })}
            className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            placeholder="18 / 24 / 9 …"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">COINGECKO ID</label>
          <input
            value={form.coingecko_id}
            onChange={(e) => setForm({ ...form, coingecko_id: e.target.value })}
            className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
            placeholder="near / ethereum / solana …"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm text-gray-300 mb-1">BINANCE SYMBOL</label>
          <div className="flex gap-2">
            <input
              value={form.binance_symbol || ""}
              onChange={(e) => setForm({ ...form, binance_symbol: e.target.value.toUpperCase() })}
              className="flex-1 rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white"
              placeholder="NEARUSDT …"
            />
            <button
              type="button"
              className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white"
              onClick={async () => {
                const s = await findBinancePair(form.symbol?.toUpperCase());
                setForm((f) => ({ ...f, binance_symbol: s || f.binance_symbol }));
              }}
              title="Tự dò trên Binance"
            >
              Auto Detect
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Gợi ý: hệ thống sẽ thử {form.symbol?.toUpperCase()}USDT/BUSD/USDC.
          </p>
        </div>

        <div className="md:col-span-2 mt-2 flex gap-3">
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-semibold"
          >
            Register & Analyze
          </button>
        </div>
      </form>
    </div>
  );
}
