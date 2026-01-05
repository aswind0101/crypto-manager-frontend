import React from "react";
import type { SetupEngineOutput } from "../lib/feeds/setups/types";

export function SetupsPanel({ out }: { out: SetupEngineOutput | null }) {
  if (!out) return null;

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid #222", borderRadius: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Setups (Intraday){out.preferred_id ? ` — Preferred: ${out.preferred_id}` : ""}
      </div>

      {out.setups.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No setups (DQ gate or insufficient context).</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {out.setups.map((s) => (
            <div
              key={s.id}
              style={{
                padding: 10,
                border: "1px solid #333",
                borderRadius: 10,
                opacity: s.status === "INVALIDATED" ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {s.side} — {s.type} — {s.status}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    TF: entry {s.entry_tf} / bias {s.bias_tf} • RR(min): {s.rr_min.toFixed(2)} • Conf:{" "}
                    {s.confidence.grade} ({s.confidence.score})
                  </div>
                </div>

                <div style={{ fontSize: 12, textAlign: "right" }}>
                  <div>Entry: {s.entry.mode}</div>
                  <div>
                    [{s.entry.zone.lo.toFixed(2)} – {s.entry.zone.hi.toFixed(2)}]
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div>SL: {s.stop.price.toFixed(2)} ({s.stop.basis})</div>
                <div>
                  TP:{" "}
                  {s.tp.map((t) => `${t.price.toFixed(2)} (${t.size_pct}%)`).join(" • ")}
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>Trigger</div>
                <div style={{ opacity: 0.9 }}>{s.entry.trigger.summary}</div>
                <ul style={{ marginTop: 6, marginBottom: 0 }}>
                  {s.entry.trigger.checklist.map((c) => (
                    <li key={c.key} style={{ opacity: c.ok ? 0.95 : 0.65 }}>
                      {c.ok ? "OK" : "WAIT"} — {c.key}
                      {c.note ? `: ${c.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>

              {s.confidence.reasons?.length ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  {s.confidence.reasons.slice(0, 4).join(" • ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
