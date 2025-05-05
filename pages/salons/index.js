// pages/salons/index.js
import React, { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { useRouter } from "next/router";
import withAuthProtection from "../../hoc/withAuthProtection";
import Link from "next/link";
import Navbar from "../../components/Navbar";

function Salons() {
    const [salons, setSalons] = useState([]);

    useEffect(() => {
        fetchSalons();
    }, []);

    const fetchSalons = async () => {
        try {
            const token = (await getAuth().currentUser.getIdToken());
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setSalons(data);
        } catch (error) {
            console.error("Failed to fetch salons:", error.message);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Are you sure you want to delete this salon?")) return;
        try {
            const token = (await getAuth().currentUser.getIdToken());
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/salons/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setSalons(salons.filter(salon => salon.id !== id));
            } else {
                alert("Failed to delete salon.");
            }
        } catch (error) {
            console.error("Delete error:", error.message);
            alert("Error deleting salon.");
        }
    };

    return (
        <div className="bg-[#1C1F26] min-h-screen text-white font-mono">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4 text-center">💇‍♀️ Salon Manager</h1>

            <div className="max-w-4xl mx-auto rounded-xl overflow-hidden shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
                {/* Header */}
                <div className="rounded-t-2xl bg-yellow-700 px-6 py-3 flex items-center justify-between shadow-md text-white text-sm font-semibold">
                    <span>Salons</span>
                    <Link
                        href="/salons/add"
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-1.5 rounded-xl shadow-md transition"
                    >
                        ➕ Add Salon
                    </Link>
                </div>

                {/* Table */}
                <div className="overflow-x-auto bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] max-w-4xl mx-auto">
                    {salons.length === 0 ? (
                        <p className="text-center text-yellow-300 py-6">✨ No salons yet. Add your first one!</p>
                    ) : (
                        <table className="min-w-full text-[11px] text-white">
                            <thead className="text-yellow-300">
                                <tr>
                                    <th className="px-4 py-2 text-left whitespace-nowrap">Name</th>
                                    <th className="px-4 py-2 text-left whitespace-nowrap">Address</th>
                                    <th className="px-4 py-2 text-left whitespace-nowrap">Phone</th>
                                    <th className="px-4 py-2 text-left whitespace-nowrap">Email</th>
                                    <th className="px-4 py-2 text-left whitespace-nowrap">Status</th>
                                    <th className="px-4 py-2 text-center whitespace-nowrap">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {salons.map((salon) => (
                                    <tr key={salon.id} className="border-t border-white/5 hover:bg-[#162330]">
                                        <td className="px-4 py-2 whitespace-nowrap">{salon.name}</td>
                                        <td className="px-4 py-2">{salon.address}</td>
                                        <td className="px-4 py-2">{salon.phone}</td>
                                        <td className="px-4 py-2">{salon.email}</td>
                                        <td className="px-4 py-2">
                                            {salon.status ? (
                                                <span className={`font-bold ${salon.status.toLowerCase() === 'active'
                                                    ? 'text-green-400'
                                                    : salon.status.toLowerCase() === 'inactive'
                                                        ? 'text-red-400'
                                                        : 'text-yellow-300'
                                                    }`}>
                                                    {salon.status}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 italic">N/A</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-4">
                                                <button
                                                    onClick={() => handleDelete(salon.id)}
                                                    className="text-red-400 hover:text-red-600 transition text-xs whitespace-nowrap"
                                                >
                                                    🗑️ Delete
                                                </button>
                                                <Link
                                                    href={`/salons/edit/${salon.id}`}
                                                    className="text-yellow-400 hover:text-yellow-500 text-xs whitespace-nowrap"
                                                >
                                                    ✏️ Edit
                                                </Link>
                                            </div>
                                        </td>

                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

export default withAuthProtection(Salons);

