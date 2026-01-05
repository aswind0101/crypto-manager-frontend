import React from "react";

type SnapshotLike = any;
type FeaturesLike = any;

const styles: Record<string, React.CSSProperties> = {
    wrap: {
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "#060606",
        borderBottom: "1px solid #222",
        padding: "10px 12px",
    },
    row: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },
    input: {
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid #333",
        background: "#0a0a0a",
        color: "white",
        fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        width: 120,
    },
    chip: {
        padding: "3px 10px",
        borderRadius: 999,
        border: "1px solid #333",
        fontSize: 12,
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
        background: "#0a0a0a",
    },
    mono: {
        fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    strong: { fontWeight: 800 },
};

function fmt(n: any, dp = 2) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toFixed(dp);
}

export function TerminalHeader({
    draftSymbol,
    setDraftSymbol,
    commitSymbol,
    snap,
    features,
}: {
    draftSymbol: string;
    setDraftSymbol: (s: string) => void;
    commitSymbol: () => void;
    snap: any | null;
    features: any | null;
}) {
    const dq = String(features?.quality?.dq_grade ?? "—");
    const bybitOk = Boolean(features?.quality?.bybit_ok);
    const binanceOk = Boolean(features?.quality?.binance_ok);

    const mid = snap?.price?.mid ?? snap?.price?.last;
    const dev = features?.cross?.deviation_bps ?? features?.cross?.dev_bps;

    return (
        <div style={styles.wrap}>
            <div style={styles.row}>
                <input
                    style={styles.input}
                    value={draftSymbol}
                    onChange={(e) => setDraftSymbol(String(e.target.value).toUpperCase())}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commitSymbol();
                        }
                    }}
                    onBlur={() => commitSymbol()}
                    spellCheck={false}
                />

                <span style={styles.chip}>
                    <span style={{ ...styles.mono, opacity: 0.8 }}>DQ</span>
                    <span style={{ ...styles.mono, ...styles.strong }}>{dq}</span>
                </span>

                <span style={styles.chip}>
                    <span style={{ ...styles.mono, opacity: 0.8 }}>BYBIT</span>
                    <span style={{ ...styles.mono, ...styles.strong }}>
                        {bybitOk ? "OK" : "DOWN"}
                    </span>
                </span>

                <span style={styles.chip}>
                    <span style={{ ...styles.mono, opacity: 0.8 }}>BINANCE</span>
                    <span style={{ ...styles.mono, ...styles.strong }}>
                        {binanceOk ? "OK" : "DOWN"}
                    </span>
                </span>

                <span style={styles.chip}>
                    <span style={{ ...styles.mono, opacity: 0.8 }}>MID</span>
                    <span style={{ ...styles.mono, ...styles.strong }}>{fmt(mid, 2)}</span>
                </span>

                <span style={styles.chip}>
                    <span style={{ ...styles.mono, opacity: 0.8 }}>DEV</span>
                    <span style={{ ...styles.mono, ...styles.strong }}>
                        {Number.isFinite(Number(dev)) ? `${Number(dev).toFixed(1)}bps` : "—"}
                    </span>
                </span>

                <span style={{ ...styles.chip, opacity: 0.8 }}>
                    <span style={styles.mono}>ts</span>
                    <span style={styles.mono}>
                        {snap?.ts ? new Date(snap.ts).toLocaleTimeString() : "—"}
                    </span>
                </span>
            </div>
        </div>
    );
}
