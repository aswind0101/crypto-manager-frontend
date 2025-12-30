// lib/snapshot/market-snapshot-v4.js

import * as Bybit from "../exchanges/bybit.usdtm";
import * as Binance from "../exchanges/binance.usdtm";
import * as Okx from "../exchanges/okx.usdtm";

import { ema, rsi, macd, atr, labelEmaStack, labelRsiBias } from "../indicators/core";
import { findSwings, detectBosChoch, detectLiquidityGrab } from "../indicators/structure";
import { calcBookImbalance, calcTradesDelta, orderflowConfidence } from "../indicators/orderflow";
import { fundingExtremeLabel, oiTrendLabel, basisPremium } from "../indicators/derivatives";
import { collectBybitLiquidations, collectBinanceLiquidations } from "../ws/liquidations";

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
function normalizeLiqWindow(liqData, exchange) {
    // liqData: {window_ms, by_side{LONG,SHORT}, events, telemetry{...}}
    if (!liqData) {
        return {
            exchange,
            status: "not_supported",
            observed_liquidations: false,
            ws_ok: false,
            window_ms: null,
            by_side: { LONG: 0, SHORT: 0 },
            events: 0,
            telemetry: null,
        };
    }

    const t = liqData.telemetry || {};
    const ws_ok = !!t.ws_opened && (t.error == null);
    const observed = (liqData.events || 0) > 0;

    let status = "unknown";
    if (!t.ws_opened || t.error) status = "ws_failed";
    else if (observed) status = "observed";
    else if ((t.messages || 0) >= 1) status = "no_events"; // usually only subscribe ack
    else status = "no_messages";

    return {
        ...liqData,
        exchange,
        status,
        observed_liquidations: observed,
        ws_ok,
    };
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

        // Liquidations via WS (best-effort, short window)
        let liq = { ok: false, data: null };
        if (exchange === "bybit") {
            liq = await safe(`${exchange}.liqWS`, () => collectBybitLiquidations(symbol, { windowMs: 12000 }));
        }
        if (exchange === "binance") {
            liq = await safe(`${exchange}.liqWS`, () => collectBinanceLiquidations(symbol, { windowMs: 12000 }));
        }

        const data_quality = unifyDataQuality([
            { ok: !!ticker.ok }, { ok: Object.values(klines).some(x => (x.closed_len || 0) > 50) }
        ]);
        const liqNorm = normalizeLiqWindow(liq.data, exchange);

        return {
            meta: { exchange, data_quality },
            klines,
            ticker: ticker.data,
            derivatives: {
                open_interest: oi.data,
                open_interest_hist: oiHist.data,
                funding_history: fundingHist.data,
                liquidations_window: liqNorm, // {window_ms, by_side{LONG,SHORT}, events}
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
    const oiHistBinance = binance?.derivatives?.open_interest_hist || [];
    const oiTrendBinance = oiTrendLabel(oiHistBinance);

    function numOrNull(x) { return Number.isFinite(x) ? x : null; }
    function range(arr) {
        const xs = arr.filter(Number.isFinite);
        if (!xs.length) return null;
        return Math.max(...xs) - Math.min(...xs);
    }

    const fundingArr = [funding.bybit, funding.binance, funding.okx].map(numOrNull);
    const premiumArr = [premium.bybit, premium.binance, premium.okx].map(numOrNull);

    const derivativesSynthesis = {
        oi_trend: { binance: oiTrendBinance, bybit: "unknown", okx: "unknown" },
        funding_divergence: range(fundingArr),
        premium_divergence: range(premiumArr),
        leverage_regime: "neutral",
    };

    const anyFundingExtreme =
        ["positive_extreme", "negative_extreme"].includes(fundingLabels.bybit) ||
        ["positive_extreme", "negative_extreme"].includes(fundingLabels.binance) ||
        ["positive_extreme", "negative_extreme"].includes(fundingLabels.okx);

    if (anyFundingExtreme && (oiTrendBinance === "rising" || oiTrendBinance === "rising_strong")) {
        derivativesSynthesis.leverage_regime = "risk_on";
    } else if (anyFundingExtreme && (oiTrendBinance === "falling" || oiTrendBinance === "falling_strong")) {
        derivativesSynthesis.leverage_regime = "risk_off";
    }

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

    function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }

    const k15 = pickPrimaryKlines("15");
    const last15 = last(k15);
    const volNotional15m = (last15 && Number.isFinite(last15.c) && Number.isFinite(last15.v))
        ? (last15.c * last15.v)
        : null;

    // pick liquidation from the most reliable exchange you have (priority: bybit -> binance -> okx)
    const liqBybit = bybit?.derivatives?.liquidations_window || null;
    const liqBinance = binance?.derivatives?.liquidations_window || null;

    const liqPick = (liqBybit && liqBybit.ws_ok) ? liqBybit : (liqBinance && liqBinance.ws_ok) ? liqBinance : null;

    let liqFeatures = {
        source: liqPick?.exchange || null,
        status: liqPick?.status || "not_supported",
        observed: !!liqPick?.observed_liquidations,
        long_notional: liqPick?.by_side?.LONG ?? 0,
        short_notional: liqPick?.by_side?.SHORT ?? 0,
        total_notional: 0,
        bias: null,
        intensity_15m: null,
    };

    liqFeatures.total_notional = liqFeatures.long_notional + liqFeatures.short_notional;

    if (liqFeatures.total_notional > 0) {
        liqFeatures.bias = (liqFeatures.short_notional - liqFeatures.long_notional) / liqFeatures.total_notional; // -1..1
    }

    if (Number.isFinite(volNotional15m) && volNotional15m > 0) {
        liqFeatures.intensity_15m = liqFeatures.total_notional / volNotional15m; // unitless ratio
    }

    const hasTf = !!tfFeatures["60"] && !!tfFeatures["240"];
    const hasDeriv = !!(bybit?.ticker || binance?.ticker || okx?.ticker);

    const overall = blockConfidence({
        klinesOk: hasTf,
        derivOk: hasDeriv,
        ofConf: Math.max(ofBybit, ofBinance, ofOkx),
    });

    let liquidationScore = 0.5; // neutral
    if (liqFeatures.observed) {
        const inten = liqFeatures.intensity_15m;
        // intensity threshold heuristic (client-only quick): > 0.15 = strong liquidation pulse
        if (Number.isFinite(inten)) {
            if (inten > 0.15) liquidationScore = 0.85;
            else if (inten > 0.05) liquidationScore = 0.7;
            else liquidationScore = 0.6;
        } else {
            liquidationScore = 0.6;
        }
    }

    // Overall data quality
    const unifiedQuality = unifyDataQuality([
        { ok: !!tfFeatures["60"] },
        { ok: !!bybit?.ticker || !!binance?.ticker || !!okx?.ticker },
    ]);

    const snapshot = {
        schema: { name: "market_snapshot", version: "4.0", exchanges: ["bybit", "binance", "okx"], intervals: INTERVALS },
        generated_at: nowMs(),
        runtime: { tz, client_only: true, app: "crypto-manager-frontend" },
        request: { symbol, market: "perp/futures", margin: "USDT" },
        symbol,

        per_exchange: { bybit, binance, okx },

        unified: {
            features: {
                timeframes: tfFeatures,
                structure: { swings_last: swings.slice(-10), bos_last: bos.last, bos_events: bos.events, liquidity_grab: grab },
                derivatives: { funding, funding_labels: fundingLabels, premium, liquidation_features: liqFeatures, derivatives_synthesis: derivativesSynthesis, },
                orderflow: of,
            },
            scores: {
                trend: hasTf ? 0.8 : 0.2,
                derivatives: hasDeriv ? 0.8 : 0.2,
                orderflow: Math.max(ofBybit, ofBinance, ofOkx),
                overall,
                liquidations: liquidationScore,
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