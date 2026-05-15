import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView } from "../store/uiSlice";
import { sfx } from "../utils/sound";

const ITEMS = [
  { id: "home",    label: "Play",   icon: "🎡" },
  { id: "daily",   label: "Daily",  icon: "📅" },
  { id: "online",  label: "VS",     icon: "🌐" },
  { id: "shop",    label: "Shop",   icon: "🛒" },
  { id: "profile", label: "Me",     icon: "📊" },
];

export default function BottomNav() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  return (
    <nav className="tw-nav">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={view === it.id || (it.id === "home" && view === "play") ? "active" : ""}
          onClick={() => { sfx.click(); dispatch(setView(it.id)); }}
        >
          <span style={{ fontSize: 22 }}>{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
