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
    const [debtsOpen, setDebtsOpen] = useState(false);
    const [expensesOpen, setExpensesOpen] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const menuRef = useRef();

    const SUPER_ADMINS = ["D9nW6SLT2pbUuWbNVnCgf2uINok2"];
    const [isSuperAdmin, setIsSuperAdmin] = useState(false);
    const [isSalonChu, setIsSalonChu] = useState(false);
    const [isSalonNhanVien, setIsSalonNhanVien] = useState(false);
    const [isSalonKhachHang, setIsSalonKhachHang] = useState(false);

    useEffect(() => {
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
            const parsedUser = JSON.parse(storedUser);
            setUser(parsedUser);

            if (parsedUser.uid && SUPER_ADMINS.includes(parsedUser.uid)) {
                setIsSuperAdmin(true);
            }
            if (parsedUser.role === "Salon_Chu") setIsSalonChu(true);
            if (parsedUser.role === "Salon_NhanVien") setIsSalonNhanVien(true);
            if (parsedUser.role === "Salon_KhachHang") setIsSalonKhachHang(true);
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
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [menuOpen]);

    const handleLogout = async () => {
        try {
            await signOut(auth);
            localStorage.removeItem("user");

            const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
            localStorage.removeItem(`portfolio_${storedUser.uid}`);
            localStorage.removeItem(`lastUpdated_${storedUser.uid}`);
            localStorage.removeItem(`categories_cache_${storedUser.uid}`);
            localStorage.removeItem(`categories_cache_expiry_${storedUser.uid}`);

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
            <nav className="w-full text-white px-4 py-3 flex justify-between items-center rounded-b-2xl z-50 bg-[#1C1F26] shadow-lg">
                <Link href="/home" className="flex items-center gap-2 font-bold text-xl text-yellow-400 hover:text-yellow-300 transition cursor-pointer">
                    💰 <span>Crypto Manager</span>
                </Link>
                <button className="text-2xl md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
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
                        className="text-white px-6 py-4 bg-[#1C1F26] rounded-b-2xl flex flex-col gap-4 text-sm z-40 max-w-sm mx-auto w-full shadow-lg"
                    >
                        {user && (
                            <div className="text-sm text-blue-200">
                                👋 Hello, <span className="font-bold">{user.name}</span>
                                <div className="text-xs mt-1 font-mono">UID: {user.uid}</div>
                            </div>
                        )}

                        <Link href="/home" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                            <FiHome /> Home
                        </Link>
                        <Link href="/transactions" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                            <FiList /> Transactions
                        </Link>

                        {/* Salon Menu */}
                        {(isSuperAdmin || isSalonChu) && (
                            <>
                                <Link href="/salons" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    🏠 Salons
                                </Link>
                                <Link href="/services" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    💈 Services
                                </Link>
                            </>
                        )}
                        {(isSalonNhanVien || isSalonKhachHang) && (
                            <Link href="/appointments" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                📅 Appointments
                            </Link>
                        )}

                        {/* Debts Menu */}
                        <button
                            onClick={() => setDebtsOpen(!debtsOpen)}
                            className="hover:text-cyan-300 flex items-center gap-2"
                        >
                            💳 Debts {debtsOpen ? "▾" : "▸"}
                        </button>
                        <AnimatePresence>
                            {debtsOpen && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="pl-4 flex flex-col gap-2 text-sm"
                                >
                                    <Link href="/debts" onClick={() => setMenuOpen(false)} className="hover:text-yellow-300">
                                        👁️ View Debts
                                    </Link>
                                    <Link href="/lenders" onClick={() => setMenuOpen(false)} className="hover:text-yellow-300">
                                        👥 Manage Lenders
                                    </Link>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Expenses Menu */}
                        <button
                            onClick={() => setExpensesOpen(!expensesOpen)}
                            className="hover:text-cyan-300 flex items-center gap-2"
                        >
                            💸 Expenses {expensesOpen ? "▾" : "▸"}
                        </button>
                        <AnimatePresence>
                            {expensesOpen && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="pl-4 flex flex-col gap-2 text-sm"
                                >
                                    <Link href="/expenses" onClick={() => setMenuOpen(false)} className="hover:text-yellow-300">
                                        👁️ View Expenses
                                    </Link>
                                    <Link href="/categories" onClick={() => setMenuOpen(false)} className="hover:text-yellow-300">
                                        🗂 Manage Categories
                                    </Link>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <Link href="/settings" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
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
