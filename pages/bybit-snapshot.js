// pages/bybit-snapshot.js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { app } from "../firebase";

const BYBIT_BASE = "https://api.bybit.com";

// ===== Helpers gọi Bybit trực tiếp từ browser =====

async function getFromBybit(path, params = {}) {
  const url = new URL(path, BYBIT_BASE);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Bybit HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
    );
  }

  const data = await res.json();

  if (data.retCode !== 0) {
    throw new Error(`Bybit retCode ${data.retCode}: ${data.retMsg}`);
  }

  return data.result || {};
}

async function getKlines(symbol, intervals = ["1", "5", "15", "60", "240", "D"], limit = 200) {
  const klines = {};
  for (const interval of intervals) {
    const result = await getFromBybit("/v5/market/kline", {
      category: "linear",
      symbol,
      interval,
      limit,
    });
    klines[interval] = result.list || [];
  }
  return klines;
}

async function getOpenInterest(symbol, intervalTime = "5min", limit = 200) {
  const result = await getFromBybit("/v5/market/open-interest", {
    category: "linear",
    symbol,
    intervalTime,
    limit,
  });
  return result.list || [];
}

async function getLongShortRatio(symbol, period = "1h", limit = 100) {
  const result = await getFromBybit("/v5/market/account-ratio", {
    category: "linear",
    symbol,
    period,
    limit,
  });
  return result.list || [];
}

async function getFundingHistory(symbol, limit = 50) {
  const result = await getFromBybit("/v5/market/funding/history", {
    category: "linear",
    symbol,
    limit,
  });
  return result.list || [];
}

async function getOrderbook(symbol, limit = 25) {
  const result = await getFromBybit("/v5/market/orderbook", {
    category: "linear",
    symbol,
    limit,
  });
  return {
    bids: result.b || [],
    asks: result.a || [],
  };
}

async function getRecentTrades(symbol, limit = 500) {
  const result = await getFromBybit("/v5/market/recent-trade", {
    category: "linear",
    symbol,
    limit,
  });
  return result.list || [];
}

async function getTicker(symbol) {
  const result = await getFromBybit("/v5/market/tickers", {
    category: "linear",
    symbol,
  });
  const list = result.list || [];
  return list[0] || {};
}

async function collectSymbolData(symbol) {
  return {
    symbol,
    klines: await getKlines(symbol),
    open_interest: await getOpenInterest(symbol),
    long_short_ratio: await getLongShortRatio(symbol),
    funding_history: await getFundingHistory(symbol),
    orderbook: await getOrderbook(symbol),
    recent_trades: await getRecentTrades(symbol),
    ticker: await getTicker(symbol),
  };
}

// ===== React page =====

export default function BybitSnapshotPage() {
  const router = useRouter();
  const auth = getAuth(app);

  const [symbolsInput, setSymbolsInput] = useState("BTCUSDT,ETHUSDT");
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Bảo vệ route: chưa login => về /login
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

    const symbols = trimmed
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      setError("Danh sách symbol không hợp lệ");
      return;
    }

    setLoading(true);
    setError("");
    setSnapshot(null);
    setCopied(false);

    try {
      const generatedAt = Date.now();
      const symbolsData = [];

      for (const sym of symbols) {
        // eslint-disable-next-line no-console
        console.log("Fetching data for", sym);
        const data = await collectSymbolData(sym);
        symbolsData.push(data);
      }

      const payload = {
        exchange: "bybit",
        category: "linear",
        generated_at: generatedAt,
        symbols: symbolsData,
      };

      setSnapshot(payload);
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

  const handleDownload = () => {
    if (!snapshot) return;

    try {
      const jsonString = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });

      // Tạo tên file: bybit_snapshot_<timestamp>_<symbols>.json
      const ts = snapshot.generated_at || Date.now();
      let symbolsName = "ALL";
      if (Array.isArray(snapshot.symbols) && snapshot.symbols.length > 0) {
        symbolsName = snapshot.symbols.map((s) => s.symbol).join("_");
      }
      const filename = `bybit_snapshot_${ts}_${symbolsName}.json`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-semibold mb-2">
          Bybit Snapshot Tool (Client-side)
        </h1>
        <p className="text-sm md:text-base text-slate-400 mb-6">
          Trang này gọi trực tiếp Bybit từ trình duyệt của bạn (qua VPN nếu có),
          không đi qua server Render. Lấy dữ liệu kline / OI / funding / orderbook / trades
          cho nhiều symbol rồi cho phép copy JSON hoặc tải về file để gửi cho ChatGPT phân tích.
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
              API base:{" "}
              <span className="font-mono text-[11px] md:text-xs break-all">
                {BYBIT_BASE}
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
            <div className="mt-3 text-xs md:text-sm text-red-400 bg-red-950/40 border border-red-500/40 rounded-xl px-3 py-2 whitespace-pre-wrap">
              <span className="font-semibold">Lỗi:</span> {error}
            </div>
          )}
        </div>

        {/* Kết quả */}
        <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4 md:p-5 shadow-xl shadow-black/30">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
            <h2 className="text-sm md:text-base font-semibold">
              Kết quả JSON
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                disabled={!snapshot}
                className="text-xs md:text-sm px-3 py-1 rounded-lg border border-slate-600 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copied ? "✅ Đã copy" : "Copy JSON"}
              </button>
              <button
                onClick={handleDownload}
                disabled={!snapshot}
                className="text-xs md:text-sm px-3 py-1 rounded-lg border border-emerald-500/60 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ⬇️ Download JSON
              </button>
            </div>
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
