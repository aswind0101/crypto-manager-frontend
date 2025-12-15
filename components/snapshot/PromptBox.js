export default function PromptBox({ value }) {
  return (
    <textarea
      readOnly
      value={value || ""}
      className="h-44 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 font-mono text-xs leading-5 text-slate-100 outline-none"
    />
  );
}
