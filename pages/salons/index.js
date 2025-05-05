// pages/salons/index.js
import React, { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { useRouter } from "next/router";
import withAuthProtection from "../hoc/withAuthProtection";
import Link from "next/link";

const SalonsList = () => {
    const [salons, setSalons] = useState([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const baseUrl = "https://crypto-manager-backend.onrender.com";

    const fetchSalons = async () => {
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            const res = await fetch(`${baseUrl}/api/salons`, {
                headers: { Authorization: `Bearer ${idToken}` }
            });
            const data = await res.json();
            setSalons(data);
        } catch (err) {
            console.error("Error fetching salons:", err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSalons();
    }, []);

    return (
        <div className="p-6 text-white min-h-screen bg-[#1C1F26]">
            <h1 className="text-2xl font-bold mb-4">🏠 Salons Management</h1>
            <button
                onClick={() => router.push("/salons/add")}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg mb-6 text-white"
            >
                ➕ Add New Salon
            </button>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border border-white/20">
                        <thead>
                            <tr className="bg-yellow-700 text-white">
                                <th className="px-3 py-2 border">Name</th>
                                <th className="px-3 py-2 border">Address</th>
                                <th className="px-3 py-2 border">Phone</th>
                                <th className="px-3 py-2 border">Owner UID</th>
                                <th className="px-3 py-2 border">Status</th>
                                <th className="px-3 py-2 border">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {salons.map((salon) => (
                                <tr key={salon.id} className="border-b border-white/10">
                                    <td className="px-3 py-2">{salon.name}</td>
                                    <td className="px-3 py-2">{salon.address}</td>
                                    <td className="px-3 py-2">{salon.phone}</td>
                                    <td className="px-3 py-2 text-xs">{salon.owner_user_id}</td>
                                    <td className="px-3 py-2">{salon.status}</td>
                                    <td className="px-3 py-2">
                                        <Link href={`/salons/edit/${salon.id}`}>
                                            <span className="text-yellow-400 hover:underline cursor-pointer">Edit</span>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default withAuthProtection(SalonsList);
