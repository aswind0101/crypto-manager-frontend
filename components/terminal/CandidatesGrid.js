export default function CandidatesGrid({ setups }) {
  const list = Array.isArray(setups) ? setups : [];
  if (!list.length) return null;

  return (
    <div className="glass neon-border rounded-2xl p-5">
      <div className="text-lg font-semibold neon-text">Top Candidates</div>
      <div className="text-sm text-slate-400 mt-1">Kèo thay thế theo score để tránh “một góc nhìn”.</div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {list.map((s, i) => (
          <div key={`${s?.type}-${i}`} className="glass rounded-xl p-4 border border-slate-700/30">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">{s?.bias}</div>
              <div className="text-xs text-slate-400">{s?.timeframe_label || s?.timeframe}</div>
            </div>
            <div className="text-xs text-slate-300 mt-1">{s?.type}</div>

            <div className="text-xs text-slate-400 mt-3">Score</div>
            <div className="text-base text-slate-100 font-semibold">
              {Number.isFinite(s?.final_score) ? Math.round(Number(s.final_score) * 100) : "—"}
            </div>

            <div className="text-xs text-slate-400 mt-2">RR TP1</div>
            <div className="text-sm text-slate-200">
              {Number.isFinite(s?.r_multiple?.tp1) ? Number(s.r_multiple.tp1).toFixed(2) : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
