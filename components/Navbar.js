import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import { FiHome, FiList, FiLogOut } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
    const router = useRouter();
    const [user, setUser] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const menuRef = useRef();

    function clearAppCache() {
        const allowPrefixes = [
            "cachedPortfolio_",
            "lastUpdated_",
            "price_",
            "coinList",
            "coinListUpdated"
        ];

        Object.keys(localStorage).forEach((key) => {
            if (
                allowPrefixes.some(prefix => key.startsWith(prefix))
            ) {
                localStorage.removeItem(key);
            }
        });
    }

    useEffect(() => {
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setMenuOpen(false);
            }
        };

        if (menuOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        } else {
            document.removeEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [menuOpen]);

    const handleLogout = async () => {
        try {
          // Đăng xuất khỏi Firebase Auth
          await signOut(auth);
      
          // ✅ Xoá toàn bộ localStorage (bao gồm: user, cachedPortfolio, coinList, price_...)
          localStorage.clear();
      
          // ✅ Reload để reset toàn bộ state trong app
          router.push("/login"); // hoặc dùng: window.location.href = "/login";
        } catch (error) {
          console.error("Logout error:", error);
        }
      };
      

    return (
        <>
            <nav className="w-full bg-yellow-400 shadow-md px-6 py-3 flex justify-between items-center rounded-b-lg relative">
                {/* Logo */}
                <div className="flex items-center gap-2 text-black font-extrabold text-xl">
                    <span>💰</span>
                    <span>CMA</span>
                </div>

                {/* User Info */}
                {user && (
                    <div className="hidden md:flex flex-col items-end text-black font-semibold text-sm mr-4">
                        <span>
                            Hello, <span className="ml-1 font-bold">{user.name}</span>
                        </span>
                        <span className="text-xs text-gray-700">
                            UID: <span className="font-mono">{user.uid}</span>
                        </span>
                    </div>
                )}

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-4 font-semibold text-sm">
                    <Link href="/home" className="text-black hover:text-white transition flex items-center gap-1">
                        <FiHome /> Home
                    </Link>
                    <Link href="/transactions" className="text-black hover:text-white transition flex items-center gap-1">
                        <FiList /> Transactions
                    </Link>
                    {user && (
                        <button
                            onClick={handleLogout}
                            className="text-black hover:text-white transition flex items-center gap-1"
                        >
                            <FiLogOut /> Logout
                        </button>
                    )}
                </div>

                {/* Mobile Menu Toggle */}
                <button
                    className="md:hidden text-black text-xl focus:outline-none"
                    onClick={() => setMenuOpen(!menuOpen)}
                >
                    {menuOpen ? <FaTimes /> : <FaBars />}
                </button>

                {/* Mobile Menu with animation */}
                <AnimatePresence>
                    {menuOpen && (
                        <motion.div
                            ref={menuRef}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 0.95, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="absolute top-16 left-0 w-full bg-[#fefce8] text-black py-4 px-6 flex flex-col gap-4 font-semibold text-sm rounded-b-xl shadow-xl z-50"
                        >
                            {user && (
                                <div className="text-gray-700 text-base font-medium mb-2">
                                    👋 Hello, <span className="font-bold">{user.name}</span>
                                    <div className="text-xs mt-1">
                                        UID: <span className="font-mono">{user.uid}</span>
                                    </div>
                                </div>
                            )}
                            <Link
                                href="/home"
                                onClick={() => setMenuOpen(false)}
                                className="flex items-center gap-2 hover:text-yellow-600"
                            >
                                <FiHome /> Home
                            </Link>
                            <Link
                                href="/transactions"
                                onClick={() => setMenuOpen(false)}
                                className="flex items-center gap-2 hover:text-yellow-600"
                            >
                                <FiList /> Transactions
                            </Link>
                            {user && (
                                <button
                                    className="text-left flex items-center gap-2 hover:text-red-500"
                                    onClick={() => {
                                        handleLogout();
                                        setMenuOpen(false);
                                    }}
                                >
                                    <FiLogOut /> Logout
                                </button>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </nav>

            {/* Toast */}
            {showToast && (
                <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 animate-fade">
                    👋 Logged out successfully
                </div>
            )}
        </>
    );
}
