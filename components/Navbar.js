import Link from "next/link";

export default function Navbar() {
  return (
      <nav className="bg-yellow-400 shadow-md px-6 py-3 flex justify-between items-center rounded-b-lg">
          {/* Logo / Brand */}
          <div className="flex items-center gap-2 text-black font-extrabold text-xl">
              <span>💰</span>
              <span>Crypto Manager</span>
          </div>

          {/* Menu items */}
          <div className="flex items-center gap-4 text-black font-semibold text-sm">
              
          </div>
      </nav>
  );
}
