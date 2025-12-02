// pages/bybit-snapshot.js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { app } from "../firebase";

const BYBIT_BASE = "https://api.bybit.com";
const BINANCE_BASE = "https://fapi.binance.com";
const OKX_BASE = "https://www.okx.com";

// ====================== BYBIT HELPERS ======================

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

// Lấy danh sách top N perpetual USDT trên Bybit (category=linear) theo volume 24h
async function getTopPerpSymbols(limit = 100) {
  // lấy dư limit một chút cho chắc
  const result = await getFromBybit("/v5/market/instruments-info", {
    category: "linear",
    limit: 500,
  });

  const list = Array.isArray(result.list) ? result.list : [];

  const usdtPerps = list.filter((item) => {
    // Tên field theo Bybit v5: quoteCoin, contractType
    const quote = item.quoteCoin;
    const contractType = item.contractType;
    return quote === "USDT" && contractType === "LinearPerpetual";
  });

  usdtPerps.sort((a, b) => {
    const va = Number(a.turnover24h ?? 0);
    const vb = Number(b.turnover24h ?? 0);
    return vb - va;
  });

  return usdtPerps.slice(0, limit).map((item) => item.symbol);
}

async function getKlines(
  symbol,
  intervals = ["1", "5", "15", "60", "240", "D"],
  limit = 200
) {
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
  const klines = await getKlines(symbol);

  return {
    symbol,
    klines,
    indicators: computeAllIndicators(klines),
    open_interest: await getOpenInterest(symbol),
    long_short_ratio: await getLongShortRatio(symbol),
    funding_history: await getFundingHistory(symbol),
    orderbook: await getOrderbook(symbol),
    recent_trades: await getRecentTrades(symbol),
    ticker: await getTicker(symbol),
  };
}

// ====================== INDICATOR & METRICS HELPERS ======================

// Parse kline Bybit: ["ts","open","high","low","close","volume", ...] -> object number
function parseKlinesList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      const [ts, open, high, low, close, volume] = row;
      return {
        ts: Number(ts),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      };
    })
    .sort((a, b) => a.ts - b.ts);
}

function calcEMA(values, period) {
  if (!values || values.length === 0) return null;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(values, period = 14) {
  if (!values || values.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  gains /= period;
  losses /= period;

  let rs;
  if (losses === 0) {
    rs = gains === 0 ? 1 : 100;
  } else {
    rs = gains / losses;
  }
  let rsi = 100 - 100 / (1 + rs);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    gains = (gains * (period - 1) + gain) / period;
    losses = (losses * (period - 1) + loss) / period;

    if (losses === 0) {
      rs = gains === 0 ? 1 : 100;
    } else {
      rs = gains / losses;
    }
    rsi = 100 - 100 / (1 + rs);
  }

  return rsi;
}

function calcMACD(values, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  if (!values || values.length < longPeriod + signalPeriod) {
    return { macd: null, signal: null, hist: null };
  }

  const kShort = 2 / (shortPeriod + 1);
  const kLong = 2 / (longPeriod + 1);
  const emaShortArr = [];
  const emaLongArr = [];

  let emaShort = values[0];
  let emaLong = values[0];

  for (let i = 0; i < values.length; i++) {
    const price = values[i];
    emaShort = i === 0 ? price : price * kShort + emaShort * (1 - kShort);
    emaLong = i === 0 ? price : price * kLong + emaLong * (1 - kLong);
    emaShortArr.push(emaShort);
    emaLongArr.push(emaLong);
  }

  const macdArr = emaShortArr.map((es, idx) => es - emaLongArr[idx]);

  const kSignal = 2 / (signalPeriod + 1);
  let emaSignal = macdArr[longPeriod];
  let signal = emaSignal;

  for (let i = longPeriod + 1; i < macdArr.length; i++) {
    emaSignal = macdArr[i] * kSignal + emaSignal * (1 - kSignal);
    signal = emaSignal;
  }

  const macd = macdArr[macdArr.length - 1];
  const hist = macd - (signal ?? 0);

  return { macd, signal, hist };
}

function calcATR(parsedKlines, period = 14) {
  if (!parsedKlines || parsedKlines.length <= period) return null;
  const trs = [];

  for (let i = 0; i < parsedKlines.length; i++) {
    const { high, low, close } = parsedKlines[i];
    if (i === 0) {
      trs.push(high - low);
    } else {
      const prevClose = parsedKlines[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }
  }

  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return atr;
}

function buildVolumeProfile(parsedKlines, bins = 24) {
  if (!parsedKlines || !parsedKlines.length) return null;

  const lows = parsedKlines.map((k) => k.low);
  const highs = parsedKlines.map((k) => k.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);

  if (!isFinite(minPrice) || !isFinite(maxPrice) || minPrice === maxPrice) {
    return null;
  }

  const binSize = (maxPrice - minPrice) / bins;
  const volumes = new Array(bins).fill(0);

  for (const k of parsedKlines) {
    const price = (k.high + k.low + k.close) / 3;
    let idx = Math.floor((price - minPrice) / binSize);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    volumes[idx] += k.volume;
  }

  const resultBins = [];
  for (let i = 0; i < bins; i++) {
    resultBins.push({
      from: minPrice + i * binSize,
      to: minPrice + (i + 1) * binSize,
      volume: volumes[i],
    });
  }

  return { minPrice, maxPrice, bins: resultBins };
}

// Tính indicators cho 1 timeframe (list kline raw từ Bybit)
function computeIndicatorsForInterval(rawList) {
  const parsed = parseKlinesList(rawList || []);
  if (!parsed.length) return null;

  const closes = parsed.map((k) => k.close);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);
  const ema200 = calcEMA(closes, 200);
  const rsi14 = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const atr14 = calcATR(parsed, 14);
  const volProfile = buildVolumeProfile(parsed, 24);

  const last = parsed[parsed.length - 1];

  return {
    last,
    rsi14,
    ema: { ema20, ema50, ema100, ema200 },
    macd,
    atr14,
    vol_profile: volProfile,
  };
}

// Tính indicators cho tất cả TF chính
const DEFAULT_INTERVALS = ["1", "5", "15", "60", "240", "D"];

function computeAllIndicators(klines) {
  const indicators = {};
  if (!klines) return indicators;

  for (const tf of DEFAULT_INTERVALS) {
    const raw = klines[tf];
    if (!raw || !raw.length) continue;
    const computed = computeIndicatorsForInterval(raw);
    if (computed) {
      indicators[tf] = computed;
    }
  }
  return indicators;
}

// Tính metrics phái sinh (OI, funding, long/short) + Binance/OKX nếu có
function computeDerivativesMetrics(
  bybitData,
  binanceForSymbol = null,
  okxForSymbol = null
) {
  const { open_interest, long_short_ratio, funding_history } = bybitData || {};
  const metrics = {
    bybit: {},
    binance: {},
    okx: {},
  };

  // --- Bybit OI ---
  if (Array.isArray(open_interest) && open_interest.length) {
    const latest = open_interest[0];
    const prev = open_interest[1] || null;
    const pastIdx = Math.min(open_interest.length - 1, 24);
    const past = open_interest[pastIdx] || null;

    const nowOI = Number(latest.openInterest ?? latest.open_interest ?? 0);
    metrics.bybit.open_interest_now = nowOI;

    if (prev) {
      const prevOI = Number(prev.openInterest ?? prev.open_interest ?? 0);
      const diff = nowOI - prevOI;
      metrics.bybit.open_interest_change_1 = diff;
      metrics.bybit.open_interest_change_1_pct =
        prevOI ? (diff / prevOI) * 100 : null;
    }

    if (past) {
      const pastOI = Number(past.openInterest ?? past.open_interest ?? 0);
      metrics.bybit.open_interest_change_n = nowOI - pastOI;
    }
  }

  // --- Bybit Funding ---
  if (Array.isArray(funding_history) && funding_history.length) {
    const lastF = Number(
      funding_history[0].fundingRate ??
        funding_history[0].funding_rate ??
        0
    );
    const avgF =
      funding_history.reduce(
        (sum, fh) =>
          sum + Number(fh.fundingRate ?? fh.funding_rate ?? 0),
        0
      ) / funding_history.length;

    metrics.bybit.funding_now = lastF;
    metrics.bybit.funding_avg = avgF;
  }

  // --- Bybit Long/Short Ratio ---
  if (Array.isArray(long_short_ratio) && long_short_ratio.length) {
    const last = long_short_ratio[0];
    const recent = long_short_ratio.slice(
      0,
      Math.min(10, long_short_ratio.length)
    );
    const avgBuy =
      recent.reduce(
        (sum, r) =>
          sum + Number(r.buyRatio ?? r.buy_ratio ?? 0),
        0
      ) / recent.length;

    metrics.bybit.long_short_ratio_now = {
      buyRatio: Number(last.buyRatio ?? last.buy_ratio ?? 0),
      sellRatio: Number(last.sellRatio ?? last.sell_ratio ?? 0),
    };
    metrics.bybit.long_short_ratio_avg_10 = avgBuy;
  }

  // --- Binance metrics (nếu có) ---
  if (binanceForSymbol) {
    const oiHist = binanceForSymbol.open_interest_hist_5m || [];
    if (oiHist.length) {
      const lastOI = oiHist[oiHist.length - 1];
      metrics.binance.open_interest_5m_last = {
        sumOpenInterest: Number(lastOI.sumOpenInterest ?? 0),
        sumOpenInterestValue: Number(lastOI.sumOpenInterestValue ?? 0),
        t: Number(lastOI.t ?? 0),
      };
    }

    const frHist = binanceForSymbol.funding_history || [];
    if (frHist.length) {
      const lastFr = frHist[frHist.length - 1];
      const avgFr =
        frHist.reduce(
          (sum, x) => sum + Number(x.fundingRate ?? 0),
          0
        ) / frHist.length;

      metrics.binance.funding_last = Number(lastFr.fundingRate ?? 0);
      metrics.binance.funding_avg = avgFr;
    }

    const taker = binanceForSymbol.taker_long_short_ratio_5m || [];
    if (taker.length) {
      const lt = taker[taker.length - 1];
      metrics.binance.taker_long_short_ratio_last = {
        buyVol: Number(lt.buyVol ?? 0),
        sellVol: Number(lt.sellVol ?? 0),
        buySellRatio: Number(lt.buySellRatio ?? 0),
        t: Number(lt.t ?? 0),
      };
    }
  }

  // --- OKX metrics (snapshot OI) ---
  if (okxForSymbol && okxForSymbol.open_interest) {
    metrics.okx.open_interest_snapshot = okxForSymbol.open_interest;
  }

  return metrics;
}

// ====================== BINANCE HELPERS ======================

async function getFromBinance(path, params = {}) {
  const url = new URL(path, BINANCE_BASE);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const res = await fetch(url.toString(), { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Binance HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
    );
  }

  return res.json();
}

// Funding history (perp) – fapi/v1/fundingRate
async function getBinanceFundingHistory(symbol, limit = 50) {
  try {
    const data = await getFromBinance("/fapi/v1/fundingRate", {
      symbol,
      limit,
    });

    return (data || []).map((row) => ({
      t: row.fundingTime,
      fundingRate: Number(row.fundingRate),
      symbol: row.symbol,
    }));
  } catch (err) {
    console.error("getBinanceFundingHistory error:", err.message || err);
    return [];
  }
}

// Open interest history – futures/data/openInterestHist
async function getBinanceOpenInterestHist(
  symbol,
  period = "5m",
  limit = 50
) {
  try {
    const data = await getFromBinance("/futures/data/openInterestHist", {
      symbol,
      period,
      limit,
    });

    return (data || []).map((row) => ({
      t: row.timestamp,
      sumOpenInterest: Number(row.sumOpenInterest),
      sumOpenInterestValue: Number(row.sumOpenInterestValue),
      symbol: row.symbol,
    }));
  } catch (err) {
    console.error("getBinanceOpenInterestHist error:", err.message || err);
    return [];
  }
}

// Taker long/short ratio – futures/data/takerlongshortRatio
async function getBinanceTakerLongShortRatio(
  symbol,
  period = "5m",
  limit = 50
) {
  try {
    const data = await getFromBinance("/futures/data/takerlongshortRatio", {
      symbol,
      period,
      limit,
    });

    return (data || []).map((row) => ({
      t: row.timestamp,
      buyVol: Number(row.buyVol),
      sellVol: Number(row.sellVol),
      buySellRatio: Number(row.buySellRatio),
      symbol: row.symbol,
    }));
  } catch (err) {
    console.error("getBinanceTakerLongShortRatio error:", err.message || err);
    return [];
  }
}

// ====================== OKX HELPERS ======================

async function getFromOkx(path, params = {}) {
  const url = new URL(path, OKX_BASE);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const res = await fetch(url.toString(), { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OKX HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
    );
  }

  return res.json();
}

// Map BYBIT symbol (e.g. BTCUSDT) -> OKX instId (BTC-USDT-SWAP)
function mapToOkxInstId(symbol) {
  if (!symbol.endsWith("USDT")) return null;
  const base = symbol.replace("USDT", "");
  return `${base}-USDT-SWAP`;
}

async function getOkxOpenInterestSnapshot(symbol) {
  try {
    const instId = mapToOkxInstId(symbol);
    if (!instId) return null;

    const data = await getFromOkx("/api/v5/public/open-interest", {
      instType: "SWAP",
      instId,
    });

    if (!data || data.code !== "0" || !Array.isArray(data.data)) {
      return null;
    }

    const row = data.data[0];
    if (!row) return null;

    return {
      instId: row.instId,
      oi: Number(row.oi),
      oiCcy: Number(row.oiCcy),
      ts: Number(row.ts),
    };
  } catch (err) {
    console.error("getOkxOpenInterestSnapshot error:", err.message || err);
    return null;
  }
}

// ====================== REACT PAGE ======================

export default function BybitSnapshotPage() {
  const router = useRouter();
  const auth = getAuth(app);

  const [symbolsInput, setSymbolsInput] = useState(""); // không mặc định nữa
  const [allTopSymbols, setAllTopSymbols] = useState([]);
  const [selectedSymbols, setSelectedSymbols] = useState([]);
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

  // Load danh sách top 100 symbol từ Bybit ngay khi vào trang
  useEffect(() => {
    let cancelled = false;

    async function loadTopSymbols() {
      try {
        const syms = await getTopPerpSymbols(100);
        if (!cancelled) {
          setAllTopSymbols(syms);
        }
      } catch (err) {
        console.error("Không tải được danh sách top symbols:", err);
        if (!cancelled) {
          setError((prev) =>
            prev
              ? prev +
                "\nKhông tải được danh sách top 100 symbols từ Bybit."
              : "Không tải được danh sách top 100 symbols từ Bybit."
          );
        }
      }
    }

    loadTopSymbols();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSymbol = (sym) => {
    setSelectedSymbols((prev) => {
      const exists = prev.includes(sym);
      const next = exists ? prev.filter((s) => s !== sym) : [...prev, sym];
      setSymbolsInput(next.join(","));
      return next;
    });
  };

  const handleFetch = async () => {
    const trimmed = symbolsInput.trim();
    if (!trimmed) {
      setError(
        "Vui lòng chọn symbol từ danh sách top 100 hoặc nhập ít nhất 1 symbol, ví dụ: BTCUSDT"
      );
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

      const binanceDeriv = {};
      const okxDeriv = {};

      for (const sym of symbols) {
        console.log("Fetching Bybit data for", sym);
        const bybitData = await collectSymbolData(sym);

        console.log("Fetching Binance/OKX data for", sym);
        let binFunding = [];
        let binOiHist = [];
        let binTakerLS = [];
        let okxOiSnap = null;

        try {
          const [
            _binFunding,
            _binOiHist,
            _binTakerLS,
            _okxOiSnap,
          ] = await Promise.all([
            getBinanceFundingHistory(sym),
            getBinanceOpenInterestHist(sym),
            getBinanceTakerLongShortRatio(sym),
            getOkxOpenInterestSnapshot(sym),
          ]);

          binFunding = _binFunding || [];
          binOiHist = _binOiHist || [];
          binTakerLS = _binTakerLS || [];
          okxOiSnap = _okxOiSnap || null;
        } catch (e) {
          console.error(
            `Error fetching Binance/OKX data for ${sym}:`,
            e.message || e
          );
        }

        const binForSym = {
          funding_history: binFunding,
          open_interest_hist_5m: binOiHist,
          taker_long_short_ratio_5m: binTakerLS,
        };

        const okxForSym = {
          open_interest: okxOiSnap,
        };

        binanceDeriv[sym] = binForSym;
        okxDeriv[sym] = okxForSym;

        const derived_metrics = computeDerivativesMetrics(
          bybitData,
          binForSym,
          okxForSym
        );

        symbolsData.push({
          ...bybitData,
          derived_metrics,
        });
      }

      const onchain = {
        exchange_netflow_daily: [],
        whale_exchange_flows: [],
      };

      const global_derivatives = {
        binance: binanceDeriv,
        okx: okxDeriv,
      };

      const payload = {
        version: 2,
        generated_at: generatedAt,
        per_exchange: {
          bybit: {
            category: "linear",
            symbols: symbolsData,
          },
        },
        onchain,
        global_derivatives,
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

      const ts = snapshot.generated_at || Date.now();
      let symbolsName = "ALL";
      const bybitData = snapshot.per_exchange?.bybit;
      if (
        bybitData &&
        Array.isArray(bybitData.symbols) &&
        bybitData.symbols.length > 0
      ) {
        symbolsName = bybitData.symbols.map((s) => s.symbol).join("_");
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
          Bybit Snapshot Tool (Client-side, v2 + Binance + OKX)
        </h1>
        <p className="text-sm md:text-base text-slate-400 mb-6">
          Trang này gọi trực tiếp Bybit, Binance và OKX từ trình duyệt của bạn
          (qua VPN nếu có), không đi qua server Render. Lấy dữ liệu kline / OI /
          funding / orderbook / trades cho nhiều symbol rồi cho phép copy JSON
          hoặc tải về file (schema v2 mở rộng) để gửi cho ChatGPT phân tích.
        </p>

        {/* Form nhập/chọn symbol */}
        <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4 md:p-5 shadow-xl shadow-black/30 mb-6">
          <label className="block text-sm font-medium mb-2">
            Symbols (phân tách bằng dấu phẩy)
          </label>
          <input
            type="text"
            value={symbolsInput}
            onChange={(e) => {
              setSymbolsInput(e.target.value);
              const raw = e.target.value
                .split(",")
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);
              setSelectedSymbols(raw);
            }}
            placeholder="VD: BTCUSDT,ETHUSDT,SOLUSDT"
            className="w-full rounded-xl bg-slate-950/80 border border-slate-700 px-3 py-2 text-sm md:text-base outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />

          {/* Chọn từ top 100 symbol */}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-medium">
                Chọn từ Top 100 perp USDT trên Bybit
              </span>
              <span className="text-[11px] text-slate-500">
                Sắp xếp theo khối lượng 24h (turnover24h)
              </span>
            </div>

            {allTopSymbols.length === 0 ? (
              <p className="text-xs text-slate-500">
                Đang tải danh sách top 100 symbols...
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                {allTopSymbols.map((sym) => {
                  const isSelected = selectedSymbols.includes(sym);
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => toggleSymbol(sym)}
                      className={`px-2 py-1 rounded-lg border text-[11px] transition-all ${
                        isSelected
                          ? "bg-emerald-500/80 border-emerald-400 text-slate-950 font-semibold"
                          : "bg-slate-900/80 border-slate-700 text-slate-200 hover:bg-slate-800"
                      }`}
                    >
                      {isSelected ? "✓ " : ""}
                      {sym}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-2 text-[11px] text-slate-500">
              Nhấn vào symbol để chọn/bỏ chọn. Các symbol đã chọn sẽ tự động
              cập nhật vào ô phía trên (có thể chỉnh tay nếu cần).
            </p>
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mt-4">
            <div className="text-xs md:text-sm text-slate-400 space-y-1">
              <div>
                Bybit API:{" "}
                <span className="font-mono text-[11px] md:text-xs break-all">
                  {BYBIT_BASE}
                </span>
              </div>
              <div>
                Binance API:{" "}
                <span className="font-mono text-[11px] md:text-xs break-all">
                  {BINANCE_BASE}
                </span>
              </div>
              <div>
                OKX API:{" "}
                <span className="font-mono text-[11px] md:text-xs break-all">
                  {OKX_BASE}
                </span>
              </div>
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
              Kết quả JSON (schema v2 + Binance + OKX)
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
              Chưa có dữ liệu. Chọn symbol từ danh sách top 100 hoặc nhập thủ
              công rồi bấm{" "}
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
