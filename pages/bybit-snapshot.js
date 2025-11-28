// pages/bybit-snapshot.js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { app } from "../firebase";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://crypto-manager-backend.onrender.com";

export default function BybitSnapshotPage() {
  const router = useRouter();
  const auth = getAuth(app);

  const [symbolsInput, setSymbolsInput] = useState("BTCUSDT,ETHUSDT");
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Bảo vệ route: nếu chưa login => về /login
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.push("/login");
      }
    });

    return () => unsubscribe();
  }, [auth, router]);

  const handleFetch = async () => {
    const trimmed = symbolsInput.trim();
    if (!trimmed) {
      setError("Vui lòng nhập ít nhất 1 symbol, ví dụ: BTCUSDT");
      return;
    }

    setLoading(true);
    setError("");
    setSnapshot(null);
    setCopied(false);

    try {
      const query = encodeURIComponent(trimmed);
      const url = `${BACKEND_URL}/api/bybit/snapshot?symbols=${query}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        // Backend trả status != 2xx
        setError(
          data?.error ||
            `Request failed with status ${res.status} ${res.statusText}`
        );
        setSnapshot(null);
      } else if (data.error) {
        // Backend trả JSON { error: ... }
        setError(data.error);
        setSnapshot(null);
      } else {
        setSnapshot(data);
      }
    } catch (err) {
      console.error("Fetch snapshot error:", err);
      setError(err.message || "Fetch snapshot error");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-semibold mb-2">
          Bybit Snapshot Tool
        </h1>
        <p className="text-sm md:text-base text-slate-400 mb-6">
          Lấy dữ liệu kline / OI / funding / orderbook / recent trades cho
          nhiều symbol (BTCUSDT, ETHUSDT, SOLUSDT...). Sau đó bạn chỉ cần copy
          JSON và dán qua ChatGPT để mình phân tích swing 1–2 ngày.
        </p>

        {/* Form nhập symbol */}
        <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4 md:p-5 shadow-xl shadow-black/30 mb-6">
          <label className="block text-sm font-medium mb-2">
            Symbols (phân tách bằng dấu phẩy)
          </label>
          <input
            type="text"
            value={symbolsInput}
            onChange={(e) => setSymbolsInput(e.target.value)}
            placeholder="BTCUSDT,ETHUSDT,SOLUSDT"
            className="w-full rounded-xl bg-slate-950/80 border border-slate-700 px-3 py-2 text-sm md:text-base outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mt-4">
            <div className="text-xs md:text-sm text-slate-400">
              Backend:{" "}
              <span className="font-mono text-[11px] md:text-xs break-all">
                {BACKEND_URL}/api/bybit/snapshot
              </span>
            </div>
            <button
              onClick={handleFetch}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Đang lấy dữ liệu..." : "Fetch Snapshot"}
            </button>
          </div>

          {error && (
            <div className="mt-3 text-xs md:text-sm text-red-400 bg-red-950/40 border border-red-500/40 rounded-xl px-3 py-2">
              <span className="font-semibold">Lỗi:</span> {error}
            </div>
          )}
        </div>

        {/* Kết quả */}
        <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4 md:p-5 shadow-xl shadow-black/30">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm md:text-base font-semibold">
              Kết quả JSON
            </h2>
            <button
              onClick={handleCopy}
              disabled={!snapshot}
              className="text-xs md:text-sm px-3 py-1 rounded-lg border border-slate-600 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {copied ? "✅ Đã copy" : "Copy JSON"}
            </button>
          </div>

          {!snapshot && !error && !loading && (
            <p className="text-xs md:text-sm text-slate-500">
              Chưa có dữ liệu. Nhập danh sách symbol rồi bấm{" "}
              <span className="font-semibold">Fetch Snapshot</span>.
            </p>
          )}

          <pre className="mt-2 max-h-[480px] overflow-auto text-[11px] md:text-xs bg-slate-950/80 rounded-xl p-3 border border-slate-800 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
            {snapshot ? JSON.stringify(snapshot, null, 2) : "// no data"}
          </pre>
        </div>
      </div>
    </div>
  );
}
