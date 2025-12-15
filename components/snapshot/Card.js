export default function Card({ className = "", children }) {
  return (
    <div
      className={
        "rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)] " +
        className
      }
    >
      {children}
    </div>
  );
}
