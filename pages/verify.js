import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuth, signOut } from "firebase/auth"; // ⬅️ dùng getAuth, signOut từ Firebase

export default function VerifyPage() {
  const router = useRouter();
  const { token } = router.query;
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;

    const verify = async () => {
      try {
        const res = await fetch(`https://crypto-manager-backend.onrender.com/api/freelancers/verify?token=${token}`);
        const data = await res.json();

        if (res.ok) {
          setStatus("success");
          setMessage(data.message);

          // Đợi 2s để user đọc thông báo
          setTimeout(async () => {
            // 🟢 SIGN OUT khỏi Firebase để clear mọi session trước
            const auth = getAuth();
            await signOut(auth);

            // 🟢 Xoá luôn user ở localStorage (nếu có)
            localStorage.removeItem("user");

            // ⏳ Sau đó chuyển về login
            router.push("/login");
          }, 2000);
        } else {
          setStatus("error");
          setMessage(data.error || "Verification failed.");
        }
      } catch (err) {
        console.error("❌ Verification error:", err.message);
        setStatus("error");
        setMessage("Network or token error.");
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4">
      <div className="bg-white/30 dark:bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-xl p-8 max-w-md w-full text-center text-gray-800 dark:text-gray-100">
        <h1 className="text-2xl font-bold mb-4 text-emerald-700 dark:text-emerald-300">
          🔐 Email Verification
        </h1>

        {status === "loading" && (
          <p className="text-yellow-500 font-medium">⏳ Verifying your account...</p>
        )}

        {status === "success" && (
          <>
            <p className="text-green-500 text-lg font-semibold mb-2">{message}</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              You have been logged out for security.<br />
              Redirecting to login...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <p className="text-red-500 text-lg font-semibold mb-2">{message}</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Please try again or contact support.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
