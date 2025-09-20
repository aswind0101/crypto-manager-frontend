// frontend/pages/coin-analyzer/index.js
import { useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;

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

  const onChange = (e) => setForm((s) => ({ ...s, [e.target.name]: e.target.value }));

  async function refreshDataAndAnalyze(symbol, doAll = true) {
    // 2) kick worker
    const kickUrl = doAll
      ? `${BACKEND}/api/workers/refresh-all/${encodeURIComponent(symbol)}`
      : `${BACKEND}/api/workers/refresh-price/${encodeURIComponent(symbol)}`;
    const k = await fetch(kickUrl, { method: "POST" });
    if (!k.ok) throw new Error("Refresh worker failed");
    const kJson = await k.json();
    setRefreshInfo(kJson);

    // 3) run analysis
    const runRes = await fetch(`${BACKEND}/api/coins/${encodeURIComponent(symbol)}/run-analysis`, { method: "POST" });
    if (!runRes.ok) {
      const j = await runRes.json().catch(()=>({}));
      throw new Error(j.error || "Phân tích thất bại (run-analysis)");
    }

    // 4) get latest snapshot
    const getRes = await fetch(`${BACKEND}/api/coins/${encodeURIComponent(symbol)}/analyze`);
    if (!getRes.ok) {
      const j = await getRes.json().catch(()=>({}));
      throw new Error(j.error || "Không lấy được kết quả phân tích");
    }
    const a = await getRes.json();
    setAnalysis(a);
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
      // 1) register / upsert
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
        const j = await regRes.json().catch(()=>({}));
        throw new Error(j.error || "Đăng ký coin thất bại");
      }
      const regData = await regRes.json();
      setRegisterResp(regData);

      // 2→3→4) refresh & analyze
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

        {/* Form */}
        <form className="mt-8 grid gap-4 bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Symbol *" name="symbol" value={form.symbol} onChange={onChange} placeholder="NEAR, BTC, ETH" required />
            <Field label="Name *" name="name" value={form.name} onChange={onChange} placeholder="NEAR Protocol" required />
            <Field label="Chain" name="chain" value={form.chain} onChange={onChange} placeholder="NEAR, Ethereum, BSC…" />
            <Field label="Contract Address" name="contract_address" value={form.contract_address} onChange={onChange} placeholder="ERC20/BEP20… (để trống nếu L1)" />
            <Field label="Decimals" name="decimals" value={form.decimals} onChange={onChange} placeholder="18, 24" type="number" />
            <Field label="CoinGecko ID" name="coingecko_id" value={form.coingecko_id} onChange={onChange} placeholder="near" />
            <Field label="Binance Symbol" name="binance_symbol" value={form.binance_symbol} onChange={onChange} placeholder="NEARUSDT" />
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

            {error && <span className="text-red-400 text-sm">{error}</span>}
          </div>
        </form>

        {registerResp && (
          <div className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-sm">
            ✅ Đã đăng ký/cập nhật coin: <b>{registerResp.symbol}</b> — {registerResp.name}
          </div>
        )}

        {refreshInfo && (
          <div className="mt-4 p-4 rounded-xl bg-indigo-500/10 border border-indigo-400/30 text-sm">
            <div className="font-medium mb-1">Worker refresh:</div>
            <pre className="whitespace-pre-wrap text-indigo-200 text-xs">
{JSON.stringify(refreshInfo, null, 2)}
            </pre>
          </div>
        )}

        {analysis && (
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
        )}
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, placeholder, type="text", required }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-300">{label}{required ? " *" : ""}</span>
      <input
        className="bg-white/10 border border-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50"
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
