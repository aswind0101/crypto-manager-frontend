// frontend/pages/coin-analyzer/index.js
import { useState } from "react";

/**
 * ENV bắt buộc:
 * NEXT_PUBLIC_BACKEND_URL = https://<your-backend-domain>
 * Ví dụ: https://crypto-manager-backend.onrender.com
 *
 * Backend endpoints được dùng:
 * - POST /api/crypto-assets/register   → upsert coin vào crypto_assets
 * - POST /api/coins/:symbol/run-analysis → chạy analyzer 1 lần cho coin
 * - GET  /api/coins/:symbol/analyze      → lấy kết quả phân tích mới nhất
 */

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

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  async function handleAnalyze(e) {
    e.preventDefault();
    setError("");
    setAnalysis(null);
    setRegisterResp(null);
    if (!form.symbol || !form.name) {
      setError("Vui lòng nhập tối thiểu Symbol và Name.");
      return;
    }
    setLoading(true);
    try {
      // 1) Đăng ký/Upsert coin vào crypto_assets
      const regRes = await fetch(`${BACKEND}/api/crypto-assets/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol.trim().toUpperCase(),
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

      // 2) Chạy phân tích cho symbol
      const runRes = await fetch(`${BACKEND}/api/coins/${encodeURIComponent(form.symbol.trim().toUpperCase())}/run-analysis`, {
        method: "POST",
      });
      if (!runRes.ok) {
        const j = await runRes.json().catch(()=>({}));
        throw new Error(j.error || "Phân tích thất bại (run-analysis)");
      }
      // (Có thể bỏ qua payload runRes; mình sẽ fetch snapshot mới nhất để hiển thị)

      // 3) Lấy kết quả mới nhất
      const getRes = await fetch(`${BACKEND}/api/coins/${encodeURIComponent(form.symbol.trim().toUpperCase())}/analyze`);
      if (!getRes.ok) {
        const j = await getRes.json().catch(()=>({}));
        throw new Error(j.error || "Không lấy được kết quả phân tích");
      }
      const a = await getRes.json();
      setAnalysis(a);
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
          Đăng ký coin vào hệ thống → chạy phân tích → xem khuyến nghị mua/bán, buy zone, SL/TP.
        </p>

        {/* Form */}
        <form onSubmit={handleAnalyze} className="mt-8 grid gap-4 bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Symbol *" name="symbol" value={form.symbol} onChange={onChange} placeholder="VD: NEAR, BTC, ETH" required />
            <Field label="Name *" name="name" value={form.name} onChange={onChange} placeholder="VD: NEAR Protocol" required />
            <Field label="Chain" name="chain" value={form.chain} onChange={onChange} placeholder="VD: NEAR, Ethereum, BSC" />
            <Field label="Contract Address" name="contract_address" value={form.contract_address} onChange={onChange} placeholder="ERC20/BEP20... (để rỗng nếu L1)" />
            <Field label="Decimals" name="decimals" value={form.decimals} onChange={onChange} placeholder="VD: 18, 24" type="number" />
            <Field label="CoinGecko ID" name="coingecko_id" value={form.coingecko_id} onChange={onChange} placeholder="VD: near" />
            <Field label="Binance Symbol" name="binance_symbol" value={form.binance_symbol} onChange={onChange} placeholder="VD: NEARUSDT" />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {loading ? "Analyzing..." : "Register & Analyze"}
            </button>
            {error && <span className="text-red-400 text-sm">{error}</span>}
          </div>
        </form>

        {/* Kết quả đăng ký */}
        {registerResp && (
          <div className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/30">
            <div className="text-emerald-300 text-sm">
              ✅ Đã đăng ký/ cập nhật coin: <strong>{registerResp.symbol}</strong> – {registerResp.name}
            </div>
          </div>
        )}

        {/* Kết quả phân tích */}
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

            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="font-medium mb-2">Ghi chú</h3>
              <ul className="list-disc list-inside text-gray-300 text-sm space-y-1">
                <li>Giá/biểu đồ được lấy từ worker giá (Binance US ưu tiên, fallback CoinGecko). Cron 5’/lần theo server. :contentReference[oaicite:3]{index=3} :contentReference[oaicite:4]{index=4}</li>
                <li>On-chain netflow/large transfers được cập nhật định kỳ từ Covalent. :contentReference[oaicite:5]{index=5}</li>
                <li>News activity từ NewsAPI/CryptoPanic (15’/lần). :contentReference[oaicite:6]{index=6}</li>
                <li>Analyzer tổng hợp RSI/EMA/MACD + on-chain + news để tính điểm & khuyến nghị. :contentReference[oaicite:7]{index=7}</li>
              </ul>
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
