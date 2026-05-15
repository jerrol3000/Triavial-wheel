import React from "react";
import { useDispatch } from "react-redux";
import { closeModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";

export default function DailyBonusModal({ data }) {
  const dispatch = useDispatch();
  React.useEffect(() => { sfx.coin(); }, []);
  if (!data) return null;
  const { streak = 0, spinsReward = 0, coinsReward = 0 } = data;

  return (
    <div className="tw-modal-backdrop" onClick={() => dispatch(closeModal())}>
      <div className="tw-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48 }}>🎁</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 26, fontWeight: 700 }}>Daily Bonus!</div>
        <div style={{ color: "var(--text-dim)", margin: "6px 0 16px" }}>
          Day {streak} login streak — keep showing up for bigger rewards.
        </div>
        <div className="tw-grid-2" style={{ marginBottom: 16 }}>
          <div className="tw-stat">
            <div style={{ fontSize: 28 }}>🎡</div>
            <div className="tw-stat-value">+{spinsReward}</div>
            <div className="tw-stat-label">Free Spins</div>
          </div>
          <div className="tw-stat">
            <div style={{ fontSize: 28 }}>🪙</div>
            <div className="tw-stat-value">+{coinsReward}</div>
            <div className="tw-stat-label">Coins</div>
          </div>
        </div>
        <div className="tw-streak-ladder">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className={`tw-streak-day ${d <= streak ? "claimed" : ""} ${d === streak ? "current" : ""}`}>
              <span style={{ fontSize: 14 }}>Day {d}</span>
              <span style={{ fontSize: 11 }}>{d <= 2 ? "🎡" : "🎡🎡"}{d > 5 ? "🎡" : ""}</span>
            </div>
          ))}
        </div>
        <button className="tw-btn block" style={{ marginTop: 16 }} onClick={() => dispatch(closeModal())}>
          Awesome
        </button>
      </div>
    </div>
  );
}
