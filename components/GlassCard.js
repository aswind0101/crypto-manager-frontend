// 📁 components/GlassCard.js
import React from "react";

export default function GlassCard({ title, value, icon, children, className = "" }) {
    return (
        <div
            className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.3)]
            p-6 transition-all duration-300 hover:scale-[1.02] ${className}`}
        >
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-yellow-300 font-bold text-lg">{title}</h2>
                {icon && <div className="text-2xl text-white">{icon}</div>}
            </div>
            <p className="text-white text-xl font-mono mb-4">{value}</p>
            {children && <div className="text-sm text-gray-300">{children}</div>}
        </div>
    );
}
