import Link from "next/link";

export default function Navbar() {
    return (
        <nav className="w-full bg-yellow-400 shadow-md px-6 py-3 flex justify-between items-center rounded-b-lg">
            {/* Logo */}
            <div className="flex items-center gap-2 text-black font-extrabold text-xl">
                <span>💰</span>
                <span>CMA</span>
            </div>

            {/* Menu */}
            <div className="flex items-center gap-4 font-semibold text-sm">
                <Link href="/transactions" className="text-black hover:text-white transition">
                    Transactions
        </Link>
                <Link href="/reports" className="text-black hover:text-white transition">
                    Home
        </Link>
            </div>
        </nav>
    );
}
