import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";


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
    const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 giờ.

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

  const filtered = categories.filter((cat) =>
    filterType === "all" ? true : cat.type === filterType
  );

  return (
    <div className="bg-gradient-to-br from-[#0b1e3d] via-[#132f51] to-[#183b69] min-h-screen text-white p-4">
      <Navbar />
      <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-4">🗂️ Manage Categories</h1>

      <form onSubmit={handleAdd} className="bg-[#1a2f46] max-w-lg mx-auto p-6 rounded-xl border border-[#2c4069] shadow-lg space-y-4">
        <h2 className="text-lg font-semibold text-yellow-400">➕ Add New Category</h2>
        <input
          type="text"
          placeholder="Category name (e.g., Food, Salary)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
          required
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-[#1f2937] text-white px-4 py-2 rounded-full w-full outline-none"
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="credit-spending">Credit Spending</option>
        </select>
        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-full"
        >
          Add Category
        </button>
        {status && <p className="text-sm text-yellow-300 text-center mt-4">{status}</p>}
        <button
          type="button"
          onClick={() => router.push("/add-expense")}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-full transition mt-2"
        >
          🔙 Back to Add Expense
        </button>

      </form>

      {/* Bộ lọc */}
      <div className="max-w-lg mx-auto mt-6 flex justify-center gap-4">
        {["all", "expense", "income", "credit-spending"].map((val) => (
          <button
            key={val}
            onClick={() => setFilterType(val)}
            className={`px-3 py-1 rounded-full text-xs border ${filterType === val
              ? "bg-yellow-400 text-black font-bold"
              : "border-yellow-400 text-yellow-300"
              }`}
          >
            {val.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Danh sách category */}
      <div className="max-w-lg mx-auto mt-4 bg-[#1f2937] rounded-xl shadow-lg border border-[#2c4069] overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-[#183b69] text-yellow-300">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cat) => (
              <tr key={cat.id} className="border-t border-gray-700 hover:bg-[#162330]">
                <td className="px-4 py-2">{cat.name}</td>
                <td className="px-4 py-2 text-yellow-200">{cat.type.toUpperCase()}</td>
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
  );
}

export default withAuthProtection(Categories);
