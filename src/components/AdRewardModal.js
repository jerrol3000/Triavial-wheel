import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { closeModal, pushToast } from "../store/uiSlice";
import { grantFreeSpins, refillLives, addCoins } from "../store/statsSlice";
import { api } from "../api/client";
import { sfx } from "../utils/sound";

// Stub rewarded video: 5-second countdown imitating an ad SDK. In production,
// replace the placeholder block with your AdMob / AppLovin / Unity Ads SDK
// call and trigger onComplete() in the SDK's onRewarded callback.
export default function AdRewardModal({ reward = "free_spin" }) {
  const dispatch = useDispatch();
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [done, setDone] = useState(false);
  const [granted, setGranted] = useState(null);

  useEffect(() => {
    if (secondsLeft <= 0) { setDone(true); return; }
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const claim = async () => {
    sfx.coin();
    try {
      const { data } = await api.post("/stats/watch-ad-reward", { reward });
      // Server is source of truth. Mirror locally for instant UI.
      if (data.granted_free_spins) dispatch(grantFreeSpins(data.granted_free_spins));
      if (data.granted_coins) dispatch(addCoins(data.granted_coins));
      if (data.granted_life_refill) dispatch(refillLives());
      setGranted(data);
      dispatch(pushToast({ icon: "🎁", title: "Reward claimed!", text: rewardText(data) }));
      setTimeout(() => dispatch(closeModal()), 600);
    } catch (e) {
      const err = e?.response?.data?.error || "claim failed";
      if (err === "cooldown") {
        const wait = e?.response?.data?.wait_seconds || 600;
        dispatch(pushToast({ icon: "⏳", title: "Slow down", text: `Try again in ${Math.ceil(wait / 60)} min.` }));
      } else {
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't claim", text: err }));
      }
      dispatch(closeModal());
    }
  };

  return (
    <div className="tw-modal-backdrop" onClick={() => dispatch(closeModal())}>
      <div className="tw-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "var(--text-dim)", letterSpacing: 1 }}>SPONSORED</div>
        <div className="tw-ad-frame">
          <div style={{ fontSize: 56 }}>📺</div>
          <div style={{ fontSize: 14, color: "var(--text-dim)", margin: "10px 0" }}>
            Demo ad — replace with your AdMob / AppLovin SDK
          </div>
          <div style={{ fontFamily: "Fredoka", fontSize: 36, fontWeight: 700, margin: 16 }}>
            {done ? "✓" : secondsLeft}
          </div>
        </div>
        {!done && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Stay on this screen to earn your reward</div>}
        {done && !granted && (
          <button className="tw-btn block" style={{ marginTop: 12 }} onClick={claim}>
            🎁 Claim {rewardLabel(reward)}
          </button>
        )}
        {granted && (
          <div style={{ marginTop: 12, color: "var(--good)", fontWeight: 600 }}>
            {rewardText(granted)}
          </div>
        )}
      </div>
    </div>
  );
}

function rewardLabel(r) {
  if (r === "life_refill") return "lives refill";
  if (r === "coins") return "+30 coins";
  return "free spin";
}
function rewardText(d) {
  const parts = [];
  if (d.granted_free_spins) parts.push(`+${d.granted_free_spins} free spin${d.granted_free_spins > 1 ? "s" : ""}`);
  if (d.granted_coins) parts.push(`+${d.granted_coins} coins`);
  if (d.granted_life_refill) parts.push("lives refilled");
  return parts.join(" · ");
}
