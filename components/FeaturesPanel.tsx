import React from "react";
import type { FeaturesSnapshot } from "../lib/feeds/features/types";

export function FeaturesPanel({ f }: { f: FeaturesSnapshot | null }) {
  if (!f) return null;

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid #222", borderRadius: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Feature Engine (Intraday)</div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ opacity: 0.7 }}>Bias ({f.bias.tf})</div>
          <div><b>{f.bias.trend_dir}</b> (strength {f.bias.trend_strength.toFixed(2)})</div>
          <div>ADX14: {f.bias.adx14?.toFixed(1) ?? "—"}</div>
          <div>Vol: {f.bias.vol_regime}</div>
        </div>

        <div>
          <div style={{ opacity: 0.7 }}>Entry</div>
          <div>RSI 5m: {f.entry.momentum.rsi14_5m?.toFixed(1) ?? "—"}</div>
          <div>RSI 15m: {f.entry.momentum.rsi14_15m?.toFixed(1) ?? "—"}</div>
          <div>MACD hist 5m: {f.entry.momentum.macdHist_5m?.toFixed(4) ?? "—"}</div>
          <div>ATR% 15m: {f.entry.volatility.atrp_15m?.toFixed(2) ?? "—"}</div>
        </div>

        <div>
          <div style={{ opacity: 0.7 }}>Orderflow</div>
          <div>Imb 10/50/200: {f.orderflow.imbalance.top10.toFixed(2)} / {f.orderflow.imbalance.top50.toFixed(2)} / {f.orderflow.imbalance.top200.toFixed(2)}</div>
          <div>Aggression: {f.orderflow.aggression_ratio.toFixed(2)}</div>
        </div>

        <div>
          <div style={{ opacity: 0.7 }}>Cross</div>
          <div>Dev bps: {f.cross.dev_bps != null ? f.cross.dev_bps.toFixed(2) : "—"}</div>
          <div>Dev z: {f.cross.dev_z != null ? f.cross.dev_z.toFixed(2) : "—"}</div>
          <div>Consensus: {f.cross.consensus_score != null ? f.cross.consensus_score.toFixed(2) : "—"}</div>
        </div>
      </div>

      {f.flags.notes?.length ? (
        <ul style={{ marginTop: 10, marginBottom: 0 }}>
          {f.flags.notes.slice(0, 5).map((n, i) => (
            <li key={i} style={{ fontSize: 12, opacity: 0.85 }}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
