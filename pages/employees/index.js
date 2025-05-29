import React, { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import withAuthProtection from "../../hoc/withAuthProtection";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import DocumentPreviewModal from "../../components/DocumentPreviewModal";

function Employees() {
  const [employees, setEmployees] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [previewFiles, setPreviewFiles] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const router = useRouter();
  const [role, setRole] = useState("");
  const [uid, setUid] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      const u = JSON.parse(localStorage.getItem("user") || "{}");
      setRole(u.role);
      setUid(u.uid);
    }
  }, []);
  // SuperAdmin list
  const SUPER_ADMINS = ["D9nW6SLT2pbUuWbNVnCgf2uINok2"];
  const isSuperAdmin = SUPER_ADMINS.includes(uid);
  const isSalonChu = role === "Salon_Chu";
  const canApprove = isSalonChu || isSuperAdmin;

  useEffect(() => {
    let intervalId;
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        fetchEmployees(user);
        intervalId = setInterval(() => fetchEmployees(user), 10000); // ⏰ 10s cập nhật
      }
    });
    return () => {
      unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const fetchEmployees = async (user) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/employees", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setEmployees(data);
      } else if (data.employees && Array.isArray(data.employees)) {
        setEmployees(data.employees);
      } else {
        setEmployees([]);
      }
    } catch (error) {
      setEmployees([]);
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
      alert("Error deleting employee.");
    }
  };

  const handleApproval = async (employeeId, type, newStatus) => {
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(
        "https://crypto-manager-backend.onrender.com/api/employees/update-status",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            employee_id: employeeId,
            type,
            status: newStatus,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to update");
      setEmployees((prev) =>
        prev.map((emp) =>
          emp.id === employeeId ? { ...emp, [type]: newStatus } : emp
        )
      );
    } catch (err) {
      alert("Failed to update status.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-800 via-sky-700 to-pink-700 px-4 py-8 text-gray-100">
      <Navbar />
      <DocumentPreviewModal
        files={previewFiles}
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      <h1 className="text-3xl font-extrabold text-center text-emerald-300 mb-8">
        👥 Employee Manager
      </h1>

      <div className="max-w-6xl mx-auto space-y-8">
        <div className="glass-box overflow-x-auto">
          <div className="flex justify-end mb-4">
            <Link
              href="/employees/add"
              className="bg-gradient-to-r from-emerald-500 via-amber-400 to-pink-400 text-white px-5 py-2 rounded-full font-semibold shadow-lg hover:shadow-xl hover:brightness-105 transition"
            >
              ➕ Add Employee
            </Link>
          </div>
          <table className="min-w-full text-[13px] text-white">
            <thead>
              <tr className="text-yellow-400">
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Phone</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Cert Status</th>
                <th className="px-4 py-2 text-left">ID Doc Status</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-yellow-400">
                    ⏳ Loading employees...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-pink-300">
                    ✨ No employees yet. Add your first one!
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="border-t border-white/10 hover:bg-white/10 ">
                    <td className="px-4 py-2">{emp.name}</td>
                    <td className="px-4 py-2">{emp.phone}</td>
                    <td className="px-4 py-2">{emp.email}</td>
                    <td className="px-4 py-2">{emp.role}</td>
                    {/* Cert Status */}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {(!emp.certifications || emp.certifications.length === 0) ? (
                          <span className="italic text-gray-400">Empty</span>
                        ) : canApprove ? (
                          <select
                            value={emp.certification_status}
                            onChange={(e) =>
                              handleApproval(
                                emp.id,
                                "certification_status",
                                e.target.value
                              )
                            }
                            className="bg-white/10 border border-gray-700 text-xs rounded px-1"
                          >
                            <option value="In Review">In Review</option>
                            <option value="Approved">Approved</option>
                            <option value="Rejected">Rejected</option>
                          </select>
                        ) : (
                          <span
                            className={`font-semibold ${
                              emp.certification_status === "Approved"
                                ? "text-green-500"
                                : emp.certification_status === "Rejected"
                                ? "text-red-500"
                                : "text-yellow-400"
                            }`}
                          >
                            {emp.certification_status}
                          </span>
                        )}
                        {(emp.certifications || []).length > 0 && (
                          <button
                            onClick={() => {
                              setPreviewFiles(emp.certifications.map((f) => f));
                              setPreviewOpen(true);
                            }}
                            className="text-xs text-yellow-400 hover:underline"
                          >
                            🔍
                          </button>
                        )}
                      </div>
                    </td>
                    {/* ID Doc Status */}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {(!emp.id_documents || emp.id_documents.length === 0) ? (
                          <span className="italic text-gray-400">Empty</span>
                        ) : canApprove ? (
                          <select
                            value={emp.id_document_status}
                            onChange={(e) =>
                              handleApproval(
                                emp.id,
                                "id_document_status",
                                e.target.value
                              )
                            }
                            className="bg-white/10 border border-gray-700 text-xs rounded px-1"
                          >
                            <option value="In Review">In Review</option>
                            <option value="Approved">Approved</option>
                            <option value="Rejected">Rejected</option>
                          </select>
                        ) : (
                          <span
                            className={`font-semibold ${
                              emp.id_document_status === "Approved"
                                ? "text-green-500"
                                : emp.id_document_status === "Rejected"
                                ? "text-red-500"
                                : "text-yellow-400"
                            }`}
                          >
                            {emp.id_document_status}
                          </span>
                        )}
                        {(emp.id_documents || []).length > 0 && (
                          <button
                            onClick={() => {
                              setPreviewFiles(emp.id_documents.map((f) => f));
                              setPreviewOpen(true);
                            }}
                            className="text-xs text-yellow-400 hover:underline"
                          >
                            🔍
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-2">
                      {emp.status ? (
                        <span
                          className={`inline-block px-3 py-1 rounded-full font-bold text-xs
                          ${
                            emp.status.toLowerCase() === "active"
                              ? "bg-green-100 text-green-700"
                              : emp.status.toLowerCase() === "inactive"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {emp.status}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">N/A</span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDelete(emp.id)}
                          className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-semibold hover:bg-red-200"
                        >
                          🗑️
                        </button>
                        <Link
                          href={`/employees/edit/${emp.id}`}
                          className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold hover:bg-yellow-200"
                        >
                          ✏️
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default withAuthProtection(Employees);
