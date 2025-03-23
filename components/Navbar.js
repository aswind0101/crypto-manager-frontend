import { useState } from "react";
import Link from "next/link";

export default function Navbar() {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <nav className="w-full bg-yellow-400 shadow-md px-6 py-3 rounded-b-lg">
            <div className="flex justify-between items-center">
                {/* Logo */}
                <div className="flex items-center gap-2 text-black font-extrabold text-xl">
                    <span>💰</span>
                    <span>CMA</span>
                </div>

                {/* Toggle Button */}
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="text-black font-semibold text-sm hover:text-white transition"
                >
                    {showMenu ? "✖ Close" : "☰ Menu"}
                </button>
            </div>

            {/* Menu Items */}
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${showMenu ? "max-h-40 mt-3" : "max-h-0"}`}>
                <div className="flex flex-col gap-2 font-semibold text-sm text-black">
                    <Link href="/transactions" className="hover:text-white transition-colors">
                        Transactions
                    </Link>
                    <Link href="/reports" className="hover:text-white transition-colors">
                        Home
                    </Link>
                </div>
            </div>
        </nav>
    );
}