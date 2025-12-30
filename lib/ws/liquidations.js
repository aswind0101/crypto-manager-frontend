// lib/ws/liquidations.js

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function safeClose(ws) {
    try {
        ws?.close?.();
    } catch { }
}

function upperSymbol(symbol) {
    return String(symbol || "").toUpperCase().trim();
}
function lowerSymbol(symbol) {
    return String(symbol || "").toLowerCase().trim();
}

// Aggregate liquidation notional by side in a short window
// Returns: { window_ms, by_side: { LONG: number, SHORT: number }, events: number }
function initAgg(windowMs) {
    return {
        window_ms: windowMs,
        by_side: { LONG: 0, SHORT: 0 },
        events: 0,
        telemetry: {
            ws_opened: false,
            ws_subscribed: false,
            messages: 0,
            last_msg_ts: null,
            error: null,
        },
    };
}

/**
 * BYBIT public liquidation stream (v5 websocket public):
 * topic: allLiquidation.{symbol}  e.g. allLiquidation.BTCUSDT :contentReference[oaicite:2]{index=2}
 *
 * We collect for windowMs then close.
 */
export async function collectBybitLiquidations(symbol, { windowMs = 4000 } = {}) {
    const sym = upperSymbol(symbol);
    const agg = initAgg(windowMs);

    // Bybit public WS base commonly: wss://stream.bybit.com/v5/public/linear
    // If this changes, you'll see diagnostics error and can swap base.
    const url = "wss://stream.bybit.com/v5/public/linear";

    return await new Promise((resolve) => {
        let ws;
        let timeout;
        try {
            ws = new WebSocket(url);
            ws.onopen = () => {
                agg.telemetry.ws_opened = true;
                const msg = { op: "subscribe", args: [`allLiquidation.${sym}`] };
                ws.send(JSON.stringify(msg));
                agg.telemetry.ws_subscribed = true;
                timeout = setTimeout(() => {
                    safeClose(ws);
                    resolve(agg);
                }, windowMs);
            };

            ws.onmessage = (evt) => {
                try {
                    agg.telemetry.messages += 1;
                    agg.telemetry.last_msg_ts = Date.now();
                    const data = JSON.parse(evt.data);
                    // liquidation message format can vary; we parse defensively
                    const items =
                        data?.data ??
                        data?.result ??
                        data?.payload ??
                        data?.result?.data ??
                        null;
                    const arr = Array.isArray(items) ? items : items ? [items] : [];
                    for (const it of arr) {
                        // side can be "Buy"/"Sell" depending on stream payload
                        const side = String(it?.side || it?.S || "").toUpperCase();
                        const px = Number(it?.price ?? it?.p);
                        const qty = Number(it?.size ?? it?.q);
                        if (!Number.isFinite(px) || !Number.isFinite(qty)) continue;

                        // Heuristic mapping:
                        // If liquidation order side is SELL => liquidated LONGs (forced sell) => LONG liquidation
                        // If side is BUY  => liquidated SHORTs => SHORT liquidation
                        if (side === "SELL") agg.by_side.LONG += px * qty;
                        else if (side === "BUY") agg.by_side.SHORT += px * qty;

                        agg.events += 1;
                    }
                } catch { }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                safeClose(ws);
                agg.telemetry.error = "ws_error";
                resolve(agg);
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                resolve(agg);
            };
        } catch {
            clearTimeout(timeout);
            safeClose(ws);
            resolve(agg);
        }
    });
}

/**
 * BINANCE USDT-M futures liquidation stream:
 * Base: wss://fstream.binance.com
 * Stream: <symbol>@forceOrder :contentReference[oaicite:3]{index=3}
 *
 * We collect for windowMs then close.
 */
export async function collectBinanceLiquidations(symbol, { windowMs = 4000 } = {}) {
    const sym = lowerSymbol(symbol);
    const agg = initAgg(windowMs);

    const url = `wss://fstream.binance.com/ws/${sym}@forceOrder`;

    return await new Promise((resolve) => {
        let ws;
        let timeout;
        try {
            ws = new WebSocket(url);

            ws.onopen = () => {
                agg.telemetry.ws_opened = true;
                timeout = setTimeout(() => {
                    safeClose(ws);
                    resolve(agg);
                }, windowMs);
            };

            ws.onmessage = (evt) => {
                try {
                    agg.telemetry.messages += 1;
                    agg.telemetry.last_msg_ts = Date.now();
                    const msg = JSON.parse(evt.data);
                    const o = msg?.o;
                    if (!o) return;

                    // payload fields in docs: o.S (side), o.p (price), o.q (orig qty)
                    const side = String(o.S || "").toUpperCase();
                    const px = Number(o.p);
                    const qty = Number(o.q);
                    if (!Number.isFinite(px) || !Number.isFinite(qty)) return;

                    if (side === "SELL") agg.by_side.LONG += px * qty;
                    else if (side === "BUY") agg.by_side.SHORT += px * qty;

                    agg.events += 1;
                } catch { }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                safeClose(ws);
                agg.telemetry.error = "ws_error";
                resolve(agg);
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                resolve(agg);
            };
        } catch {
            clearTimeout(timeout);
            safeClose(ws);
            resolve(agg);
        }
    });
}
