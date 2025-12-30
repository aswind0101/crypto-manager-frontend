// lib/snapshot/market-snapshot-v4.js

import * as Bybit from "../exchanges/bybit.usdtm";
import * as Binance from "../exchanges/binance.usdtm";
import * as Okx from "../exchanges/okx.usdtm";

import { ema, rsi, macd, atr, labelEmaStack, labelRsiBias } from "../indicators/core";
import { findSwings, detectBosChoch, detectLiquidityGrab } from "../indicators/structure";
import { calcBookImbalance, calcTradesDelta, orderflowConfidence } from "../indicators/orderflow";
import { fundingExtremeLabel, oiTrendLabel, basisPremium } from "../indicators/derivatives";
import { getLiquidationCache, getLiquidationCacheMeta } from "../ws/liquidation-cache";


const INTERVALS = ["5", "15", "60", "240", "D"];
const KLINE_LIMIT = 300;

function nowMs() { return Date.now(); }

function toKlineObj(k) {
    // đảm bảo numeric
    return {
        ts: Number(k.ts),
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
    };
}

function dropFormingCandle(klines, tf) {
    // rule: bỏ candle mới nhất nếu chưa “đóng” dựa trên ts + tfMs > now
    const tfMs = tf === "D" ? 86400000 : Number(tf) * 60000;
    if (!Array.isArray(klines) || klines.length < 2) return klines || [];
    const last = klines[klines.length - 1];
    const closeTs = Number(last.ts) + tfMs;
    if (Number.isFinite(closeTs) && closeTs > nowMs()) {
        return klines.slice(0, -1);
    }
    return klines;
}

function computeTfFeatures(klines) {
    const closes = klines.map(k => k.c);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e100 = ema(closes, 100);
    const e200 = ema(closes, 200);
    const r = rsi(closes, 14);
    const m = macd(closes, 12, 26, 9);
    const a = atr(klines, 14);

    const i = klines.length - 1;
    const last = {
        ema20: e20[i], ema50: e50[i], ema100: e100[i], ema200: e200[i],
        rsi14: r[i],
        macd: m.line[i], macd_signal: m.signal[i], macd_hist: m.hist[i],
        atr14: a[i],
    };

    const emaStack = labelEmaStack(last.ema20, last.ema50, last.ema100, last.ema200);
    const rsiBias = labelRsiBias(last.rsi14);

    // trend label (nhẹ): dựa trên ema stack + vị trí close so với ema200
    const c = closes[i];
    let trend = "range";
    if (emaStack === "bull_stack" && Number.isFinite(c) && Number.isFinite(last.ema200) && c > last.ema200) trend = "bull";
    if (emaStack === "bear_stack" && Number.isFinite(c) && Number.isFinite(last.ema200) && c < last.ema200) trend = "bear";

    return { last, labels: { ema_stack: emaStack, rsi_bias: rsiBias, trend } };
}

function unifyDataQuality(blocks) {
    // blocks: [{ok:boolean}] -> ok/partial/insufficient
    const oks = blocks.filter(x => x.ok).length;
    if (oks === blocks.length) return "ok";
    if (oks >= 1) return "partial";
    return "unavailable";
}
function blockConfidence({ klinesOk, derivOk, ofConf }) {
    let c = 0;
    if (klinesOk) c += 0.45;
    if (derivOk) c += 0.35;
    if (Number.isFinite(ofConf)) c += 0.20 * Math.max(0, Math.min(1, ofConf));
    return Math.min(1, c);
}

export async function buildMarketSnapshotV4(symbol, { tz = "America/Los_Angeles" } = {}) {
    const t0 = nowMs();
    const errors = [];

    async function safe(label, fn) {
        try {
            const data = await fn();
            return { ok: true, data };
        } catch (e) {
            errors.push({ label, message: String(e?.message || e) });
            return { ok: false, data: null };
        }
    }

    async function fetchExchange(exchange) {
        const api = exchange === "bybit" ? Bybit : exchange === "binance" ? Binance : Okx;

        // klines per TF
        const klines = {};
        for (const tf of INTERVALS) {
            const res = await safe(`${exchange}.klines.${tf}`, async () => {
                const raw = await api.getKlines(symbol, tf, KLINE_LIMIT);
                const norm = (raw || []).map(toKlineObj);
                const closed = dropFormingCandle(norm, tf);
                return { tf, closed, raw_len: norm.length, closed_len: closed.length };
            });
            klines[tf] = res.ok ? res.data : { tf, closed: [], raw_len: 0, closed_len: 0 };
        }

        const ticker = await safe(`${exchange}.ticker`, () => api.getTicker(symbol));
        const oi = await safe(`${exchange}.oi`, () => api.getOpenInterest(symbol));
        const fundingHist = api.getFundingHistory
            ? await safe(`${exchange}.fundingHist`, () => api.getFundingHistory(symbol))
            : { ok: false, data: [] };

        const book = api.getOrderbook ? await safe(`${exchange}.book`, () => api.getOrderbook(symbol, 50)) : { ok: false, data: null };
        const trades = api.getRecentTrades ? await safe(`${exchange}.trades`, () => api.getRecentTrades(symbol, 500)) : { ok: false, data: [] };
        // Binance OI hist (best-effort)
        let oiHist = { ok: false, data: [] };
        if (exchange === "binance" && api.getOpenInterestHist) {
            oiHist = await safe(`${exchange}.oiHist`, () => api.getOpenInterestHist(symbol, "5m", 50));
        }

        const data_quality = unifyDataQuality([
            { ok: !!ticker.ok }, { ok: Object.values(klines).some(x => (x.closed_len || 0) > 50) }
        ]);
        const liqCache = getLiquidationCache();
        const liqMeta = getLiquidationCacheMeta();

        let liqData = null;
        if (exchange === "bybit") liqData = liqCache?.bybit || null;
        if (exchange === "binance") liqData = liqCache?.binance || null;
        if (exchange === "okx") {
            liqData = null;
        }
        if (exchange !== "bybit" && exchange !== "binance") {
            liqData = null;
        } else if (liqData) {
                liqData = {
                    ...liqData,
                    cache: {
                        symbol: liqMeta.symbol,
                        updated_at: liqMeta.updated_at,
                        window_ms: liqMeta.window_ms,
                        running: liqMeta.running,
                    },
                    observed_liquidations: (liqData?.events || 0) > 0,
                };
            } else {
                liqData = {
                    window_ms: liqMeta.window_ms || null,
                    by_side: { LONG: 0, SHORT: 0 },
                    events: 0,
                    telemetry: {
                        ws_opened: false,
                        ws_subscribed: false,
                        messages: 0,
                        last_msg_ts: null,
                        error: "no_cache",
                    },
                    cache: {
                        symbol: liqMeta.symbol,
                        updated_at: liqMeta.updated_at,
                        window_ms: liqMeta.window_ms,
                        running: liqMeta.running,
                    },
                    observed_liquidations: false,
                };
            }

        return {
            meta: { exchange, data_quality },
            klines,
            ticker: ticker.data,
            derivatives: {
                open_interest: oi.data,
                open_interest_hist: oiHist.data,
                funding_history: fundingHist.data,
                liquidations_window: liqData,
            },
            orderflow: {
                orderbook: book.data,
                trades: trades.data,
            },
        };
    }

    const [bybit, binance, okx] = await Promise.all([
        fetchExchange("bybit"),
        fetchExchange("binance"),
        fetchExchange("okx"),
    ]);

    // Unified features (dùng Bybit làm “primary price” nếu đủ; fallback sang Binance/OKX)
    function pickPrimaryKlines(tf) {
        const a = bybit?.klines?.[tf]?.closed || [];
        if (a.length > 100) return a;
        const b = binance?.klines?.[tf]?.closed || [];
        if (b.length > 100) return b;
        return okx?.klines?.[tf]?.closed || [];
    }

    const tfFeatures = {};
    for (const tf of INTERVALS) {
        const k = pickPrimaryKlines(tf);
        tfFeatures[tf] = k.length ? computeTfFeatures(k) : null;
    }

    // Structure dùng TF 60/240 chủ đạo
    const k60 = pickPrimaryKlines("60");
    const swings = k60.length ? findSwings(k60, 2, 2) : [];
    const bos = k60.length ? detectBosChoch(k60, swings) : { events: [], last: null };
    const grab = k60.length ? detectLiquidityGrab(k60, swings, 80) : null;

    // Derivatives synthesis (cross-exchange)
    const funding = {
        bybit: bybit?.ticker?.funding,
        binance: binance?.ticker?.funding,
        okx: okx?.ticker?.funding,
    };
    const fundingLabels = {
        bybit: fundingExtremeLabel(funding.bybit),
        binance: fundingExtremeLabel(funding.binance),
        okx: fundingExtremeLabel(funding.okx),
    };

    const premium = {
        bybit: basisPremium(bybit?.ticker?.mark, bybit?.ticker?.index),
        binance: basisPremium(binance?.ticker?.mark, binance?.ticker?.index),
        okx: basisPremium(okx?.ticker?.mark, okx?.ticker?.index),
    };

    // Orderflow synthesis (mỗi sàn)
    function ofBlock(ex) {
        const book = ex?.orderflow?.orderbook;
        const trades = ex?.orderflow?.trades || [];
        const bi = book ? calcBookImbalance(book) : { imbalance: null };
        const td = calcTradesDelta(trades);
        const conf = orderflowConfidence({ book, trades });
        return { book_imbalance: bi.imbalance, delta_notional: td.deltaNotional, confidence: conf };
    }

    const of = { bybit: ofBlock(bybit), binance: ofBlock(binance), okx: ofBlock(okx) };
    const ofBybit = of?.bybit?.confidence ?? 0;
    const ofBinance = of?.binance?.confidence ?? 0;
    const ofOkx = of?.okx?.confidence ?? 0;

    const hasTf = !!tfFeatures["60"] && !!tfFeatures["240"];
    const hasDeriv = !!(bybit?.ticker || binance?.ticker || okx?.ticker);

    const overall = blockConfidence({
        klinesOk: hasTf,
        derivOk: hasDeriv,
        ofConf: Math.max(ofBybit, ofBinance, ofOkx),
    });


    // Overall data quality
    const unifiedQuality = unifyDataQuality([
        { ok: !!tfFeatures["60"] },
        { ok: !!bybit?.ticker || !!binance?.ticker || !!okx?.ticker },
    ]);

    const snapshot = {
        schema: { name: "market_snapshot", version: "4.1", exchanges: ["bybit", "binance", "okx"], intervals: INTERVALS },
        generated_at: nowMs(),
        runtime: { tz, client_only: true, app: "crypto-manager-frontend" },
        request: { symbol, market: "perp/futures", margin: "USDT" },
        symbol,

        per_exchange: { bybit, binance, okx },

        unified: {
            features: {
                timeframes: tfFeatures,
                structure: { swings_last: swings.slice(-10), bos_last: bos.last, bos_events: bos.events, liquidity_grab: grab },
                derivatives: { funding, funding_labels: fundingLabels, premium },
                orderflow: of,
            },
            scores: {
                trend: hasTf ? 0.8 : 0.2,
                derivatives: hasDeriv ? 0.8 : 0.2,
                orderflow: Math.max(ofBybit, ofBinance, ofOkx),
                overall,
            },
            data_quality: unifiedQuality,
        },
        risk_policy: {
            defaults: {
                intraday: { risk_per_trade_pct: 1.0, max_leverage: 10, max_positions: 2, allow_dca: false },
                swing: { risk_per_trade_pct: 1.25, max_leverage: 5, max_positions: 2, allow_dca: true, dca_max_adds: 2 },
            },
            stops: {
                intraday: { method: "max(structure_invalidation, 1.2*ATR14_entryTF)" },
                swing: { method: "structure_invalidation_HTF or 1.5*ATR14_H4" },
            },
            take_profit: {
                tp1: { at_R: 1.0, reduce_pct: 35 },
                tp2: { at_R: 2.0, reduce_pct: 35 },
                runner: { method: "trail_ema20_or_structure" },
            },
            filters: [
                "no-trade if HTF trend conflicts strongly",
                "no-trade if funding extreme + OI rising against direction",
                "reduce size if data_quality is partial or overall score < 0.5",
            ],
        },
        diagnostics: {
            timings_ms: { total: nowMs() - t0 },
            errors,
            warnings: [],
        },

    };

    return snapshot;
}
