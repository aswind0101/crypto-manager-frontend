import ChipRow from "./ChipRow";

export default function OutlookPanel({ outlook }) {
  if (!outlook) return null;

  return (
    <div className="glass neon-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold neon-text">Market Outlook</div>
          <div className="text-sm text-slate-400 mt-1">
            {outlook?.headline?.market_position} · {outlook?.headline?.trend_clarity}
          </div>
          <div className="text-sm text-slate-400 mt-1">
            {outlook?.headline?.data_quality} · {outlook?.headline?.quick_risk}
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-slate-400">Action</div>
          <div className="text-base font-semibold">{outlook?.action?.status || "—"}</div>
          <div className="text-xs text-slate-400 mt-1">
            {outlook?.action?.setup_type_label ? `${outlook.action.setup_type_label} · ` : ""}
            {outlook?.action?.tf_label || ""}
          </div>
        </div>
      </div>

      <ChipRow
        chips={(outlook?.flag_texts || []).map((x) => ({ key: x.key, text: x.text, tone: x.tone }))}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(outlook?.horizons || []).map((h) => (
          <div key={h.key} className="glass rounded-xl p-4 border border-slate-700/30">
            <div className="text-sm text-slate-300 font-semibold">{h.title}</div>
            <div className="text-xs text-slate-400 mt-1">
              Bias: <span className="text-slate-200">{h.bias}</span> · Clarity:{" "}
              <span className="text-slate-200">{h.clarity}</span>
            </div>

            <div className="mt-3">
              <div className="text-xs text-slate-400">Drivers</div>
              <ul className="mt-1 text-xs text-slate-200 space-y-1 list-disc list-inside">
                {(h.drivers || []).slice(0, 4).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>

            <div className="mt-3">
              <div className="text-xs text-slate-400">Risks</div>
              <ul className="mt-1 text-xs text-slate-200 space-y-1 list-disc list-inside">
                {(h.risks || []).slice(0, 4).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
