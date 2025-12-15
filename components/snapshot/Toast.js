export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-xs text-slate-100 shadow-[0_10px_25px_rgba(0,0,0,0.5)]">
      {message}
    </div>
  );
}
