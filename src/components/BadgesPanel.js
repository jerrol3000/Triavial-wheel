import React, { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { equipBadge, unequipBadge } from "../store/badgesSlice";
import { pushToast } from "../store/uiSlice";

const CATEGORY_ORDER = ["milestone", "skill", "social", "streak", "spending"];
const CATEGORY_LABEL = {
  milestone: "Milestones",
  skill: "Skill",
  social: "Online",
  streak: "Streaks",
  spending: "Spending & Collection",
};

// Profile tab — full grid of every badge in the system, with earned/
// locked styling, tier color, and an "equip into showcase" picker for
// the 3 slots that render next to the username everywhere else.
export default function BadgesPanel() {
  const dispatch = useDispatch();
  const catalog = useSelector((s) => s.badges.catalog);
  const earned = useSelector((s) => s.badges.earned);
  const equipped = useSelector((s) => s.badges.equipped);
  const stats = useSelector((s) => s.stats);

  const earnedSet = useMemo(() => new Set(earned.map((e) => e.badge_id)), [earned]);
  const equippedSlot = useMemo(() => {
    const m = {}; for (const e of earned) if (e.equipped_slot != null) m[e.badge_id] = e.equipped_slot; return m;
  }, [earned]);

  const grouped = useMemo(() => {
    const g = {};
    for (const b of catalog) {
      (g[b.category] = g[b.category] || []).push(b);
    }
    return g;
  }, [catalog]);

  const totalEarned = earned.length;
  const totalCatalog = catalog.length;

  return (
    <div className="tw-col">
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>🏅 Badge Case</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
          Earned <strong>{totalEarned}</strong> of {totalCatalog}. Pick up to 3 to showcase next to your username.
        </div>
        <div className="tw-row" style={{ gap: 10, marginTop: 12, justifyContent: "center" }}>
          {[1, 2, 3].map((slot) => {
            const id = Object.entries(equippedSlot).find(([, s]) => s === slot)?.[0];
            const item = id ? catalog.find((c) => c.id === id) : null;
            return (
              <div key={slot} className={`tw-badge-slot ${item ? "filled" : "empty"}`}>
                {item ? (
                  <>
                    <span style={{ fontSize: 28 }}>{item.icon || "🏅"}</span>
                    <button className="tw-badge-slot-remove" title="Remove from showcase"
                            onClick={() => dispatch(unequipBadge(item.id))}>×</button>
                  </>
                ) : <span style={{ color: "var(--text-dim)", fontSize: 11 }}>SLOT {slot}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {CATEGORY_ORDER.filter((c) => grouped[c]).map((cat) => (
        <div key={cat} className="tw-card">
          <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
            {CATEGORY_LABEL[cat]}
          </div>
          <div className="tw-badge-grid">
            {grouped[cat].map((b) => {
              const isEarned = earnedSet.has(b.id);
              const isEquipped = equippedSlot[b.id] != null;
              const progress = isEarned ? b.criteria_value : Math.min(b.criteria_value, readProgress(stats, b.criteria_type));
              const pct = b.criteria_value ? Math.min(100, Math.round((progress / b.criteria_value) * 100)) : 0;
              return (
                <div key={b.id} className={`tw-badge-card tier-${b.tier} ${isEarned ? "earned" : "locked"}`}>
                  <div className="tw-badge-icon">{b.icon || "🏅"}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.15 }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", margin: "3px 0 6px", minHeight: 26 }}>{b.description}</div>
                  {!isEarned && (
                    <div className="tw-badge-progress" title={`${progress} / ${b.criteria_value}`}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {isEarned && (
                    isEquipped ? (
                      <div className="tw-badge-equipped-pill">✓ In showcase</div>
                    ) : (
                      <BadgeEquipMenu badgeId={b.id} equippedSlot={equippedSlot} />
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function BadgeEquipMenu({ badgeId, equippedSlot }) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const tryEquip = async (slot) => {
    setOpen(false);
    const r = await dispatch(equipBadge({ id: badgeId, slot }));
    if (r.meta.requestStatus !== "fulfilled") {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't equip", text: r.payload?.error || "" }));
    }
  };
  return (
    <div style={{ position: "relative" }}>
      <button className="tw-badge-equip-btn" onClick={() => setOpen((v) => !v)}>
        + Showcase
      </button>
      {open && (
        <div className="tw-badge-equip-menu">
          {[1, 2, 3].map((s) => (
            <button key={s} onClick={() => tryEquip(s)}>
              Slot {s}
              {Object.values(equippedSlot).includes(s) && <span style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 10 }}>(replaces)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function readProgress(stats, type) {
  switch (type) {
    case "games_played":         return stats.games_played || 0;
    case "correct":              return stats.correct || 0;
    case "best_streak":          return stats.best_streak || 0;
    case "level":                return stats.level || 1;
    case "online_wins":          return stats.online_wins || 0;
    case "win_streak":           return stats.win_streak || 0;
    case "longest_daily_streak": return stats.longest_daily_streak || 0;
    case "coins_spent_total":    return stats.coins_spent_total || 0;
    case "cosmetics_owned_count":return stats.cosmetics_owned_count || 0;
    case "pro_lifetime_months":  return stats.pro_lifetime_months || 0;
    default: return 0;
  }
}
