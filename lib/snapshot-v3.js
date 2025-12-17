// snapshot-v3.1.js
// Node/Next-friendly snapshot builder v3.1
// Nâng cấp từ snapshot-v3.js (v3.0) để bám FULL spec Price Analyzer v3.0
// - Indicators: trend_label, trend_strength, ema_stack_label, rsi_bias_label
// - Price structure: structure_phase, recent_bos, htf_trend_context
// - Key levels: previous day / weekly / monthly
// - Derived metrics: *_trend_label, volatility_state
// - Sentiment: funding_extreme, volatility_sentiment, market_summary

const BYBIT_BASE = "https://api.bybit.com";
const BINANCE_BASE = "https://fapi.binance.com";
const OKX_BASE = "https://www.okx.com";

// ====================== ONCHAIN VIA BACKEND (Dune proxy) ======================

const ONCHAIN_API_BASE =
  process.env.NEXT_PUBLIC_ONCHAIN_API_BASE || "";

async function fetchOnchainBlock(assetOrSymbol = "BTC") {
  if (!ONCHAIN_API_BASE) {
    console.warn(
      "[snapshot-v3] NEXT_PUBLIC_ONCHAIN_API_BASE chưa được set, onchain sẽ rỗng."
    );
    return {
      exchange_netflow_daily: [],
      whale_exchange_flows: [],
      whale_summary: {},
    };
  }

  try {
    const url = new URL("/api/bybit/onchain", ONCHAIN_API_BASE);
    // Gửi nguyên asset/symbol client đang dùng (BTC, ETH, LINKUSDT, ...)
    url.searchParams.set("asset", assetOrSymbol);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "[snapshot-v3] /onchain HTTP error:",
        res.status,
        text
      );
      return {
        exchange_netflow_daily: [],
        whale_exchange_flows: [],
        whale_summary: {},
      };
    }

    const data = await res.json();

    return {
      exchange_netflow_daily: data.exchange_netflow_daily || [],
      whale_exchange_flows: data.whale_exchange_flows || [],
      whale_summary: data.whale_summary || {},
    };
  } catch (err) {
    console.error("[snapshot-v3] fetchOnchainBlock error:", err);
    return {
      exchange_netflow_daily: [],
      whale_exchange_flows: [],
      whale_summary: {},
    };
  }
}

// ====================== ONCHAIN COMPACT HELPERS ======================

// Chuẩn hóa symbol/perp (BTCUSDT, ETHUSDT, LINKPERP...) về base asset (BTC, ETH, LINK...)
function normalizeBaseAssetFromSymbol(value = "BTC") {
  const raw = String(value || "").toUpperCase().trim();
  if (!raw) return "BTC";

  const suffixes = ["USDT", "USDC", "BUSD", "USD", "PERP"];
  for (const suf of suffixes) {
    if (raw.endsWith(suf)) {
      const base = raw.slice(0, -suf.length);
      return base || raw;
    }
  }
  return raw;
}

function classifyNetflowTrend(sumUsd) {
  const v = Math.abs(sumUsd || 0);
  if (v < 1e6) return "flat"; // < 1M USD thì coi như phẳng

  const dir = sumUsd > 0 ? "inflow" : "outflow";
  let strength = "weak";
  if (v >= 5e7) strength = "strong"; // >= 50M
  else if (v >= 1e7) strength = "normal"; // 10M - 50M

  return `${dir}_${strength}`; // ví dụ: inflow_normal, outflow_strong
}

function classifyWhaleTrend(sumUsd) {
  const v = Math.abs(sumUsd || 0);
  if (v < 1e6) return "whales_neutral";

  if (sumUsd > 0) return "whales_depositing";
  return "whales_withdrawing";
}

function buildOnchainCompact(rawOnchain, assetOrSymbol = "BTC") {
  const source = rawOnchain || {};
  const exchangeNetflow = Array.isArray(source.exchange_netflow_daily)
    ? source.exchange_netflow_daily
    : [];
  const whaleFlows = Array.isArray(source.whale_exchange_flows)
    ? source.whale_exchange_flows
    : [];

  // Xác định base asset
  let baseAsset =
    (exchangeNetflow[0] && exchangeNetflow[0].asset) ||
    normalizeBaseAssetFromSymbol(assetOrSymbol);

  // ---------- 1) NETFLOW: rút gọn còn 7 ngày ----------
  const sortedNet = [...exchangeNetflow].sort(
    (a, b) => (a.t || 0) - (b.t || 0)
  );
  const netLast7 = sortedNet.slice(-7);

  const netflow7d = netLast7.map((row) => ({
    t: Number(row.t) || 0,
    net: Number(row.netflow) || 0,
    net_usd: Number(row.netflow_usd) || 0,
  }));

  // ---------- 2) WHALE FLOWS: gộp theo ngày & theo sàn ----------
  const perDay = new Map();
  const perExchange = new Map();

  for (const row of whaleFlows) {
    const t = Number(row.t) || 0;
    if (!t) continue;
    const ex = row.exchange || "unknown";
    const dir = row.direction;
    const usd = Number(row.amount_usd) || 0;

    // Gộp theo ngày
    if (!perDay.has(t)) {
      perDay.set(t, { t, deposit_usd: 0, withdraw_usd: 0 });
    }
    const day = perDay.get(t);
    if (dir === "deposit") day.deposit_usd += usd;
    else if (dir === "withdraw") day.withdraw_usd += usd;

    // Gộp theo sàn (7d)
    if (!perExchange.has(ex)) {
      perExchange.set(ex, {
        exchange: ex,
        deposit_usd_7d: 0,
        withdraw_usd_7d: 0,
      });
    }
    const exAgg = perExchange.get(ex);
    if (dir === "deposit") exAgg.deposit_usd_7d += usd;
    else if (dir === "withdraw") exAgg.withdraw_usd_7d += usd;
  }

  const whaleDaily = Array.from(perDay.values()).sort((a, b) => a.t - b.t);
  const whaleLast7 = whaleDaily.slice(-7);

  const whaleNetflow7d = whaleLast7.map((day) => {
    const netWhale = day.withdraw_usd - day.deposit_usd;
    return {
      t: day.t,
      deposit_usd: day.deposit_usd,
      withdraw_usd: day.withdraw_usd,
      net_whale_usd: netWhale,
    };
  });

  // Helper cộng N ngày cuối
  function sumLastN(arr, key, n) {
    if (!arr || !arr.length) return 0;
    const sub = arr.slice(-n);
    return sub.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
  }

  // ---------- 3) SUMMARY last_day / 3d / 7d ----------
  const lastDayNetflowUsd = netflow7d.length
    ? netflow7d[netflow7d.length - 1].net_usd
    : 0;

  const lastDayWhale = whaleNetflow7d.length
    ? whaleNetflow7d[whaleNetflow7d.length - 1]
    : { deposit_usd: 0, withdraw_usd: 0, net_whale_usd: 0 };

  const last3dNetflowUsd = sumLastN(netflow7d, "net_usd", 3);
  const last7dNetflowUsd = sumLastN(netflow7d, "net_usd", 7);
  const last3dWhaleNetUsd = sumLastN(whaleNetflow7d, "net_whale_usd", 3);
  const last7dWhaleNetUsd = sumLastN(whaleNetflow7d, "net_whale_usd", 7);

  // ---------- 4) Dominant exchanges ----------
  const dominantExList = [];
  let totalAbsNet = 0;

  for (const agg of perExchange.values()) {
    const net = agg.withdraw_usd_7d - agg.deposit_usd_7d;
    const item = {
      exchange: agg.exchange,
      net_whale_usd_7d: net,
    };
    dominantExList.push(item);
    totalAbsNet += Math.abs(net);
  }

  dominantExList.sort(
    (a, b) => Math.abs(b.net_whale_usd_7d) - Math.abs(a.net_whale_usd_7d)
  );
  const topExchanges = dominantExList.slice(0, 5);

  // ---------- 5) Labels ----------
  const netflowTrend = classifyNetflowTrend(last7dNetflowUsd);
  const whaleTrend = classifyWhaleTrend(last7dWhaleNetUsd);

  let exchangeConcentration = "diversified";
  if (topExchanges.length && totalAbsNet > 0) {
    const share =
      Math.abs(topExchanges[0].net_whale_usd_7d) / totalAbsNet;
    if (share > 0.5) {
      const exKey = topExchanges[0].exchange
        .toLowerCase()
        .replace(/\s+/g, "_");
      exchangeConcentration = `${exKey}_dominant`;
    }
  }

  let onchainSentiment = "onchain_neutral";
  if (
    netflowTrend.startsWith("outflow") &&
    whaleTrend === "whales_withdrawing"
  ) {
    onchainSentiment = "onchain_bullish";
  } else if (
    netflowTrend.startsWith("inflow") &&
    whaleTrend === "whales_depositing"
  ) {
    onchainSentiment = "onchain_bearish";
  }

  function buildSummaryText() {
    if (!netflow7d.length && !whaleNetflow7d.length) {
      return `Chưa có dữ liệu onchain đáng kể cho ${baseAsset}.`;
    }
    const parts = [];

    if (netflowTrend.startsWith("outflow")) {
      parts.push(
        `${baseAsset} có xu hướng rút khỏi sàn (outflow) trong 7 ngày gần đây.`
      );
    } else if (netflowTrend.startsWith("inflow")) {
      parts.push(
        `${baseAsset} có xu hướng nạp lên sàn (inflow) trong 7 ngày gần đây.`
      );
    }

    if (whaleTrend === "whales_withdrawing") {
      parts.push("Whale chủ yếu rút khỏi sàn, thiên về tích lũy.");
    } else if (whaleTrend === "whales_depositing") {
      parts.push(
        "Whale chủ yếu nạp lên sàn, tạo áp lực bán tiềm năng."
      );
    }

    if (topExchanges.length) {
      parts.push(
        `Dòng tiền whale tập trung nhất ở sàn ${topExchanges[0].exchange}.`
      );
    }

    return parts.join(" ");
  }

  const summary = {
    last_day: {
      netflow_usd: lastDayNetflowUsd,
      whale_net_usd: lastDayWhale.net_whale_usd,
      whale_deposit_usd: lastDayWhale.deposit_usd,
      whale_withdraw_usd: lastDayWhale.withdraw_usd,
    },
    last_3d: {
      netflow_usd: last3dNetflowUsd,
      whale_net_usd: last3dWhaleNetUsd,
    },
    last_7d: {
      netflow_usd: last7dNetflowUsd,
      whale_net_usd: last7dWhaleNetUsd,
    },
    dominant_exchanges: topExchanges,
  };

  const labels = {
    netflow_trend: netflowTrend,
    whale_trend: whaleTrend,
    exchange_concentration: exchangeConcentration,
    onchain_sentiment: onchainSentiment,
    summary_text: buildSummaryText(),
  };

  return {
    asset: baseAsset,
    updated_at: Date.now(),
    timeseries: {
      netflow_7d: netflow7d,
      whale_netflow_7d: whaleNetflow7d,
    },
    summary,
    labels,
  };
}


// ====================== BYBIT HELPERS ======================

async function getFromBybit(path, params = {}) {
  const url = new URL(path, BYBIT_BASE);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const res = await fetch(url.toString(), { method: "GET" });

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

// Chỉ lấy TF cần cho plan H1–H4–Daily
async function getKlinesForV3(symbol, intervals = ["60", "240", "D"], limit = 200) {
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

// ====================== INDICATOR HELPERS ======================

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

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1) + 0) / period;
    } else {
      avgGain = (avgGain * (period - 1) + 0) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (!values || values.length < slow + signalPeriod)
    return { macd: null, signal: null, hist: null };

  const emaFast = calcEMA(values, fast);
  const emaSlow = calcEMA(values, slow);
  if (emaFast == null || emaSlow == null)
    return { macd: null, signal: null, hist: null };

  const macdArr = [];
  for (let i = slow; i < values.length; i++) {
    const slice = values.slice(0, i + 1);
    const eFast = calcEMA(slice, fast);
    const eSlow = calcEMA(slice, slow);
    if (eFast != null && eSlow != null) {
      macdArr.push(eFast - eSlow);
    }
  }

  if (macdArr.length < signalPeriod)
    return { macd: null, signal: null, hist: null };

  const macd = macdArr[macdArr.length - 1];
  const signal = calcEMA(macdArr, signalPeriod);
  const hist = signal != null ? macd - signal : null;

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

// ====== v3.1: Helper suy ra label/strength cho trend & RSI/EMA ======

function classifyEmaStack(ema) {
  if (!ema) return "ema_unknown";
  const { ema20, ema50, ema100, ema200 } = ema;

  if (
    ema20 != null &&
    ema50 != null &&
    ema100 != null &&
    ema200 != null
  ) {
    if (ema20 > ema50 && ema50 > ema100 && ema100 > ema200) {
      return "bull_stack";
    }
    if (ema20 < ema50 && ema50 < ema100 && ema100 < ema200) {
      return "bear_stack";
    }
  }
  return "ema_mixed";
}

function classifyRsiBias(rsi14) {
  if (rsi14 == null) return "rsi_neutral";
  if (rsi14 >= 70) return "rsi_overbought";
  if (rsi14 >= 60) return "rsi_bull";
  if (rsi14 <= 30) return "rsi_oversold";
  if (rsi14 <= 40) return "rsi_bear";
  return "rsi_neutral";
}

// Helper: suy ra trend_state từ EMA + RSI
function deriveTrendState(lastClose, ema, rsi14) {
  if (!lastClose || !ema) return "unknown";

  const { ema20, ema50, ema100, ema200 } = ema;

  const above20 = ema20 != null && lastClose > ema20;
  const above50 = ema50 != null && lastClose > ema50;
  const above100 = ema100 != null && lastClose > ema100;
  const above200 = ema200 != null && lastClose > ema200;

  const emaStack = classifyEmaStack(ema);
  const rsiBias = classifyRsiBias(rsi14);

  if (above20 && above50 && emaStack === "bull_stack") {
    return "bull_above_ema20_50";
  }
  if (!above20 && !above50 && emaStack === "bear_stack") {
    return "bear_below_ema20_50";
  }
  if (above20 && !above50) {
    return "rebound_above_20_below_50";
  }
  if (!above20 && above50) {
    return "pullback_below_20_above_50";
  }
  if (above200 && emaStack === "bull_stack" && rsiBias.startsWith("rsi_bull")) {
    return "strong_bull_trend";
  }
  if (!above200 && emaStack === "bear_stack" && rsiBias.startsWith("rsi_bear")) {
    return "strong_bear_trend";
  }

  return "choppy_mixed";
}

// v3.1: build trend label + strength dùng cho Trend Radar
function deriveTrendLabelAndStrength(tfLabel, trend_state) {
  if (!trend_state || trend_state === "unknown") {
    return {
      trend_label: `Range / unclear (${tfLabel})`,
      trend_strength: "neutral",
    };
  }

  if (trend_state === "strong_bull_trend") {
    return {
      trend_label: `Strong uptrend (${tfLabel})`,
      trend_strength: "strong_bull",
    };
  }
  if (trend_state === "strong_bear_trend") {
    return {
      trend_label: `Strong downtrend (${tfLabel})`,
      trend_strength: "strong_bear",
    };
  }
  if (
    trend_state === "bull_above_ema20_50" ||
    trend_state === "rebound_above_20_below_50"
  ) {
    return {
      trend_label: `Uptrend / bullish bias (${tfLabel})`,
      trend_strength: "bull",
    };
  }
  if (
    trend_state === "bear_below_ema20_50" ||
    trend_state === "pullback_below_20_above_50"
  ) {
    return {
      trend_label: `Downtrend / bearish bias (${tfLabel})`,
      trend_strength: "bear",
    };
  }

  return {
    trend_label: `Choppy / range (${tfLabel})`,
    trend_strength: "range",
  };
}
// ====================== CLOSED-CANDLE SANITIZER ======================

// Mapping seconds cho từng timeframe trong snapshot v3
function tfToSec(tf) {
  if (tf === "5") return 5 * 60;
  if (tf === "15") return 15 * 60;
  if (tf === "60") return 60 * 60;
  if (tf === "240") return 4 * 60 * 60;
  if (tf === "D") return 24 * 60 * 60;
  return null;
}

/**
 * Bybit thường trả về forming candle ở cuối mảng.
 * Hàm này:
 * - parse klines -> sort theo ts
 * - xác định forming candle theo nowMs và tfSec
 * - trả về { closed: [...], forming: candle|null }
 */
function splitClosedAndForming(rawList, tf, nowMs) {
  const parsed = parseKlinesList(rawList || []);
  if (!parsed.length) return { closed: [], forming: null };

  const tfSec = tfToSec(tf);
  if (!tfSec) {
    // fallback an toàn: coi candle cuối là forming
    return {
      closed: parsed.slice(0, -1),
      forming: parsed[parsed.length - 1] || null,
    };
  }

  const last = parsed[parsed.length - 1];
  const isForming = typeof last?.ts === "number" && nowMs < last.ts + tfSec * 1000;

  if (isForming) {
    return {
      closed: parsed.slice(0, -1),
      forming: last,
    };
  }

  // Nếu last đã qua thời gian đóng -> coi là closed (forming null)
  return { closed: parsed, forming: null };
}
function parseClosedKlines(rawList, tf, nowMs) {
  const { closed, forming } = splitClosedAndForming(rawList || [], tf, nowMs);
  return {
    parsed_closed: closed,                 // parsed + closed-only
    parsed_forming: forming || null,       // parsed forming candle (optional)
  };
}
function computeIndicatorsForInterval(rawList, tfLabel, tfKey) {
  const nowMs = Date.now();

  // Tách closed/forming theo tfKey (60/240/D/5/15)
  const { closed, forming } = splitClosedAndForming(rawList || [], tfKey, nowMs);

  // Bắt buộc phải có ít nhất 1 closed candle để “last” hợp lệ
  if (!closed.length) return null;

  const closes = closed.map((k) => k.close);

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);
  const ema200 = calcEMA(closes, 200);
  const rsi14 = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const atr14 = calcATR(closed, 14);
  const volProfile = buildVolumeProfile(closed, 24);

  const last_closed = closed[closed.length - 1];
  const ema = { ema20, ema50, ema100, ema200 };

  const trend_state = deriveTrendState(last_closed.close, ema, rsi14);
  const ema_stack_label = classifyEmaStack(ema);
  const rsi_bias_label = classifyRsiBias(rsi14);
  const { trend_label, trend_strength } = deriveTrendLabelAndStrength(tfLabel, trend_state);

  return {
    // Backward compatible field
    last: last_closed,

    // Optional debug (không bắt buộc)
    current: forming || null,

    rsi14,
    ema,
    macd,
    atr14,
    vol_profile: volProfile,
    trend_state,
    trend_label,
    trend_strength,
    ema_stack_label,
    rsi_bias_label,
  };
}
function computeIndicatorsFromParsedClosed(parsedClosed, tfLabel) {
  if (!Array.isArray(parsedClosed) || parsedClosed.length === 0) return null;

  const closes = parsedClosed.map((k) => k.close);

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);
  const ema200 = calcEMA(closes, 200);
  const rsi14 = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const atr14 = calcATR(parsedClosed, 14);
  const volProfile = buildVolumeProfile(parsedClosed, 24);

  const last_closed = parsedClosed[parsedClosed.length - 1];

  const ema = { ema20, ema50, ema100, ema200 };
  const trend_state = deriveTrendState(last_closed.close, ema, rsi14);
  const ema_stack_label = classifyEmaStack(ema);
  const rsi_bias_label = classifyRsiBias(rsi14);
  const { trend_label, trend_strength } = deriveTrendLabelAndStrength(tfLabel, trend_state);

  return {
    last: last_closed,       // closed candle đúng 100%
    current: null,           // intentionally null (đã “đóng băng” theo closed list)
    rsi14,
    ema,
    macd,
    atr14,
    vol_profile: volProfile,
    trend_state,
    trend_label,
    trend_strength,
    ema_stack_label,
    rsi_bias_label,
  };
}

function computeHTFIndicatorsFromClosedParsed(parsed60, parsed240, parsedD) {
  return {
    "60": computeIndicatorsFromParsedClosed(parsed60, "H1"),
    "240": computeIndicatorsFromParsedClosed(parsed240, "H4"),
    "D": computeIndicatorsFromParsedClosed(parsedD, "D1"),
  };
}

// Chỉ giữ 60 / 240 / D cho v3.1
const INTERVALS_V3 = ["60", "240", "D"];

// LTF intervals cho snapshot riêng (realtime timing)
const LTF_INTERVALS_V3 = ["5", "15"];

// Tính indicators cho M5 / M15 từ klines thô (Bybit)
function computeLTFIndicatorsForV3(klines) {
  const indicators = {};
  if (!klines) return indicators;

  for (const tf of LTF_INTERVALS_V3) {
    const raw = klines[tf];
    if (!raw || !raw.length) continue;

    // Label TF cho logic nội bộ (computeIndicatorsForInterval)
    const tfLabel = tf === "5" ? "M5" : "M15";

    const computed = computeIndicatorsForInterval(raw, tfLabel, tf);
    if (computed) {
      indicators[tf] = computed;
    }
  }

  return indicators;
}


function computeIndicatorsForV3(klines) {
  const indicators = {};
  if (!klines) return indicators;

  for (const tf of INTERVALS_V3) {
    const raw = klines[tf];
    if (!raw || !raw.length) continue;
    const tfLabel = tf === "60" ? "H1" : tf === "240" ? "H4" : "D1";
    const computed = computeIndicatorsForInterval(raw, tfLabel, tf);
    if (computed) {
      indicators[tf] = computed;
    }
  }
  return indicators;
}

// Build block klines_compact cho mỗi TF
// 60: last 20, 240: last 20, D: last 30
function buildKlinesCompact(klinesRaw, config) {
  const defaultCfg = { "60": 20, "240": 20, "D": 30 };
  const cfg = config || defaultCfg;

  const result = {};

  for (const tf of Object.keys(cfg)) {
    const raw = (klinesRaw && klinesRaw[tf]) || [];
    if (!raw || !raw.length) {
      result[tf] = [];
      continue;
    }

    const nowMs = Date.now();
    const { closed } = splitClosedAndForming(raw, tf, nowMs);

    const n = cfg[tf];
    const sliceClosed = closed.slice(-n);

    result[tf] = sliceClosed.map((c) => ({
      ts: c.ts,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));
  }


  return result;
}

// LTF compact: 5m / 15m – dùng cho timing realtime
// 5m: last 36 (3h), 15m: last 32 (8h)
function buildLtfKlinesCompact(klinesRaw, config) {
  const defaultCfg = { "5": 36, "15": 32 };
  const cfg = config || defaultCfg;

  const result = {};
  const nowMs = Date.now();

  for (const tf of Object.keys(cfg)) {
    const raw = (klinesRaw && klinesRaw[tf]) || [];
    if (!raw || !raw.length) {
      result[tf] = [];
      continue;
    }

    const { closed } = splitClosedAndForming(raw, tf, nowMs);

    const n = cfg[tf];
    const sliceClosed = closed.slice(-n);

    result[tf] = sliceClosed.map((c) => ({
      ts: c.ts,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));
  }

  return result;
}
// ====================== DERIVATIVES METRICS ======================

// v3.1: thêm đánh giá trend OI, funding, L/S, volatility_state
function labelTrendFromDiff(pct) {
  if (pct == null) return "trend_unknown";
  if (pct > 5) return "rising_strong";
  if (pct > 1) return "rising";
  if (pct < -5) return "falling_strong";
  if (pct < -1) return "falling";
  return "flat";
}

function labelFundingExtreme(now, avg) {
  if (now == null) return "funding_neutral";
  const absNow = Math.abs(now);
  const absAvg = Math.abs(avg ?? 0);

  if (absNow > 3 * (absAvg || 0.0001) && absNow > 0.0007) {
    return now > 0 ? "funding_extreme_positive" : "funding_extreme_negative";
  }
  if (absNow > 0.0004) {
    return now > 0 ? "funding_positive" : "funding_negative";
  }
  return "funding_neutral";
}

function computeVolatilityState(indicators) {
  // dùng ATR14 Daily làm base
  const d = indicators?.D;
  if (!d || !d.atr14 || !d.last) return "vol_unknown";

  const atr = d.atr14;
  const close = d.last.close || 0;
  if (!close) return "vol_unknown";

  const pct = (atr / close) * 100;
  if (pct < 1) return "vol_low";
  if (pct < 3) return "vol_normal";
  if (pct < 6) return "vol_high";
  return "vol_extreme";
}

function computeDerivativesMetrics(bybitData, binanceForSymbol, okxForSymbol) {
  const { open_interest, long_short_ratio, funding_history, indicators } =
    bybitData || {};
  const metrics = {
    bybit: {},
    binance: {},
    okx: {},
  };

  // ---------- OI: now + change ----------
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
      metrics.bybit.open_interest_change_1_pct = prevOI
        ? (diff / prevOI) * 100
        : null;
    }

    if (past) {
      const pastOI = Number(past.openInterest ?? past.open_interest ?? 0);
      metrics.bybit.open_interest_change_n = nowOI - pastOI;
    }

    metrics.bybit.oi_trend_label = labelTrendFromDiff(
      metrics.bybit.open_interest_change_1_pct
    );
  } else {
    metrics.bybit.oi_trend_label = "trend_unknown";
  }

  // ---------- Funding ----------
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
    metrics.bybit.funding_trend_label =
      Math.sign(lastF - avgF) > 0 ? "funding_up" : "funding_down_or_flat";
    metrics.bybit.funding_extreme_label = labelFundingExtreme(lastF, avgF);
  } else {
    metrics.bybit.funding_trend_label = "funding_unknown";
    metrics.bybit.funding_extreme_label = "funding_neutral";
  }

  // ---------- Long/Short Ratio ----------
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

    const buyNow = Number(last.buyRatio ?? last.buy_ratio ?? 0);
    const sellNow = Number(last.sellRatio ?? last.sell_ratio ?? 0);

    metrics.bybit.long_short_ratio_now = {
      buyRatio: buyNow,
      sellRatio: sellNow,
    };
    metrics.bybit.long_short_ratio_avg_10 = avgBuy;

    const diffLS = buyNow - avgBuy;
    if (diffLS > 2) metrics.bybit.lsr_trend_label = "lsr_more_longs";
    else if (diffLS < -2) metrics.bybit.lsr_trend_label = "lsr_more_shorts";
    else metrics.bybit.lsr_trend_label = "lsr_balanced";
  } else {
    metrics.bybit.lsr_trend_label = "lsr_unknown";
  }

  // ---------- Binance ----------
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

  // ---------- OKX ----------
  if (okxForSymbol && okxForSymbol.open_interest) {
    metrics.okx.open_interest_snapshot = okxForSymbol.open_interest;
  }

  // ---------- Volatility state ----------
  metrics.bybit.volatility_state = computeVolatilityState(indicators || null);

  // ---------- Global derivatives view (cross-exchange) ----------
  metrics.global = buildGlobalDerivMetrics(
    metrics.bybit,
    metrics.binance,
    metrics.okx
  );

  return metrics;
}

// v3.2: Tạo global derivatives metrics từ Bybit + Binance + OKX
function buildGlobalDerivMetrics(bybitMetrics, binanceMetrics, okxMetrics) {
  const global = {};

  // ---------- OI direction (dựa vào Bybit là chính) ----------
  const oiChange1 = Number(bybitMetrics?.open_interest_change_1_pct ?? 0);
  let oiDirection = "flat";
  if (Number.isFinite(oiChange1)) {
    if (oiChange1 > 0.5) oiDirection = "increasing";
    else if (oiChange1 < -0.5) oiDirection = "decreasing";
  }

  global.oi_change_1_pct = Number.isFinite(oiChange1) ? oiChange1 : null;
  global.oi_direction = oiDirection;
  global.oi_trend_label = bybitMetrics?.oi_trend_label ?? "oi_unknown";

  // ---------- Funding: Bybit vs Binance ----------
  const bybitFunding = Number(bybitMetrics?.funding_now ?? NaN);
  const binanceFunding = Number(
    binanceMetrics && binanceMetrics.funding_last != null
      ? binanceMetrics.funding_last
      : NaN
  );

  let fundingDiff = null;
  let fundingPremiumSide = "neutral";
  const fundingDiffAbsThreshold = 0.00002; // ~2 bps

  if (Number.isFinite(bybitFunding) && Number.isFinite(binanceFunding)) {
    fundingDiff = bybitFunding - binanceFunding;
    if (fundingDiff > fundingDiffAbsThreshold) {
      fundingPremiumSide = "bybit";
    } else if (fundingDiff < -fundingDiffAbsThreshold) {
      fundingPremiumSide = "binance";
    }
  }

  global.funding_now_bybit = Number.isFinite(bybitFunding) ? bybitFunding : null;
  global.funding_last_binance = Number.isFinite(binanceFunding)
    ? binanceFunding
    : null;
  global.funding_diff = fundingDiff;
  global.funding_premium_side = fundingPremiumSide;

  // ---------- Binance taker long/short ----------
  let takerSide = "neutral";
  let takerRatio = null;
  if (binanceMetrics && binanceMetrics.taker_long_short_ratio_last) {
    takerRatio = Number(
      binanceMetrics.taker_long_short_ratio_last.buySellRatio ?? 0
    );
    if (Number.isFinite(takerRatio)) {
      if (takerRatio > 1.2) takerSide = "taker_long";
      else if (takerRatio < 0.8) takerSide = "taker_short";
    }
  }

  global.taker_buy_sell_ratio = takerRatio;
  global.taker_flow_side = takerSide;

  // ---------- Bybit retail L/S ----------
  let retailSide = "neutral";
  const bybitBuyRatio = Number(
    bybitMetrics?.long_short_ratio_now?.buyRatio ?? NaN
  );
  if (Number.isFinite(bybitBuyRatio)) {
    if (bybitBuyRatio > 0.6) retailSide = "retail_long";
    else if (bybitBuyRatio < 0.4) retailSide = "retail_short";
  }

  global.retail_flow_side = retailSide;
  global.retail_buy_ratio = Number.isFinite(bybitBuyRatio)
    ? bybitBuyRatio
    : null;

  // ---------- OKX OI snapshot (nếu có) ----------
  if (okxMetrics && okxMetrics.open_interest_snapshot) {
    const oiSnap = okxMetrics.open_interest_snapshot;
    const v =
      Number(oiSnap.oiCcy ?? oiSnap.oi_value ?? oiSnap.oi ?? NaN);
    if (Number.isFinite(v)) {
      global.okx_oi_usd = v;
    }
  }

  // ---------- Derivatives sentiment composite score ----------
  let score = 0;

  // OI direction
  if (oiDirection === "increasing") score += 1;
  else if (oiDirection === "decreasing") score -= 1;

  // Funding đồng pha
  if (Number.isFinite(bybitFunding) && Number.isFinite(binanceFunding)) {
    if (bybitFunding > 0 && binanceFunding > 0) score += 0.5;
    if (bybitFunding < 0 && binanceFunding < 0) score -= 0.5;
  }

  // Taker flow
  if (takerSide === "taker_long") score += 1;
  else if (takerSide === "taker_short") score -= 1;

  // Retail flow
  if (retailSide === "retail_long") score += 0.5;
  else if (retailSide === "retail_short") score -= 0.5;

  let sentimentLabel = "deriv_neutral";
  if (score >= 1.5) sentimentLabel = "deriv_bullish";
  else if (score <= -1.5) sentimentLabel = "deriv_bearish";

  global.sentiment_score = score;
  global.sentiment_label = sentimentLabel;

  return global;
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

async function getBinanceFundingHistory(symbol, limit = 50) {
  try {
    const data = await getFromBinance("/fapi/v1/fundingRate", {
      symbol,
      limit,
    });

    return (data || []).map((row) => ({
      t: row.fundingTime,
      fundingTime: row.fundingTime,
      fundingRate: Number(row.fundingRate),
      symbol: row.symbol,
    }));
  } catch (err) {
    console.error("getBinanceFundingHistory error:", err.message || err);
    return [];
  }
}

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

// ====================== PRICE STRUCTURE / KEY LEVELS ======================

function detectSimpleTrend(closes) {
  if (!closes || closes.length < 3) return "range";
  const first = closes[0];
  const last = closes[closes.length - 1];
  const pct = ((last - first) / first) * 100;
  if (pct > 1) return "uptrend";
  if (pct < -1) return "downtrend";
  return "range";
}

function buildSimpleSwings(parsed, lookback = 80, tfLabel = "H1") {
  const swings = [];
  if (!parsed || parsed.length < 5) return swings;

  const len = parsed.length;
  const start = Math.max(0, len - lookback);

  // Tính average range trong vùng lookback để phân loại internal / external
  let sumRange = 0;
  let cntRange = 0;
  for (let i = start; i < len; i++) {
    const c = parsed[i];
    if (typeof c.high === "number" && typeof c.low === "number") {
      const r = c.high - c.low;
      if (Number.isFinite(r) && r > 0) {
        sumRange += r;
        cntRange++;
      }
    }
  }
  const avgRange = cntRange > 0 ? sumRange / cntRange : 0;

  // Ngưỡng bỏ bớt internal swing theo TF (range% so với giá)
  let minInternalRangePct = 0;
  if (tfLabel === "H1") {
    minInternalRangePct = 0.15; // 0.15%
  } else if (tfLabel === "H4") {
    minInternalRangePct = 0.1; // 0.10%
  } else if (tfLabel === "D1" || tfLabel === "D") {
    minInternalRangePct = 0.05; // 0.05%
  }

  // Helper để tránh H & L cùng ts và ưu tiên external
  function pushSwing(type, price, ts, kind) {
    const last = swings[swings.length - 1];
    if (last && last.ts === ts) {
      // Nếu đã có swing cùng ts:
      // - Nếu swing cũ là internal và swing mới là external -> replace
      if (last.kind === "internal" && kind === "external") {
        swings[swings.length - 1] = { type, price, ts, kind };
      }
      // Ngược lại, giữ swing cũ (ưu tiên cái xuất hiện trước / external đã có)
      return;
    }
    swings.push({ type, price, ts, kind });
  }

  // Fractal size = 2: dùng 2 nến trước + 2 nến sau
  const fractalSize = 2;
  const firstIndex = Math.max(start, fractalSize);
  const lastIndex = len - fractalSize - 1;

  for (let i = firstIndex; i <= lastIndex; i++) {
    const cur = parsed[i];
    if (
      typeof cur.high !== "number" ||
      typeof cur.low !== "number" ||
      typeof cur.ts !== "number"
    ) {
      continue;
    }

    let isHighFractal = true;
    let isLowFractal = true;

    for (let k = 1; k <= fractalSize; k++) {
      const prev = parsed[i - k];
      const next = parsed[i + k];

      if (!prev || !next) {
        isHighFractal = false;
        isLowFractal = false;
        break;
      }

      if (!(cur.high > prev.high && cur.high > next.high)) {
        isHighFractal = false;
      }
      if (!(cur.low < prev.low && cur.low < next.low)) {
        isLowFractal = false;
      }
    }

    // Phân loại swing internal / external
    const range = cur.high - cur.low;
    let kind = "internal";
    if (avgRange > 0 && range >= avgRange * 1.5) {
      kind = "external";
    }

    // Tính range% so với giá trung bình nến
    const priceRef = (cur.high + cur.low) / 2;
    let rangePct = 0;
    if (priceRef > 0) {
      rangePct = (range / priceRef) * 100;
    }

    // Nếu là internal và quá nhỏ so với ngưỡng TF → bỏ qua
    if (kind === "internal" && rangePct < minInternalRangePct) {
      continue;
    }

    if (isHighFractal) {
      pushSwing("H", cur.high, cur.ts, kind);
    }
    if (isLowFractal) {
      pushSwing("L", cur.low, cur.ts, kind);
    }
  }

  return swings;
}


// v3.2: detect BOS & CHOCH dựa trên swings + trend hiện tại của TF
function detectRecentBOS(swings, lastClose, tfTrendLabel, tfLabel, maxLookback = 8) {
  if (!Array.isArray(swings) || swings.length < 3) return [];

  // Ưu tiên external swings nếu có
  const baseSwings = swings.some((s) => s.kind)
    ? swings.filter((s) => !s.kind || s.kind === "external")
    : swings;

  if (baseSwings.length < 3) return [];

  const recent = baseSwings.slice(-maxLookback);
  const result = [];

  // Helper: xác định type = BOS hay CHOCH
  function resolveBOSType(direction) {
    if (direction === "bullish") {
      if (tfTrendLabel === "downtrend") return "CHOCH";
      return "BOS";
    }
    if (direction === "bearish") {
      if (tfTrendLabel === "uptrend") return "CHOCH";
      return "BOS";
    }
    // trend range hoặc không rõ
    return "BOS";
  }

  const highs = recent.filter((s) => s.type === "H");
  const lows = recent.filter((s) => s.type === "L");

  // Bullish break: phá swing high gần nhất
  if (highs.length) {
    const lastHigh = highs[highs.length - 1];
    if (lastClose > lastHigh.price) {
      const direction = "bullish";
      const type = resolveBOSType(direction);
      result.push({
        type,
        direction,
        broken_level: lastHigh.price,
        ts: lastHigh.ts,
        tf: tfLabel || null,
      });
    }
  }

  // Bearish break: phá swing low gần nhất
  if (lows.length) {
    const lastLow = lows[lows.length - 1];
    if (lastClose < lastLow.price) {
      const direction = "bearish";
      const type = resolveBOSType(direction);
      result.push({
        type,
        direction,
        broken_level: lastLow.price,
        ts: lastLow.ts,
        tf: tfLabel || null,
      });
    }
  }

  return result;
}
function splitClosedForming(parsed, tfLabel) {
  if (!Array.isArray(parsed) || parsed.length < 2) {
    return { closed: Array.isArray(parsed) ? parsed : [], forming: null };
  }

  // Map tfLabel -> seconds (đồng bộ với tfToSec logic)
  let tfKey = null;
  if (tfLabel === "M5") tfKey = "5";
  else if (tfLabel === "M15") tfKey = "15";
  else if (tfLabel === "H1") tfKey = "60";
  else if (tfLabel === "H4") tfKey = "240";
  else if (tfLabel === "D1" || tfLabel === "D") tfKey = "D";

  const tfSec = tfKey ? tfToSec(tfKey) : null;
  if (!tfSec) {
    // fallback an toàn: KHÔNG cắt bừa nữa, coi toàn bộ là closed
    return { closed: parsed, forming: null };
  }

  const nowMs = Date.now();
  const last = parsed[parsed.length - 1];
  const isForming = typeof last?.ts === "number" && nowMs < last.ts + tfSec * 1000;

  if (isForming) {
    return {
      closed: parsed.slice(0, -1),
      forming: last,
    };
  }

  return { closed: parsed, forming: null };
}

// v3.1+: detect liquidity grab quanh swing H/L gần nhất
function detectLiquidityGrabs(parsed, swings, maxLookback = 8) {
  if (!Array.isArray(parsed) || !parsed.length) return [];
  if (!Array.isArray(swings) || !swings.length) return [];

  // parsed được coi là CLOSED-ONLY (caller chịu trách nhiệm)
  const last = parsed[parsed.length - 1];

  if (
    typeof last.high !== "number" ||
    typeof last.low !== "number" ||
    typeof last.close !== "number" ||
    typeof last.ts !== "number"
  ) {
    return [];
  }
  // Ưu tiên external swings
  const baseSwings = swings.some((s) => s.kind)
    ? swings.filter((s) => !s.kind || s.kind === "external")
    : swings;

  if (!baseSwings.length) return [];

  const recent = baseSwings.slice(-maxLookback);
  const events = [];

  // Buy-side liquidity grab (trên swing High)
  const lastHighSwing = recent.slice().reverse().find((s) => s.type === "H");
  if (lastHighSwing) {
    if (last.high > lastHighSwing.price && last.close < lastHighSwing.price) {
      events.push({
        side: "buy",
        level: lastHighSwing.price,
        wick: last.high,
        close: last.close,
        ts: last.ts,
        ref_swing_ts: lastHighSwing.ts,
        pattern: "liquidity_grab",
      });
    }
  }

  // Sell-side liquidity grab (dưới swing Low)
  const lastLowSwing = recent.slice().reverse().find((s) => s.type === "L");
  if (lastLowSwing) {
    if (last.low < lastLowSwing.price && last.close > lastLowSwing.price) {
      events.push({
        side: "sell",
        level: lastLowSwing.price,
        wick: last.low,
        close: last.close,
        ts: last.ts,
        ref_swing_ts: lastLowSwing.ts,
        pattern: "liquidity_grab",
      });
    }
  }

  return events;
}

// v3.1: phase của structure – dùng cho Setup Engine
function classifyStructurePhase(trend, rangeWidthPct) {
  if (!trend || trend === "range") {
    if (rangeWidthPct < 1) return "compression";
    return "range";
  }
  if (trend === "uptrend" || trend === "downtrend") {
    if (rangeWidthPct < 1.5) return "trend_choppy";
    return "trend_expansion";
  }
  return "unknown";
}

function computePriceStructureTF(parsed, tfLabel) {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      tf: tfLabel,
      trend_label: "range",
      range: { in_range: true, high: null, low: null, mid: null },
      swings: [],
      recent_bos: [],
      liquidity_events: [],
      structure_phase: "unknown",
    };
  }

  const closes = parsed.map((c) => c.close);
  const trend = detectSimpleTrend(closes);

  const recent = parsed.slice(-50);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);

  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const mid = (high + low) / 2;
  const in_range = trend === "range";

  const swings = buildSimpleSwings(parsed, 80, tfLabel);

  const lastClose = parsed[parsed.length - 1].close;
  const recent_bos = detectRecentBOS(swings, lastClose, trend, tfLabel, 8);
  const liquidity_events = detectLiquidityGrabs(parsed, swings, 8);

  const rangeWidthPct = low > 0 ? ((high - low) / low) * 100 : 0;
  const structure_phase = classifyStructurePhase(trend, rangeWidthPct);

  return {
    tf: tfLabel,
    trend_label: trend,
    range: { in_range, high, low, mid },
    swings,
    recent_bos,
    liquidity_events,
    structure_phase,
  };
}

// v3.1: HTF trend context (gộp H4 + D1)
function buildHTFTrendContext(priceStruct) {
  const H4 = priceStruct.H4;
  const D1 = priceStruct.D1;

  const h4Trend = H4?.trend_label || "range";
  const dTrend = D1?.trend_label || "range";
  const context = {
    h4_trend_label: h4Trend,
    d1_trend_label: dTrend,
    summary: "",
  };

  if (h4Trend === "uptrend" && dTrend === "uptrend") {
    context.summary = "HTF aligned uptrend (H4 + D1). Ưu tiên buy setup.";
  } else if (h4Trend === "downtrend" && dTrend === "downtrend") {
    context.summary = "HTF aligned downtrend (H4 + D1). Ưu tiên sell setup.";
  } else if (h4Trend === "uptrend" && dTrend === "downtrend") {
    context.summary = "H4 up, D1 down – possible countertrend H4.";
  } else if (h4Trend === "downtrend" && dTrend === "uptrend") {
    context.summary = "H4 down, D1 up – pullback trên HTF.";
  } else {
    context.summary = "Mixed / range context giữa H4 và D1.";
  }

  return context;
}

// v3.1: key levels – daily + prev day + weekly + monthly approx
function buildKeyLevelsFromDaily(parsedDaily) {
  if (!parsedDaily || !parsedDaily.length) {
    return {
      daily: null,
      previous_day: null,
      weekly: null,
      monthly: null,
      supply_zones: [],
      demand_zones: [],
    };
  }

  const len = parsedDaily.length;
  const last = parsedDaily[len - 1];
  const prev = len > 1 ? parsedDaily[len - 2] : null;

  // Weekly: dùng ~5 nến daily cuối
  const weeklySlice = parsedDaily.slice(-5);
  const weekly = {
    open: weeklySlice[0].open,
    high: Math.max(...weeklySlice.map((d) => d.high)),
    low: Math.min(...weeklySlice.map((d) => d.low)),
    close: weeklySlice[weeklySlice.length - 1].close,
  };

  // Monthly: ~22 nến daily
  const monthlySlice = parsedDaily.slice(-22);
  const monthly = {
    open: monthlySlice[0].open,
    high: Math.max(...monthlySlice.map((d) => d.high)),
    low: Math.min(...monthlySlice.map((d) => d.low)),
    close: monthlySlice[monthlySlice.length - 1].close,
  };

  const daily = {
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
  };

  const previous_day = prev
    ? {
      open: prev.open,
      high: prev.high,
      low: prev.low,
      close: prev.close,
    }
    : null;

  return {
    daily,
    previous_day,
    weekly,
    monthly,
    supply_zones: [], // có thể bổ sung sau bằng logic volume profile / swings
    demand_zones: [],
  };
}

// ====================== ORDERFLOW SUMMARY & SENTIMENT ======================

function buildOrderflowSummary(orderbook, recentTrades) {
  const bidsRaw = orderbook?.bids || [];
  const asksRaw = orderbook?.asks || [];

  const bids = bidsRaw.map((b) => ({
    price: Number(b[0]),
    size: Number(b[1]),
  }));
  const asks = asksRaw.map((a) => ({
    price: Number(a[0]),
    size: Number(a[1]),
  }));

  const totalBid = bids.reduce((s, x) => s + x.size, 0);
  const totalAsk = asks.reduce((s, x) => s + x.size, 0);
  const imbalance =
    totalBid + totalAsk === 0 ? 0 : (totalBid - totalAsk) / (totalBid + totalAsk);

  const topBids = [...bids].sort((a, b) => b.size - a.size).slice(0, 3);
  const topAsks = [...asks].sort((a, b) => b.size - a.size).slice(0, 3);

  // Chuẩn hoá recentTrades: lấy side, qty, timestamp
  const normTrades = [];
  for (const t of recentTrades || []) {
    const sideRaw = t.side || t.S || "";
    const qty = Number(t.size ?? t.qty ?? t.v ?? 0);
    if (!qty || !Number.isFinite(qty) || qty <= 0) continue;

    const tsCandidate =
      t.time ??
      t.T ??
      t.ts ??
      t.tradeTimeMs ??
      t.execTime ??
      t.execTimeMs ??
      null;
    const ts = tsCandidate != null ? Number(tsCandidate) : null;

    normTrades.push({
      side: sideRaw,
      qty,
      ts: Number.isFinite(ts) && ts > 0 ? ts : null,
    });
  }

  // Tổng buy/sell volume
  let buyVol = 0;
  let sellVol = 0;
  for (const tr of normTrades) {
    if (tr.side === "Buy") buyVol += tr.qty;
    else if (tr.side === "Sell") sellVol += tr.qty;
  }

  // Aggression cơ bản (giữ logic cũ)
  let aggression = "neutral";
  if (buyVol > sellVol * 1.2 && buyVol > 0) aggression = "aggressive_buy";
  else if (sellVol > buyVol * 1.2 && sellVol > 0) aggression = "aggressive_sell";

  // Cửa sổ thời gian trades (window_sec thực tế)
  let windowSec = null;
  const tsValid = normTrades
    .filter((t) => t.ts && Number.isFinite(t.ts))
    .sort((a, b) => a.ts - b.ts);

  if (tsValid.length >= 2) {
    const tsMin = tsValid[0].ts;
    const tsMax = tsValid[tsValid.length - 1].ts;
    if (tsMax > tsMin) {
      windowSec = (tsMax - tsMin) / 1000;
    }
  }

  const trade_delta = buyVol - sellVol;

  // Delta 1 phút / 3 phút gần nhất
  let delta1m = null;
  let delta3m = null;

  if (tsValid.length) {
    const lastTs = tsValid[tsValid.length - 1].ts;
    const oneMinAgo = lastTs - 60_000;
    const threeMinAgo = lastTs - 180_000;

    let buy1 = 0;
    let sell1 = 0;
    let buy3 = 0;
    let sell3 = 0;

    for (const tr of tsValid) {
      if (tr.ts >= oneMinAgo) {
        if (tr.side === "Buy") buy1 += tr.qty;
        else if (tr.side === "Sell") sell1 += tr.qty;
      }
      if (tr.ts >= threeMinAgo) {
        if (tr.side === "Buy") buy3 += tr.qty;
        else if (tr.side === "Sell") sell3 += tr.qty;
      }
    }

    delta1m = buy1 - sell1;
    delta3m = buy3 - sell3;
  }

  // Cụm volume lớn trong bucket 15s
  let maxBuyCluster = null;
  let maxSellCluster = null;

  if (tsValid.length) {
    const bucketMs = 15_000;
    const buckets = new Map();

    for (const tr of tsValid) {
      const key = Math.floor(tr.ts / bucketMs);
      let b = buckets.get(key);
      if (!b) {
        b = { buy: 0, sell: 0 };
        buckets.set(key, b);
      }
      if (tr.side === "Buy") b.buy += tr.qty;
      else if (tr.side === "Sell") b.sell += tr.qty;
    }

    let maxB = 0;
    let maxS = 0;
    for (const b of buckets.values()) {
      if (b.buy > maxB) maxB = b.buy;
      if (b.sell > maxS) maxS = b.sell;
    }

    maxBuyCluster = maxB > 0 ? maxB : null;
    maxSellCluster = maxS > 0 ? maxS : null;
  }

  // Áp lực ngắn hạn từ deltas
  let shortTermPressure = "balanced";
  if (delta3m != null) {
    if (delta3m > 0 && (delta1m ?? 0) > 0) {
      shortTermPressure = "buy_pressure";
    } else if (delta3m < 0 && (delta1m ?? 0) < 0) {
      shortTermPressure = "sell_pressure";
    }
  }

  // mm_mode (giữ nguyên logic cũ)
  let mm_mode = "neutral";
  if (Math.abs(imbalance) < 0.05 && aggression === "neutral") {
    mm_mode = "range_holding";
  } else if (imbalance > 0.1 && aggression === "aggressive_buy") {
    mm_mode = "pushing_up";
  } else if (imbalance < -0.1 && aggression === "aggressive_sell") {
    mm_mode = "pushing_down";
  }

  return {
    recent_trades: {
      window_sec: windowSec,
      buy_volume: buyVol,
      sell_volume: sellVol,
      trade_delta,
      aggression,
      delta_1m: delta1m,
      delta_3m: delta3m,
      max_buy_cluster: maxBuyCluster,
      max_sell_cluster: maxSellCluster,
      short_term_pressure: shortTermPressure,
    },
    orderbook: {
      book_imbalance: imbalance,
      liquidity_pockets: {
        above: topAsks,
        below: topBids,
      },
    },
    mm_mode_label: mm_mode,
  };
}

// v3.1: sentiment labels mở rộng
function buildSentimentLabels(derivedMetrics, indicators, orderflowSummary) {
  const r = derivedMetrics?.bybit?.long_short_ratio_now || null;
  const fundingNow = derivedMetrics?.bybit?.funding_now ?? 0;
  const fundingExtremeLabel =
    derivedMetrics?.bybit?.funding_extreme_label ?? "funding_neutral";
  const volState = derivedMetrics?.bybit?.volatility_state ?? "vol_unknown";

  let retail_bias = "balanced";
  if (r) {
    const buy = r.buyRatio ?? 0;
    const sell = r.sellRatio ?? 0;
    if (buy > sell * 1.1) retail_bias = "retail_long";
    else if (sell > buy * 1.1) retail_bias = "retail_short";
  }

  let squeeze_risk = "neutral";
  if (retail_bias === "retail_long" && fundingNow > 0) {
    squeeze_risk = "long_squeeze";
  } else if (retail_bias === "retail_short" && fundingNow < 0) {
    squeeze_risk = "short_squeeze";
  }

  let funding_extreme = "neutral";
  if (fundingExtremeLabel === "funding_extreme_positive") {
    funding_extreme = "expensive_long";
  } else if (fundingExtremeLabel === "funding_extreme_negative") {
    funding_extreme = "expensive_short";
  }

  let volatility_sentiment = "vol_neutral";
  if (volState === "vol_low") volatility_sentiment = "quiet_market";
  else if (volState === "vol_high" || volState === "vol_extreme")
    volatility_sentiment = "high_risk_move";

  // market_summary: 1–2 câu ngắn cho Dashboard
  const h1 = indicators?.["60"];
  const h1Trend = h1?.trend_label || "";
  let market_summary = "";

  if (retail_bias === "retail_long") {
    market_summary += "Retail đang nghiêng về long. ";
  } else if (retail_bias === "retail_short") {
    market_summary += "Retail đang nghiêng về short. ";
  } else {
    market_summary += "Retail khá cân bằng. ";
  }

  if (squeeze_risk === "long_squeeze") {
    market_summary += "Rủi ro long squeeze tăng, cẩn trọng với cú đạp nhanh. ";
  } else if (squeeze_risk === "short_squeeze") {
    market_summary +=
      "Rủi ro short squeeze tăng, dễ có cú squeeze lên bất ngờ. ";
  }

  market_summary += `Trend H1: ${h1Trend || "khó đọc"}. `;

  const aggr = orderflowSummary?.recent_trades?.aggression || "neutral";
  if (aggr === "aggressive_buy") {
    market_summary += "Dòng tiền ngắn hạn đang buy chủ động. ";
  } else if (aggr === "aggressive_sell") {
    market_summary += "Dòng tiền ngắn hạn đang sell chủ động. ";
  }

  // ----- Derivatives sentiment + composite score (v3.2) -----
  const derivGlobal = derivedMetrics?.global || null;
  const derivatives_sentiment =
    derivGlobal?.sentiment_label ?? "deriv_neutral";
  const derivatives_score_raw = Number(
    derivGlobal?.sentiment_score ?? 0
  );

  let composite_score = 0;

  // 1) Bắt đầu từ điểm derivatives
  if (Number.isFinite(derivatives_score_raw)) {
    composite_score += derivatives_score_raw;
  }

  // 2) Retail bias
  if (retail_bias === "retail_long") composite_score += 0.5;
  else if (retail_bias === "retail_short") composite_score -= 0.5;

  // 3) Funding extreme (expensive_long/short)
  if (funding_extreme === "expensive_long") composite_score += 0.5;
  else if (funding_extreme === "expensive_short") composite_score -= 0.5;

  // 4) Orderflow aggression
  if (aggr === "aggressive_buy") composite_score += 0.5;
  else if (aggr === "aggressive_sell") composite_score -= 0.5;

  const sentiment_score = {
    derivatives: Number.isFinite(derivatives_score_raw)
      ? derivatives_score_raw
      : 0,
    composite: composite_score,
  };

  return {
    retail_bias,
    squeeze_risk,
    funding_extreme,
    volatility_sentiment,
    market_summary,
    derivatives_sentiment,
    sentiment_score,
  };
}


// ====================== COLLECT SYMBOL DATA V3.1 ======================

async function collectSymbolDataV3(symbol) {
  // Bước 1: lấy klines trước (vì indicators phụ thuộc vào klines)
  const klines = await getKlinesForV3(symbol);

  // Bước 2: các API phái sinh/bybit khác chạy song song
  const [
    open_interest,
    long_short_ratio,
    funding_history,
    orderbook,
    recent_trades,
    ticker,
  ] = await Promise.all([
    getOpenInterest(symbol),
    getLongShortRatio(symbol),
    getFundingHistory(symbol),
    getOrderbook(symbol),
    getRecentTrades(symbol),
    getTicker(symbol),
  ]);

  return {
    symbol,
    klines,
    indicators: computeIndicatorsForV3(klines),
    open_interest,
    long_short_ratio,
    funding_history,
    orderbook,
    recent_trades,
    ticker,
  };
}


// ====================== SNAPSHOT V3.1 BUILDER ======================

export async function buildSnapshotV3(symbols) {
  const generatedAt = Date.now();
  const symbolsData = [];
  const binanceDeriv = {};
  const okxDeriv = {};

  for (const sym of symbols) {
    console.log("[snapshot-v3.1] Fetching Bybit data for", sym);
    const bybitData = await collectSymbolDataV3(sym);

    const raw60 = bybitData.klines["60"] || [];
    const raw240 = bybitData.klines["240"] || [];
    const rawD = bybitData.klines["D"] || [];

    const nowMs = Date.now();

    const { parsed_closed: parsed60, parsed_forming: forming60 } =
      parseClosedKlines(raw60, "60", nowMs);

    const { parsed_closed: parsed240, parsed_forming: forming240 } =
      parseClosedKlines(raw240, "240", nowMs);

    const { parsed_closed: parsedD, parsed_forming: formingD } =
      parseClosedKlines(rawD, "D", nowMs);

    const indicators_htf = computeHTFIndicatorsFromClosedParsed(parsed60, parsed240, parsedD);
    // Xây meta cho symbol này
    const lastKlineTs = {
      "60": parsed60.length ? parsed60[parsed60.length - 1].ts : null,
      "240": parsed240.length ? parsed240[parsed240.length - 1].ts : null,
      D: parsedD.length ? parsedD[parsedD.length - 1].ts : null,
    };
    const formingKlineTs = {
      "60": forming60?.ts ?? null,
      "240": forming240?.ts ?? null,
      D: formingD?.ts ?? null,
    };

    let base = sym;
    let quote = "USDT";
    if (sym.endsWith("USDT")) {
      base = sym.slice(0, -4);
      quote = "USDT";
    }

    const price_structure = {
      H1: computePriceStructureTF(parsed60, "H1"),
      H4: computePriceStructureTF(parsed240, "H4"),
      D1: computePriceStructureTF(parsedD, "D1"),
    };

    const htf_trend_context = buildHTFTrendContext(price_structure);
    const key_levels = buildKeyLevelsFromDaily(parsedD);

    const orderflow_summary = buildOrderflowSummary(
      bybitData.orderbook,
      bybitData.recent_trades
    );

    const klines_compact = buildKlinesCompact(bybitData.klines, {
      "60": 20,
      "240": 20,
      "D": 30,
    });

    console.log("[snapshot-v3.1] Fetching Binance/OKX data for", sym);
    let binFunding = [];
    let binOiHist = [];
    let binTakerLS = [];
    let okxOiSnap = null;

    try {
      const [_binFunding, _binOiHist, _binTakerLS, _okxOiSnap] =
        await Promise.all([
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
        `[snapshot-v3.1] Error fetching Binance/OKX data for ${sym}:`,
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
      { ...bybitData, indicators: indicators_htf },
      binForSym,
      okxForSym
    );

    const sentiment_labels = buildSentimentLabels(
      derived_metrics,
      indicators_htf,
      orderflow_summary
    );

    symbolsData.push({
      symbol: sym,
      meta: {
        symbol: sym,
        base,
        quote,
        category: "linear_perp",
        generated_at: generatedAt,
        last_kline_ts: lastKlineTs,
        forming_kline_ts: formingKlineTs, // debug
      },
      ticker: bybitData.ticker,
      indicators: indicators_htf, // 60/240/D: đảm bảo đồng bộ với last_kline_ts + structure + key_levels
      klines_compact,
      price_structure: {
        ...price_structure,
        htf_trend_context,
      },
      key_levels,
      derived_metrics,
      orderflow_summary,
      sentiment_labels,
    });

  }

  // Dùng trực tiếp symbol đầu tiên cho onchain (ví dụ: LINKUSDT)
  let primaryAssetForOnchain = "BTC";
  if (symbols && symbols.length) {
    primaryAssetForOnchain = symbols[0];
  }

  // Gọi raw onchain từ backend
  const rawOnchain = await fetchOnchainBlock(primaryAssetForOnchain);
  // Compact lại để JSON gọn
  const onchain = buildOnchainCompact(rawOnchain, primaryAssetForOnchain);


  const global_derivatives = {
    binance: binanceDeriv,
    okx: okxDeriv,
  };

  const schema = {
    name: "price_analyzer_snapshot",
    version: "3.1",
    exchange: ["bybit", "binance", "okx"],
    intervals: ["60", "240", "D"],
  };

  const payload = {
    schema,
    version: 3.1,
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

  return payload;
}

// Snapshot riêng cho LTF (M5 / M15) – nhẹ, phục vụ realtime timing
export async function buildLtfSnapshotV3(symbols) {
  const generatedAt = Date.now();
  const bybitLtfSymbols = {};
  const binanceDerivLtf = {};
  const okxDerivLtf = {};

  if (!Array.isArray(symbols) || !symbols.length) {
    throw new Error("[snapshot-v3.1] buildLtfSnapshotV3: symbols trống.");
  }

  for (const sym of symbols) {
    console.log("[snapshot-v3.1] Fetching LTF data for", sym);

    // 1) Lấy klines LTF Bybit: M5 / M15
    const klinesLtf = await getKlinesForV3(sym, LTF_INTERVALS_V3, 200);

    const indicators_ltf = computeLTFIndicatorsForV3(klinesLtf);
    const klines_ltf_compact = buildLtfKlinesCompact(klinesLtf, {
      "5": 36,
      "15": 32,
    });

    // 2) Ticker Bybit để biết giá hiện tại / mark
    // 2) Ticker + Orderbook + Recent Trades (để build orderflow/MM cho LTF)
    const [ticker, orderbook, recent_trades] = await Promise.all([
      getTicker(sym),
      getOrderbook(sym, 50),      // depth 50 để imbalance ổn hơn
      getRecentTrades(sym, 500),  // giữ 500 trade như HTF
    ]);

    const orderflow_summary = buildOrderflowSummary(orderbook, recent_trades);


    // 3) Derivatives LTF từ Binance & OI snapshot từ OKX
    let binFunding = [];
    let binOiHist = [];
    let binTakerLS = [];
    let okxOiSnap = null;

    try {
      const [_binFunding, _binOiHist, _binTakerLS, _okxOiSnap] =
        await Promise.all([
          getBinanceFundingHistory(sym),
          getBinanceOpenInterestHist(sym, "5m", 50),
          getBinanceTakerLongShortRatio(sym, "5m", 50),
          getOkxOpenInterestSnapshot(sym),
        ]);

      binFunding = _binFunding || [];
      binOiHist = _binOiHist || [];
      binTakerLS = _binTakerLS || [];
      okxOiSnap = _okxOiSnap || null;
    } catch (e) {
      console.error(
        `[snapshot-v3.1] Error fetching Binance/OKX LTF data for ${sym}:`,
        e.message || e
      );
    }

    const binForSymLtf = {
      funding_history: binFunding,
      open_interest_hist_5m: binOiHist,
      taker_long_short_ratio_5m: binTakerLS,
    };

    const okxForSymLtf = {
      open_interest: okxOiSnap,
    };

    binanceDerivLtf[sym] = binForSymLtf;
    okxDerivLtf[sym] = okxForSymLtf;

    // Meta cơ bản cho symbol LTF này
    let base = sym;
    let quote = "USDT";
    if (sym.endsWith("USDT")) {
      base = sym.slice(0, -4);
      quote = "USDT";
    }

    bybitLtfSymbols[sym] = {
      symbol: sym,
      meta: {
        symbol: sym,
        base,
        quote,
        category: "linear_perp",
        generated_at: generatedAt,
      },
      ticker,

      // NEW: orderflow/MM cho LTF (orderbook + recent trades)
      orderflow_summary,

      indicators_ltf,
      klines_ltf_compact,
    };

  }

  const schema = {
    name: "price_analyzer_ltf_snapshot",
    version: "3.3-ltf",
    exchange: ["bybit", "binance", "okx"],
    intervals: ["5", "15"],
  };

  const payload = {
    schema,
    version: 3.3, // bạn có thể đổi nếu muốn
    generated_at: generatedAt,
    per_exchange_ltf: {
      bybit: {
        venue: "bybit",
        category: "linear",
        symbols: bybitLtfSymbols,
      },
    },
    global_derivatives_ltf: {
      binance: binanceDerivLtf,
      okx: okxDerivLtf,
    },
  };

  return payload;
}
// ====================== SPEC v3.3-full TOP-LEVEL SHORTCUTS ======================
// Mục tiêu: tạo các field ở root đúng theo SPEC, nhưng vẫn giữ full payload trong per_exchange/per_exchange_ltf.
// SPEC gọi trực tiếp: indicators["60"].last, key_levels.previous_day.high, key_levels.range_high/low, orderflow_summary...
function attachSpecRootShortcutsV33Full(snapshot, primarySymbol) {
  try {
    if (!snapshot || !primarySymbol) return snapshot;

    // ---------- HTF: lấy object symbol từ per_exchange.bybit.symbols (ARRAY) ----------
    const htfArr = snapshot?.per_exchange?.bybit?.symbols;
    const htf =
      Array.isArray(htfArr) ? htfArr.find((s) => s?.symbol === primarySymbol) : null;

    if (htf) {
      // Các field mà SPEC gọi trực tiếp ở root
      if (snapshot.ticker == null) snapshot.ticker = htf.ticker ?? null;
      if (snapshot.indicators == null) snapshot.indicators = htf.indicators ?? {};
      if (snapshot.klines_compact == null)
        snapshot.klines_compact = htf.klines_compact ?? {};
      if (snapshot.price_structure == null)
        snapshot.price_structure = htf.price_structure ?? {};
      if (snapshot.derived_metrics == null)
        snapshot.derived_metrics = htf.derived_metrics ?? {};
      if (snapshot.orderflow_summary == null)
        snapshot.orderflow_summary = htf.orderflow_summary ?? {};
      if (snapshot.sentiment_labels == null)
        snapshot.sentiment_labels = htf.sentiment_labels ?? {};

      // key_levels: SPEC gọi key_levels.previous_day.* và key_levels.range_high/low
      if (snapshot.key_levels == null) {
        const kl = htf.key_levels ? JSON.parse(JSON.stringify(htf.key_levels)) : {};

        // range_high/low đôi khi đang nằm trong price_structure.H1.range.high/low (theo lỗi bạn test)
        const rangeHigh =
          kl?.range_high ??
          htf?.price_structure?.H1?.range?.high ??
          htf?.price_structure?.H4?.range?.high ??
          null;

        const rangeLow =
          kl?.range_low ??
          htf?.price_structure?.H1?.range?.low ??
          htf?.price_structure?.H4?.range?.low ??
          null;

        if (rangeHigh != null) kl.range_high = rangeHigh;
        if (rangeLow != null) kl.range_low = rangeLow;

        snapshot.key_levels = kl;
      }
    }

    // ---------- LTF: giữ đúng SPEC path dưới per_exchange_ltf (đã đúng), nhưng có thể tạo shortcut root nếu muốn debug ----------
    const ltf = snapshot?.per_exchange_ltf?.bybit?.symbols?.[primarySymbol];
    if (ltf) {
      // Optional: không bắt buộc theo SPEC, nhưng hữu ích để debug nhanh
      if (snapshot.ticker_ltf == null) snapshot.ticker_ltf = ltf.ticker ?? null;
      if (snapshot.indicators_ltf == null)
        snapshot.indicators_ltf = ltf.indicators_ltf ?? {};
      if (snapshot.klines_ltf_compact == null)
        snapshot.klines_ltf_compact = ltf.klines_ltf_compact ?? {};
      if (snapshot.orderflow_summary_ltf == null)
        snapshot.orderflow_summary_ltf = ltf.orderflow_summary ?? {};
    }

    return snapshot;
  } catch (e) {
    console.error("[snapshot-v3] attachSpecRootShortcutsV33Full error:", e?.message || e);
    return snapshot;
  }
}
// ====================== FULL SNAPSHOT (HTF + LTF IN ONE FILE) ======================
// Mục tiêu: xuất 1 file JSON duy nhất, đủ data cho cả HTF (H1/H4/D1) và LTF (M5/M15).
// Cách làm: buildSnapshotV3 + buildLtfSnapshotV3 (song song) rồi merge.
//
// Tương thích ngược:
// - Giữ nguyên cấu trúc HTF snapshot: per_exchange / onchain / global_derivatives
// - Thêm 2 keys mới: per_exchange_ltf / global_derivatives_ltf
// - Nâng schema.name + schema.version để AI nhận biết "FULL"


export async function buildFullSnapshotV3(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) {
    throw new Error("[snapshot-v3.1] buildFullSnapshotV3: symbols trống.");
  }

  const generatedAt = Date.now();

  // Build song song để giảm thời gian chờ
  const [htfSnap, ltfSnap] = await Promise.all([
    buildSnapshotV3(symbols),
    buildLtfSnapshotV3(symbols),
  ]);

  // Merge: ưu tiên giữ nguyên HTF payload, chỉ nhúng thêm LTF + cập nhật schema
  const merged = {
    ...(htfSnap || {}),
    schema: {
      name: "price_analyzer_full_snapshot",
      version: "3.3-full",
      exchange: ["bybit", "binance", "okx"],
      intervals: ["60", "240", "D", "5", "15"],
    },
    version: 3.3,
    generated_at: generatedAt,
    per_exchange_ltf: ltfSnap?.per_exchange_ltf || {},
    global_derivatives_ltf: ltfSnap?.global_derivatives_ltf || {},
    _meta: {
      htf_generated_at: htfSnap?.generated_at || null,
      ltf_generated_at: ltfSnap?.generated_at || null,
    },
  };
  attachSpecRootShortcutsV33Full(merged, symbols[0]);
  return merged;
}
// ====================== V7 WRAPPERS (MULTI-SYMBOL + META TOP-LEVEL) ======================
// Mục tiêu: không đụng logic compute v3.x, chỉ wrap output thành schema v7 để:
// - Fix top-level meta/ticker ambiguity
// - Multi-symbol map-first
// - Tách analysis vs realtime snapshot
//
// NOTE: payload size chưa tối ưu (theo yêu cầu "khoan payload").

function toV7FromV3({ symbols, htfSnap, ltfSnap, mode }) {
  const generatedAt = Date.now();
  const primarySymbol = Array.isArray(symbols) && symbols.length ? symbols[0] : null;

  // --- HTF symbols (v3: per_exchange.bybit.symbols là ARRAY) ---
  const htfSymbolsArr = htfSnap?.per_exchange?.bybit?.symbols;
  const htfMap = {};
  if (Array.isArray(htfSymbolsArr)) {
    for (const s of htfSymbolsArr) {
      if (!s?.symbol) continue;
      htfMap[s.symbol] = s;
    }
  }

  // --- LTF symbols (v3-ltf: per_exchange_ltf.bybit.symbols là OBJECT MAP) ---
  const ltfMap = ltfSnap?.per_exchange_ltf?.bybit?.symbols || {};

  // --- union symbols ---
  const union = new Set();
  for (const sym of symbols || []) union.add(sym);
  for (const sym of Object.keys(htfMap)) union.add(sym);
  for (const sym of Object.keys(ltfMap || {})) union.add(sym);

  const symbolsList = Array.from(union);

  // Build symbols_map theo contract v7 (chưa tối ưu payload)
  const symbols_map = {};
  for (const sym of symbolsList) {
    const htf = htfMap[sym] || null;
    const ltf = ltfMap?.[sym] || null;

    // market: ưu tiên ticker LTF nếu có (thường mới hơn), fallback HTF
    const ticker = ltf?.ticker || htf?.ticker || null;

    // Bạn có thể tuỳ biến mapping last/index/high/low theo format ticker Bybit bạn đang dùng
    const toNumOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const last_price = toNumOrNull(
      ticker?.lastPrice ??
      ticker?.last_price ??
      ticker?.last ??
      ticker?.price ??
      ticker?.markPrice ??
      ticker?.mark_price
    );

    const index_price = toNumOrNull(
      ticker?.indexPrice ??
      ticker?.index_price ??
      ticker?.index
    );

    const high_24h = toNumOrNull(
      ticker?.highPrice24h ??
      ticker?.high_price_24h ??
      ticker?.high_24h ??
      ticker?.high24h
    );

    const low_24h = toNumOrNull(
      ticker?.lowPrice24h ??
      ticker?.low_price_24h ??
      ticker?.low_24h ??
      ticker?.low24h
    );
    symbols_map[sym] = {
      meta: {
        symbol: sym,
        base: htf?.meta?.base || ltf?.meta?.base || null,
        quote: htf?.meta?.quote || ltf?.meta?.quote || null,
        category: htf?.meta?.category || ltf?.meta?.category || "linear_perp",
      },

      market: {
        ticker, // giữ raw để debug/backward
        last_price,
        index_price,
        high_24h,
        low_24h,
      },

      // Analysis snapshot: chứa HTF block
      analysis: mode === "realtime" ? null : {
        // giữ nguyên v3 fields để AI engine/SPEC vẫn đọc được
        ticker: htf?.ticker || null,
        indicators: htf?.indicators || null,
        klines_compact: htf?.klines_compact || null,
        price_structure: htf?.price_structure || null,
        key_levels: htf?.key_levels || null,
        derived_metrics: htf?.derived_metrics || null,
        orderflow_summary: htf?.orderflow_summary || null,
        sentiment_labels: htf?.sentiment_labels || null,
        _v3_meta: htf?.meta || null,
      },

      // Realtime snapshot: chứa LTF block
      realtime: mode === "analysis" ? null : {
        ticker: ltf?.ticker || null,
        indicators_ltf: ltf?.indicators_ltf || null,
        klines_ltf_compact: ltf?.klines_ltf_compact || null,
        orderflow_summary: ltf?.orderflow_summary || null,
        _v3_meta: ltf?.meta || null,
      },
    };
  }

  // global block (giữ nguyên v3 để không break các consumer cũ)
  const global = {
    onchain: htfSnap?.onchain || null,
    global_derivatives: htfSnap?.global_derivatives || null,
    global_derivatives_ltf: ltfSnap?.global_derivatives_ltf || null,
  };

  return {
    schema: { name: "price_analyzer_snapshot", version: "7.0" },
    meta: {
      snapshot_id: `${generatedAt}-${mode}-${primarySymbol || "NA"}`,
      generated_at: generatedAt,
      mode, // "analysis" | "realtime" | "full"
      primary_symbol: primarySymbol,
      exchange_universe: ["bybit", "binance", "okx"],
      intervals:
        mode === "analysis" ? ["60", "240", "D"]
          : mode === "realtime" ? ["5", "15"]
            : ["60", "240", "D", "5", "15"],
      closed_candle_policy: "closed_only_confirm",
    },
    symbols: symbolsList,
    symbols_map,
    global,

    // OPTIONAL: compat layer (giữ nguyên v3/v3-full để UI cũ chạy song song)
    legacy: {
      htf: htfSnap || null,
      ltf: ltfSnap || null,
    },
  };
}

// --------- PUBLIC EXPORTS ---------

// Analysis snapshot v7: chỉ HTF (buildSnapshotV3)
export async function buildAnalysisSnapshotV7(symbols) {
  const htfSnap = await buildSnapshotV3(symbols);
  return toV7FromV3({ symbols, htfSnap, ltfSnap: null, mode: "analysis" });
}

// Realtime snapshot v7: chỉ LTF (buildLtfSnapshotV3)
export async function buildRealtimeSnapshotV7(symbols) {
  const ltfSnap = await buildLtfSnapshotV3(symbols);
  return toV7FromV3({ symbols, htfSnap: null, ltfSnap, mode: "realtime" });
}

// Full snapshot v7: HTF + LTF (buildSnapshotV3 + buildLtfSnapshotV3)
export async function buildFullSnapshotV7(symbols) {
  const [htfSnap, ltfSnap] = await Promise.all([
    buildSnapshotV3(symbols),
    buildLtfSnapshotV3(symbols),
  ]);
  return toV7FromV3({ symbols, htfSnap, ltfSnap, mode: "full" });
}

// Default export cho tiện
export default buildSnapshotV3;
