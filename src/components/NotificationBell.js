import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { setView, setProfileTab, pushToast } from "../store/uiSlice";
import { rt } from "../realtime/client";
import { sfx } from "../utils/sound";

// Polls /api/notifications every POLL_MS as a backstop, but live
// pushes come over the WebSocket (`notification` event) so the bell
// updates instantly when an interaction lands. The poll just fills
// in anything the user missed while offline.
const POLL_MS = 30 * 1000;
const RECENT_THRESHOLD_MS = 5 * 60 * 1000; // last 5 min ⇒ "just now"
// Solid panel background so the page beneath doesn't bleed through.
// Was `var(--card)` (rgba 6% opacity) before — user reported it was
// too transparent to read.
const PANEL_BG = "#1a1530";
const PANEL_BORDER = "rgba(124,58,237,0.45)";

function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < RECENT_THRESHOLD_MS) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationBell() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [wsLive, setWsLive] = useState(false);
  // Brief shake when a live notification arrives — even a user not
  // looking at the bell catches it from peripheral vision.
  const [shaking, setShaking] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);
  const shakeTimerRef = useRef(null);
  // Mirror `open` into a ref so the WS listener (registered once) can
  // read the current value without re-subscribing on every toggle.
  const openRef = useRef(false);
  openRef.current = open;

  const load = useCallback(async () => {
    if (!user) { setItems([]); setUnread(0); return; }
    try {
      const { data } = await api.get("/notifications");
      setItems(data.notifications || []);
      setUnread(data.unread_count || 0);
    } catch (e) { /* silent — notifications are best-effort */ }
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, user]);

  // Live WebSocket subscription. The server emits `notification` over
  // the shared socket on every interaction (gifts, friend requests,
  // play invites). De-dupes by id so live + poll arrivals only render
  // once. Also tracks open/close events so the panel can show a
  // "live"/"offline" indicator — a stale socket is the most common
  // reason notifications "don't arrive."
  useEffect(() => {
    if (!user) return;
    // Defensive connect — App.js opens the socket on login but this
    // handles edge cases (NotificationBell mounts before App effect
    // fires, page restored from bfcache, etc.).
    try { rt.connect(); } catch (e) {}
    const off = rt.on((msg) => {
      if (!msg) return;
      if (msg.type === "open") { setWsLive(true); return; }
      if (msg.type === "close") { setWsLive(false); return; }
      if (msg.type !== "notification" || !msg.notification) return;
      const n = msg.notification;
      console.info("[notif] received via WS:", n.type, n.title);
      setItems((prev) => {
        if (prev.some((it) => it.id === n.id)) return prev;
        return [{ ...n, unread: true }, ...prev].slice(0, 30);
      });
      if (!openRef.current) setUnread((u) => u + 1);
      try { sfx.coin(); } catch (e) {}
      // Trigger bell shake animation. Cancel any in-flight shake so
      // back-to-back arrivals don't blend into a long jitter.
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      setShaking(true);
      shakeTimerRef.current = setTimeout(() => setShaking(false), 900);
      dispatch(pushToast({
        icon: n.icon || "🔔",
        title: n.title || "New notification",
        text: n.text || "",
        duration: 4500,
      }));
    });
    return () => {
      off();
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    };
  }, [user, dispatch]);

  // Close the panel when clicking outside it (excluding the bell itself).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((it) => ({ ...it, unread: false })));
      try { await api.post("/notifications/read"); } catch (e) {}
    }
  };

  // play_invite has its own accept/decline buttons inline; clicking
  // the row itself for any other type deep-links to Profile → Friends.
  const handleClick = (n) => {
    if (n.actionType === "join_invite") return; // handled by inline buttons
    setOpen(false);
    if (n.actionType === "view_friends") {
      dispatch(setProfileTab("friends"));
      dispatch(setView("profile"));
    }
  };

  const acceptInvite = (n) => {
    setOpen(false);
    if (!n.roomCode) return;
    try { rt.connect(); } catch (e) {}
    try { rt.send({ type: "join_room", code: String(n.roomCode).toUpperCase() }); } catch (e) {}
    dispatch(setView("online"));
    // Remove this invite from the visible list so it doesn't linger.
    setItems((prev) => prev.filter((it) => it.id !== n.id));
  };

  const declineInvite = (n) => {
    // Just dismiss locally; the room stays open on the server until
    // the inviter leaves. (We don't have a "decline_invite" message —
    // not worth a server round-trip for a passive ignore.)
    setItems((prev) => prev.filter((it) => it.id !== n.id));
  };

  if (!user) return null;

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <style>{`
        @keyframes tw-bell-shake {
          0%,100% { transform: rotate(0); }
          15% { transform: rotate(-18deg); }
          30% { transform: rotate(14deg); }
          45% { transform: rotate(-10deg); }
          60% { transform: rotate(6deg); }
          75% { transform: rotate(-3deg); }
        }
      `}</style>
      <button
        ref={btnRef}
        type="button"
        className="tw-pill"
        onClick={toggleOpen}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications"
        style={{ cursor: "pointer", padding: "4px 10px", position: "relative", fontSize: 16 }}
      >
        <span style={{
          display: "inline-block",
          transformOrigin: "50% 10%",
          animation: shaking ? "tw-bell-shake 0.9s ease" : "none",
        }}>🔔</span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -4, right: -4,
              minWidth: 18, height: 18, padding: "0 5px",
              borderRadius: 9,
              background: "#ef4444",
              color: "#fff",
              fontSize: 11, fontWeight: 700, lineHeight: "18px",
              textAlign: "center",
              border: "2px solid #1a1530",
              boxSizing: "content-box",
            }}
          >{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 340,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: 480,
            overflowY: "auto",
            zIndex: 100,
            padding: 0,
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 14,
            boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          }}
          role="dialog"
          aria-label="Notifications"
        >
          <div style={{
            padding: "12px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            display: "flex", alignItems: "center", gap: 8,
            position: "sticky", top: 0,
            background: PANEL_BG,
          }}>
            <strong style={{ fontFamily: "Fredoka", fontSize: 16 }}>Notifications</strong>
            <span
              title={wsLive ? "Live — instant updates" : "Reconnecting…"}
              style={{
                width: 8, height: 8, borderRadius: 4,
                background: wsLive ? "#22c55e" : "#f59e0b",
                boxShadow: wsLive ? "0 0 6px #22c55e" : "none",
              }}
            />
            <span style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: 0.5 }}>
              {wsLive ? "LIVE" : "OFFLINE"}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent", border: "none",
                color: "var(--text-dim)", cursor: "pointer", fontSize: 18, padding: 4,
              }}
            >×</button>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>🔕</div>
              You're all caught up.
              <div style={{ marginTop: 6, fontSize: 12 }}>
                We'll let you know when a friend sends a gift or wants to play.
              </div>
            </div>
          ) : items.map((n) => {
            const isInvite = n.actionType === "join_invite";
            return (
              <div
                key={n.id}
                role={isInvite ? undefined : "button"}
                tabIndex={isInvite ? undefined : 0}
                onClick={() => handleClick(n)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  width: "100%", textAlign: "left",
                  padding: "12px 14px",
                  background: n.unread ? "rgba(124,58,237,0.18)" : "transparent",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  color: "var(--text)",
                  cursor: isInvite ? "default" : "pointer",
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{n.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: n.unread ? 700 : 500, fontSize: 13 }}>{n.title}</div>
                  {n.text && <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{n.text}</div>}
                  <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>{timeAgo(n.at)}</div>
                  {isInvite && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button
                        type="button"
                        className="tw-btn"
                        onClick={(e) => { e.stopPropagation(); acceptInvite(n); }}
                        style={{ padding: "6px 14px", fontSize: 13 }}
                      >🎮 Accept</button>
                      <button
                        type="button"
                        className="tw-btn ghost"
                        onClick={(e) => { e.stopPropagation(); declineInvite(n); }}
                        style={{ padding: "6px 14px", fontSize: 13 }}
                      >Dismiss</button>
                    </div>
                  )}
                </span>
                {n.unread && !isInvite && (
                  <span aria-hidden="true" style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: "#7c3aed",
                    marginTop: 6, flexShrink: 0,
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}
