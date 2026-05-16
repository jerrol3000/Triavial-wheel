import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import Icon from "./Icon";
import Avatar from "./Avatar";

// Four equal tabs, all labeled. Labels describe destinations (not icons),
// so "Online" is clearer than "VS" which would duplicate the icon's
// visible text. Active state lifts the icon and recolors the label — no
// background chips, halos, or FAB chrome.
const ITEMS = [
  { id: "daily",   label: "Daily",   icon: "daily" },
  { id: "online",  label: "Online",  icon: "vs" },
  { id: "shop",    label: "Shop",    icon: "shop" },
  { id: "profile", label: "Profile", icon: "me" },
];

export default function BottomNav() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  const user = useSelector((s) => s.auth.user);

  return (
    <nav className="tw-nav">
      {ITEMS.map((it) => {
        const active = view === it.id;
        const showAvatar = it.id === "profile" && user && user.avatar;
        return (
          <button
            key={it.id}
            className={active ? "active" : ""}
            onClick={() => { sfx.click(); dispatch(safeNavigate(it.id)); }}
            title={it.label}
          >
            <span className="tw-nav-icon">
              {showAvatar
                ? <Avatar value={user.avatar} size={32} ring={active} me />
                : <Icon name={it.icon} size={32} />}
            </span>
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
