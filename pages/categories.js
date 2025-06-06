import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import TitleCaseText from "../components/TitleCaseText";


function Categories() {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [status, setStatus] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [currentUser, setCurrentUser] = useState(null);
  const router = useRouter();


  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        fetchCategories(user);
      }
    });
    return () => unsub();
  }, []);

  const fetchCategories = async (user) => {
    const uid = user.uid;
    const CACHE_KEY = `categories_cache_${uid}`;
    const CACHE_EXPIRY_KEY = `categories_cache_expiry_${uid}`;
    const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 giờ

    try {
      const idToken = await user.getIdToken();
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/categories", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      setCategories(data);

      // ✅ Ghi đè lại cache sau khi thêm mới
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_EXPIRY_KEY, (Date.now() + CACHE_TTL).toString());
    } catch (err) {
      console.error("❌ Error fetching categories:", err.message);
    }
  };


  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name || !type) {
      setStatus("❗ Please enter category name and type.");
      return;
    }

    const idToken = await currentUser.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ name: name.trim(), type }),
    });

    if (res.ok) {
      setName("");
      setStatus("✅ Category added!");
      fetchCategories(currentUser);
      setTimeout(() => setStatus(""), 3000);
    } else {
      const err = await res.json();
      if (err.error.includes("exists")) {
        setStatus("❌ Category name already exists.");
      } else {
        setStatus("❌ Failed to add: " + err.error);
      }
    }
  };
  const handleDeleteCategory = async (id) => {
    if (!confirm("Are you sure you want to delete this category?")) return;

    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`https://crypto-manager-backend.onrender.com/api/categories/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (res.ok) {
        setStatus("✅ Category deleted!");
        fetchCategories(currentUser); // reload danh sách
        setTimeout(() => setStatus(""), 3000);
      } else {
        const err = await res.json();
        if (err.error.includes("in use")) {
          setStatus("❌ Cannot delete: this category is in use.");
        } else {
          setStatus("❌ Failed to delete: " + err.error);
        }

      }
    } catch (err) {
      console.error("❌ Delete error:", err.message);
      alert("❌ Something went wrong.");
    }
  };
  const toTitleCase = (str) =>
    str
      .replace(/-/g, ' ') // thay dấu - bằng khoảng trắng
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  const filtered = categories.filter((cat) =>
    filterType === "all" ? true : cat.type === filterType
  );

  return (
    <div className="w-full p-4 bg-[#1C1F26] min-h-screen text-white font-mono">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">🗂️ Manage Categories</h1>

      <form onSubmit={handleAdd} className="bg-[#1C1F26] max-w-lg mx-auto p-6 rounded-2xl shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631] transition-all space-y-4">
        <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Category</h2>
        <input
          type="text"
          placeholder="Category name (e.g., Food, Salary)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-gray-800 text-white px-4 py-2 rounded-xl w-full outline-none"
          required
        />
        <div className="relative w-full">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="bg-[#1C1F26] border border-gray-800 text-white rounded-xl px-4 py-2 w-full outline-none appearance-none transition pr-10"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="credit-spending">Credit Spending</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl"
        >
          Add Category
        </button>
        {status && <p className="text-sm text-yellow-300 text-center mt-4">{status}</p>}
        <button
          type="button"
          onClick={() => router.push("/add-expense")}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl transition mt-2"
        >
          🔙 Back to Add Expense
        </button>

      </form>

      {/* Bộ lọc dropdown */}
      <div className="max-w-lg mx-auto mt-6 flex justify-center">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-[#1C1F26] text-white px-4 py-2 rounded-full text-sm outline-none border border-yellow-400"
        >
          <option value="all">🗂 All</option>
          <option value="expense">💸 Expense</option>
          <option value="income">💰 Income</option>
          <option value="credit-spending">💳 Credit Spending</option>
        </select>
      </div>

      {/* Danh sách category */}
      <div className="w-full overflow-x-auto mt-4 flex justify-center">
        <div className="w-full max-w-[1200px] mx-auto overflow-x-auto rounded-2xl bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]">
          <table className="min-w-full text-sm">
            <thead className="bg-yellow-700 text-white text-bold">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cat, index) => (
                <tr
                  key={cat.id}
                  className={`border-t border-white/4 hover:bg-[#162330] ${index === filtered.length - 1 ? "rounded-b-xl" : ""
                    }`}
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    <TitleCaseText text={cat.name} />
                  </td>
                  <td className="px-4 py-2 text-yellow-200 whitespace-nowrap">
                    <TitleCaseText text={cat.type} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-red-400 hover:text-red-600 text-xs whitespace-nowrap"
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

export default withAuthProtection(Categories);
