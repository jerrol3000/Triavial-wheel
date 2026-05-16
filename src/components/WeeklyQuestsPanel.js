import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { fetchStats } from "../store/statsSlice";
import { pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";

// Weekly quest sibling of QuestsPanel. Same visual treatment + claim
// flow, but its own endpoint and a different colored chip so players
// can tell the two ladders apart at a glance. Resets every Monday UTC
// (server-side) — client just reads + renders.
export default function WeeklyQuestsPanel() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [quests, setQuests] = useState([]);
  const [week, setWeek] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) { setLoading(false); return; }
    api.get("/stats/weekly-quests")
      .then((r) => { setQuests(r.data.quests || []); setWeek(r.data.week || null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!user) return null; // QuestsPanel above already prompts signed-out users
  if (loading) return null;
  if (!quests.length) return null;

  const claim = async (id) => {
    sfx.coin();
    try {
      const { data } = await api.post("/stats/weekly-quests/claim", { id });
      const r = data.reward || {};
      const parts = [];
      if (r.coins) parts.push(`+${r.coins} coins`);
      if (r.free_spins) parts.push(`+${r.free_spins} free spins`);
      dispatch(pushToast({ icon: "🏆", title: "Weekly reward!", text: parts.join(" · ") }));
      dispatch(fetchStats());
      load();
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't claim", text: e?.response?.data?.error || "" }));
    }
  };

  const completedCount = quests.filter((q) => (q.progress || 0) >= q.target).length;

  return (
    <div className="tw-card tw-quests-weekly">
      <div className="tw-row" style={{ marginBottom: 10, gap: 8 }}>
        <span style={{ fontSize: 22 }}>🏆</span>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>Weekly Quests</div>
        <div style={{ flex: 1 }} />
        <span className="tw-pill" title={`Resets Monday 00:00 UTC · ${week || ""}`}>{completedCount}/{quests.length} done</span>
      </div>
      {quests.map((q) => {
        const progress = Math.min(q.target, q.progress || 0);
        const complete = progress >= q.target;
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
                  ? <span className="tw-quest-done">✓ Done — back next week</span>
                  : <>Reward: {[q.reward?.coins ? `${q.reward.coins} 🪙` : null, q.reward?.free_spins ? `${q.reward.free_spins} 🎡` : null].filter(Boolean).join(" + ")}</>
                }
              </div>
            </div>
            {complete && !q.claimed && (
              <button className="tw-btn tw-quest-claim" onClick={() => claim(q.id)} title="Claim your reward">Claim</button>
            )}
            {q.claimed && <span className="tw-quest-locked" aria-label="Already claimed this week">✓</span>}
          </div>
        );
      })}
    </div>
  );
}
