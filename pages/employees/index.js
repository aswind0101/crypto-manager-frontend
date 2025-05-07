import React, { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import withAuthProtection from "../../hoc/withAuthProtection";
import Link from "next/link";
import Navbar from "../../components/Navbar";

function Employees() {
    const [employees, setEmployees] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const auth = getAuth();
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                fetchEmployees(user);
            }
        });
        return () => unsubscribe();
    }, []);

    const fetchEmployees = async (user) => {
        try {
            const token = await user.getIdToken();
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            console.log("💥 API employees result:", data);

            if (Array.isArray(data)) {
                setEmployees(data);
            } else if (data.employees && Array.isArray(data.employees)) {
                setEmployees(data.employees);
            } else {
                console.warn("Unexpected API response format:", data);
                setEmployees([]);
            }
        } catch (error) {
            console.error("Failed to fetch employees:", error.message);
        }
        setIsLoading(false);
    };

    const handleDelete = async (id) => {
        if (!confirm("Are you sure you want to delete this employee?")) return;
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`https://crypto-manager-backend.onrender.com/api/employees/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                setEmployees(employees.filter((emp) => emp.id !== id));
            } else {
                alert("Failed to delete employee.");
            }
        } catch (error) {
            console.error("Delete error:", error.message);
            alert("Error deleting employee.");
        }
    };

    return (
        <div className="bg-[#1C1F26] min-h-screen text-white font-mono">
            <Navbar />
            <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4 text-center">👥 Employee Manager</h1>

            <div className="max-w-5xl mx-auto rounded-xl overflow-hidden shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
                {/* Header */}
                <div className="rounded-t-2xl bg-yellow-700 px-6 py-3 flex items-center justify-between shadow-md text-white text-sm font-semibold">
                    <span>Employees</span>
                    <Link
                        href="/employees/add"
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-1.5 rounded-xl shadow-md transition"
                    >
                        ➕ Add Employee
                    </Link>
                </div>

                {/* Table */}
                <div className="overflow-x-auto bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] max-w-5xl mx-auto">
                    {isLoading ? (
                        <p className="text-center text-yellow-300 py-6">⏳ Loading employees...</p>
                    ) : employees.length === 0 ? (
                        <p className="text-center text-yellow-300 py-6">✨ No employees yet. Add your first one!</p>
                    ) : (
                        <table className="min-w-full text-[11px] text-white">
                            <thead className="text-yellow-300">
                                <tr>
                                    <th className="px-4 py-2 text-left">Name</th>
                                    <th className="px-4 py-2 text-left">Phone</th>
                                    <th className="px-4 py-2 text-left">Email</th>
                                    <th className="px-4 py-2 text-left">Role</th>
                                    <th className="px-4 py-2 text-left">Status</th>
                                    <th className="px-4 py-2 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map((emp) => (
                                    <tr key={emp.id} className="border-t border-white/5 hover:bg-[#162330]">
                                        <td className="px-4 py-2">{emp.name}</td>
                                        <td className="px-4 py-2">{emp.phone}</td>
                                        <td className="px-4 py-2">{emp.email}</td>
                                        <td className="px-4 py-2">{emp.role}</td>
                                        <td className="px-4 py-2">
                                            {emp.status ? (
                                                <span className={`font-bold ${
                                                    emp.status.toLowerCase() === "active"
                                                        ? "text-green-400"
                                                        : emp.status.toLowerCase() === "inactive"
                                                        ? "text-red-400"
                                                        : "text-yellow-300"
                                                }`}>
                                                    {emp.status}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 italic">N/A</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-4">
                                                <button
                                                    onClick={() => handleDelete(emp.id)}
                                                    className="text-red-400 hover:text-red-600 transition text-xs whitespace-nowrap"
                                                >
                                                    🗑️ Delete
                                                </button>
                                                <Link
                                                    href={`/employees/edit/${emp.id}`}
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

export default withAuthProtection(Employees);
