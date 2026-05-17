import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { setModal } from "../store/uiSlice";
import { useT } from "../i18n";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { PlayerFlair } from "./PlayerFlair";
import { ProBadge } from "./PublicProfile";

// Polls the global leaderboard every POLL_MS and animates row position
// changes via CSS transforms. Each row keeps a stable DOM node (keyed by
// username), so when the sorted order shifts, React rewrites the inline
// `translateY(...)` and the CSS transition slides the same node to its new
// slot. New high scores flash green and pulse briefly.
const POLL_MS = 7000;
const ROW_H = 40;

export default function LiveLeaderboard({ limit = 8, compact = false }) {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const { t } = useT();
  const openProfile = (uid) => {
    if (!uid) return;
    dispatch(setModal({ name: "publicProfile", data: { userId: uid } }));
  };
  const [rows, setRows] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [tick, setTick] = useState(0);
  const [flashing, setFlashing] = useState(new Map()); // username → "up"|"new"
  const prevScores = useRef(new Map());
  const prevRanks = useRef(new Map());

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch((process.env.API_BASE_URL || "/api") + "/stats/leaderboard");
      const data = await r.json();
      const slice = (Array.isArray(data) ? data : []).slice(0, limit);

      // Diff against previous snapshot to compute flashes.
      const next = new Map();
      slice.forEach((row, i) => {
        const prevScore = prevScores.current.get(row.username);
        const prevRank = prevRanks.current.get(row.username);
        if (prevScore === undefined) next.set(row.username, "new");
        else if (row.high_score > prevScore) next.set(row.username, "up");
        else if (prevRank !== undefined && i < prevRank) next.set(row.username, "up");
        else if (prevRank !== undefined && i > prevRank) next.set(row.username, "down");
      });

      slice.forEach((r, i) => {
        prevScores.current.set(r.username, r.high_score);
        prevRanks.current.set(r.username, i);
      });

      setRows(slice);
      if (next.size) {
        setFlashing(next);
        setTimeout(() => setFlashing(new Map()), 900);
      }
      setTick((t) => t + 1);
    } catch (e) {
      // silent — leaderboard is best-effort
    }
    if (user) {
      try {
        const r = await api.get("/stats/my-rank");
        setMyRank(r.data);
      } catch (e) { /* ignore */ }
    } else {
      setMyRank(null);
    }
  }, [limit, user]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const totalHeight = rows.length * ROW_H;
  const youInTop = user && rows.some((r) => r.username === user.username);

  return (
    <div className={`tw-livelb ${compact ? "compact" : ""}`}>
      <div className="tw-livelb-header">
        <span className="tw-livelb-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="leaderboard" size={22} />
          {t("home.leaderboard.title").replace("🌍 ", "")}
        </span>
        <div className="tw-row" style={{ gap: 6 }}>
          <span className="tw-livelb-dot" title={`Updated every ${Math.round(POLL_MS / 1000)}s`} />
          <span style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: 1 }}>LIVE</span>
        </div>
      </div>

      {!rows.length ? (
        <div className="tw-livelb-empty">{t("home.leaderboard.empty")}</div>
      ) : (
        <div className="tw-livelb-rows" style={{ height: `${totalHeight}px` }}>
          {rows.map((r, i) => {
            const mine = user && r.username === user.username;
            const flash = flashing.get(r.username);
            const clickable = !!r.user_id;
            return (
              <div
                key={r.username}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => openProfile(r.user_id) : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(r.user_id); } } : undefined}
                className={`tw-livelb-row ${mine ? "mine" : ""} ${flash === "up" ? "flash-up" : ""} ${flash === "down" ? "flash-down" : ""} ${flash === "new" ? "flash-new" : ""}`}
                style={{ transform: `translateY(${i * ROW_H}px)`, cursor: clickable ? "pointer" : "default" }}
                title={clickable ? `View ${r.username}'s profile` : undefined}
              >
                <span className="tw-livelb-rank">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                </span>
                <span className="tw-livelb-name" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {/* Gold padding ring on PRO subscribers — visible over the
                      existing frame so even a regular frame gets the
                      PRO halo. Without a frame, this becomes the frame. */}
                  <span style={{
                    display: "inline-flex",
                    padding: r.pro ? 2 : 0,
                    borderRadius: "50%",
                    background: r.pro ? "linear-gradient(135deg, #fbbf24, #f59e0b)" : "transparent",
                    boxShadow: r.pro ? "0 0 6px rgba(245,158,11,0.6)" : "none",
                    flexShrink: 0,
                  }}>
                    <Avatar value={r.avatar} size={22} />
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <PlayerFlair username={r.username} cosmetics={r.public_cosmetics} badges={r.badges} compact />
                    {r.pro && <ProBadge small />}
                    {mine && <span className="tw-livelb-you"> · {t("common.you").toLowerCase()}</span>}
                  </span>
                </span>
                <span className="tw-livelb-level">L{r.level}</span>
                <span className="tw-livelb-score">{r.high_score.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}

      {myRank && user && !youInTop && myRank.rank && (
        <>
          <div className="tw-livelb-divider"><span>···</span></div>
          <div className="tw-livelb-row mine pinned">
            <span className="tw-livelb-rank">{myRank.rank}</span>
            <span className="tw-livelb-name">
              {user.username}
              <span className="tw-livelb-you"> · {t("common.you").toLowerCase()}</span>
            </span>
            <span className="tw-livelb-level">L{myRank.level || 1}</span>
            <span className="tw-livelb-score">{(myRank.high_score || 0).toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
}
