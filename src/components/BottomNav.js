import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import Icon from "./Icon";
import Avatar from "./Avatar";

// Bottom nav. The Trivia Wheel logo in the header is the "home/play" entry
// point so we don't duplicate it here. VS is the centerpiece — rendered
// larger with no label since the icon literally reads "VS".
const ITEMS = [
  { id: "daily",   label: "Daily", icon: "daily" },
  { id: "online",  label: null,    icon: "vs",   hero: true },
  { id: "shop",    label: "Shop",  icon: "shop" },
  { id: "profile", label: "Me",    icon: "me" },
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
        const iconSize = it.hero ? 48 : 28;
        return (
          <button
            key={it.id}
            className={`${active ? "active" : ""} ${it.hero ? "hero" : ""}`}
            onClick={() => { sfx.click(); dispatch(safeNavigate(it.id)); }}
            title={it.id === "online" ? "Play with friends" : it.label}
          >
            <span className={`tw-nav-icon ${it.hero ? "tw-nav-icon-lg" : ""}`}>
              {showAvatar
                ? <Avatar value={user.avatar} size={iconSize} ring={active} />
                : <Icon name={it.icon} size={iconSize} />}
            </span>
            {it.label && <span>{it.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}
