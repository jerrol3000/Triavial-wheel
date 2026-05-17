import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import { useT } from "../i18n";
import Icon from "./Icon";
import Avatar from "./Avatar";

// Four equal tabs. Labels resolve through i18n so a language switch in
// Settings re-labels the nav immediately. Label keys map to nav.*
// translations (Daily / Online / Shop / Me — though Online uses "VS"
// in English-icon context). i18n key list lives in src/i18n/translations.js.
const ITEMS = [
  { id: "daily",   labelKey: "nav.daily",   icon: "daily" },
  { id: "online",  labelKey: "nav.online",  icon: "vs" },
  { id: "shop",    labelKey: "nav.shop",    icon: "shop" },
  { id: "profile", labelKey: "nav.profile", icon: "me" },
];

export default function BottomNav() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  const user = useSelector((s) => s.auth.user);
  const { t } = useT();

  return (
    <nav className="tw-nav">
      {ITEMS.map((it) => {
        const active = view === it.id;
        const showAvatar = it.id === "profile" && user && user.avatar;
        const label = t(it.labelKey);
        return (
          <button
            key={it.id}
            className={active ? "active" : ""}
            onClick={() => { sfx.click(); dispatch(safeNavigate(it.id)); }}
            title={label}
            aria-label={label}
          >
            {/* Labels removed — icons are big and self-explanatory.
                title + aria-label keep the text accessible to hover
                tooltips + screen readers. Avatar on the profile button
                uses a slightly smaller size so the wearer's PNG frame
                ring (extends to ~size/0.55) still fits visually
                without overflowing the bottom of the nav bar. */}
            <span className={`tw-nav-icon ${showAvatar ? "with-frame" : ""}`}>
              {showAvatar
                ? <Avatar value={user.avatar} size={28} ring={active} me />
                : <Icon name={it.icon} size={44} />}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
