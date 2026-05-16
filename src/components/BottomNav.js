import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import Icon from "./Icon";
import Avatar from "./Avatar";

// Bottom nav. The Trivia Wheel logo in the header is the "home/play" entry
// point, so it's not duplicated here. VS is the centerpiece — rendered as
// a circular FAB-style button floating above the bar at true horizontal
// center, with a reserved empty slot in the row so the side tabs don't
// crowd into 50%.
const SIDE_ITEMS = [
  { id: "daily",   label: "Daily", icon: "daily" },
  { id: "shop",    label: "Shop",  icon: "shop" },
  { id: "profile", label: "Me",    icon: "me" },
];

export default function BottomNav() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  const user = useSelector((s) => s.auth.user);

  const renderTab = (it) => {
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
            ? <Avatar value={user.avatar} size={28} ring={active} />
            : <Icon name={it.icon} size={28} />}
        </span>
        <span>{it.label}</span>
      </button>
    );
  };

  const heroActive = view === "online";

  return (
    <nav className="tw-nav">
      {SIDE_ITEMS.slice(0, 2).map(renderTab)}
      {/* Reserved slot so the row stays balanced around the absolute-
          positioned VS hero — keeps Shop from sliding into center. */}
      <div className="tw-nav-hero-slot" aria-hidden="true" />
      {SIDE_ITEMS.slice(2).map(renderTab)}
      <button
        className={`tw-nav-hero ${heroActive ? "active" : ""}`}
        onClick={() => { sfx.click(); dispatch(safeNavigate("online")); }}
        title="Play with friends"
      >
        <Icon name="vs" size={56} />
      </button>
    </nav>
  );
}
