import { useEffect, useState } from "react";
import { useRouter } from "next/router";

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

          // ✅ Sau vài giây tự chuyển sang login
          setTimeout(() => {
            router.push("/login");
          }, 4000);
        } else {
          setStatus("error");
          setMessage(data.error || "Verification failed.");
        }
      } catch (err) {
        setStatus("error");
        setMessage("Network error or server not responding.");
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-300 via-sky-300 to-pink-300 dark:from-emerald-800 dark:via-sky-700 dark:to-pink-700 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8 max-w-md w-full text-center text-gray-800 dark:text-gray-100">
        <h1 className="text-2xl font-bold mb-4">🔐 Email Verification</h1>

        {status === "loading" && <p>⏳ Verifying your account...</p>}

        {status === "success" && (
          <>
            <p className="text-green-500 text-lg font-semibold mb-2">{message}</p>
            <p>Redirecting to login...</p>
          </>
        )}

        {status === "error" && (
          <>
            <p className="text-red-500 text-lg font-semibold mb-2">{message}</p>
            <p>Please try again or contact support.</p>
          </>
        )}
      </div>
    </div>
  );
}
