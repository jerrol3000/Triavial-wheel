import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import Icon from "./Icon";
import Avatar from "./Avatar";

// Bottom nav. The Trivia Wheel logo in the header is the "home/play" entry
// point, so it's not duplicated here. Shop and VS are the two primary
// action tabs — rendered larger than the secondary Daily / Me tabs so
// they pop without any background chrome.
const ITEMS = [
  { id: "daily",   label: "Daily", icon: "daily" },
  { id: "shop",    label: "Shop",  icon: "shop", big: true },
  { id: "online",  label: null,    icon: "vs",   big: true, title: "Play with friends" },
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
        const iconSize = it.big ? 48 : 28;
        return (
          <button
            key={it.id}
            className={`${active ? "active" : ""} ${it.big ? "big" : ""}`}
            onClick={() => { sfx.click(); dispatch(safeNavigate(it.id)); }}
            title={it.title || it.label}
          >
            <span className="tw-nav-icon" style={{ width: iconSize, height: iconSize }}>
              {showAvatar
                ? <Avatar value={user.avatar} size={iconSize} ring={active} />
                : <Icon name={it.icon} size={iconSize} />}
            </span>
            {/* Empty placeholder keeps vertical alignment consistent for
                tabs that don't have a label (VS). */}
            <span>{it.label || " "}</span>
          </button>
        );
      })}
    </nav>
  );
}
