import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { pushToast, setModal, setView } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import { rt } from "../realtime/client";
import { sfx } from "../utils/sound";
import OtherAvatar from "./OtherAvatar";
import Icon from "./Icon";
import { EmptyFriendsIcon, GiftIcon } from "./SvgIcons";
import MenuPopover from "./MenuPopover";

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
              <OtherAvatar value={f.avatar} cosmetics={f.public_cosmetics} size={28} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{f.username}</span>
              <span className={`tw-online-dot ${f.online_now ? "on" : ""}`} title={f.online_now ? "Online now" : "Offline"} />
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>L{f.level} · ⭐ {f.online_rating}</span>
            </div>
            <div className="tw-row" style={{ gap: 4 }}>
              <PlayInviteButton friend={f} />
              <GiftButton friend={f} />
              <button className="tw-btn ghost sm" title="Remove friend" onClick={() => remove(f.id)}>×</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Direct invite-to-play. Picks a difficulty inline, then fires the
// WS `play_invite` which (a) creates a private room with us as host,
// (b) sends a live notification to the friend with an Accept button.
// We navigate to the Online view immediately so the lobby/code page
// shows up — the friend slot is empty until they accept.
function PlayInviteButton({ friend }) {
  const dispatch = useDispatch();
  const send = (difficulty) => {
    sfx.click();
    try { rt.connect(); } catch (e) {}
    // Catch server-side rejections (friend already in a match, not
    // actually friends, etc.) for a few seconds after sending so we
    // can surface a clear toast instead of silent failure.
    const off = rt.on((msg) => {
      if (!msg || msg.type !== "error") return;
      const err = msg.error;
      const niceErr =
        err === "friend_in_match" ? `@${friend.username} is already in a match.` :
        err === "already_in_match" ? "Leave your current match first." :
        err === "not_friends" ? `You're not friends with @${friend.username} anymore.` :
        err === "invalid_friend" ? "Invalid friend." :
        err === "friend_not_found" ? "Couldn't find that friend." :
        null;
      if (niceErr) {
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't invite", text: niceErr, duration: 4000 }));
      }
    });
    setTimeout(off, 3000);
    try { rt.send({ type: "play_invite", friendId: friend.id, difficulty }); } catch (e) {}
    dispatch(pushToast({
      icon: "🎮",
      title: `Invite sent to @${friend.username}`,
      text: friend.online_now ? "They'll see it instantly." : "They'll see it next time they sign in.",
      duration: 3500,
    }));
    dispatch(setView("online"));
  };
  return (
    <MenuPopover
      label={`Invite @${friend.username}`}
      trigger={
        <button
          className="tw-btn ghost sm"
          title={`Invite @${friend.username} to play`}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "4px 8px", gap: 4 }}
        >🎮 Play</button>
      }
    >
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, fontWeight: 600 }}>
        Invite @{friend.username}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="tw-btn block" onClick={() => send("easy")} style={{ justifyContent: "flex-start" }}>🟢 Easy</button>
        <button className="tw-btn block" onClick={() => send("medium")} style={{ justifyContent: "flex-start" }}>🟡 Medium</button>
        <button className="tw-btn block" onClick={() => send("hard")} style={{ justifyContent: "flex-start" }}>🔴 Hard</button>
      </div>
    </MenuPopover>
  );
}

// Gift button — sends a small amount of coins or free spins to a
// friend. Daily caps enforced server-side: 200 coins / 5 spins per
// friend per UTC day. Each click prompts for the kind + amount inline.
function GiftButton({ friend }) {
  const dispatch = useDispatch();
  const [busy, setBusy] = React.useState(false);

  const send = async (kind, amount) => {
    setBusy(true);
    try {
      await api.post("/friends/gift", { to: friend.id, kind, amount });
      dispatch(pushToast({ icon: "🎁", title: `Sent ${amount} ${kind === "free_spins" ? "spins" : "coins"} to @${friend.username}` }));
      dispatch(fetchStats());
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
    <MenuPopover
      label={`Gift to @${friend.username}`}
      trigger={
        <button
          className="tw-btn ghost sm"
          title="Send a gift"
          disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "4px 8px" }}
        ><GiftIcon size={18} /></button>
      }
    >
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, fontWeight: 600 }}>
        Gift to @{friend.username}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="tw-btn block" onClick={() => send("coins", 50)} style={{ justifyContent: "flex-start" }}>🪙 50 coins</button>
        <button className="tw-btn block" onClick={() => send("coins", 100)} style={{ justifyContent: "flex-start" }}>🪙 100 coins</button>
        <button className="tw-btn block" onClick={() => send("coins", 200)} style={{ justifyContent: "flex-start" }}>🪙 200 coins (cap)</button>
        <div style={{ height: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }} />
        <button className="tw-btn block" onClick={() => send("free_spins", 1)} style={{ justifyContent: "flex-start", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="free_spin" size={18} /> 1 spin
        </button>
        <button className="tw-btn block" onClick={() => send("free_spins", 3)} style={{ justifyContent: "flex-start", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="free_spin" size={18} /> 3 spins
        </button>
        <button className="tw-btn block" onClick={() => send("free_spins", 5)} style={{ justifyContent: "flex-start", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="free_spin" size={18} /> 5 spins (cap)
        </button>
      </div>
    </MenuPopover>
  );
}
