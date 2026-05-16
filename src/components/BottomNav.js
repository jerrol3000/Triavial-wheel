import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import Icon from "./Icon";
import Avatar from "./Avatar";

// Each entry can be an Icon name (resolves from /icons/ with emoji fallback)
// OR — for the "me" tab when the user has set an avatar — render the avatar.
const ITEMS = [
  { id: "home",    label: "Play",   icon: "play" },
  { id: "daily",   label: "Daily",  icon: "daily" },
  { id: "online",  label: "VS",     icon: "vs" },
  { id: "shop",    label: "Shop",   icon: "shop" },
  { id: "profile", label: "Me",     icon: "me" },
];

export default function BottomNav() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  const user = useSelector((s) => s.auth.user);

  return (
    <nav className="tw-nav">
      {ITEMS.map((it) => {
        const active = view === it.id || (it.id === "home" && view === "play");
        const showAvatar = it.id === "profile" && user && user.avatar;
        // VS is the primary social/competitive tab — render it a notch larger
        // than its siblings so it reads as the headline call-to-action.
        const isHero = it.id === "online";
        const iconSize = isHero ? 38 : 28;
        return (
          <button
            key={it.id}
            className={active ? "active" : ""}
            onClick={() => { sfx.click(); dispatch(safeNavigate(it.id)); }}
            title={it.label}
          >
            <span className={`tw-nav-icon ${isHero ? "tw-nav-icon-lg" : ""}`}>
              {showAvatar
                ? <Avatar value={user.avatar} size={iconSize} ring={active} />
                : <Icon name={it.icon} size={iconSize} />}
            </span>
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
