// components/Navbar.js
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
            await signOut(auth);
            localStorage.removeItem("user");

            const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
            localStorage.removeItem(`portfolio_${storedUser.uid}`);
            localStorage.removeItem(`lastUpdated_${storedUser.uid}`);

            setShowToast(true);
            setTimeout(() => {
                setShowToast(false);
                router.push("/login");
            }, 1500);
        } catch (error) {
            console.error("Logout error:", error);
        }
    };

    return (
        <>
            <nav className="w-full whote== shadow-lg px-6 py-3 flex justify-between items-center rounded-b-2xl text-white z-50">
                {/* Logo + App name */}
                <div className="flex items-center gap-2 font-bold text-xl">
                    💰 <span className="tracking-wide">Crypto Manager</span>
                </div>

                {/* Desktop User Info */}
                {user && (
                    <div className="hidden md:flex flex-col items-end text-sm mr-4">
                        <span>
                            Hello, <span className="font-bold">{user.name}</span>
                        </span>
                        <span className="text-xs text-blue-200">
                            UID: <span className="font-mono">{user.uid}</span>
                        </span>
                    </div>
                )}

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-6 font-medium">
                    <Link href="/home" className="hover:text-cyan-300 transition flex items-center gap-1">
                        <FiHome /> Home
                    </Link>
                    <Link href="/transactions" className="hover:text-cyan-300 transition flex items-center gap-1">
                        <FiList /> Transactions
                    </Link>
                    {user && (
                        <button
                            onClick={handleLogout}
                            className="hover:text-red-400 transition flex items-center gap-1"
                        >
                            <FiLogOut /> Logout
                        </button>
                    )}
                </div>

                {/* Mobile Toggle */}
                <button className="md:hidden text-2xl" onClick={() => setMenuOpen(!menuOpen)}>
                    {menuOpen ? <FaTimes /> : <FaBars />}
                </button>
            </nav>

            {/* Mobile Menu */}
            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] text-white px-6 py-4 rounded-b-2xl shadow-lg flex flex-col gap-4 text-sm md:hidden z-40"
                    >
                        {user && (
                            <div className="text-sm text-blue-200">
                                👋 Hello, <span className="font-bold">{user.name}</span>
                                <div className="text-xs mt-1 font-mono">UID: {user.uid}</div>
                            </div>
                        )}
                        <Link
                            href="/home"
                            onClick={() => setMenuOpen(false)}
                            className="hover:text-cyan-300 flex items-center gap-2"
                        >
                            <FiHome /> Home
                        </Link>
                        <Link
                            href="/transactions"
                            onClick={() => setMenuOpen(false)}
                            className="hover:text-cyan-300 flex items-center gap-2"
                        >
                            <FiList /> Transactions
                        </Link>
                        <Link href="/settings" className="text-black hover:text-white transition flex items-center gap-1">
                            ⚙️ Settings
                        </Link>
                        {user && (
                            <button
                                className="text-left flex items-center gap-2 hover:text-red-400"
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

            {/* Toast */}
            {showToast && (
                <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50">
                    👋 Logged out successfully
                </div>
            )}
        </>
    );
}
