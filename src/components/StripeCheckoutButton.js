import React, { useState } from "react";
import { useDispatch } from "react-redux";
import { api } from "../api/client";
import { pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";

// Stripe Hosted Checkout — opens Stripe's payment page in a new tab. Stripe
// auto-enables Apple Pay / Google Pay on supported browsers. After success,
// the success URL is configured to redirect back with `?paid=1&session=...`
// which App.js verifies + grants on next mount.
export default function StripeCheckoutButton({ productId }) {
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);

  const click = async () => {
    sfx.click();
    setBusy(true);
    try {
      const { data } = await api.post("/pay/stripe/checkout", { product: productId });
      if (data.url) window.location.href = data.url;
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't start checkout", text: e?.response?.data?.error || "" }));
    }
    setBusy(false);
  };

  return (
    <button className="tw-btn block" onClick={click} disabled={busy}
      style={{ background: "linear-gradient(135deg, #635bff, #4f46e5)" }}>
      {busy ? "…" : "💳 Card / Apple / Google Pay"}
    </button>
  );
}
