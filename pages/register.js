import { useState } from "react";
import { useRouter } from "next/router";

function Register() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [msg, setMsg] = useState("");
    const router = useRouter();

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!email || !password) {
            setMsg("❗ Please fill in all fields.");
            return;
        }

        try {
            const res = await fetch("https://crypto-manager-backend.onrender.com/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (res.ok) {
                setMsg("✅ Registered successfully. Please login.");
                setTimeout(() => router.push("/login"), 1500);
            } else {
                setMsg("❌ " + data.error);
            }
        } catch (err) {
            console.error(err);
            setMsg("Something went wrong.");
        }
    };

    return (
        <div className="min-h-screen bg-[#1C1F26] text-white flex flex-col justify-center items-center">
            <h1 className="text-2xl font-bold mb-4">Register</h1>
            <form onSubmit={handleRegister} className="space-y-4 w-80">
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 rounded bg-gray-800 text-white"
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2 rounded bg-gray-800 text-white"
                />
                <button type="submit" className="w-full bg-yellow-500 hover:bg-yellow-600 rounded px-4 py-2 font-bold">
                    Register
                </button>
                {msg && <p className="text-center text-yellow-300">{msg}</p>}
            </form>
        </div>
    );
}

export default Register;
