import React, { useRef, useState } from "react";
import { useDispatch } from "react-redux";
import Avatar from "./Avatar";
import { api } from "../api/client";
import { fetchMe } from "../store/authSlice";
import { pushToast } from "../store/uiSlice";
import { AVATAR_PRESETS } from "../data/icons";

// Server caps the BASE64-ENCODED data URL at 4.5MB. Base64 expansion is
// roughly 4/3, so 3.3MB raw → ~4.4MB encoded fits inside. Set the raw
// file cap slightly under that so a borderline image doesn't pass the
// client check and then fail server-side.
const MAX_UPLOAD_BYTES = 3.3 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// DiceBear options — each style produces an infinitely variable set of
// avatars from a seed. Free, no signup, served from their CDN. The
// pre-seeded list below is what we show in the picker grid; players
// can also tap "🎲 Shuffle" to roll a fresh random seed within a style.
const DICEBEAR_STYLES = [
  { id: "adventurer",  label: "Adventurer" },
  { id: "fun-emoji",   label: "Fun" },
  { id: "lorelei",     label: "Lorelei" },
  { id: "bottts",      label: "Bots" },
  { id: "pixel-art",   label: "Pixel" },
  { id: "big-smile",   label: "Smiles" },
];
// Twelve handpicked seeds per style — picked from English words so the
// resulting avatars are easy to remember and feel curated.
const DICEBEAR_SEEDS = ["cosmo", "willow", "sage", "river", "blaze", "luna", "atlas", "echo", "nova", "rio", "ember", "wren"];

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
  const [dbStyle, setDbStyle] = useState(DICEBEAR_STYLES[0].id);
  const [localValue, setLocalValue] = useState(value);
  React.useEffect(() => { setLocalValue(value); }, [value]);

  // Roll a fresh random seed within the current DiceBear style — used by
  // the "🎲 Shuffle" button so players who don't see a face they like
  // can keep rolling until they do.
  const shuffleDicebear = () => {
    const seed = Math.random().toString(36).slice(2, 10);
    set(`dicebear:${dbStyle}:${seed}`);
  };

  const set = async (next) => {
    setLocalValue(next);
    if (onChange) onChange(next);
    if (save === "auto") {
      setBusy(true);
      try {
        const { data } = await api.put("/auth/me/avatar", { avatar: next });
        dispatch(fetchMe());
        dispatch(pushToast({ icon: "✨", title: "Avatar updated" }));
      } catch (e) {
        const status = e?.response?.status;
        const err = e?.response?.data?.error || (status === 413 ? "too_large" : status ? `http_${status}` : "network");
        // Roll back so the UI doesn't lie about the saved state.
        setLocalValue(value);
        dispatch(pushToast({
          icon: "⚠️",
          title: "Couldn't save avatar",
          text: err === "too_large" || err === "avatar_too_large" ? "Picture is too large — try a smaller one."
            : err === "avatar_invalid_format" ? "Unsupported image format."
            : err === "network" ? "Server unreachable — is the backend running?"
            : err,
        }));
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

  return (
    <div className="tw-avpicker">
      <div className="tw-avpicker-current">
        <Avatar value={localValue} size={compact ? 56 : 80} ring />
        <div style={{ flex: 1 }}>
          {!compact && <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 4 }}>Profile picture</div>}
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
            Pick from the grid, shuffle for a random one, or upload your own (PNG / JPG / GIF, max 3 MB).
          </div>
          <div className="tw-row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
            <button className="tw-pill" type="button" onClick={shuffleDicebear} disabled={busy} title="Roll a random avatar"
                    style={{ cursor: "pointer", padding: "6px 12px" }}>
              🎲 Shuffle
            </button>
            <button
              className="tw-btn ghost"
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={busy}
              title="Upload an image or animated GIF"
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              📤 Upload
            </button>
            {localValue && (
              <button
                className="tw-btn ghost"
                type="button"
                onClick={() => set(null)}
                disabled={busy}
                title="Remove avatar"
                style={{ padding: "6px 14px", fontSize: 13 }}
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

      {/* Featured illustrated avatars — the in-house PNG set from
          /icons/cosmetics/avatars/ rendered as a quick-pick row at
          the top. Falls back gracefully to the emoji if a file is
          missing (Avatar component handles the onError swap). */}
      {(() => {
        const featured = AVATAR_PRESETS.filter((p) => p.file);
        if (!featured.length) return null;
        return (
          <>
            <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 12, marginBottom: 4 }}>
              Featured
            </div>
            <div className="tw-avpicker-grid" style={{ marginBottom: 8 }}>
              {featured.map((p) => {
                const val = `preset:${p.id}`;
                const selected = localValue === val;
                return (
                  <button key={p.id} type="button" disabled={busy}
                          className={`tw-avpicker-cell ${selected ? "selected" : ""}`}
                          onClick={() => set(val)} title={p.id}>
                    <Avatar value={val} size={compact ? 36 : 44} />
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* Style selector — 6 visual languages to pick from. */}
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 }}>
        Generated
      </div>
      <div className="tw-row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4, marginBottom: 8 }}>
        {DICEBEAR_STYLES.map((s) => (
          <button key={s.id} type="button"
                  className={`tw-pill ${dbStyle === s.id ? "selected" : ""}`}
                  style={{ cursor: "pointer", padding: "4px 12px", fontSize: 12,
                           background: dbStyle === s.id ? "linear-gradient(135deg, var(--primary), var(--primary-2))" : undefined,
                           border: dbStyle === s.id ? "none" : undefined, color: "#fff" }}
                  onClick={() => setDbStyle(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="tw-avpicker-grid">
        {DICEBEAR_SEEDS.map((seed) => {
          const val = `dicebear:${dbStyle}:${seed}`;
          const selected = localValue === val;
          return (
            <button key={seed} type="button" disabled={busy}
                    className={`tw-avpicker-cell ${selected ? "selected" : ""}`}
                    onClick={() => set(val)} title={seed}>
              <Avatar value={val} size={compact ? 36 : 44} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
