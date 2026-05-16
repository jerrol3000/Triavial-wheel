import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { pushToast, setModal } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import Avatar from "./Avatar";
import { EmptyFriendsIcon, GiftIcon } from "./SvgIcons";

// Friends list + add-by-username + pending requests. Rendered on Profile and
// inside the Online lobby.
export default function FriendsPanel({ compact = false }) {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    api.get("/friends").then((r) => setFriends(r.data || [])).catch(() => {});
    api.get("/friends/pending").then((r) => setPending(r.data || [])).catch(() => {});
  }, [user]);
  useEffect(() => {
    // Don't start polling at all when signed out; otherwise the 20s
    // tick keeps hitting /friends with no token after logout and gets
    // a 401 → triggers the auth-expired cascade.
    if (!user) return;
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load, user]);

  const add = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post("/friends/add", { username: username.trim() });
      if (data.status === "accepted") {
        dispatch(pushToast({ icon: "🤝", title: `${username} added`, text: "They had already sent you a request" }));
      } else {
        dispatch(pushToast({ icon: "✉️", title: "Request sent", text: `Waiting for ${username} to accept` }));
      }
      setUsername("");
      load();
    } catch (err) {
      const e2 = err?.response?.data?.error || "failed";
      const niceErr =
        e2 === "user_not_found" ? "No user with that name" :
        e2 === "already_friends" ? "Already friends" :
        e2 === "request_already_sent" ? "Request already sent" :
        e2 === "cant_add_self" ? "That's you :)" :
        e2;
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't add", text: niceErr }));
    }
    setBusy(false);
  };

  const accept = async (id) => {
    try { await api.post("/friends/accept", { user_id: id }); dispatch(pushToast({ icon: "🤝", title: "Friend added" })); load(); }
    catch (e) { dispatch(pushToast({ icon: "⚠️", title: "Failed" })); }
  };
  const reject = async (id) => {
    try { await api.post("/friends/reject", { user_id: id }); load(); }
    catch (e) {}
  };
  const remove = async (id) => {
    if (!confirm("Remove this friend?")) return;
    try { await api.delete(`/friends/${id}`); load(); }
    catch (e) { dispatch(pushToast({ icon: "⚠️", title: "Failed" })); }
  };

  if (!user) {
    return (
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16, marginBottom: 6 }}>👥 Friends</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 8 }}>Sign in to add friends.</div>
        <button className="tw-btn block" onClick={() => dispatch(setModal("auth"))}>Sign in</button>
      </div>
    );
  }

  return (
    <div className="tw-card">
      <div className="tw-row" style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>👥 Friends</div>
        <div style={{ flex: 1 }} />
        {pending.length > 0 && <span className="tw-pill" style={{ background: "rgba(245,158,11,0.3)", color: "#fff", border: "none" }}>{pending.length} request{pending.length === 1 ? "" : "s"}</span>}
      </div>

      <form className="tw-row" onSubmit={add} style={{ marginBottom: 10 }}>
        <input className="tw-input" placeholder="Add by username" value={username}
               onChange={(e) => setUsername(e.target.value)} maxLength={20} />
        <button type="submit" className="tw-btn" disabled={busy || !username.trim()}>Add</button>
      </form>

      {pending.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Pending requests</div>
          {pending.map((p) => (
            <div key={p.id} className="tw-row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span>@{p.username}</span>
              <div className="tw-row">
                <button className="tw-btn sm" onClick={() => accept(p.id)}>Accept</button>
                <button className="tw-btn ghost sm" onClick={() => reject(p.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {friends.length === 0 ? (
        <div style={{ textAlign: "center", padding: "16px 8px" }}>
          <EmptyFriendsIcon size={88} />
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 600, marginTop: 8 }}>No friends yet</div>
          <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 4 }}>Add someone by their username above to challenge them.</div>
        </div>
      ) : (
        friends.slice(0, compact ? 5 : 50).map((f) => (
          <div key={f.id} className="tw-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap", gap: 6 }}>
            <div className="tw-row" style={{ gap: 8, minWidth: 0 }}>
              <Avatar value={f.avatar} size={28} ring={f.online_now} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{f.username}</span>
              <span className={`tw-online-dot ${f.online_now ? "on" : ""}`} title={f.online_now ? "Online now" : "Offline"} />
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>L{f.level} · ⭐ {f.online_rating}</span>
            </div>
            <div className="tw-row" style={{ gap: 4 }}>
              <GiftButton friend={f} />
              <button className="tw-btn ghost sm" title="Remove friend" onClick={() => remove(f.id)}>×</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Gift button — sends a small amount of coins or free spins to a
// friend. Daily caps enforced server-side: 200 coins / 5 spins per
// friend per UTC day. Each click prompts for the kind + amount inline.
function GiftButton({ friend }) {
  const dispatch = useDispatch();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const send = async (kind, amount) => {
    setBusy(true);
    try {
      await api.post("/friends/gift", { to: friend.id, kind, amount });
      dispatch(pushToast({ icon: "🎁", title: `Sent ${amount} ${kind === "free_spins" ? "spins" : "coins"} to @${friend.username}` }));
      dispatch(fetchStats());
      setOpen(false);
    } catch (e) {
      const err = e?.response?.data;
      if (err?.error === "daily_cap") {
        dispatch(pushToast({ icon: "⚠️", title: "Daily cap reached", text: `You've already sent ${err.sent_today} ${kind === "free_spins" ? "spins" : "coins"} to @${friend.username} today.` }));
      } else if (err?.error === "insufficient_coins" || err?.error === "insufficient_spins") {
        dispatch(pushToast({ icon: "⚠️", title: "Not enough to gift", text: "Top up first." }));
      } else {
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't send gift" }));
      }
    }
    setBusy(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <button className="tw-btn ghost sm" title="Send a gift" onClick={() => setOpen((v) => !v)} disabled={busy}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "4px 8px" }}>
        <GiftIcon size={18} />
      </button>
      {open && (
        <div className="tw-gift-menu">
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>Gift to @{friend.username}</div>
          <button onClick={() => send("coins", 50)}>🪙 50 coins</button>
          <button onClick={() => send("coins", 100)}>🪙 100 coins</button>
          <button onClick={() => send("coins", 200)}>🪙 200 coins (cap)</button>
          <div style={{ height: 4 }} />
          <button onClick={() => send("free_spins", 1)}>🎡 1 spin</button>
          <button onClick={() => send("free_spins", 3)}>🎡 3 spins</button>
          <button onClick={() => send("free_spins", 5)}>🎡 5 spins (cap)</button>
        </div>
      )}
    </div>
  );
}
