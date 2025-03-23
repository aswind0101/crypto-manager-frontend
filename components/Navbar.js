import { useState } from "react";
import Link from "next/link";

export default function Navbar() {
    const [menuOpen, setMenuOpen] = useState(false);

    const toggleMenu = () => setMenuOpen(!menuOpen);

    return (
        <nav className="w-full bg-yellow-400 shadow-md px-6 py-3 rounded-b-lg">
            <div className="flex justify-between items-center">
                {/* Logo */}
                <div className="flex items-center gap-2 text-black font-extrabold text-xl">
                    <span>💰</span>
                    <span>CMA</span>
                </div>

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-4 font-semibold text-sm text-black">
                    <Link href="/transactions" className="hover:text-white transition-colors">
                        Transactions
                    </Link>
                    <Link href="/reports" className="hover:text-white transition-colors">
                        Home
                    </Link>
                </div>

                {/* Mobile Toggle */}
                <button onClick={toggleMenu} className="md:hidden text-black font-bold text-xl">
                    {menuOpen ? "✖" : "☰"}
                </button>
            </div>

            {/* Mobile Menu */}
            <div
                className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${menuOpen ? "max-h-40 mt-3" : "max-h-0"}`}
            >
                <div className="flex flex-col gap-2 font-semibold text-sm text-black">
                    <Link href="/reports" className="hover:text-white transition-colors" onClick={toggleMenu}>
                        Home
                    </Link>
                    <Link href="/transactions" className="hover:text-white transition-colors" onClick={toggleMenu}>
                        Transactions
                    </Link>
                </div>
            </div>
        </nav>
    );
}