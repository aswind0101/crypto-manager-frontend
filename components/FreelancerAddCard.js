// components/FreelancerAddCard.js
import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { getAuth, onAuthStateChanged } from "firebase/auth"; // Đồng bộ cách gọi

// Nên truyền prop stripeKey hoặc import từ file cấu hình env (trong Next.js sẽ dùng NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

function AddCardForm({ onCompleted }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);

    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {},
      redirect: "if_required",
    });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    // Lưu payment_method_id lên backend
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      alert("You must login to save your card!");
      setLoading(false);
      return;
    }
    const token = await user.getIdToken();

    await fetch("https://crypto-manager-backend.onrender.com/api/payment/stripe/save-payment-method", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payment_method_id: setupIntent.payment_method }),
    });

    setLoading(false);
    alert("✅ Card added!");
    if (onCompleted) onCompleted();
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: "tabs" }} />
      <button
        type="submit"
        disabled={loading}
        className="w-full mt-4 py-2 rounded bg-emerald-500 text-white font-semibold"
      >
        {loading ? "Saving..." : "Add Card"}
      </button>
    </form>
  );
}

export default function FreelancerAddCard({ onCompleted }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    // Đảm bảo đồng bộ cách dùng user giống Navbar
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        setClientSecret(null);
        return;
      }
      // Đã login → lấy token và gọi API Stripe
      const token = await user.getIdToken();
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/payment/stripe/setup-intent", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setClientSecret(data.client_secret);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <div>Loading payment form...</div>;
  if (!clientSecret) return <div className="text-pink-500">You must login to add a payment method.</div>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <AddCardForm onCompleted={onCompleted} />
    </Elements>
  );
}
