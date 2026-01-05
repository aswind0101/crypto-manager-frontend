import { useState } from "react";
import { DataStatusBar } from "../components/DataStatusBar";
import { FeaturesPanel } from "../components/FeaturesPanel";
import { SetupsPanel } from "../components/SetupsPanel";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";

export default function Home() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const { snap, features, setups } = useSetupsSnapshot(symbol);

  return (
    <div style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      </div>

      <DataStatusBar snap={snap} />
      <FeaturesPanel f={features} />
      <SetupsPanel out={setups} />
    </div>
  );
}
