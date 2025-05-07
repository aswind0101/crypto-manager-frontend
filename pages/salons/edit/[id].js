// pages/salons/edit/[id].js
import React, { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { useRouter } from "next/router";
import withAuthProtection from "../../../hoc/withAuthProtection";

const EditSalon = () => {
    const [salon, setSalon] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const router = useRouter();
    const { id } = router.query;

    const fetchSalon = async () => {
        if (!id) return;
        setLoading(true);
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/salons", {
                headers: { Authorization: `Bearer ${idToken}` }
            });
            const data = await res.json();
            const found = data.find((s) => s.id === parseInt(id));
            if (!found) {
                alert("Salon not found");
                router.push("/salons");
            } else {
                setSalon(found);
            }
        } catch (err) {
            console.error("Error fetching salon:", err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSalon();
    }, [id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!salon.name.trim()) {
            alert("Name is required");
            return;
        }
        setSaving(true);
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            const idToken = await user.getIdToken();

            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/salons/${id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    name: salon.name,
                    address: salon.address,
                    phone: salon.phone,
                    email: salon.email,
                    owner_user_id: salon.owner_user_id,
                    status: salon.status
                })
            });
            if (res.ok) {
                router.push("/salons");
            } else {
                const err = await res.json();
                alert(err.error || "Something went wrong");
            }
        } catch (err) {
            console.error("Error updating salon:", err.message);
            alert("Error updating salon");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-6 text-white">Loading...</div>;

    return (
        <div className="p-6 min-h-screen bg-[#1C1F26] text-white">
            <h1 className="text-2xl font-bold mb-4">✏️ Edit Salon</h1>
            <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
                <div>
                    <label className="block mb-1">Name *</label>
                    <input
                        type="text"
                        value={salon.name}
                        onChange={(e) => setSalon({ ...salon, name: e.target.value })}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                        required
                    />
                </div>
                <div>
                    <label className="block mb-1">Address</label>
                    <textarea
                        value={salon.address}
                        onChange={(e) => setSalon({ ...salon, address: e.target.value })}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                    ></textarea>
                </div>
                <div>
                    <label className="block mb-1">Phone</label>
                    <input
                        type="text"
                        value={salon.phone}
                        onChange={(e) => setSalon({ ...salon, phone: e.target.value })}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                    />
                </div>
                <div>
                    <label className="block mb-1">Email</label>
                    <input
                        type="email"
                        placeholder="Email (optional)"
                        value={salon.email || ""}
                        onChange={(e) => setSalon({ ...salon, email: e.target.value })}
                        className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
                    />
                </div>
               
                <div>
                    <label className="block mb-1">Status</label>
                    <select
                        value={salon.status}
                        onChange={(e) => setSalon({ ...salon, status: e.target.value })}
                        className="w-full p-2 bg-gray-800 rounded border border-gray-600"
                    >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
                <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 rounded text-white"
                >
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </form>
        </div>
    );
};

export default withAuthProtection(EditSalon);