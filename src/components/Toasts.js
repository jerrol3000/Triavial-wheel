import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { dismissToast } from "../store/uiSlice";

export default function Toasts() {
  const toasts = useSelector((s) => s.ui.toasts);
  const dispatch = useDispatch();
  const scheduledRef = useRef(new Set());

  // Only schedule a dismiss timer for toasts we haven't seen before. Earlier
  // version cleared and re-armed every toast's timer on every push, which (a)
  // reset already-elapsed timers, and (b) made the effect work-set grow as
  // O(n²) for batched pushes during a level-up cascade.
  useEffect(() => {
    const currentIds = new Set();
    toasts.forEach((t) => {
      currentIds.add(t.id);
      if (!scheduledRef.current.has(t.id)) {
        scheduledRef.current.add(t.id);
        const id = t.id;
        setTimeout(() => {
          dispatch(dismissToast(id));
          scheduledRef.current.delete(id);
        }, t.duration ?? 2500);
      }
    });
    // Forget toasts that have already been dismissed (no need to keep IDs).
    for (const id of scheduledRef.current) {
      if (!currentIds.has(id)) scheduledRef.current.delete(id);
    }
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
