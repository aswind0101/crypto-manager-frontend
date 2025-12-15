export default function WorkflowStepper({ stages, activeId, onSelect, locks }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-sm font-semibold">Workflow</div>
      <div className="mt-1 text-xs text-slate-400">Bấm theo bước, UI sẽ khóa bước sai quy trình</div>

      <div className="mt-4 flex flex-col gap-2">
        {stages.map((s, idx) => {
          const active = s.id === activeId;
          const locked = !!locks?.[s.id];

          return (
            <button
              key={s.id}
              onClick={() => !locked && onSelect?.(s.id)}
              disabled={locked}
              className={[
                "w-full rounded-xl border px-3 py-3 text-left transition",
                locked
                  ? "cursor-not-allowed border-slate-800 bg-slate-950/30 opacity-60"
                  : "border-slate-800 bg-slate-950 hover:border-slate-600 hover:bg-slate-900",
                active ? "ring-1 ring-slate-500" : "",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    <span className="mr-2 text-slate-400">{String(idx + 1).padStart(2, "0")}</span>
                    {s.label}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{s.desc}</div>
                </div>

                <div className="mt-0.5">
                  {locked ? (
                    <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300">
                      LOCKED
                    </span>
                  ) : active ? (
                    <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-400">
                      READY
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
        Logic khóa mặc định:
        <div className="mt-1">
          Step2 yêu cầu <span className="text-slate-200">Step1=READY</span> + có LTF snapshot.
          Position yêu cầu <span className="text-slate-200">ENTRY_OK</span>.
        </div>
      </div>
    </div>
  );
}
