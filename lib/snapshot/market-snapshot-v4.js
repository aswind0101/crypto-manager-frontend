// lib/snapshot/market-snapshot-v4.js

import * as Bybit from "../exchanges/bybit.usdtm";
import * as Binance from "../exchanges/binance.usdtm";
import * as Okx from "../exchanges/okx.usdtm";

import { ema, rsi, macd, atr, labelEmaStack, labelRsiBias } from "../indicators/core";
import { findSwings, detectBosChoch, detectLiquidityGrab } from "../indicators/structure";
import { calcBookImbalance, calcTradesDelta, orderflowConfidence } from "../indicators/orderflow";
import { fundingExtremeLabel, oiTrendLabel, basisPremium } from "../indicators/derivatives";
import { collectBybitLiquidations, collectBinanceLiquidations } from "../ws/liquidations";
import { buildSetupsV2 } from "../indicators/setup-engine";
import { buildMarketOutlookV1 } from "../indicators/market-outlook";



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

// ===========================
// Anchor Layer v2 helpers
// ===========================
function kTs(k) {
    return k && Number.isFinite(k.ts) ? Number(k.ts) : null;
}

function buildSwingPrimitiveFromLast({ swings_last, klines, tf }) {
    const s0 = (swings_last && swings_last[0]) ? swings_last[0] : null;
    if (!s0 || !Number.isFinite(s0.i) || !Number.isFinite(s0.price)) return null;
    return {
        tf,
        type: s0.type,      // "low" | "high"
        price: s0.price,
        idx: s0.i,
        ts: kTs(klines?.[s0.i]),
        src: "fractal",
    };
}

function buildBosPrimitive({ bos_last, klines, tf }) {
    const b0 = bos_last || null;
    if (!b0 || !Number.isFinite(b0.i) || !Number.isFinite(b0.level)) return null;
    return {
        tf,
        kind: String(b0.type || "").startsWith("BOS") ? "BOS" : "CHOCH",
        side: b0.type === "BOS_UP" ? "bull" : (b0.type === "BOS_DOWN" ? "bear" : "unknown"),
        price: b0.level,
        idx: b0.i,
        ts: kTs(klines?.[b0.i]),
    };
}

function buildSweepPrimitiveFromGrab({ liquidity_grab, klines, tf, swings_last }) {
    // liquidity_grab example:
    // { i: 297, type: "grab_up_wick_reject", swing: 2946 }
    const g0 = liquidity_grab || null;
    if (!g0 || !Number.isFinite(g0.i) || !Number.isFinite(g0.swing)) return null;

    const k0 = klines?.[g0.i];
    if (!k0) return null;

    const isUp = String(g0.type || "").includes("up");
    const reclaimed = Number(g0.swing);
    // Try to resolve swing_ref (idx/ts) from swings_last
    let refIdx = null;
    let refTs = null;

    if (Array.isArray(swings_last) && swings_last.length) {
        // prefer exact price match; fallback to nearest within small epsilon
        const refType = isUp ? "high" : "low";
        const eps = 1e-6;

        let best = null;
        for (const s of swings_last) {
            if (!s) continue;
            if (s.type !== refType) continue;
            if (!Number.isFinite(s.price) || !Number.isFinite(s.i)) continue;

            const d = Math.abs(Number(s.price) - reclaimed);
            if (d <= eps) { best = s; break; }
            if (!best || d < Math.abs(Number(best.price) - reclaimed)) best = s;
        }

        if (best && Number.isFinite(best.i)) {
            refIdx = best.i;
            refTs = kTs(klines?.[best.i]) ?? null;
        }
    }

    const wickExtreme = isUp ? Number(k0.h) : Number(k0.l);
    const confirmClose = Number(k0.c); // v2-minimal: confirm cùng candle (Bước 3/4 sẽ nâng cấp search confirm 1-3 candle)

    if (!Number.isFinite(wickExtreme) || !Number.isFinite(confirmClose) || !Number.isFinite(reclaimed)) return null;

    const penetration = isUp ? (wickExtreme - reclaimed) : (reclaimed - wickExtreme);
    const closeBackDistance = isUp ? (reclaimed - confirmClose) : (confirmClose - reclaimed);

    return {
        tf,
        side: isUp ? "up" : "down",
        swing_ref: {
            type: isUp ? "high" : "low",
            price: reclaimed,
            ts: refTs,
            idx: refIdx,
        },
        wick_extreme: wickExtreme,
        sweep_ts: kTs(k0),
        confirm_ts: kTs(k0),
        confirm_close: confirmClose,
        reclaimed_level: reclaimed,
        quality: {
            penetration,
            close_back_distance: closeBackDistance,
            speed: 0,
        },
        src: "liquidity_grab",
        raw_type: g0.type,
        idx: g0.i,
    };
}

function initAnchorLayer(symbol) {
    return {
        v: "2.0",
        market: { symbol, now_ts: nowMs(), tick_size: null }, // tick_size sẽ bổ sung sau
        volatility: { atr: {}, atr_pct: {} },
        structure: { by_tf: {} },
        liquidity: { by_tf: {} },
    };
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

    const tfKlines = {};
    const tfFeatures = {};
    for (const tf of INTERVALS) {
        const k = pickPrimaryKlines(tf);
        tfKlines[tf] = k;
        tfFeatures[tf] = k.length ? computeTfFeatures(k) : null;
    }

    // Structure dùng TF 60/240 chủ đạo (giữ nguyên output v1)
    const k60 = tfKlines["60"] || [];
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

    const k15 = tfKlines["15"] || [];
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
        intensity_15m: null
    };

    liqFeatures.total_notional = liqFeatures.long_notional + liqFeatures.short_notional;

    if (liqFeatures.observed && liqFeatures.total_notional > 0) {
        liqFeatures.bias =
            (liqFeatures.short_notional - liqFeatures.long_notional) /
            liqFeatures.total_notional;
    }

    if (
        liqFeatures.observed &&
        liqFeatures.total_notional > 0 &&
        Number.isFinite(volNotional15m) &&
        volNotional15m > 0
    ) {
        liqFeatures.intensity_15m = liqFeatures.total_notional / volNotional15m;
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

    // ===========================
    // Anchor Layer v2 (NEW)
    // ===========================
    const anchor_layer = initAnchorLayer(symbol);

    for (const tf of INTERVALS) {
        const k = tfKlines[tf] || [];
        const feat = tfFeatures[tf];

        // volatility
        const atr14 = feat?.last?.atr14;
        anchor_layer.volatility.atr[tf] = Number.isFinite(atr14) ? atr14 : null;
        const lastClose = k.length ? k[k.length - 1].c : null;
        anchor_layer.volatility.atr_pct[tf] = (Number.isFinite(atr14) && Number.isFinite(lastClose) && lastClose > 0) ? (atr14 / lastClose) : null;

        // structure primitives per TF (minimal: swing_last; full swings not yet standardized here)
        // If you want full swing lists per TF, we can add it in the next step.
        const swingsTf = k.length ? findSwings(k, 2, 2) : [];
        const bosTf = k.length ? detectBosChoch(k, swingsTf) : { events: [], last: null };
        const grabTf = k.length ? detectLiquidityGrab(k, swingsTf, 80) : null;

        // Prepare "swings_last" like your v1 structure (keep consistent)
        const swings_last = swingsTf.slice(-10);

        const swing_last_p = buildSwingPrimitiveFromLast({ swings_last, klines: k, tf });
        const bos_last_p = buildBosPrimitive({ bos_last: bosTf.last, klines: k, tf });
        const sweep_last_p = buildSweepPrimitiveFromGrab({ liquidity_grab: grabTf, klines: k, tf, swings_last });

        anchor_layer.structure.by_tf[tf] = {
            // v2 primitives
            swing_last: swing_last_p,
            bos_last: bos_last_p,

            // v1/raw (để debug / backward compat)
            swings_last,
            bos_last_raw: bosTf.last,
            liquidity_grab: grabTf,
        };


        anchor_layer.liquidity.by_tf[tf] = {
            sweep_last: sweep_last_p,
            sweeps: sweep_last_p ? [sweep_last_p] : [],
        };
    }

    // Attach
    snapshot.unified.anchor_layer = anchor_layer;

    // Existing setups V1 (still built off snapshot; step 3 will refactor engine to use anchor_layer)
    //const setupsV1 = buildSetupsV1(snapshot);
    //snapshot.unified.setups = { version: "1.0", ...setupsV1 };

    // v2 (NEW)
    //const setupsV2 = buildSetupsV2(snapshot, { prefer_tf: "60" });
    //snapshot.unified.setups_v2 = setupsV2;

    // (khuyến nghị) dùng v2 làm primary cho UI/consumers nếu tồn tại
    /*
    if (setupsV2?.primary) {
        snapshot.unified.setups.primary = {
            // map tối thiểu để tương thích màn hình v1
            symbol: setupsV2.primary.symbol,
            type: setupsV2.primary.type,
            bias: setupsV2.primary.bias,
            trigger: setupsV2.primary.trigger,
            entry_zone: setupsV2.primary.entry_zone,
            entry: setupsV2.primary.entry_preferred,
            invalidation: setupsV2.primary.invalidation,
            stop: setupsV2.primary.stop,
            targets: {
                tp1: setupsV2.primary.targets?.tp1 ?? null,
                tp2: setupsV2.primary.targets?.tp2 ?? null,
                runner: null,
            },
            confidence: setupsV2.primary.final_score, // nếu UI dùng confidence 1 số
            // optional: expose the two scores
            idea_confidence: setupsV2.primary.idea_confidence,
            parameter_reliability: setupsV2.primary.parameter_reliability,
            quality_tier: setupsV2.primary.quality_tier,
            warnings: setupsV2.primary.warnings,
        };
    } */
    // v2 only (export to JSON)
    const setupsV2 = buildSetupsV2(snapshot, { prefer_tf: "60" });
    snapshot.unified.setups_v2 = setupsV2;
    // Retail outlook v1 (NEW)
    snapshot.unified.market_outlook_v1 = buildMarketOutlookV1(snapshot);
    // Optional: explicitly mark v1 as present in codebase but not exported
    snapshot.unified.setups_v1_exported = false;
    // ===========================
    return snapshot;
}
