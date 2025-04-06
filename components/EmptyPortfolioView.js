// components/EmptyPortfolioView.js
import React from "react";
import Link from "next/link";
import Navbar from "./Navbar";

const EmptyPortfolioView = () => {
    return (
        <div className="p-4 max-w-3xl mx-auto text-center text-white">
            <Navbar />
            <div className="mt-12 bg-[#0e1628] rounded-xl p-6 shadow-md">
                <h1 className="text-xl font-bold text-yellow-400 mb-4">🕊️ No Transactions Found</h1>
                <p className="text-gray-300 mb-6">You haven&apos;t added any crypto transactions yet.</p>
                <Link
                    href="/add-transaction"
                    className="inline-block bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded font-semibold"
                >
                    ➕ Add your first transaction
                </Link>
            </div>
        </div>
    );
};

export default EmptyPortfolioView;
