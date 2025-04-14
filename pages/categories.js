import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import withAuthProtection from "../hoc/withAuthProtection";
import { getAuth, onAuthStateChanged } from "firebase/auth";

function Categories() {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [status, setStatus] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [currentUser, setCurrentUser] = useState(null);

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
    const idToken = await user.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/categories", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json();
    setCategories(data);
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
    } else {
      const err = await res.json();
      setStatus("❌ " + err.error);
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
        </select>
        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-full"
        >
          Add Category
        </button>
        {status && <p className="text-sm text-yellow-300 text-center">{status}</p>}
      </form>

      {/* Bộ lọc */}
      <div className="max-w-lg mx-auto mt-6 flex justify-center gap-4">
        {["all", "expense", "income"].map((val) => (
          <button
            key={val}
            onClick={() => setFilterType(val)}
            className={`px-4 py-1 rounded-full text-sm border ${
              filterType === val
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((cat) => (
              <tr key={cat.id} className="border-t border-gray-700 hover:bg-[#162330]">
                <td className="px-4 py-2">{cat.name}</td>
                <td className="px-4 py-2 text-yellow-200">{cat.type.toUpperCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default withAuthProtection(Categories);
