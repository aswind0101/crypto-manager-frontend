import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="bg-gradient-to-r from-blue-600 to-blue-800 shadow-lg py-4 px-6 flex justify-between items-center transition duration-300 hover:opacity-90">
      <h1 className="text-white text-2xl font-bold tracking-wide">Crypto Manager</h1>
      <div className="space-x-6">
        <a href="/" className="text-white text-lg font-semibold hover:text-gray-300 transition">Home</a>
        <a href="/dashboard" className="text-white text-lg font-semibold hover:text-gray-300 transition">Dashboard</a>
      </div>
    </nav>

  );
}
