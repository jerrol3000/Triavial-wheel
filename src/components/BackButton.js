import React from "react";
import { useDispatch } from "react-redux";
import { setView } from "../store/uiSlice";
import { safeNavigate } from "../utils/navigate";
import { sfx } from "../utils/sound";

// Standardized back affordance for every subview. Same shape and
// position so the player learns where Back lives in two screens.
//
// Two flavors:
//   - target="home" (default): returns to the home grid. Uses
//     safeNavigate so an in-progress round triggers the quit
//     confirmation modal first.
//   - target=<string>: setView(target) directly — no quit guard.
//     Use for intra-feature flows where Back means "the previous
//     sub-screen of this same view" (e.g. H/L picker → leaderboard).
//   - onClick override: bypass both and call a custom handler. Used
//     by FriendChallenges sub-modes to manage local state.
export default function BackButton({ target = "home", label = "← Back", onClick, className = "", style = {} }) {
  const dispatch = useDispatch();
  const handle = () => {
    sfx.click();
    if (onClick) onClick();
    else if (target === "home") dispatch(safeNavigate("home"));
    else dispatch(setView(target));
  };
  return (
    <button
      className={`tw-pill tw-back-btn ${className}`}
      onClick={handle}
      title="Back"
      style={{
        alignSelf: "flex-start",
        cursor: "pointer",
        // Lock a consistent visual + ergonomic floor across every
        // view. ~44 px tall thanks to padding + font baseline.
        padding: "10px 14px",
        minHeight: 40,
        fontWeight: 700,
        ...style,
      }}
    >
      {label}
    </button>
  );
}
