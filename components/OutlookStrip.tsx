import React, { useMemo } from "react";

type FeaturesLike = any;

const styles: Record<string, React.CSSProperties> = {
  panel: { marginTop: 12, border: "1px solid #222", borderRadius: 10, overflow: "hidden" },
  header: { padding: "10px 12px", borderBottom: "1px solid #222", fontWeight: 700, background: "#0b0b0b" },
  row: { display: "flex", gap: 10, padding: 12, flexWrap: "wrap" },
  tile: { border: "1px solid #222", borderRadius: 10, padding: 10, minWidth: 200, background: "#070707" },
  title: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 },
  tf: { fontWeight: 800 },
  chip: { padding: "2px 8px", border: "1px solid #333", borderRadius: 999, fontSize: 11, display: "inline-flex" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
  kv: { display: "grid", gap: 4, fontSize: 12, opacity: 0.9 },
  flags: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
};

function tfTile(features: FeaturesLike, tf: string) {
  const ms = features?.market_structure?.[tf];
  const trend = String(ms?.trend ?? "—");
  const flags = ms?.flags ?? {};
  const sH = ms?.lastSwingHigh?.price;
  const sL = ms?.lastSwingLow?.price;

  const sweep = ms?.lastSweep
    ? `${ms.lastSweep.dir} @ ${Number(ms.lastSweep.price).toFixed(2)}`
    : "—";

  const bos = ms?.lastBOS
    ? `${ms.lastBOS.dir} @ ${Number(ms.lastBOS.price ?? ms.lastBOS.level ?? 0).toFixed(2)}`
    : "—";

  const choch = ms?.lastCHOCH
    ? `${ms.lastCHOCH.dir} @ ${Number(ms.lastCHOCH.price ?? ms.lastCHOCH.level ?? 0).toFixed(2)}`
    : "—";

  const chips: string[] = [];
  if (flags?.bosUp) chips.push("BOS↑");
  if (flags?.bosDown) chips.push("BOS↓");
  if (flags?.sweepUp) chips.push("SWP↑");
  if (flags?.sweepDown) chips.push("SWP↓");

  return { tf, trend, sH, sL, bos, choch, sweep, chips };
}

export function OutlookStrip({ f }: { f: FeaturesLike | null }) {
  const tiles = useMemo(() => {
    const tfs = ["15m", "1h", "4h", "1d"];
    return tfs.map((tf) => tfTile(f, tf));
  }, [f]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>Market Outlook</div>
      <div style={styles.row}>
        {tiles.map((t) => (
          <div key={t.tf} style={styles.tile}>
            <div style={styles.title}>
              <span style={styles.tf}>{t.tf.toUpperCase()}</span>
              <span style={styles.chip}>{`trend: ${t.trend}`}</span>
            </div>

            <div style={styles.kv}>
              <div>
                <span style={styles.mono}>SwingH</span>: {typeof t.sH === "number" ? t.sH.toFixed(2) : "—"}{" "}
                <span style={{ marginLeft: 8 }} />
                <span style={styles.mono}>SwingL</span>: {typeof t.sL === "number" ? t.sL.toFixed(2) : "—"}
              </div>
              <div>
                <span style={styles.mono}>BOS</span>: {t.bos}
              </div>
              <div>
                <span style={styles.mono}>CHOCH</span>: {t.choch}
              </div>
              <div>
                <span style={styles.mono}>SWEEP</span>: {t.sweep}
              </div>
            </div>

            <div style={styles.flags}>
              {t.chips.length ? (
                t.chips.map((x) => (
                  <span key={x} style={styles.chip}>
                    {x}
                  </span>
                ))
              ) : (
                <span style={{ opacity: 0.6 }}>No flags</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
