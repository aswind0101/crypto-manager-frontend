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
export async function collectBybitLiquidations(symbol, { windowMs = 12000 } = {}) {
    const sym = upperSymbol(symbol);
    const agg = initAgg(windowMs);

    const url = "wss://stream.bybit.com/v5/public/linear";

    return await new Promise((resolve) => {
        let ws;
        let timeout;

        const finish = () => {
            clearTimeout(timeout);
            safeClose(ws);
            resolve(agg);
        };

        try {
            ws = new WebSocket(url);

            ws.onopen = () => {
                agg.telemetry.ws_opened = true;

                const msg = { op: "subscribe", args: [`allLiquidation.${sym}`] };
                ws.send(JSON.stringify(msg));
                agg.telemetry.ws_subscribed = true;

                timeout = setTimeout(finish, windowMs);
            };

            ws.onmessage = (evt) => {
                agg.telemetry.messages += 1;
                agg.telemetry.last_msg_ts = Date.now();

                let data;
                try {
                    data = JSON.parse(evt.data);
                } catch {
                    return;
                }

                // Ignore non-payload / ack messages
                // Bybit often sends {success:true, op:"subscribe", ...} or {op:"pong"} etc.
                if (data?.op && data?.op !== "subscribe") return;
                if (data?.success === true && data?.op === "subscribe") return;

                // Topic guard (only accept liquidation topic)
                const topic = String(data?.topic || "");
                if (!topic.includes("allLiquidation")) return;

                // Bybit v5 payload commonly: { topic, data: [ {...}, ... ] } OR { topic, data: {...} }
                const payload = data?.data;
                const arr = Array.isArray(payload) ? payload : payload ? [payload] : [];
                if (!arr.length) return;

                for (const it of arr) {
                    // Defensive key mapping
                    const side = String(it?.side || it?.S || "").toUpperCase(); // "Buy"/"Sell" or "BUY"/"SELL"
                    const px = Number(it?.price ?? it?.p);
                    const qty = Number(it?.size ?? it?.q);

                    if (!Number.isFinite(px) || !Number.isFinite(qty)) continue;
                    if (side !== "BUY" && side !== "SELL") continue;

                    // Mapping: SELL => long liquidation; BUY => short liquidation
                    if (side === "SELL") agg.by_side.LONG += px * qty;
                    else agg.by_side.SHORT += px * qty;

                    agg.events += 1;
                }
            };

            ws.onerror = () => {
                agg.telemetry.error = "ws_error";
                finish();
            };

            ws.onclose = () => finish();
        } catch {
            agg.telemetry.error = "ws_exception";
            finish();
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
export async function collectBinanceLiquidations(symbol, { windowMs = 12000 } = {}) {
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
                agg.telemetry.messages += 1;
                agg.telemetry.last_msg_ts = Date.now();

                let msg;
                try {
                    msg = JSON.parse(evt.data);
                } catch {
                    return;
                }

                // Guard: forceOrder payload has "o"
                const o = msg?.o;
                if (!o) return;

                const side = String(o.S || "").toUpperCase();
                const px = Number(o.p);
                const qty = Number(o.q);
                if (!Number.isFinite(px) || !Number.isFinite(qty)) return;

                if (side === "SELL") agg.by_side.LONG += px * qty;
                else if (side === "BUY") agg.by_side.SHORT += px * qty;

                agg.events += 1;
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
