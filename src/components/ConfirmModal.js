import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { closeModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";

// In-app replacement for window.confirm().
//
// Why: native browser confirm is system-styled (looks like an OS dialog,
// not the game's brand), blocks the JS thread, and can't be styled or
// localized. This component renders in the existing modal slot so quit
// prompts, forfeit warnings, etc. look consistent with the rest of the
// app's UI.
//
// Usage: dispatch(setModal({
//   name: "confirm",
//   data: {
//     title: "Quit this round?",
//     message: "You'll lose 5 coins.",
//     confirmText: "Quit",       // optional, defaults to "OK"
//     cancelText:  "Stay",       // optional, defaults to "Cancel"
//     destructive: true,         // optional, styles confirm in red
//     icon: "💔",                // optional, shown beside title
//     onConfirm: <thunk or action>, // optional, dispatched on confirm
//   }
// }));
//
// Or for the most common case (Promise-style), prefer the
// `confirmDialog(dispatch, opts)` helper in utils/confirm.js — that
// resolves a Promise<boolean> for awaiting in async handlers.
export default function ConfirmModal({ data }) {
  const dispatch = useDispatch();
  const d = data || {};

  const close = () => dispatch(closeModal());
  const onConfirm = () => {
    sfx.click();
    if (typeof d.onConfirm === "function") d.onConfirm();
    if (d.onConfirm && d.onConfirm.type) dispatch(d.onConfirm);
    close();
  };
  const onCancel = () => { sfx.click(); if (typeof d.onCancel === "function") d.onCancel(); close(); };

  // Keyboard: Enter = confirm, Esc = cancel. Matches native confirm's
  // behavior so muscle memory carries over.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="tw-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tw-confirm-title"
    >
      <div className="tw-modal tw-confirm-modal">
        <div className="tw-confirm-head">
          {d.icon && <span className="tw-confirm-icon" aria-hidden="true">{d.icon}</span>}
          <div id="tw-confirm-title" className="tw-confirm-title">{d.title || "Are you sure?"}</div>
        </div>
        {d.message && <div className="tw-confirm-body">{d.message}</div>}
        <div className="tw-confirm-actions">
          <button className="tw-btn ghost" onClick={onCancel} autoFocus>
            {d.cancelText || "Cancel"}
          </button>
          <button
            className={`tw-btn ${d.destructive ? "danger" : ""}`}
            onClick={onConfirm}
          >
            {d.confirmText || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
