import { motion } from "framer-motion";

export default function TopBar({ symbol, subtitle }) {
  return (
    <div className="glass neon-border rounded-2xl px-5 py-4 relative overflow-hidden">
      <div className="absolute inset-0 grid-holo opacity-70" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="text-2xl font-semibold tracking-tight neon-text"
          >
            {symbol}
          </motion.div>
          <div className="text-sm text-slate-400 mt-1">{subtitle}</div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded-full glass border border-cyan-400/20 text-cyan-200">Client-only</span>
          <span className="px-2 py-1 rounded-full glass border border-violet-400/20 text-violet-200">Hi-tech UI</span>
          <span className="px-2 py-1 rounded-full glass border border-emerald-400/20 text-emerald-200">Swing</span>
        </div>
      </div>
    </div>
  );
}
