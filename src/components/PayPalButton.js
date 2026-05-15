import React, { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { api } from "../api/client";
import { pushToast } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import { sfx } from "../utils/sound";

// ── Singleton script loader so the SDK isn't injected twice if multiple
//    PayPalButton instances mount.
let sdkLoadPromise = null;
function loadPaypalSdk(clientId) {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if (window.paypal) return Promise.resolve(window.paypal);
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    s.async = true;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => reject(new Error("sdk_load_failed"));
    document.head.appendChild(s);
  });
  return sdkLoadPromise;
}

export default function PayPalButton({ productId, clientId, onSuccess }) {
  const dispatch = useDispatch();
  const ref = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let renderedButtons = null;
    loadPaypalSdk(clientId)
      .then((paypal) => {
        if (cancelled || !ref.current) return;
        renderedButtons = paypal.Buttons({
          style: { layout: "horizontal", height: 38, tagline: false, shape: "pill", color: "blue" },
          createOrder: async () => {
            const { data } = await api.post("/pay/paypal/create-order", { product: productId });
            return data.id;
          },
          onApprove: async (data) => {
            try {
              const { data: cap } = await api.post("/pay/paypal/capture-order", { order_id: data.orderID });
              sfx.coin();
              dispatch(pushToast({ icon: "🎉", title: "Purchase complete", text: rewardText(cap.granted) }));
              dispatch(fetchStats());
              if (onSuccess) onSuccess(cap.granted);
            } catch (e) {
              dispatch(pushToast({ icon: "⚠️", title: "Capture failed", text: "Contact support if charged." }));
            }
          },
          onError: () => {
            dispatch(pushToast({ icon: "⚠️", title: "PayPal error", text: "Try again." }));
          },
          onCancel: () => {},
        });
        renderedButtons.render(ref.current).catch((e) => {
          if (!cancelled) setError(e?.message || "render_failed");
        });
      })
      .catch((e) => { if (!cancelled) setError(e.message); });

    return () => {
      cancelled = true;
      if (renderedButtons && typeof renderedButtons.close === "function") {
        try { renderedButtons.close(); } catch (e) {}
      }
    };
  }, [productId, clientId, dispatch, onSuccess]);

  if (error) {
    return <div style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
      Payment unavailable — try again later.
    </div>;
  }
  return <div ref={ref} className="tw-paypal-button" />;
}

function rewardText(g) {
  if (!g) return "";
  const parts = [];
  if (g.coins) parts.push(`+${g.coins} coins`);
  if (g.free_spins) parts.push(`+${g.free_spins} free spins`);
  if (g.powerups) parts.push(`+${Object.values(g.powerups).reduce((a, b) => a + b, 0)} powerups`);
  return parts.join(" · ");
}
