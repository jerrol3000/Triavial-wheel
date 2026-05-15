import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { fetchStats } from "../store/statsSlice";
import { pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";

export default function QuestsPanel() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) { setLoading(false); return; }
    api.get("/stats/quests")
      .then((r) => setQuests(r.data.quests || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!user) {
    return (
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📋 Daily Quests</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Sign in to unlock daily quests for extra rewards.</div>
      </div>
    );
  }

  const claim = async (id) => {
    sfx.coin();
    try {
      const { data } = await api.post("/stats/quests/claim", { id });
      const r = data.reward || {};
      const parts = [];
      if (r.coins) parts.push(`+${r.coins} coins`);
      if (r.free_spins) parts.push(`+${r.free_spins} free spins`);
      dispatch(pushToast({ icon: "🎁", title: "Quest reward!", text: parts.join(" · ") }));
      dispatch(fetchStats());
      load();
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't claim", text: e?.response?.data?.error || "" }));
    }
  };

  if (loading) return null;
  if (!quests.length) return null;

  const completedCount = quests.filter((q) => (q.progress || 0) >= q.target).length;

  return (
    <div className="tw-card">
      <div className="tw-row" style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>📋 Daily Quests</div>
        <div style={{ flex: 1 }} />
        <span className="tw-pill" title="Quests reset at midnight UTC">{completedCount}/{quests.length} done</span>
      </div>
      {quests.map((q) => {
        const progress = Math.min(q.target, q.progress || 0);
        const complete = progress >= q.target;
        const cls = `tw-quest ${complete ? "complete" : ""} ${q.claimed ? "claimed" : ""}`;
        return (
          <div key={q.id} className={cls}>
            <div className="tw-quest-info">
              <div className="tw-quest-text">{q.text}</div>
              <div className="tw-quest-progress" title={`${progress} / ${q.target}`}>
                <div style={{ width: `${(progress / q.target) * 100}%` }} />
              </div>
              <div className="tw-quest-reward">
                Reward: {[q.reward?.coins ? `${q.reward.coins} 🪙` : null, q.reward?.free_spins ? `${q.reward.free_spins} 🎡` : null].filter(Boolean).join(" + ")}
              </div>
            </div>
            {complete && !q.claimed && (
              <button className="tw-btn" onClick={() => claim(q.id)} title="Claim your reward">Claim</button>
            )}
            {q.claimed && <span className="tw-pill" style={{ background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)" }}>✓</span>}
          </div>
        );
      })}
    </div>
  );
}
