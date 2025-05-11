import { useState } from "react";

export default function ResendVerifyEmail({ email }) {
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);

    const handleResend = async () => {
        if (!email) {
            setStatus("❌ Missing email.");
            return;
        }

        setLoading(true);
        setStatus("");

        try {
            const res = await fetch(
                `https://crypto-manager-backend.onrender.com/api/freelancers/resend-verify?email=${encodeURIComponent(email)}`
            );

            const data = await res.json();

            if (res.ok) {
                setStatus("✅ Verification email resent. Please check your inbox.");
            } else {
                setStatus(`❌ ${data.error || "Failed to resend email."}`);
            }
        } catch (err) {
            setStatus("❌ Network error.");
        }

        setLoading(false);
    };

    return (
        <div className="mt-4 text-center space-y-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
                Didn&apos;t receive the verification email?
            </p>

            <button
                onClick={handleResend}
                disabled={loading}
                className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-1.5 px-4 rounded-xl transition"
            >
                {loading ? "Sending..." : "Resend Verification Email"}
            </button>
            {status && (
                <p className="text-sm mt-2 font-medium text-yellow-500">{status}</p>
            )}
        </div>
    );
}
