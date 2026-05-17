import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { fetchStats } from "../store/statsSlice";
import { pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import Icon from "./Icon";

// One quest card with a Daily | Weekly tab toggle so both ladders live
// in the same screen real estate — players can see both exist without
// scrolling. Replaces the old QuestsPanel + WeeklyQuestsPanel stack on
// Home. Each tab shows its own ready-count chip so the player can spot
// claimable rewards on the inactive tab at a glance.
export default function QuestsHub() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [tab, setTab] = useState("daily");
  const [daily, setDaily] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [week, setWeek] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled([
      api.get("/stats/quests"),
      api.get("/stats/weekly-quests"),
    ]).then(([d, w]) => {
      if (d.status === "fulfilled") setDaily(d.value.data.quests || []);
      if (w.status === "fulfilled") {
        setWeekly(w.value.data.quests || []);
        setWeek(w.value.data.week || null);
      }
    }).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!user) {
    return (
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📋 Quests</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Sign in to unlock daily & weekly quests for extra rewards.</div>
      </div>
    );
  }

  if (loading) return null;
  if (!daily.length && !weekly.length) return null;

  const dailyReady = daily.filter((q) => (q.progress || 0) >= q.target && !q.claimed).length;
  const weeklyReady = weekly.filter((q) => (q.progress || 0) >= q.target && !q.claimed).length;

  const active = tab === "daily" ? daily : weekly;
  const isWeekly = tab === "weekly";

  const claim = async (id) => {
    sfx.coin();
    const url = isWeekly ? "/stats/weekly-quests/claim" : "/stats/quests/claim";
    try {
      const { data } = await api.post(url, { id });
      const r = data.reward || {};
      const parts = [];
      if (r.coins) parts.push(`+${r.coins} coins`);
      if (r.free_spins) parts.push(`+${r.free_spins} free spins`);
      dispatch(pushToast({
        icon: isWeekly ? "🏆" : "🎁",
        title: isWeekly ? "Weekly reward!" : "Quest reward!",
        text: parts.join(" · "),
      }));
      dispatch(fetchStats());
      load();
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't claim", text: e?.response?.data?.error || "" }));
    }
  };

  const completedCount = active.filter((q) => (q.progress || 0) >= q.target).length;
  const tabBtn = (id, label, readyCount) => (
    <button
      type="button"
      className="tw-pill"
      onClick={() => setTab(id)}
      style={{
        cursor: "pointer",
        flex: 1,
        background: tab === id ? "linear-gradient(135deg, var(--primary), var(--primary-2))" : undefined,
        border: tab === id ? "none" : undefined,
        color: "#fff",
        position: "relative",
        fontWeight: tab === id ? 700 : 500,
      }}
    >
      {label}
      {readyCount > 0 && (
        <span
          aria-label={`${readyCount} ready to claim`}
          style={{
            marginLeft: 6,
            background: "var(--good, #22c55e)",
            color: "#0a0a0a",
            borderRadius: 999,
            padding: "1px 7px",
            fontSize: 11,
            fontWeight: 700,
            verticalAlign: "middle",
          }}
        >{readyCount}</span>
      )}
    </button>
  );

  return (
    <div className={`tw-card ${isWeekly ? "tw-quests-weekly" : ""}`}>
      <div className="tw-row" style={{ marginBottom: 10, gap: 8 }}>
        {isWeekly
          ? <span style={{ fontSize: 22 }}>🏆</span>
          : <Icon name="daily_quest" size={26} />}
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>
          {isWeekly ? "Weekly Quests" : "Daily Quests"}
        </div>
        <div style={{ flex: 1 }} />
        <span
          className="tw-pill"
          title={isWeekly ? `Resets Monday 00:00 UTC · ${week || ""}` : "Resets at midnight UTC"}
        >
          {completedCount}/{active.length} done
        </span>
      </div>

      <div className="tw-row" style={{ marginBottom: 12, gap: 6 }}>
        {tabBtn("daily", "Daily", dailyReady)}
        {tabBtn("weekly", "Weekly", weeklyReady)}
      </div>

      {active.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "8px 4px" }}>
          {isWeekly ? "No weekly quests this week." : "No daily quests today."}
        </div>
      ) : active.map((q) => {
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
                  ? <span className="tw-quest-done">✓ Done — back {isWeekly ? "next week" : "tomorrow"}</span>
                  : (
                    // Build the reward inline so we can render the
                    // actual coin + wheel icons instead of plain
                    // emoji glyphs. Joined with a centered "+" only
                    // when both kinds are present.
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>Reward:</span>
                      {q.reward?.coins ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          {q.reward.coins} <Icon name="coins" size={14} />
                        </span>
                      ) : null}
                      {q.reward?.coins && q.reward?.free_spins ? <span>+</span> : null}
                      {q.reward?.free_spins ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          {q.reward.free_spins} <Icon name="free_spin" size={14} />
                        </span>
                      ) : null}
                    </span>
                  )
                }
              </div>
            </div>
            {complete && !q.claimed && (
              <button className="tw-btn tw-quest-claim" onClick={() => claim(q.id)} title="Claim your reward">Claim</button>
            )}
            {q.claimed && <span className="tw-quest-locked" aria-label="Already claimed">✓</span>}
          </div>
        );
      })}
    </div>
  );
}
