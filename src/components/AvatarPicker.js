import React, { useRef, useState } from "react";
import { useDispatch } from "react-redux";
import Avatar from "./Avatar";
import { AVATAR_PRESETS } from "../data/icons";
import { api } from "../api/client";
import { fetchMe } from "../store/authSlice";
import { pushToast } from "../store/uiSlice";

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3MB encoded — matches server limit
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Lets the user pick a preset emoji avatar OR upload a custom image/GIF.
// Used inline in Settings, and inside the signup modal as a compact picker.
//
// Props:
//   value:    current avatar string (preset:foo, data URL, or null)
//   onChange: fired with the new value (parent decides when to persist)
//   compact:  if true, fewer presets + no caption text (for signup modal)
//   save:     "auto" (PUT to server immediately) or "manual" (parent handles)
export default function AvatarPicker({ value, onChange, compact = false, save = "manual" }) {
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const set = async (next) => {
    if (onChange) onChange(next);
    if (save === "auto") {
      setBusy(true);
      try {
        await api.put("/auth/me/avatar", { avatar: next });
        dispatch(fetchMe());
        dispatch(pushToast({ icon: "✨", title: "Avatar updated" }));
      } catch (e) {
        const err = e?.response?.data?.error || "failed";
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't save avatar", text: err }));
      }
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      dispatch(pushToast({ icon: "⚠️", title: "Unsupported type", text: "PNG, JPG, GIF, or WebP only" }));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      dispatch(pushToast({ icon: "⚠️", title: "Too large", text: `${Math.round(file.size / 1024)} KB — keep under ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB` }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set(String(reader.result));
    reader.onerror = () => dispatch(pushToast({ icon: "⚠️", title: "Read failed" }));
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-selecting the same file later
  };

  const presets = compact ? AVATAR_PRESETS.slice(0, 8) : AVATAR_PRESETS;

  return (
    <div className="tw-avpicker">
      <div className="tw-avpicker-current">
        <Avatar value={value} size={compact ? 56 : 80} ring />
        <div style={{ flex: 1 }}>
          {!compact && <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 4 }}>Profile picture</div>}
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
            Pick a preset or upload a PNG / JPG / animated GIF (max 3 MB).
          </div>
          <div className="tw-row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
            <button
              className="tw-btn"
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={busy}
              title="Upload an image or animated GIF"
            >
              📤 Upload
            </button>
            {value && (
              <button
                className="tw-btn ghost"
                type="button"
                onClick={() => set(null)}
                disabled={busy}
                title="Remove avatar"
              >
                ✕ Remove
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={onFile}
            />
          </div>
        </div>
      </div>

      <div className="tw-avpicker-grid">
        {presets.map((p) => {
          const presetVal = `preset:${p.id}`;
          const selected = value === presetVal;
          return (
            <button
              key={p.id}
              className={`tw-avpicker-cell ${selected ? "selected" : ""}`}
              type="button"
              onClick={() => set(presetVal)}
              disabled={busy}
              title={p.id}
            >
              <Avatar value={presetVal} size={compact ? 36 : 44} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
