import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { fetchStats } from "../store/statsSlice";
import { pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import Icon from "./Icon";

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
      <div className="tw-row" style={{ marginBottom: 10, gap: 8 }}>
        <Icon name="daily_quest" size={26} />
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>Daily Quests</div>
        <div style={{ flex: 1 }} />
        <span className="tw-pill" title="Quests reset at midnight UTC">{completedCount}/{quests.length} done</span>
      </div>
      {quests.map((q) => {
        const progress = Math.min(q.target, q.progress || 0);
        const complete = progress >= q.target;
        // Three distinct visual states: in-progress (gradient bar fills as
        // you play), ready (bar full, green border, glowing Claim button),
        // and claimed (bar 100% green, disabled, "Done — back tomorrow"
        // label so it's obvious you can't double-dip).
        const cls = `tw-quest ${complete ? "complete" : ""} ${q.claimed ? "claimed" : ""}`;
        const fillPct = q.claimed ? 100 : (progress / q.target) * 100;
        return (
          <div key={q.id} className={cls}>
            <div className="tw-quest-info">
              <div className="tw-quest-text">
                {q.text}
                {!q.claimed && (
                  <span className="tw-quest-counter" title={`${progress} / ${q.target}`}>
                    {progress}/{q.target}
                  </span>
                )}
              </div>
              <div className="tw-quest-progress" title={`${progress} / ${q.target}`}>
                <div style={{ width: `${fillPct}%` }} />
              </div>
              <div className="tw-quest-reward">
                {q.claimed
                  ? <span className="tw-quest-done">✓ Done — back tomorrow</span>
                  : <>Reward: {[q.reward?.coins ? `${q.reward.coins} 🪙` : null, q.reward?.free_spins ? `${q.reward.free_spins} 🎡` : null].filter(Boolean).join(" + ")}</>
                }
              </div>
            </div>
            {complete && !q.claimed && (
              <button className="tw-btn tw-quest-claim" onClick={() => claim(q.id)} title="Claim your reward">Claim</button>
            )}
            {q.claimed && <span className="tw-quest-locked" aria-label="Already claimed today">✓</span>}
          </div>
        );
      })}
    </div>
  );
}
