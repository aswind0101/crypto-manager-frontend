// 📁 components/FreelancerAddCard.js
import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe("pk_test_xxx"); // Đổi thành public key của bạn

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
    const user = JSON.parse(localStorage.getItem("user"));
    const token = await window.firebase.auth().currentUser.getIdToken();
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

  useEffect(() => {
    const fetchIntent = async () => {
      const token = await window.firebase.auth().currentUser.getIdToken();
      const res = await fetch("https://crypto-manager-backend.onrender.com/api/payment/stripe/setup-intent", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setClientSecret(data.client_secret);
    };
    fetchIntent();
  }, []);

  if (!clientSecret) return <div>Loading payment form...</div>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <AddCardForm onCompleted={onCompleted} />
    </Elements>
  );
}
