// components/SalonNavbar.js
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { FaBars, FaTimes, FaCalendarAlt, FaUsers, FaChartBar, FaCog, FaSignInAlt, FaUserPlus } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

export default function SalonNavbar() {
    const router = useRouter();
    const [menuOpen, setMenuOpen] = useState(false);
    const [staffMenuOpen, setStaffMenuOpen] = useState(false);
    const menuRef = useRef();
    const [token, setToken] = useState(null);

    useEffect(() => {
        const t = localStorage.getItem('salon_token');
        setToken(t);
    }, []);

    const handleLogout = async () => {
        try {
            await signOut(auth);
            localStorage.removeItem("salon_token");
            router.push("/salon-login");
        } catch (err) {
            console.error("Lỗi đăng xuất:", err);
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setMenuOpen(false);
                setStaffMenuOpen(false);
            }
        };
        if (menuOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        } else {
            document.removeEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [menuOpen]);

    return (
        <>
            <nav className="w-full bg-gradient-to-r from-pink-50 to-purple-100 text-pink-600 px-4 py-3 flex justify-between items-center shadow-lg z-50 rounded-b-2xl border-b border-white/30">
                <Link href="/salon-dashboard" className="flex items-center gap-2 font-bold text-xl hover:text-pink-500 transition cursor-pointer">
                    💇‍♀️ <span className="tracking-wide">Salon Manager</span>
                </Link>
                <button className="text-2xl" onClick={() => setMenuOpen(!menuOpen)}>
                    {menuOpen ? <FaTimes /> : <FaBars />}
                </button>
            </nav>

            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="bg-gradient-to-br from-pink-50 to-purple-100 text-pink-700 px-6 py-4 rounded-b-2xl shadow-2xl flex flex-col gap-4 text-sm z-40 max-w-sm mx-auto w-full border-t border-white/30"
                    >
                        {!token ? (
                            <>
                                <Link href="/salon-login" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                    <FaSignInAlt /> Đăng nhập
                                </Link>
                                <Link href="/salon-register" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                    <FaUserPlus /> Đăng ký
                                </Link>
                            </>
                        ) : (
                            <>
                                <Link href="/salon-dashboard" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                    <FaCalendarAlt /> Quản lý lịch hẹn
                                </Link>

                                <div>
                                    <button
                                        onClick={() => setStaffMenuOpen(!staffMenuOpen)}
                                        className="hover:text-pink-500 flex items-center gap-2 w-full hover:scale-105 transition-all"
                                    >
                                        <FaUsers /> Quản lý nhân viên {staffMenuOpen ? "▾" : "▸"}
                                    </button>
                                    <AnimatePresence>
                                        {staffMenuOpen && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="pl-4 flex flex-col gap-2 mt-2"
                                            >
                                                <Link href="/staff" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                                    <FaUsers /> Danh sách nhân viên
                                                </Link>
                                                <Link href="/salon-add-staff" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                                    ➕ Thêm nhân viên
                                                </Link>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <Link href="/reports" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                    <FaChartBar /> Báo cáo & Thống kê
                                </Link>
                                <Link href="/settings" onClick={() => setMenuOpen(false)} className="hover:text-pink-500 flex items-center gap-2 hover:scale-105 transition-all">
                                    <FaCog /> Cài đặt
                                </Link>
                                <button
                                    className="text-left flex items-center gap-2 hover:text-red-400 hover:scale-105 transition-all"
                                    onClick={() => {
                                        handleLogout();
                                        setMenuOpen(false);
                                    }}
                                >
                                    🚪 Đăng xuất
                                </button>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
