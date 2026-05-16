import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { setView, setProfileTab, pushToast } from "../store/uiSlice";
import { rt } from "../realtime/client";
import { sfx } from "../utils/sound";

// Polls /api/notifications every POLL_MS while the user is logged in.
// Bell renders a red badge with the unread count; clicking opens a
// dropdown panel listing every notification, marks them as read, and
// each item is clickable to navigate to the right context (e.g.,
// Profile → Friends for friend requests + gifts).
const POLL_MS = 30 * 1000;
const RECENT_THRESHOLD_MS = 5 * 60 * 1000; // last 5 min ⇒ "just now"

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
  const panelRef = useRef(null);
  const btnRef = useRef(null);

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

  // Live push subscription. The server emits `notification` over the
  // shared WebSocket whenever an interaction lands (gift sent, friend
  // request opened, friend accepted). We prepend it to the visible
  // list, bump the unread badge, fire a coin chime + transient toast
  // so the user notices even if they're not staring at the bell.
  // De-dupes by id so a notification that arrives both live AND on
  // the next poll only renders once.
  useEffect(() => {
    if (!user) return;
    // Ensure the socket is actually open. App.js calls connect() on
    // login, but if NotificationBell mounts before App's effect fires
    // (or after a remount) we belt-and-suspender it here.
    try { rt.connect(); } catch (e) {}
    const off = rt.on((msg) => {
      if (!msg || msg.type !== "notification" || !msg.notification) return;
      const n = msg.notification;
      // Console hint so a "notifications not arriving" report can be
      // verified in DevTools — if you SEE this line the WS delivered;
      // if you don't, the WS side is broken (server not deployed, no
      // socket open, etc.).
      console.info("[notif] received via WS:", n.type, n.title);
      setItems((prev) => {
        if (prev.some((it) => it.id === n.id)) return prev;
        return [{ ...n, unread: true }, ...prev].slice(0, 30);
      });
      // Only bump unread if the panel isn't already open (open = read).
      setUnread((u) => (open ? u : u + 1));
      try { sfx.coin(); } catch (e) {}
      dispatch(pushToast({
        icon: n.icon || "🔔",
        title: n.title || "New notification",
        text: n.text || "",
        duration: 4000,
      }));
    });
    return off;
  }, [user, open, dispatch]);

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
    // Mark-as-read on OPEN. Optimistic local clear so the badge
    // disappears immediately while the network call settles.
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((it) => ({ ...it, unread: false })));
      try { await api.post("/notifications/read"); } catch (e) {}
    }
  };

  const handleClick = (n) => {
    setOpen(false);
    if (n.actionType === "view_friends") {
      dispatch(setProfileTab("friends"));
      dispatch(setView("profile"));
    }
  };

  if (!user) return null;

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={btnRef}
        type="button"
        className="tw-pill"
        onClick={toggleOpen}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications"
        style={{ cursor: "pointer", padding: "4px 10px", position: "relative", fontSize: 16 }}
      >
        🔔
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -4, right: -4,
              minWidth: 18, height: 18, padding: "0 5px",
              borderRadius: 9,
              background: "var(--bad, #ef4444)",
              color: "#fff",
              fontSize: 11, fontWeight: 700, lineHeight: "18px",
              textAlign: "center",
              border: "2px solid var(--bg, #1a1530)",
              boxSizing: "content-box",
            }}
          >{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="tw-card"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 320,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: 480,
            overflowY: "auto",
            zIndex: 100,
            padding: 0,
            boxShadow: "0 12px 36px rgba(0,0,0,0.4)",
          }}
          role="dialog"
          aria-label="Notifications"
        >
          <div style={{
            padding: "12px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex", alignItems: "center", gap: 8,
            position: "sticky", top: 0,
            background: "var(--card, #1f1838)",
            backdropFilter: "blur(12px)",
          }}>
            <strong style={{ fontFamily: "Fredoka", fontSize: 16 }}>Notifications</strong>
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
          ) : items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => handleClick(n)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                width: "100%", textAlign: "left",
                padding: "12px 14px",
                background: n.unread ? "rgba(124,58,237,0.10)" : "transparent",
                border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)",
                color: "var(--text)", cursor: "pointer",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
              onMouseLeave={(e) => e.currentTarget.style.background = n.unread ? "rgba(124,58,237,0.10)" : "transparent"}
            >
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{n.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: n.unread ? 700 : 500, fontSize: 13 }}>{n.title}</div>
                {n.text && <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{n.text}</div>}
                <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>{timeAgo(n.at)}</div>
              </span>
              {n.unread && (
                <span aria-hidden="true" style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: "var(--primary, #7c3aed)",
                  marginTop: 6, flexShrink: 0,
                }} />
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
