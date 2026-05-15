import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { dismissToast } from "../store/uiSlice";

export default function Toasts() {
  const toasts = useSelector((s) => s.ui.toasts);
  const dispatch = useDispatch();

  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dispatch(dismissToast(t.id)), t.duration ?? 2500));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dispatch]);

  if (!toasts.length) return null;
  return (
    <>
      {toasts.map((t, i) => (
        <div key={t.id} className="tw-toast" style={{ bottom: 90 + i * 60 }}>
          {t.icon && <span style={{ marginRight: 8 }}>{t.icon}</span>}
          <strong>{t.title}</strong>
          {t.text && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{t.text}</div>}
        </div>
      ))}
    </>
  );
}
