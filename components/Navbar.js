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
    const [isFreelancer, setIsFreelancer] = useState(false);
    const [isSalonAll, setIsSalonAll] = useState(false);
    const [isCrypto, setIsCrypto] = useState(false);
    const [isSalonKhachHang, setIsSalonKhachHang] = useState(false);
    const [isSalonsOpen, setIsSalonsOpen] = useState(false);
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [isFreelancerMenuOpen, setIsFreelancerMenuOpen] = useState(false);




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
            if (parsedUser.role === "Salon_Freelancers") setIsFreelancer(true);
            if (parsedUser.role === "Salon_All") setIsSalonAll(true);
            if (parsedUser.role === "Crypto") setIsCrypto(true);

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
            <nav className="w-full text-white px-4 py-3 flex justify-between items-center rounded-b-2xl z-50">
                <Link href="/home" className="flex items-center gap-2 font-bold text-xl text-yellow-400 hover:text-yellow-300 transition cursor-pointer">
                    💰 <span className="tracking-wide">PFMS</span>
                </Link>

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
                <div className="hidden items-center gap-6 font-medium">

                    {isSuperAdmin && (
                        <>
                            <Link href="/home" className="hover:text-cyan-300 transition flex items-center gap-1">
                                <FiHome /> Home
                            </Link>
                            <Link href="/transactions" className="hover:text-cyan-300 transition flex items-center gap-1">
                                <FiList /> Transactions
                            </Link>

                            <button className="flex flex-col">
                                🏠 Salons ▾
                            </button>
                            <div className="absolute hidden group-hover:flex flex-col bg-[#0e1628] shadow-md rounded-lg mt-2 w-52 text-sm z-50 border border-gray-700">
                                <Link href="/salons" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-t">
                                    View Salon
                                </Link>
                                <Link href="/employees" className="px-4 py-2 hover:bg-yellow-400 hover:text-black">
                                    Employees
                                </Link>
                                <Link href="/services" className="px-4 py-2 hover:bg-yellow-400 hover:text-black">
                                    Service
                                </Link>
                                <Link href="/appointments" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-b">
                                    Appointments
                                </Link>
                            </div>
                            <button className="px-4 py-2 hover:text-yellow-400 font-semibold">
                                Admin ▾
                            </button>
                            <div className="absolute hidden group-hover:block bg-white shadow-md rounded mt-1 z-50 min-w-[160px]">
                                <Link
                                    href="/admin/freelancers-review"
                                    className="block px-4 py-2 text-sm text-gray-800 hover:bg-emerald-100"
                                >
                                    Freelancers
                                </Link>
                                {/* Có thể thêm các mục khác trong Admin tại đây */}
                            </div>
                            {/* 💰 Expenses (desktop) */}
                            <div className="flex flex-col">
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setExpensesOpen(!expensesOpen)}
                                >
                                    💰 Expenses {expensesOpen ? "▴" : "▾"}
                                </button>
                                <div
                                    className="ml-6 flex flex-col text-sm"
                                    style={{ display: expensesOpen ? 'flex' : 'none' }}
                                >
                                    <Link href="/expenses" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        📄 View Expenses
                                    </Link>
                                    <Link href="/expenses/categories" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        🗂 Categories
                                    </Link>
                                </div>
                            </div>

                            {/* 💳 Debts (desktop) */}
                            <div className="flex flex-col">
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setDebtsOpen(!debtsOpen)}
                                >
                                    💳 Debts {debtsOpen ? "▴" : "▾"}
                                </button>
                                <div
                                    className="ml-6 flex flex-col text-sm"
                                    style={{ display: debtsOpen ? 'flex' : 'none' }}
                                >
                                    <Link href="/debts" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        📄 View Debts
                                    </Link>
                                    <Link href="/debts/lenders" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        🙋‍♂️ Lenders
                                    </Link>
                                </div>
                            </div>

                            <Link href="/settings" className="hover:text-cyan-300 transition flex items-center gap-1">
                                ⚙️ Settings
                            </Link>
                        </>
                    )}


                    {isSalonChu && (
                        <>
                            <button className="flex flex-col">
                                🏠 Salons ▾
                            </button>
                            <div className="absolute hidden group-hover:flex flex-col bg-[#0e1628] shadow-md rounded-lg mt-2 w-52 text-sm z-50 border border-gray-700">
                                <Link href="/salons" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-t">
                                    View Salon
                                </Link>
                                <Link href="/employees" className="px-4 py-2 hover:bg-yellow-400 hover:text-black">
                                    Employees
                                </Link>
                                <Link href="/services" className="px-4 py-2 hover:bg-yellow-400 hover:text-black">
                                    Service
                                </Link>
                                <Link href="/salon/freelancers-approval" className="px-4 py-2 hover:bg-yellow-400 hover:text-black">
                                    Freelancers Approval
                                </Link>
                                <Link href="/appointments" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-b">
                                    Appointments
                                </Link>
                            </div>
                        </>
                    )}

                    {isSalonNhanVien && (
                        <>
                            <button className="flex flex-col">
                                👤 Account ▾
                            </button>
                            <div className="absolute hidden group-hover:flex flex-col bg-[#0e1628] shadow-md rounded-lg mt-2 w-48 text-sm z-50 border border-gray-700">
                                <Link href="/employees/me" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-t">
                                    👤 My Profile
                                </Link>
                                <Link href="/appointments" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-b">
                                    📅 Appointments
                                </Link>
                            </div>
                        </>
                    )}
                    {isFreelancer && (
                        <div className="flex flex-col">
                            <button
                                className="flex items-center gap-2 hover:text-cyan-300"
                                onClick={() => setIsFreelancerMenuOpen(!isFreelancerMenuOpen)}
                            >
                                🧑‍🎨 Freelancer {isFreelancerMenuOpen ? "▴" : "▾"}
                            </button>
                            <div
                                className="ml-6 flex flex-col text-sm"
                                style={{ display: isFreelancerMenuOpen ? "flex" : "none" }}
                            >
                                <Link href="/freelancers" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    🧾 Dashboard
                                </Link>
                                <Link href="/freelancers/me" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    👤 My Profile
                                </Link>
                                <Link href="/appointments" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    📅 Appointments
                                </Link>
                                <Link href="/freelancers/payments" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    💳 Payments
                                </Link>
                            </div>
                        </div>
                    )}
                    {isSalonAll && (
                        <div className="flex flex-col">
                            <button className="flex flex-col">
                                👤 Account ▾
                            </button>
                            <div className="absolute hidden group-hover:flex flex-col bg-[#0e1628] shadow-md rounded-lg mt-2 w-48 text-sm z-50 border border-gray-700">
                                <Link href="/employees/me" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-t">
                                    👤 My Profile
                                </Link>
                                <Link href="/appointments" className="px-4 py-2 hover:bg-yellow-400 hover:text-black rounded-b">
                                    📅 Appointments
                                </Link>
                            </div>
                            <button
                                className="flex items-center gap-2 hover:text-cyan-300"
                                onClick={() => setIsFreelancerMenuOpen(!isFreelancerMenuOpen)}
                            >
                                🧑‍🎨 Freelancer {isFreelancerMenuOpen ? "▴" : "▾"}
                            </button>
                            <div
                                className="ml-6 flex flex-col text-sm"
                                style={{ display: isFreelancerMenuOpen ? "flex" : "none" }}
                            >
                                <Link href="/freelancers" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    🧾 Dashboard
                                </Link>
                                <Link href="/freelancers/me" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    👤 My Profile
                                </Link>
                                <Link href="/appointments" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    📅 Appointments
                                </Link>
                                <Link href="/freelancers/payments" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                    💳 Payments
                                </Link>
                            </div>
                        </div>
                    )}
                    {isCrypto && (
                        <>
                            <Link href="/home" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                🏠 Home
                            </Link>
                            <Link href="/transactions" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                📄 Transactions
                            </Link>

                            {/* 💰 Expenses (desktop) */}
                            <div className="flex flex-col">
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setExpensesOpen(!expensesOpen)}
                                >
                                    💰 Expenses {expensesOpen ? "▴" : "▾"}
                                </button>
                                <div
                                    className="ml-6 flex flex-col text-sm"
                                    style={{ display: expensesOpen ? 'flex' : 'none' }}
                                >
                                    <Link href="/expenses" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        📄 View Expenses
                                    </Link>
                                    <Link href="/expenses/categories" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        🗂 Categories
                                    </Link>
                                </div>
                            </div>

                            {/* 💳 Debts (desktop) */}
                            <div className="flex flex-col">
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setDebtsOpen(!debtsOpen)}
                                >
                                    💳 Debts {debtsOpen ? "▴" : "▾"}
                                </button>
                                <div
                                    className="ml-6 flex flex-col text-sm"
                                    style={{ display: debtsOpen ? 'flex' : 'none' }}
                                >
                                    <Link href="/debts" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        📄 View Debts
                                    </Link>
                                    <Link href="/debts/lenders" className="hover:text-yellow-400 flex items-center gap-2 py-1">
                                        🙋‍♂️ Lenders
                                    </Link>
                                </div>
                            </div>


                            <Link href="/settings" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                ⚙️ Settings
                            </Link>
                        </>
                    )}


                    {user && (
                        <button onClick={handleLogout} className="hover:text-red-400 transition flex items-center gap-1">
                            <FiLogOut /> Logout
                        </button>
                    )}
                </div>


                {/* Mobile Toggle */}
                <button className="text-2xl" onClick={() => setMenuOpen(!menuOpen)}>
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
                        className="text-white px-6 py-4 rounded-b-2xl flex flex-col gap-4 text-sm z-40 max-w-sm mx-auto w-full"
                    >
                        {user && (
                            <div className="text-sm text-blue-200">
                                👋 Hello, <span className="font-bold">{user.name}</span>
                                <div className="text-xs mt-1 font-mono">UID: {user.uid}</div>
                            </div>
                        )}

                        {/* Salons dropdown */}
                        {isSuperAdmin && (
                            <>
                                <Link href="/home" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    <FiHome /> Home
                                </Link>
                                <Link href="/transactions" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    <FiList /> Transactions
                                </Link>
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setIsSalonsOpen(!isSalonsOpen)}
                                >
                                    🏠 Salons {isSalonsOpen ? "▴" : "▾"}
                                </button>
                                <div className="ml-6 flex flex-col text-sm" style={{ display: isSalonsOpen ? 'flex' : 'none' }}>
                                    {isSuperAdmin && (
                                        <Link
                                            href="/salons"
                                            onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                            className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                        >
                                            📍 View Salon
                                        </Link>
                                    )}
                                    <Link
                                        href="/employees"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        👥 Employees
                                    </Link>
                                    <Link
                                        href="/services"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        💈 Service
                                    </Link>
                                    <Link
                                        href="/appointments"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        📅 Appointments
                                    </Link>
                                </div>
                                {/* Admin - Freelancers */}
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setIsAdminOpen(!isAdminOpen)}
                                >
                                    🧑‍💼 Freelancers {isAdminOpen ? "▾" : "▸"}
                                </button>

                                <AnimatePresence>
                                    {isAdminOpen && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="pl-4 flex flex-col gap-2 text-sm"
                                        >
                                            <Link
                                                href="/admin/freelancers-review"
                                                onClick={() => setMenuOpen(false)}
                                                className="hover:text-yellow-300"
                                            >
                                                🧾 Review Documents
                                            </Link>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                {/* 💰 Expenses (mobile) */}
                                <button
                                    onClick={() => setExpensesOpen(!expensesOpen)}
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                >
                                    💰 Expenses {expensesOpen ? "▴" : "▾"}
                                </button>
                                {expensesOpen && (
                                    <>
                                        <Link
                                            href="/expenses"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            📄 View Expenses
                                        </Link>
                                        <Link
                                            href="/expenses/categories"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            🗂 Categories
                                        </Link>
                                    </>
                                )}

                                {/* 💳 Debts (mobile) */}
                                <button
                                    onClick={() => setDebtsOpen(!debtsOpen)}
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                >
                                    💳 Debts {debtsOpen ? "▴" : "▾"}
                                </button>
                                {debtsOpen && (
                                    <>
                                        <Link
                                            href="/debts"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            📄 View Debts
                                        </Link>
                                        <Link
                                            href="/debts/lenders"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            🙋‍♂️ Lenders
                                        </Link>
                                    </>
                                )}

                                <Link href="/settings" className="hover:text-cyan-300 flex items-center gap-2">
                                    ⚙️ Settings
                                </Link>
                            </>
                        )}

                        {isSalonChu && (
                            <>
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setIsSalonsOpen(!isSalonsOpen)}
                                >
                                    🏠 Salons {isSalonsOpen ? "▴" : "▾"}
                                </button>
                                <div className="ml-6 flex flex-col text-sm" style={{ display: isSalonsOpen ? 'flex' : 'none' }}>
                                    {isSuperAdmin && (
                                        <Link
                                            href="/salons"
                                            onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                            className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                        >
                                            📍 View Salon
                                        </Link>
                                    )}
                                    <Link
                                        href="/employees"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        👥 Employees
                                    </Link>
                                    <Link
                                        href="/services"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        💈 Service
                                    </Link>
                                    <Link
                                        href="/salon/freelancers-approval"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        🧾 Freelancers Approval
                                    </Link>
                                    <Link
                                        href="/appointments"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        📅 Appointments
                                    </Link>
                                </div>
                            </>
                        )}

                        {isSalonNhanVien && (
                            <>
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setIsSalonsOpen(!isSalonsOpen)}
                                >
                                    👤 Account {isSalonsOpen ? "▴" : "▾"}
                                </button>
                                <div className="ml-6 flex flex-col text-sm" style={{ display: isSalonsOpen ? 'flex' : 'none' }}>
                                    <Link
                                        href="/employees/me"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        👤 My Profile
                                    </Link>
                                    <Link
                                        href="/appointments"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        📅 Appointments
                                    </Link>
                                </div>
                            </>
                        )}
                        {isFreelancer && (
                            <>
                                <button
                                    onClick={() => setIsFreelancerMenuOpen(!isFreelancerMenuOpen)}
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                >
                                    🧑‍🎨 Freelancer {isFreelancerMenuOpen ? "▴" : "▾"}
                                </button>

                                {isFreelancerMenuOpen && (
                                    <>
                                        <Link
                                            href="/freelancers"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            🧾 Dashboard
                                        </Link>
                                        <Link
                                            href="/freelancers/me"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            👤 My Profile
                                        </Link>
                                        <Link
                                            href="/appointments"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            📅 Appointments
                                        </Link>
                                        <Link
                                            href="/freelancers/payments"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            💳 Payments
                                        </Link>
                                    </>
                                )}
                            </>
                        )}
                        {isSalonAll && (
                            <>
                                <button
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                    onClick={() => setIsSalonsOpen(!isSalonsOpen)}
                                >
                                    👤 Account {isSalonsOpen ? "▴" : "▾"}
                                </button>
                                <div className="ml-6 flex flex-col text-sm" style={{ display: isSalonsOpen ? 'flex' : 'none' }}>
                                    <Link
                                        href="/employees/me"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        👤 My Profile
                                    </Link>
                                    <Link
                                        href="/appointments"
                                        onClick={() => { setMenuOpen(false); setIsSalonsOpen(false); }}
                                        className="hover:text-yellow-400 flex items-center gap-2 py-1"
                                    >
                                        📅 Appointments
                                    </Link>
                                </div>
                                <button
                                    onClick={() => setIsFreelancerMenuOpen(!isFreelancerMenuOpen)}
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                >
                                    🧑‍🎨 Freelancer {isFreelancerMenuOpen ? "▴" : "▾"}
                                </button>

                                {isFreelancerMenuOpen && (
                                    <>
                                        <Link
                                            href="/freelancers"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            🧾 Dashboard
                                        </Link>
                                        <Link
                                            href="/freelancers/me"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            👤 My Profile
                                        </Link>
                                        <Link
                                            href="/appointments"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            📅 Appointments
                                        </Link>
                                        <Link
                                            href="/freelancers/payments"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            💳 Payments
                                        </Link>
                                    </>
                                )}
                            </>
                        )}

                        {isCrypto && (
                            <>
                                <Link href="/home" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    🏠 Home
                                </Link>
                                <Link href="/transactions" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    📄 Transactions
                                </Link>

                                {/* 💰 Expenses (mobile) */}
                                <button
                                    onClick={() => setExpensesOpen(!expensesOpen)}
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                >
                                    💰 Expenses {expensesOpen ? "▴" : "▾"}
                                </button>
                                {expensesOpen && (
                                    <>
                                        <Link
                                            href="/expenses"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            📄 View Expenses
                                        </Link>
                                        <Link
                                            href="/expenses/categories"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            🗂 Categories
                                        </Link>
                                    </>
                                )}

                                {/* 💳 Debts (mobile) */}
                                <button
                                    onClick={() => setDebtsOpen(!debtsOpen)}
                                    className="flex items-center gap-2 hover:text-cyan-300"
                                >
                                    💳 Debts {debtsOpen ? "▴" : "▾"}
                                </button>
                                {debtsOpen && (
                                    <>
                                        <Link
                                            href="/debts"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            📄 View Debts
                                        </Link>
                                        <Link
                                            href="/debts/lenders"
                                            onClick={() => setMenuOpen(false)}
                                            className="pl-6 py-1 hover:text-yellow-400 flex items-center gap-2"
                                        >
                                            🙋‍♂️ Lenders
                                        </Link>
                                    </>
                                )}


                                <Link href="/settings" onClick={() => setMenuOpen(false)} className="hover:text-cyan-300 flex items-center gap-2">
                                    ⚙️ Settings
                                </Link>
                            </>
                        )}
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
