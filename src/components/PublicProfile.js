import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { closeModal, pushToast } from "../store/uiSlice";
import OtherAvatar from "./OtherAvatar";
import { BadgeCase, PlayerFlair } from "./PlayerFlair";
import { rt } from "../realtime/client";

// Lightweight public profile preview. Opened when a player taps
// another player anywhere they're shown (leaderboard rows, VS score
// cards, online lobby slots). Strict privacy contract: this view ONLY
// surfaces things the player has earned or bought —
//   - Avatar + equipped frame
//   - Level + PRO chip
//   - Equipped title
//   - Showcase badges
//   - Achievement count
//   - Lifetime stats (games, win rate, online rating, best streak)
// NEVER renders: email, country, language, friends, settings,
// payment status, raw timestamps. The owner can hide everything but
// {username, level, pro} via Profile → Privacy → "Show showcase to
// other players".

export default function PublicProfile({ userId }) {
  const dispatch = useDispatch();
  const me = useSelector((s) => s.auth.user);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`/stats/profile/${userId}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.error || "failed"))
      .finally(() => setLoading(false));
  }, [userId]);

  const isMe = me && data && me.id === data.id;

  const invitePlay = () => {
    if (!data || !data.id) return;
    try { rt.connect(); } catch (e) {}
    try { rt.send({ type: "play_invite", friendId: data.id, difficulty: "medium" }); } catch (e) {}
    dispatch(pushToast({
      icon: "🎮",
      title: `Invite sent to ${data.username}`,
      text: "Medium difficulty · they'll see it instantly if online.",
      duration: 3500,
    }));
    dispatch(closeModal());
  };

  const sendFriendRequest = async () => {
    if (!data) return;
    try {
      const { data: r } = await api.post("/friends/add", { username: data.username });
      dispatch(pushToast({
        icon: r.status === "accepted" ? "🤝" : "✉️",
        title: r.status === "accepted" ? `${data.username} added` : "Friend request sent",
        text: r.status === "accepted" ? "You're now friends" : `Waiting for ${data.username} to accept`,
      }));
    } catch (e) {
      const err = e?.response?.data?.error || "failed";
      const nice = err === "already_friends" ? "Already friends" :
                   err === "request_already_sent" ? "Request already sent" :
                   err === "user_not_found" ? "Player not found" :
                   "Couldn't send request";
      dispatch(pushToast({ icon: "⚠️", title: nice }));
    }
  };

  return (
    <div className="tw-modal-backdrop" onClick={() => dispatch(closeModal())}>
      <div className="tw-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, padding: 0, overflow: "hidden" }}>
        {/* Header banner — gradient stripe sets the "trophy case" tone */}
        <div style={{
          padding: "20px 20px 14px",
          background: "linear-gradient(135deg, rgba(124,58,237,0.45), rgba(236,72,153,0.35))",
          textAlign: "center",
        }}>
          {loading ? (
            <div className="tw-spinner" />
          ) : error ? (
            <div style={{ color: "var(--bad)" }}>Couldn't load profile.</div>
          ) : data ? (
            <>
              <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                {/* PRO ring overlays the frame on subscribers, otherwise
                    the standard frame applies. */}
                <span style={{
                  display: "inline-flex", padding: data.pro ? 3 : 0, borderRadius: "50%",
                  background: data.pro ? "linear-gradient(135deg, #fbbf24, #f59e0b, #b45309)" : "transparent",
                  boxShadow: data.pro ? "0 0 14px rgba(245,158,11,0.6)" : "none",
                }}>
                  <OtherAvatar value={data.avatar} cosmetics={data.public_cosmetics} size={72} />
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <strong style={{ fontFamily: "Fredoka", fontSize: 22 }}>{data.username}</strong>
                  {data.pro && <ProBadge />}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,0.85)", flexWrap: "wrap", justifyContent: "center" }}>
                  <span>⭐ Level {data.level}</span>
                  {/* PlayerFlair with empty username renders just the
                      premium chip (emblem + title text) so this
                      header reads the same as how others see this
                      player on the leaderboard / scoreboard. */}
                  {data.public_cosmetics && data.public_cosmetics.title && (
                    <PlayerFlair username="" cosmetics={data.public_cosmetics} badges={[]} />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Body — showcase badges + lifetime stats. Stripped if the
            player opted out of public showcase. */}
        <div style={{ padding: 18 }}>
          {data && data.showcase_hidden ? (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "24px 8px" }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>🔒</div>
              <div style={{ fontWeight: 600 }}>This player keeps their showcase private.</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                Only their name, level, and PRO status are visible.
              </div>
            </div>
          ) : data ? (
            <>
              {data.badges && data.badges.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>🏅 Showcase</SectionLabel>
                  <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                    <BadgeCase badges={data.badges} size="lg" />
                  </div>
                </div>
              )}

              {data.stats && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>📊 Lifetime</SectionLabel>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginTop: 6,
                  }}>
                    <StatTile label="Games" value={data.stats.games_played || 0} />
                    <StatTile label="Best streak" value={data.stats.best_streak || 0} />
                    <StatTile label="Online wins" value={data.stats.online_wins || 0} />
                    <StatTile label="VS rating" value={data.stats.online_rating || 1000} highlight />
                  </div>
                  {(data.stats.online_wins + data.stats.online_losses) > 0 && (
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
                      Win rate {Math.round((data.stats.online_wins / (data.stats.online_wins + data.stats.online_losses)) * 100)}%
                      · {data.stats.online_wins}W / {data.stats.online_losses}L
                    </div>
                  )}
                </div>
              )}

              {typeof data.achievements_count === "number" && (
                <div style={{ marginBottom: 16, textAlign: "center" }}>
                  <SectionLabel>🏆 Achievements</SectionLabel>
                  <div style={{ fontFamily: "Fredoka", fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {data.achievements_count}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>unlocked</div>
                </div>
              )}
            </>
          ) : null}

          {/* Action row — only when viewing someone else and we have data. */}
          {data && !isMe && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button className="tw-btn block" onClick={invitePlay}>🎮 Invite to play</button>
              <button className="tw-btn ghost block" onClick={sendFriendRequest}>👥 Add friend</button>
            </div>
          )}
          <button className="tw-btn ghost block" onClick={() => dispatch(closeModal())} style={{ marginTop: 8 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: "var(--text-dim)",
      fontWeight: 700,
      marginBottom: 4,
      textAlign: "center",
    }}>{children}</div>
  );
}

function StatTile({ label, value, highlight }) {
  return (
    <div style={{
      background: highlight ? "rgba(124,58,237,0.20)" : "rgba(255,255,255,0.04)",
      border: highlight ? "1px solid rgba(124,58,237,0.40)" : "1px solid rgba(255,255,255,0.08)",
      borderRadius: 10,
      padding: 10,
      textAlign: "center",
    }}>
      <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function ProBadge({ small = false }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: small ? "1px 6px" : "2px 8px",
      background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
      color: "#1a0d00",
      fontSize: small ? 10 : 11,
      fontWeight: 800,
      letterSpacing: 0.5,
      borderRadius: 4,
      boxShadow: "0 0 8px rgba(245,158,11,0.5)",
      textTransform: "uppercase",
    }}>PRO</span>
  );
}
