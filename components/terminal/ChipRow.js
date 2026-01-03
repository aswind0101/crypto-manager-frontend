function toneCls(tone) {
  if (tone === "good") return "border-emerald-400/25 text-emerald-200";
  if (tone === "warn") return "border-amber-400/25 text-amber-200";
  if (tone === "bad") return "border-rose-400/25 text-rose-200";
  return "border-slate-400/20 text-slate-200";
}

export default function ChipRow({ chips }) {
  if (!chips || !chips.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <div
          key={c.key}
          className={`glass px-3 py-1 rounded-full text-xs border ${toneCls(c.tone)}`}
          title={c.key}
        >
          {c.text}
        </div>
      ))}
    </div>
  );
}
