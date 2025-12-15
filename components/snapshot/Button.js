const variants = {
  primary:
    "bg-gradient-to-br from-emerald-300 via-emerald-400 to-emerald-500 text-emerald-950 shadow-[0_10px_25px_rgba(16,185,129,0.35)] hover:opacity-95 active:scale-[0.99]",
  gold:
    "bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-amber-950 shadow-[0_10px_25px_rgba(245,158,11,0.30)] hover:opacity-95 active:scale-[0.99]",
  secondary:
    "border border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-600 hover:bg-slate-900 active:scale-[0.99]",
};

export default function Button({ variant = "secondary", className = "", disabled, children, ...props }) {
  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant] || variants.secondary,
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
