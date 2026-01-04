import React from "react";
import type { UnifiedSnapshot } from "../lib/feeds/snapshot/unifiedTypes";

export function DataStatusBar({ snap }: { snap: UnifiedSnapshot | null }) {
  if (!snap) return null;

  const dq = snap.data_quality;
  const by = snap.availability.bybit;
  const bi = snap.availability.binance;

  const devBps = snap.cross_exchange?.deviation_bps?.bybit_binance;
  const leadLag = snap.cross_exchange?.lead_lag;

  return (
    <div style={{ padding: 12, border: "1px solid #222", borderRadius: 10 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>
            Data Status — {snap.canon}
          </div>
          <div style={{ opacity: 0.8, fontSize: 12 }}>
            Generated: {new Date(snap.ts_generated).toLocaleTimeString()}
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span>
            Bybit:{" "}
            <b style={{ color: by.ok ? "#4caf50" : "#f44336" }}>
              {by.ok ? "OK" : "DOWN"}
            </b>
          </span>
          <span>
            Binance:{" "}
            <b style={{ color: bi?.ok ? "#4caf50" : "#f44336" }}>
              {bi?.ok ? "OK" : "DOWN"}
            </b>
          </span>
          <span>
            DQ: <b>{dq.grade}</b> ({dq.score})
          </span>
        </div>
      </div>

      {/* Cross-exchange */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px dashed #333",
          display: "flex",
          gap: 24,
          fontSize: 13,
        }}
      >
        <div>
          <div style={{ opacity: 0.7 }}>Deviation (Bybit − Binance)</div>
          <div style={{ fontWeight: 600 }}>
            {devBps != null ? `${devBps.toFixed(2)} bps` : "—"}
          </div>
        </div>

        <div>
          <div style={{ opacity: 0.7 }}>Lead / Lag (1m)</div>
          {leadLag ? (
            <div style={{ fontWeight: 600 }}>
              {leadLag.leader === "none"
                ? "None"
                : `${leadLag.leader.toUpperCase()} leads`}{" "}
              {leadLag.lag_bars !== 0
                ? `(${Math.abs(leadLag.lag_bars)} bars)`
                : ""}
            </div>
          ) : (
            <div style={{ fontWeight: 600 }}>—</div>
          )}
        </div>
      </div>

      {/* Data quality reasons */}
      {dq.reasons.length > 0 ? (
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          {dq.reasons.slice(0, 4).map((r, i) => (
            <li key={i} style={{ fontSize: 12, opacity: 0.9 }}>
              {r}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
          No issues detected.
        </div>
      )}
    </div>
  );
}
