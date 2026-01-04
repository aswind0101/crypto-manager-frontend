import { useState } from "react";
import { DataStatusBar } from "../components/DataStatusBar";
import { useFeaturesSnapshot } from "../hooks/useFeaturesSnapshot";
import { FeaturesPanel } from "../components/FeaturesPanel";

export default function Home() {
  const [symbol, setSymbol] = useState("ETHUSDT");

  // ✅ CHỈ DÙNG 1 PIPELINE
  const { snap, features } = useFeaturesSnapshot(symbol);

  return (
    <div style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          style={{ padding: 6, fontSize: 14 }}
        />
      </div>

      {/* Snapshot status */}
      <DataStatusBar snap={snap} />

      {/* Feature Engine output */}
      <FeaturesPanel f={features} />
    </div>
  );
}
