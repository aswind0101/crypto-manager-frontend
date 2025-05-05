// pages/salons/add.js
import React, { useState } from "react";
import { getAuth } from "firebase/auth";
import { useRouter } from "next/router";
import withAuthProtection from "../hoc/withAuthProtection";

const AddSalon = () => {
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [ownerUserId, setOwnerUserId] = useState("");
    const [status, setStatus] = useState("active");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) {
            alert("Name is required");
            return;
        }
        setLoading(true);
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            const idToken = await user.getIdToken();

            const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    name,
                    address,
                    phone,
                    owner_user_id: ownerUserId || null,
                    status
                })
            });
            if (res.ok) {
                router.push("/salons");
            } else {
                const err = await res.json();
                alert(err.error || "Something went wrong");
            }
        } catch (err) {
            console.error("Error adding salon:", err.message);
            alert("Error adding salon");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 min-h-screen bg-[#1C1F26] text-white">
            <h1 className="text-2xl font-bold mb-4">➕ Add New Salon</h1>
            <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
                <div>
                    <label className="block mb-1">Name *</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                        required
                    />
                </div>
                <div>
                    <label className="block mb-1">Address</label>
                    <textarea
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                    ></textarea>
                </div>
                <div>
                    <label className="block mb-1">Phone</label>
                    <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                    />
                </div>
                <div>
                    <label className="block mb-1">Owner User UID</label>
                    <input
                        type="text"
                        value={ownerUserId}
                        onChange={(e) => setOwnerUserId(e.target.value)}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                        placeholder="(Optional)"
                    />
                </div>
                <div>
                    <label className="block mb-1">Status</label>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                    >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white"
                >
                    {loading ? "Saving..." : "Save Salon"}
                </button>
            </form>
        </div>
    );
};

export default withAuthProtection(AddSalon);
