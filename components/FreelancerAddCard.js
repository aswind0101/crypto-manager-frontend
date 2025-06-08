import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { getAuth, onAuthStateChanged } from "firebase/auth";

// Fallback env key
const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "pk_test_51RXmmn00Is0qEkuZYR7ER6aOoIlaFQ3IekLgG8D1BFM4RSSxKOxOEu5TVLjFKTa3E4xzYVikQIwYy4ynaGbCsqum00RrsXG8Jk";
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);

function AddOrUpdateCardForm({ onCompleted, onCancel }) {
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
    alert("✅ Card has been updated!");
    if (onCompleted) onCompleted();
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: "tabs" }} />
      <div className="flex gap-3 mt-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2 rounded bg-emerald-500 text-white font-semibold"
        >
          {loading ? "Saving..." : "Save Card"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 py-2 rounded bg-gray-300 text-gray-700 font-semibold hover:bg-gray-400 transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function FreelancerAddCard({ hasPayment, onCompleted }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false); // Mặc định ẩn form, chỉ hiện khi bấm Add/Update

  // Khi mở form, lấy lại clientSecret
  const fetchClientSecret = async () => {
    setLoading(true);
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      setClientSecret(null);
      return;
    }
    const token = await user.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/payment/stripe/setup-intent", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setClientSecret(data.client_secret);
    setLoading(false);
  };

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && showForm) fetchClientSecret();
    });
    return () => unsubscribe();
    // eslint-disable-next-line
  }, [showForm]);

  // Khi add/update card thành công
  const handleCardSaved = () => {
    setShowForm(false); // Đóng form lại
    if (onCompleted) onCompleted();
  };

  // Hiển thị form khi user bấm nút (Add/Update)
  const handleShowForm = async () => {
    await fetchClientSecret();
    setShowForm(true);
  };

  if (loading && showForm) return <div>Loading payment form...</div>;

  return (
    <div>
      {showForm ? (
        clientSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <AddOrUpdateCardForm
              onCompleted={handleCardSaved}
              onCancel={() => setShowForm(false)}
            />
          </Elements>
        ) : (
          <div>Loading payment form...</div>
        )
      ) : hasPayment ? (
        <div className="flex items-center gap-2 p-2 rounded bg-emerald-100 border border-emerald-300 text-emerald-700 font-semibold mb-3">
          <svg
            width="20"
            height="20"
            fill="none"
            className="inline mr-2 flex-shrink-0 self-center"
            viewBox="0 0 20 20"
          >
            <circle cx="10" cy="10" r="10" fill="#34D399" />
            <path
              d="M6 10.5L9 13.5L14 8.5"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Payment method connected!
          <button
            onClick={handleShowForm}
            className="ml-4 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            type="button"
          >
            Update
          </button>
        </div>
      ) : (
        <button
          onClick={handleShowForm}
          className="w-full px-4 py-2 rounded bg-emerald-500 text-white font-semibold"
          type="button"
        >
          Add Card
        </button>
      )}
    </div>
  );
}
