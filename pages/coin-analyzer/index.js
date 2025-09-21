// frontend/pages/coin-analyzer/index.js
import { useEffect, useMemo, useRef, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;

/** Label đẹp cho platform id của CoinGecko */
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

/** Decimals mặc định cho 1 số L1; token EVM mặc định 18 */
const L1_DECIMALS = { BTC: 8, ETH: 18, NEAR: 24, SOL: 9, ATOM: 6, BNB: 18, TRX: 6, MATIC: 18 };

function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// =================== CoinGecko helpers ===================
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

// =================== Binance helpers ===================
async function findBinancePair(baseSymbol) {
  if (!baseSymbol) return { symbol: null, guessed: null };
  const url = `${BACKEND}/api/market/detect-binance/${encodeURIComponent(baseSymbol)}?quotes=USDT,USDC,BUSD,TUSD`;
  const r = await fetch(url);
  if (!r.ok) return { symbol: null, guessed: `${baseSymbol}USDT` };
  const j = await r.json().catch(() => ({}));
  if (j?.ok && j?.symbol) return { symbol: j.symbol, guessed: null };
  return { symbol: null, guessed: j?.guessed || `${baseSymbol}USDT` };
}

export default function CoinAnalyzerPage() {
  const [form, setForm] = useState({
    symbol: "",
    name: "",
    chain: "",
    contract_address: "",
    decimals: "",
    coingecko_id: "",
    binance_symbol: "",
  });
  const [loading, setLoading] = useState(false);
  const [registerResp, setRegisterResp] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [refreshInfo, setRefreshInfo] = useState(null);
  const [progress, setProgress] = useState(0);

  const [insights, setInsights] = useState(null);
  const [insightWindow, setInsightWindow] = useState("7d"); // 24h | 48h | 7d | 30d | all


  // ====== Autocomplete state ======
  const [search, setSearch] = useState("");
  const [suggests, setSuggests] = useState([]);
  const [searching, setSearching] = useState(false);
  const [platforms, setPlatforms] = useState([]); // [{id,label,contract}]
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef(null);

  useEffect(() => {
    let timer;
    if (loading) {
      setProgress(0);
      timer = setInterval(() => {
        setProgress((p) => {
          if (p < 90) return p + 5;
          return p;
        });
      }, 300);
    } else {
      setProgress(100);
      setTimeout(() => setProgress(0), 500);
    }
    return () => clearInterval(timer);
  }, [loading]);

  const onChange = (e) => setForm((s) => ({ ...s, [e.target.name]: e.target.value }));

  // Debounced search to CoinGecko
  const runSearch = useMemo(
    () =>
      debounce(async (q) => {
        setSearching(true);
        try {
          const items = await cgSearch(q);
          setSuggests(items);
        } finally {
          setSearching(false);
        }
      }, 300),
    []
  );

  useEffect(() => {
    if (search.trim().length >= 2) runSearch(search);
    else setSuggests([]);
  }, [search, runSearch]);

  // Khi chọn 1 coin trong list gợi ý
  const pickCoin = async (c) => {
    const symbol = (c?.symbol || "").toUpperCase();
    setForm((f) => ({
      ...f,
      symbol,
      name: c?.name || f.name,
      coingecko_id: c?.id || f.coingecko_id,
    }));

    // Lấy chi tiết -> điền platforms/contracts
    const detail = await cgCoinDetail(c.id);
    const plats = [];
    const mapping = detail?.platforms || {};
    Object.entries(mapping).forEach(([pid, contract]) => {
      if (!contract) return;
      plats.push({ id: pid, label: PLATFORM_LABEL[pid] || pid, contract });
    });
    setPlatforms(plats);

    // Suy luận L1 / decimals
    const isL1 = plats.length === 0; // CG: L1 thường không có platforms hoặc contract rỗng
    const decimals = isL1 ? (L1_DECIMALS[symbol] || "") : 18;
    const defaultChain = isL1 ? symbol : (plats[0]?.label || "");

    setForm((f) => ({
      ...f,
      chain: defaultChain,
      contract_address: isL1 ? "" : plats[0]?.contract || "",
      decimals,
    }));

    // Dò Binance symbol
    const { symbol: bz, guessed } = await findBinancePair(symbol);
    setForm((f) => ({ ...f, binance_symbol: bz || guessed || f.binance_symbol }));

  };

  const handleSuggestKeyDown = (e) => {
    if (!suggests.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggests.length);
      listRef.current?.children?.[(activeIdx + 1) % suggests.length]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggests.length) % suggests.length);
      listRef.current?.children?.[(activeIdx - 1 + suggests.length) % suggests.length]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pickCoin(suggests[activeIdx]);
      setSuggests([]);
      setSearch("");
      setActiveIdx(-1);
    }
  };

  // ===============================================
  async function refreshDataAndAnalyze(symbol, doAll = true) {
    const kickUrl = doAll
      ? `${BACKEND}/api/workers/refresh-all/${encodeURIComponent(symbol)}`
      : `${BACKEND}/api/workers/refresh-price/${encodeURIComponent(symbol)}`;
    const k = await fetch(kickUrl, { method: "POST" });
    if (!k.ok) throw new Error("Refresh worker failed");
    const kJson = await k.json();
    setRefreshInfo(kJson);

    const runRes = await fetch(`${BACKEND}/api/coins/${encodeURIComponent(symbol)}/run-analysis`, { method: "POST" });
    if (!runRes.ok) {
      const j = await runRes.json().catch(() => ({}));
      throw new Error(j.error || "Phân tích thất bại (run-analysis)");
    }

    const getRes = await fetch(`${BACKEND}/api/coins/${encodeURIComponent(symbol)}/analyze`);
    if (!getRes.ok) {
      const j = await getRes.json().catch(() => ({}));
      throw new Error(j.error || "Không lấy được kết quả phân tích");
    }
    const a = await getRes.json();
    setAnalysis(a);
    try {
      const insRes = await fetch(
        `${BACKEND}/api/coins/${encodeURIComponent(symbol)}/insights?window=${encodeURIComponent(insightWindow)}`
      );
      setInsights(insRes.ok ? await insRes.json() : null);
    } catch {
      setInsights(null);
    }
    // insights
  }

  async function handleRegisterThenAnalyze(e) {
    e.preventDefault();
    setError(""); setAnalysis(null); setRegisterResp(null); setRefreshInfo(null);
    if (!form.symbol || !form.name) {
      setError("Vui lòng nhập tối thiểu Symbol và Name.");
      return;
    }
    setLoading(true);
    const symbol = form.symbol.trim().toUpperCase();
    try {
      const regRes = await fetch(`${BACKEND}/api/crypto-assets/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          name: form.name.trim(),
          chain: form.chain?.trim() || null,
          contract_address: form.contract_address?.trim() || null,
          decimals: form.decimals !== "" ? Number(form.decimals) : null,
          coingecko_id: form.coingecko_id?.trim() || null,
          binance_symbol: form.binance_symbol?.trim() || null,
        }),
      });
      if (!regRes.ok) {
        const j = await regRes.json().catch(() => ({}));
        throw new Error(j.error || "Đăng ký coin thất bại");
      }
      const regData = await regRes.json();
      setRegisterResp(regData);

      await refreshDataAndAnalyze(symbol, true);
    } catch (err) {
      setError(err.message || "Đã xảy ra lỗi.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyzeExisting(e) {
    e.preventDefault();
    setError(""); setAnalysis(null); setRefreshInfo(null);
    const symbol = form.symbol?.trim()?.toUpperCase();
    if (!symbol) { setError("Nhập SYMBOL để phân tích coin đã đăng ký."); return; }
    setLoading(true);
    try {
      await refreshDataAndAnalyze(symbol, true);
    } catch (err) {
      setError(err.message || "Đã xảy ra lỗi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b1020] text-white">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Coin Analyzer</h1>
        <p className="text-sm text-gray-300 mt-2">
          Đăng ký coin vào hệ thống → nạp dữ liệu (worker) → chạy phân tích → xem khuyến nghị.
        </p>

        {/* Search & Suggest */}
        <div className="mt-6">
          <label className="block text-sm text-gray-300 mb-1">🔎 Tìm coin theo tên hoặc symbol</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSuggestKeyDown}
            placeholder="vd: near, eth, sol, pepe…"
            className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white outline-none"
          />
          {searching && <div className="text-xs text-gray-400 mt-1">Đang tìm…</div>}
          {suggests.length > 0 && (
            <ul
              ref={listRef}
              className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/20 bg-[#171a22] text-sm text-white shadow-lg"
            >
              {suggests.map((c, i) => (
                <li
                  key={c.id}
                  onClick={() => {
                    pickCoin(c);
                    setSuggests([]);
                    setSearch("");
                    setActiveIdx(-1);
                  }}
                  className={`px-3 py-2 cursor-pointer hover:bg-white/10 flex items-center justify-between ${i === activeIdx ? "bg-white/10" : ""
                    }`}
                >
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-gray-400">({(c.symbol || "").toUpperCase()})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Form */}
        <form className="mt-6 grid gap-4 bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Symbol *" name="symbol" value={form.symbol} onChange={(e) => setForm(s => ({ ...s, symbol: e.target.value.toUpperCase() }))} placeholder="NEAR, BTC, ETH" required />
            <Field label="Name *" name="name" value={form.name} onChange={onChange} placeholder="NEAR Protocol" required />

            <div>
              <label className="text-xs uppercase tracking-wide text-gray-300 block mb-1">Chain</label>
              {platforms.length > 0 ? (
                <select
                  value={form.chain}
                  onChange={(e) => {
                    const label = e.target.value;
                    const p = platforms.find((x) => x.label === label) || {};
                    setForm((f) => ({ ...f, chain: label, contract_address: p.contract || f.contract_address }));
                  }}
                  className="bg-white/10 border border-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
                >
                  {platforms.map((p) => (
                    <option key={p.id} value={p.label}>{p.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="bg-white/10 border border-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
                  name="chain"
                  value={form.chain}
                  onChange={onChange}
                  placeholder="NEAR, Ethereum, BSC…"
                />
              )}
            </div>

            <Field label="Contract Address" name="contract_address" value={form.contract_address} onChange={onChange} placeholder="ERC20/BEP20… (để trống nếu L1)" />
            <Field label="Decimals" name="decimals" value={form.decimals} onChange={(e) => setForm(s => ({ ...s, decimals: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="18, 24" type="text" />
            <Field label="CoinGecko ID" name="coingecko_id" value={form.coingecko_id} onChange={onChange} placeholder="near" />

            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-gray-300 block mb-1">Binance Symbol</label>
              <div className="flex gap-2">
                <input
                  className="bg-white/10 border border-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
                  name="binance_symbol"
                  value={form.binance_symbol}
                  onChange={(e) => setForm(s => ({ ...s, binance_symbol: e.target.value.toUpperCase() }))}
                  placeholder="NEARUSDT…"
                />
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500"
                  onClick={async () => {
                    const { symbol, guessed } = await findBinancePair(form.symbol?.toUpperCase());
                    if (symbol) {
                      setForm((f) => ({ ...f, binance_symbol: symbol }));
                    } else if (guessed) {
                      setForm((f) => ({ ...f, binance_symbol: guessed }));
                      alert(`Không truy vấn được từ Binance lúc này. Tạm điền gợi ý: ${guessed}`);
                    } else {
                      alert("Không tìm thấy cặp trên Binance (.com/.us) cho " + (form.symbol || ""));
                    }
                  }}
                  title="Tự dò trên Binance"
                >
                  Auto Detect
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Gợi ý: hệ thống sẽ thử {form.symbol?.toUpperCase()}USDT/BUSD/USDC.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRegisterThenAnalyze}
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {loading ? "Processing..." : "Register & Analyze"}
            </button>

            <button
              onClick={handleAnalyzeExisting}
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              {loading ? "Processing..." : "Analyze Existing"}
            </button>
            {progress > 0 && progress < 100 && (
              <div className="w-full bg-gray-700 rounded-full h-2.5 mb-4 mt-4">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                ></div>
                <div className="text-xs text-right text-gray-300 mt-1">{progress}%</div>
              </div>
            )}
            {error && <span className="text-red-400 text-sm">{error}</span>}
          </div>
        </form>

        {
          registerResp && (
            <div className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-sm">
              ✅ Đã đăng ký/cập nhật coin: <b>{registerResp.symbol}</b> — {registerResp.name}
            </div>
          )
        }

        {
          refreshInfo && (
            <div className="mt-4 p-4 rounded-xl bg-indigo-500/10 border border-indigo-400/30 text-sm">
              <div className="font-medium mb-1">Worker refresh:</div>
              <pre className="whitespace-pre-wrap text-indigo-200 text-xs">
                {JSON.stringify(refreshInfo, null, 2)}
              </pre>
            </div>
          )
        }

        {
          analysis && (
            <div className="mt-8 grid gap-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-xl font-semibold mb-4">Analysis Summary – {analysis.symbol}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <KV k="Overall Score" v={analysis.overall_score?.toFixed?.(4) ?? analysis.overall_score} />
                  <KV k="Action" v={analysis.action} />
                  <KV k="Confidence" v={analysis.confidence} />
                  <KV k="Run At" v={new Date(analysis.run_at).toLocaleString()} />
                  <KV k="Buy Zone" v={`${analysis.buy_zone?.[0]} – ${analysis.buy_zone?.[1]}`} />
                  <KV k="Stop Loss" v={analysis.stop_loss} />
                  <KV k="Take Profit 1" v={analysis.take_profit?.[0]} />
                  <KV k="Take Profit 2" v={analysis.take_profit?.[1]} />
                </div>
              </div>
            </div>
          )
        }
        {analysis && (
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-gray-300">Insights window:</span>
            <select
              value={insightWindow}
              onChange={async (e) => {
                const w = e.target.value;
                setInsightWindow(w);
                try {
                  const insRes = await fetch(
                    `${BACKEND}/api/coins/${encodeURIComponent(analysis.symbol)}/insights?window=${encodeURIComponent(w)}`
                  );
                  setInsights(insRes.ok ? await insRes.json() : null);
                } catch { setInsights(null); }
              }}
              className="bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-sm"
            >
              <option value="24h">24h</option>
              <option value="48h">48h</option>
              <option value="7d">7 ngày</option>
              <option value="30d">30 ngày</option>
              <option value="all">Tất cả</option>
            </select>
            {insights?.window_used && (
              <span className="text-xs text-gray-400">Đang xem: {insights.window_used}</span>
            )}
          </div>
        )}

        {insights && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* On-chain snapshot */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="font-semibold mb-3">On-chain ({insights.window_used})</h3>
              <div className="space-y-2 text-sm">
                <KV k="Inflow → sàn (USD)" v={Number(insights.onchain?.inflow_usd || 0).toLocaleString()} />
                <KV k="Outflow ← sàn (USD)" v={Number(insights.onchain?.outflow_usd || 0).toLocaleString()} />
                <KV k="Netflow (out - in)" v={Number(insights.onchain?.netflow_usd || 0).toLocaleString()} />
                <KV k="Large transfers" v={insights.onchain?.large_count ?? 0} />
              </div>
              <p className="text-xs text-gray-400 mt-3">
                L1 như BTC/NEAR/ADA không quét on-chain theo worker EVM hiện tại ⇒ giá trị có thể là 0.
              </p>
            </div>

            {/* News snapshot */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="font-semibold mb-3">News ({insights.window_used})</h3>
              <div className="space-y-2 text-sm">
                <KV k="Số bài" v={insights.news?.count ?? 0} />
                <KV k="Sentiment (−1..1)" v={(insights.news?.avg_sentiment ?? 0).toFixed(2)} />
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Tin từ NewsAPI/CryptoPanic; sentiment sơ cấp (có thể nâng cấp VADER sau).
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, placeholder, type = "text", required }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-300">{label}{required ? " *" : ""}</span>
      <input
        className="bg-white/10 border border-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        required={required}
      />
    </label>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
      <span className="text-gray-400">{k}</span>
      <span className="font-medium">{`${v ?? "-"}`}</span>
    </div>
  );
}
