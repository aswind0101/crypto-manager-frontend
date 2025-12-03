// lib/snapshot-v3.js
// Node/Next-friendly snapshot builder v3
// Dựa trên bybit-snapshot.js v2, cắt bớt kline không cần thiết,
// thêm price_structure, key_levels, orderflow_summary, sentiment_labels.

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

// ====================== INDICATOR HELPERS (COPY TỪ V2) ======================

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
  if (!values || values.length < slow + signalPeriod) return { macd: null, signal: null, hist: null };

  const emaFast = calcEMA(values, fast);
  const emaSlow = calcEMA(values, slow);
  if (emaFast == null || emaSlow == null) return { macd: null, signal: null, hist: null };

  const macdArr = [];
  for (let i = slow; i < values.length; i++) {
    const slice = values.slice(0, i + 1);
    const eFast = calcEMA(slice, fast);
    const eSlow = calcEMA(slice, slow);
    if (eFast != null && eSlow != null) {
      macdArr.push(eFast - eSlow);
    }
  }

  if (macdArr.length < signalPeriod) return { macd: null, signal: null, hist: null };

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

// Chỉ giữ 60 / 240 / D cho v3
const INTERVALS_V3 = ["60", "240", "D"];

function computeIndicatorsForV3(klines) {
  const indicators = {};
  if (!klines) return indicators;

  for (const tf of INTERVALS_V3) {
    const raw = klines[tf];
    if (!raw || !raw.length) continue;
    const computed = computeIndicatorsForInterval(raw);
    if (computed) {
      indicators[tf] = computed;
    }
  }
  return indicators;
}

// ====================== DERIVATIVES METRICS (COPY V2) ======================

function computeDerivativesMetrics(bybitData, binanceForSymbol = null, okxForSymbol = null) {
  const { open_interest, long_short_ratio, funding_history } = bybitData || {};
  const metrics = {
    bybit: {},
    binance: {},
    okx: {},
  };

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
      metrics.bybit.open_interest_change_1_pct = prevOI ? (diff / prevOI) * 100 : null;
    }

    if (past) {
      const pastOI = Number(past.openInterest ?? past.open_interest ?? 0);
      metrics.bybit.open_interest_change_n = nowOI - pastOI;
    }
  }

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

function buildSimpleSwings(parsed, lookback = 80) {
  const swings = [];
  if (!parsed || !parsed.length) return swings;
  const start = Math.max(0, parsed.length - lookback);

  for (let i = start + 2; i < parsed.length - 2; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    const next = parsed[i + 1];

    if (cur.high > prev.high && cur.high > next.high) {
      swings.push({ type: "H", price: cur.high, ts: cur.ts });
    }
    if (cur.low < prev.low && cur.low < next.low) {
      swings.push({ type: "L", price: cur.low, ts: cur.ts });
    }
  }

  return swings;
}

function computePriceStructureTF(parsed, tfLabel) {
  if (!parsed || !parsed.length) {
    return {
      tf: tfLabel,
      trend_label: "range",
      range: { in_range: true, high: null, low: null, mid: null },
      swings: [],
      recent_bos: [],
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

  const swings = buildSimpleSwings(parsed, 80);

  return {
    tf: tfLabel,
    trend_label: trend,
    range: {
      in_range: trend === "range",
      high,
      low,
      mid,
    },
    swings,
    recent_bos: [],
  };
}

function buildKeyLevelsFromDaily(parsedDaily) {
  if (!parsedDaily || !parsedDaily.length) {
    return {
      daily: null,
      weekly: null,
      supply_zones: [],
      demand_zones: [],
    };
  }

  const len = parsedDaily.length;
  const last = parsedDaily[len - 1];
  const prev = len > 1 ? parsedDaily[len - 2] : null;

  return {
    daily: {
      open: last.open,
      high: last.high,
      low: last.low,
      previous_close: prev ? prev.close : null,
    },
    weekly: null,
    supply_zones: [],
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

  let buyVol = 0;
  let sellVol = 0;
  for (const t of recentTrades || []) {
    const side = t.side || t.S || "";
    const qty = Number(t.size ?? t.qty ?? 0);
    if (side === "Buy") buyVol += qty;
    else if (side === "Sell") sellVol += qty;
  }

  let aggression = "neutral";
  if (buyVol > sellVol * 1.2) aggression = "aggressive_buy";
  else if (sellVol > buyVol * 1.2) aggression = "aggressive_sell";

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
      window_sec: null,
      buy_volume: buyVol,
      sell_volume: sellVol,
      aggression,
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

function buildSentimentLabels(derivedMetrics) {
  const r = derivedMetrics?.bybit?.long_short_ratio_now || null;
  const fundingNow = derivedMetrics?.bybit?.funding_now ?? 0;

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

  return { retail_bias, squeeze_risk };
}

// ====================== COLLECT SYMBOL DATA V3 ======================

async function collectSymbolDataV3(symbol) {
  const klines = await getKlinesForV3(symbol);

  const open_interest = await getOpenInterest(symbol);
  const long_short_ratio = await getLongShortRatio(symbol);
  const funding_history = await getFundingHistory(symbol);
  const orderbook = await getOrderbook(symbol);
  const recent_trades = await getRecentTrades(symbol);
  const ticker = await getTicker(symbol);

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

// ====================== SNAPSHOT V3 BUILDER ======================

export async function buildSnapshotV3(symbols) {
  const generatedAt = Date.now();
  const symbolsData = [];
  const binanceDeriv = {};
  const okxDeriv = {};

  for (const sym of symbols) {
    console.log("[snapshot-v3] Fetching Bybit data for", sym);
    const bybitData = await collectSymbolDataV3(sym);

    // Chuẩn bị kline parsed cho price_structure & key_levels
    const raw60 = bybitData.klines["60"] || [];
    const raw240 = bybitData.klines["240"] || [];
    const rawD = bybitData.klines["D"] || [];

    const parsed60 = parseKlinesList(raw60);
    const parsed240 = parseKlinesList(raw240);
    const parsedD = parseKlinesList(rawD);

    const price_structure = {
      H1: computePriceStructureTF(parsed60, "H1"),
      H4: computePriceStructureTF(parsed240, "H4"),
      D1: computePriceStructureTF(parsedD, "D1"),
    };

    const key_levels = buildKeyLevelsFromDaily(parsedD);
    const orderflow_summary = buildOrderflowSummary(bybitData.orderbook, bybitData.recent_trades);

    console.log("[snapshot-v3] Fetching Binance/OKX data for", sym);
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
        `[snapshot-v3] Error fetching Binance/OKX data for ${sym}:`,
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

    const sentiment_labels = buildSentimentLabels(derived_metrics);

    symbolsData.push({
      symbol: sym,
      ticker: bybitData.ticker,
      indicators: bybitData.indicators,    // 60 / 240 / D
      price_structure,
      key_levels,
      derived_metrics,
      orderflow_summary,
      sentiment_labels,
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
    version: 3,
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

// Optional: default export cho tiện
export default buildSnapshotV3;
