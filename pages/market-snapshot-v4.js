import { useState } from "react";
import { useSetupsSnapshot } from "../hooks/useSetupsSnapshot";
import { TerminalHeader } from "../components/TerminalHeader";
import { OutlookStrip } from "../components/OutlookStrip";
import { SetupBoard } from "../components/SetupBoard";

export default function Home() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const { snap, features, setups } = useSetupsSnapshot(symbol);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <TerminalHeader symbol={symbol} setSymbol={setSymbol} snap={snap} features={features} />

      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <OutlookStrip f={features} />
        </div>
        <div>
          <SetupBoard out={setups} snap={snap} />
        </div>
      </div>
    </div>
  );
}
