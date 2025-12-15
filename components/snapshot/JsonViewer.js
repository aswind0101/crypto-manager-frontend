export default function JsonViewer({ data }) {
  const text = data ? JSON.stringify(data, null, 2) : "No snapshot loaded.";
  return (
    <pre className="max-h-[420px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
      {text}
    </pre>
  );
}
