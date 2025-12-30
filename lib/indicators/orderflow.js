// lib/indicators/orderflow.js

export function calcBookImbalance(book) {
  const bids = book?.bids || [];
  const asks = book?.asks || [];
  const bidNotional = bids.reduce((s, x) => s + (x.p * x.s), 0);
  const askNotional = asks.reduce((s, x) => s + (x.p * x.s), 0);
  const denom = bidNotional + askNotional;
  const imbalance = denom > 0 ? (bidNotional - askNotional) / denom : null; // -1..1
  return { bidNotional, askNotional, imbalance };
}

export function calcTradesDelta(trades) {
  // trades: [{px,qty,side}]
  let buy = 0, sell = 0;
  for (const t of trades || []) {
    const notional = (t.px || 0) * (t.qty || 0);
    if (!Number.isFinite(notional)) continue;
    if (String(t.side).toUpperCase() === "BUY") buy += notional;
    else if (String(t.side).toUpperCase() === "SELL") sell += notional;
  }
  return { buyNotional: buy, sellNotional: sell, deltaNotional: buy - sell };
}

export function orderflowConfidence({ book, trades }) {
  const b = (book?.bids?.length || 0) + (book?.asks?.length || 0);
  const t = trades?.length || 0;
  let c = 0;
  if (b >= 50) c += 0.45;
  else if (b >= 20) c += 0.3;
  else if (b >= 10) c += 0.15;

  if (t >= 300) c += 0.45;
  else if (t >= 100) c += 0.3;
  else if (t >= 30) c += 0.15;

  return Math.min(1, c);
}
