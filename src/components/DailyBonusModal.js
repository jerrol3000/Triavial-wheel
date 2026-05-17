import React from "react";
import { useDispatch } from "react-redux";
import { closeModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import Icon from "./Icon";

export default function DailyBonusModal({ data }) {
  const dispatch = useDispatch();
  React.useEffect(() => { sfx.coin(); }, []);
  if (!data) return null;
  const { streak = 0, spinsReward = 0, coinsReward = 0 } = data;

  return (
    <div className="tw-modal-backdrop" onClick={() => dispatch(closeModal())}>
      <div className="tw-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
          <Icon name="daily_bonus" size={56} />
        </div>
        <div style={{ fontFamily: "Fredoka", fontSize: 26, fontWeight: 700 }}>Daily Bonus!</div>
        <div style={{ color: "var(--text-dim)", margin: "6px 0 16px" }}>
          Day {streak} login streak — keep showing up for bigger rewards.
        </div>
        <div className="tw-grid-2" style={{ marginBottom: 16 }}>
          <div className="tw-stat">
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Icon name="free_spin" size={32} />
            </div>
            <div className="tw-stat-value">+{spinsReward}</div>
            <div className="tw-stat-label">Free Spins</div>
          </div>
          <div className="tw-stat">
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Icon name="coins" size={32} />
            </div>
            <div className="tw-stat-value">+{coinsReward}</div>
            <div className="tw-stat-label">Coins</div>
          </div>
        </div>
        <div className="tw-streak-ladder">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            // 1-2 → 1 spin, 3-5 → 2 spins, 6-7 → 3 spins. Single emoji
            // + ×N counter reads cleaner than mixed-length emoji rows.
            const spins = d <= 2 ? 1 : d <= 5 ? 2 : 3;
            return (
              <div key={d} className={`tw-streak-day ${d <= streak ? "claimed" : ""} ${d === streak ? "current" : ""}`}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Day {d}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontFeatureSettings: '"tnum"', display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <Icon name="free_spin" size={12} /> ×{spins}
                </span>
              </div>
            );
          })}
        </div>
        <button className="tw-btn block" style={{ marginTop: 16 }} onClick={() => dispatch(closeModal())}>
          Awesome
        </button>
      </div>
    </div>
  );
}
