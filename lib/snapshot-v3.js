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

function computeIndicatorsForInterval(rawList, tfLabel) {
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
  const ema = { ema20, ema50, ema100, ema200 };

  const trend_state = deriveTrendState(last.close, ema, rsi14);
  const ema_stack_label = classifyEmaStack(ema);
  const rsi_bias_label = classifyRsiBias(rsi14);
  const { trend_label, trend_strength } = deriveTrendLabelAndStrength(
    tfLabel,
    trend_state
  );

  return {
    last,
    rsi14,
    ema,
    macd,
    atr14,
    vol_profile: volProfile,
    trend_state, // state kỹ thuật
    trend_label, // label thân thiện
    trend_strength, // strong_bull | bull | range | bear | strong_bear
    ema_stack_label,
    rsi_bias_label,
  };
}

// Chỉ giữ 60 / 240 / D cho v3.1
const INTERVALS_V3 = ["60", "240", "D"];

function computeIndicatorsForV3(klines) {
  const indicators = {};
  if (!klines) return indicators;

  for (const tf of INTERVALS_V3) {
    const raw = klines[tf];
    if (!raw || !raw.length) continue;
    const tfLabel = tf === "60" ? "H1" : tf === "240" ? "H4" : "D1";
    const computed = computeIndicatorsForInterval(raw, tfLabel);
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

    const n = cfg[tf];
    const slice = raw.slice(-n);
    const parsed = parseKlinesList(slice);

    result[tf] = parsed.map((c) => ({
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


// v3.1+: detect liquidity grab quanh swing H/L gần nhất
function detectLiquidityGrabs(parsed, swings, maxLookback = 8) {
  if (!Array.isArray(parsed) || !parsed.length) return [];
  if (!Array.isArray(swings) || !swings.length) return [];

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
  const lastHighSwing = [...recent].reverse().find((s) => s.type === "H");
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
  const lastLowSwing = [...recent].reverse().find((s) => s.type === "L");
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
  if (!parsed || !parsed.length) {
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

  // Swings (fractal + internal/external)
  const swings = buildSimpleSwings(parsed, 80, tfLabel);

  // BOS + liquidity grab
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

  const trade_delta = buyVol - sellVol;

  return {
    recent_trades: {
      window_sec: null,
      buy_volume: buyVol,
      sell_volume: sellVol,
      trade_delta,
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

  return {
    retail_bias,
    squeeze_risk,
    funding_extreme,
    volatility_sentiment,
    market_summary,
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

    const parsed60 = parseKlinesList(raw60);
    const parsed240 = parseKlinesList(raw240);
    const parsedD = parseKlinesList(rawD);

    // Xây meta cho symbol này
    const lastKlineTs = {
      "60": parsed60.length ? parsed60[parsed60.length - 1].ts : null,
      "240": parsed240.length ? parsed240[parsed240.length - 1].ts : null,
      D: parsedD.length ? parsedD[parsedD.length - 1].ts : null,
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
      bybitData,
      binForSym,
      okxForSym
    );

    const sentiment_labels = buildSentimentLabels(
      derived_metrics,
      bybitData.indicators,
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
      },
      ticker: bybitData.ticker,
      indicators: bybitData.indicators, // 60 / 240 / D (đã enriched v3.1)
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

  const onchain = {
    exchange_netflow_daily: [],
    whale_exchange_flows: [],
  };

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

// Default export cho tiện
export default buildSnapshotV3;
