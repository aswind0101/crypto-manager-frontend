function scoreBadge(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return { label: "—", cls: "border-slate-500/25 text-slate-200" };
  if (s >= 0.8) return { label: `${Math.round(s * 100)} · Elite`, cls: "border-emerald-400/30 text-emerald-200" };
  if (s >= 0.7) return { label: `${Math.round(s * 100)} · Strong`, cls: "border-cyan-400/30 text-cyan-200" };
  if (s >= 0.6) return { label: `${Math.round(s * 100)} · OK`, cls: "border-amber-400/30 text-amber-200" };
  return { label: `${Math.round(s * 100)} · Weak`, cls: "border-rose-400/30 text-rose-200" };
}

function readinessLabel(r) {
  if (r === "ready_market" || r === "ready_limit") return { t: "READY", cls: "text-emerald-200" };
  if (r === "near_zone" || r === "wait_confirm" || r === "wait") return { t: "WAIT", cls: "text-amber-200" };
  if (r === "missed") return { t: "MISSED", cls: "text-rose-200" };
  if (r === "invalidated") return { t: "INVALID", cls: "text-rose-200" };
  return { t: "—", cls: "text-slate-200" };
}

export default function SetupCard({ title, setup }) {
  if (!setup) {
    return (
      <div className="glass neon-border rounded-2xl p-5">
        <div className="text-lg font-semibold neon-text">{title}</div>
        <div className="text-sm text-slate-400 mt-2">Không có setup đủ điều kiện (min score).</div>
      </div>
    );
  }

  const sc = scoreBadge(setup?.final_score);
  const rl = readinessLabel(setup?.execution_state?.readiness);

  const zone = setup?.entry_zone;
  const zLo = Array.isArray(zone) ? Math.min(zone[0], zone[1]) : Number(zone?.low);
  const zHi = Array.isArray(zone) ? Math.max(zone[0], zone[1]) : Number(zone?.high);

  return (
    <div className="glass neon-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold neon-text">{title}</div>
          <div className="text-sm text-slate-300 mt-1">
            <span className="font-semibold">{setup?.bias}</span> · {setup?.type} ·{" "}
            {setup?.timeframe_label || setup?.timeframe} ·{" "}
            <span className="text-slate-400">{setup?.hold_time || ""}</span>
          </div>
        </div>

        <div className="text-right space-y-2">
          <div className={`glass px-3 py-1 rounded-full text-xs border ${sc.cls}`}>{sc.label}</div>
          <div className={`text-xs font-semibold ${rl.cls}`}>{rl.t}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="glass rounded-xl p-4 border border-slate-700/30">
          <div className="text-xs text-slate-400">Entry Zone</div>
          <div className="text-sm text-slate-100 mt-1">
            {Number.isFinite(zLo) ? zLo.toLocaleString() : "—"} → {Number.isFinite(zHi) ? zHi.toLocaleString() : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-2">Preferred</div>
          <div className="text-sm text-slate-100 mt-1">
            {Number.isFinite(setup?.entry_preferred) ? Number(setup.entry_preferred).toLocaleString() : "—"}
          </div>
        </div>

        <div className="glass rounded-xl p-4 border border-slate-700/30">
          <div className="text-xs text-slate-400">Stop</div>
          <div className="text-sm text-slate-100 mt-1">
            {Number.isFinite(setup?.stop) ? Number(setup.stop).toLocaleString() : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-2">RR (TP1)</div>
          <div className="text-sm text-slate-100 mt-1">
            {Number.isFinite(setup?.r_multiple?.tp1) ? Number(setup.r_multiple.tp1).toFixed(2) : "—"}
          </div>
        </div>

        <div className="glass rounded-xl p-4 border border-slate-700/30">
          <div className="text-xs text-slate-400">Targets</div>
          <div className="text-sm text-slate-100 mt-1">
            TP1: {Number.isFinite(setup?.targets?.tp1) ? Number(setup.targets.tp1).toLocaleString() : "—"}
          </div>
          <div className="text-sm text-slate-100 mt-1">
            TP2: {Number.isFinite(setup?.targets?.tp2) ? Number(setup.targets.tp2).toLocaleString() : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-2">Execution</div>
          <div className="text-xs text-slate-200 mt-1">
            {setup?.execution_state?.order?.type ? `Order: ${setup.execution_state.order.type}` : "Order: —"}
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-4 border border-slate-700/30">
        <div className="text-xs text-slate-400">Why</div>
        <div className="text-sm text-slate-200 mt-1">
          {(setup?.execution_state?.reason || []).length
            ? (setup.execution_state.reason || []).join(", ")
            : "No explicit reasons."}
        </div>
      </div>
    </div>
  );
}
