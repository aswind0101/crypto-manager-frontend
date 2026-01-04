import { useState } from "react";
import { useBybitUnifiedSnapshot } from "../hooks/useBybitUnifiedSnapshot";
import { DataStatusBar } from "../components/DataStatusBar";

export default function Home() {
  const [symbol, setSymbol] = useState("ETHUSDT");
  const snap = useBybitUnifiedSnapshot(symbol);

  return (
    <div style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      </div>
      <DataStatusBar snap={snap} />
    </div>
  );
}
