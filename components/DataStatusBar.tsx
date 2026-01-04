// components/DataStatusBar.tsx

import React from "react";
import type { UnifiedSnapshot } from "../lib/feeds/snapshot/unifiedTypes";

export function DataStatusBar({ snap }: { snap: UnifiedSnapshot | null }) {
    if (!snap) return null;

    const dq = snap.data_quality;
    const by = snap.availability.bybit;

    return (
        <div style={{ padding: 12, border: "1px solid #222", borderRadius: 10 }}>
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

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span>
                        Bybit: <b>{by.ok ? "OK" : "DOWN"}</b>
                    </span>
                    <span>
                        DQ: <b>{dq.grade}</b> ({dq.score})
                    </span>
                </div>
            </div>

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
