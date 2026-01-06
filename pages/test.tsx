"use client";

import React, { useMemo, useState } from "react";

// IMPORTANT:
// Hãy chỉnh đường dẫn import này theo project của bạn.
// Bạn đã có hook useFeaturesSnapshot trong codebase (file hook).
import { useFeaturesSnapshot } from "../hooks/useFeaturesSnapshot";

type Row = { label: string; value: any; ok?: boolean; note?: string };

function isNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function fmtNum(x: any, digits = 4) {
  if (!isNum(x)) return "n/a";
  return x.toFixed(digits);
}

function fmtPct(x: any, digits = 2) {
  if (!isNum(x)) return "n/a";
  return `${x.toFixed(digits)}%`;
}

function fmtBps(x: any, digits = 2) {
  if (!isNum(x)) return "n/a";
  return `${x.toFixed(digits)} bps`;
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        border: "1px solid #ddd",
        background: ok ? "#eefbf0" : "#fff3f3",
        color: ok ? "#0f6a2f" : "#8a1f1f",
      }}
    >
      {text}
    </span>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        padding: 14,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function RowsTable({ rows }: { rows: Row[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={idx} style={{ borderTop: "1px solid #f0f0f0" }}>
            <td style={{ padding: "8px 6px", width: "34%", color: "#333" }}>
              {r.label}
            </td>
            <td style={{ padding: "8px 6px", width: "46%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {String(r.value)}
            </td>
            <td style={{ padding: "8px 6px", width: "20%", textAlign: "right" }}>
              {typeof r.ok === "boolean" ? (
                <Badge ok={r.ok} text={r.ok ? "OK" : "MISSING"} />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function IndicatorsDebugPage() {
  const snap = useFeaturesSnapshot("BTCUSDT");
  const f = snap?.features;

  const [showJson, setShowJson] = useState(false);

  const health = useMemo(() => {
    if (!f) return null;

    const ms15 = (f as any).market_structure?.["15m"];
    const ms1h = (f as any).market_structure?.["1h"];
    const ms4h = (f as any).market_structure?.["4h"];

    const rows: Row[] = [
      {
        label: "quality.dq_grade",
        value: f.quality?.dq_grade ?? "n/a",
        ok: !!f.quality?.dq_grade,
      },

      {
        label: "bias.trend_dir",
        value: f.bias?.trend_dir ?? "n/a",
        ok: !!f.bias?.trend_dir,
      },
      {
        label: "bias.trend_strength",
        value: isNum(f.bias?.trend_strength) ? fmtNum(f.bias.trend_strength, 3) : "n/a",
        ok: isNum(f.bias?.trend_strength),
      },
      {
        label: "bias.adx14",
        value: isNum(f.bias?.adx14) ? fmtNum(f.bias.adx14, 1) : "n/a",
        ok: isNum(f.bias?.adx14),
      },
      {
        label: "bias.ema200",
        value: isNum(f.bias?.ema200) ? fmtNum(f.bias.ema200, 2) : "n/a",
        ok: isNum(f.bias?.ema200),
      },
      {
        label: "bias.ema200_slope_bps",
        value: isNum((f.bias as any)?.ema200_slope_bps)
          ? fmtBps((f.bias as any).ema200_slope_bps, 2)
          : "n/a",
        ok: isNum((f.bias as any)?.ema200_slope_bps),
      },

      {
        label: "vol.atrp_15m",
        value: isNum(f.entry?.volatility?.atrp_15m) ? fmtPct(f.entry.volatility.atrp_15m) : "n/a",
        ok: isNum(f.entry?.volatility?.atrp_15m),
      },
      {
        label: "vol.atrp_1h",
        value: isNum((f.entry?.volatility as any)?.atrp_1h) ? fmtPct((f.entry.volatility as any).atrp_1h) : "n/a",
        ok: isNum((f.entry?.volatility as any)?.atrp_1h),
      },
      {
        label: "vol.atrp_4h",
        value: isNum((f.entry?.volatility as any)?.atrp_4h) ? fmtPct((f.entry.volatility as any).atrp_4h) : "n/a",
        ok: isNum((f.entry?.volatility as any)?.atrp_4h),
      },
      {
        label: "vol.bbWidth_15m",
        value: isNum(f.entry?.volatility?.bbWidth_15m) ? fmtNum(f.entry.volatility.bbWidth_15m, 4) : "n/a",
        ok: isNum(f.entry?.volatility?.bbWidth_15m),
      },
      {
        label: "vol.bbWidth_1h",
        value: isNum((f.entry?.volatility as any)?.bbWidth_1h) ? fmtNum((f.entry.volatility as any).bbWidth_1h, 4) : "n/a",
        ok: isNum((f.entry?.volatility as any)?.bbWidth_1h),
      },
      {
        label: "vol.bbWidth_4h",
        value: isNum((f.entry?.volatility as any)?.bbWidth_4h) ? fmtNum((f.entry.volatility as any).bbWidth_4h, 4) : "n/a",
        ok: isNum((f.entry?.volatility as any)?.bbWidth_4h),
      },

      {
        label: "cross.consensus_score",
        value: isNum(f.cross?.consensus_score) ? fmtNum(f.cross.consensus_score, 3) : "n/a",
        ok: isNum(f.cross?.consensus_score),
      },
      {
        label: "cross.dev_bps",
        value: isNum(f.cross?.dev_bps) ? fmtBps(f.cross.dev_bps, 2) : "n/a",
        ok: isNum(f.cross?.dev_bps),
      },

      {
        label: "orderflow.imbalance.top200",
        value: isNum(f.orderflow?.imbalance?.top200) ? fmtNum(f.orderflow.imbalance.top200, 3) : "n/a",
        ok: isNum(f.orderflow?.imbalance?.top200),
      },
      {
        label: "orderflow.aggression_ratio",
        value: isNum(f.orderflow?.aggression_ratio) ? fmtNum(f.orderflow.aggression_ratio, 3) : "n/a",
        ok: isNum(f.orderflow?.aggression_ratio),
      },

      // delta block (new)
      {
        label: "orderflow.delta.delta_norm",
        value: isNum((f.orderflow as any)?.delta?.delta_norm)
          ? fmtNum((f.orderflow as any).delta.delta_norm, 3)
          : "n/a",
        ok: isNum((f.orderflow as any)?.delta?.delta_norm),
      },
      {
        label: "orderflow.delta.divergence_score",
        value: isNum((f.orderflow as any)?.delta?.divergence_score)
          ? fmtNum((f.orderflow as any).delta.divergence_score, 3)
          : "n/a",
        ok: isNum((f.orderflow as any)?.delta?.divergence_score),
      },
      {
        label: "orderflow.delta.divergence_dir",
        value: (f.orderflow as any)?.delta?.divergence_dir ?? "n/a",
        ok: typeof (f.orderflow as any)?.delta?.divergence_dir === "string",
      },
      {
        label: "orderflow.delta.absorption_score",
        value: isNum((f.orderflow as any)?.delta?.absorption_score)
          ? fmtNum((f.orderflow as any).delta.absorption_score, 3)
          : "n/a",
        ok: isNum((f.orderflow as any)?.delta?.absorption_score),
      },
      {
        label: "orderflow.delta.absorption_dir",
        value: (f.orderflow as any)?.delta?.absorption_dir ?? "n/a",
        ok: typeof (f.orderflow as any)?.delta?.absorption_dir === "string",
      },

      // Market structure presence per TF
      {
        label: 'market_structure["15m"].lastBOS',
        value: ms15?.lastBOS ? `${ms15.lastBOS.dir} @ ${fmtNum(ms15.lastBOS.level, 2)}` : "n/a",
        ok: !!ms15?.lastBOS,
      },
      {
        label: 'market_structure["1h"].lastBOS',
        value: ms1h?.lastBOS ? `${ms1h.lastBOS.dir} @ ${fmtNum(ms1h.lastBOS.level, 2)}` : "n/a",
        ok: !!ms1h?.lastBOS,
      },
      {
        label: 'market_structure["4h"].lastBOS',
        value: ms4h?.lastBOS ? `${ms4h.lastBOS.dir} @ ${fmtNum(ms4h.lastBOS.level, 2)}` : "n/a",
        ok: !!ms4h?.lastBOS,
      },
      {
        label: 'market_structure["4h"].lastCHOCH',
        value: ms4h?.lastCHOCH ? `${ms4h.lastCHOCH.dir} @ ${fmtNum(ms4h.lastCHOCH.level, 2)}` : "n/a",
        ok: !!ms4h?.lastCHOCH,
      },
    ];

    const missing = rows.filter(r => r.ok === false).length;
    return { rows, missing, total: rows.length };
  }, [f]);

  if (!snap) {
    return (
      <div style={{ padding: 20 }}>
        <h2 style={{ margin: 0 }}>Indicators Debug</h2>
        <p style={{ marginTop: 10 }}>No snapshot yet.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, background: "#fafafa", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Indicators Debug</h2>
          
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {health ? (
            <Badge ok={health.missing === 0} text={`Missing ${health.missing}/${health.total}`} />
          ) : null}
          <button
            onClick={() => setShowJson(v => !v)}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: "8px 10px",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {showJson ? "Hide JSON" : "Show JSON"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
        <div style={{ gridColumn: "span 12" }}>
          <Card title="Indicator Health (presence / key values)">
            <RowsTable rows={health?.rows ?? []} />
          </Card>
        </div>

        <div style={{ gridColumn: "span 12" }}>
          <Card title="Notes (what to screenshot)">
            <ul style={{ margin: 0, paddingLeft: 18, color: "#333", lineHeight: 1.6 }}>
              <li>Chụp phần “Indicator Health” (đặc biệt các dòng: slope bps, ATR 1h/4h, BBWidth 1h/4h, MS 4h, delta.*).</li>
              <li>Nếu có “Missing &gt; 0”, chụp luôn và gửi mình.</li>
              <li>Nếu muốn, bật “Show JSON” và chụp thêm phần bias + orderflow.delta + market_structure.</li>
            </ul>
          </Card>
        </div>

        {showJson ? (
          <div style={{ gridColumn: "span 12" }}>
            <Card title="Raw FeaturesSnapshot JSON">
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 12,
                  background: "#0b1020",
                  color: "#e6e6e6",
                  overflowX: "auto",
                  fontSize: 12,
                }}
              >
                {JSON.stringify(f, null, 2)}
              </pre>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
