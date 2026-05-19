import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { rt } from "../realtime/client";
import { pushToast, setView } from "../store/uiSlice";
import { confirmDialog } from "../utils/confirm";

const PRESETS = ["GG!", "Nice try!", "Good luck!", "👋", "Tough one!", "You got this!"];
// Two emote tiers:
//   FREE — everyone gets these. Standard trash-talk vocabulary.
//   PREMIUM — Pro members + Season Pass premium holders. The "I'm
//     spending money on this game" flex set, designed to be slightly
//     more theatrical than the freebies so the difference is visible
//     to the opponent (the opponent sees the emote fly across the
//     screen too; that's the whole point).
// Server validates ownership server-side before broadcasting so a
// client can't just patch the FREE_REACTIONS array locally.
const FREE_REACTIONS    = ["👋","👏","🔥","🎉","💪","🤔"];
const PREMIUM_REACTIONS = ["😱","💯","🤡","💀","🧊","🐐","🤯","🔫","👑"];

export default function ChatPanel({ disabled = false }) {
  const dispatch = useDispatch();
  const room = useSelector((s) => s.online.room);
  const notice = useSelector((s) => s.online.chatNotice);
  const me = useSelector((s) => s.auth.user);
  // Premium gate: Pro OR Season Pass premium unlocks the spicy
  // emote pack. Each is checked independently so a player with
  // either path gets access. Future: a standalone "Emote Pack"
  // SKU could set an `emotes_unlocked` flag here too.
  const isPro = useSelector((s) => !!s.stats.pro);
  const seasonPremium = useSelector((s) => !!(s.stats.perks && s.stats.perks.season_premium));
  const hasPremiumEmotes = isPro || seasonPremium;
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room?.chat?.length]);

  useEffect(() => {
    if (!notice) return;
    if (notice.kind === "filtered") {
      dispatch(pushToast({ icon: "🤫", title: "Message blocked", text: noticeText(notice.reason), duration: 3500 }));
    } else if (notice.kind === "rate") {
      dispatch(pushToast({ icon: "🐢", title: "Slow down", text: "One message per ~2 seconds." }));
    } else if (notice.kind === "muted") {
      dispatch(pushToast({ icon: "🔇", title: "You're muted", text: `Until ${new Date(notice.until).toLocaleString()}`, duration: 5000 }));
    } else if (notice.kind === "auto_muted") {
      dispatch(pushToast({ icon: "🔇", title: "Auto-muted for 1 hour", text: "Repeated filtered messages.", duration: 5000 }));
    }
  }, [notice, dispatch]);

  const sendText = (msg) => {
    const t = (msg ?? text).trim();
    if (!t || disabled) return;
    rt.send({ type: "chat", text: t });
    setText("");
  };
  const sendReact = (emoji) => {
    if (disabled) return;
    rt.send({ type: "reaction", emoji });
  };
  const report = async (m) => {
    if (!(await confirmDialog(dispatch, {
      icon: "🛡️",
      title: "Report this message?",
      message: "A moderator will review the message and take action if it violates community rules.",
      confirmText: "Report",
      cancelText: "Cancel",
      destructive: true,
    }))) return;
    rt.send({ type: "report_message", messageId: m.id, reason: "user_reported" });
    dispatch(pushToast({ icon: "🛡️", title: "Reported", text: "Thanks — a moderator will review." }));
  };

  return (
    <div className="tw-chat">
      <div className="tw-chat-log" ref={scrollRef}>
        {!room?.chat?.length && (
          <div className="tw-chat-empty">Be friendly! GG, nice try, good luck — keep it PG.</div>
        )}
        {room?.chat?.map((m) => {
          const mine = me && m.userId === me.id;
          return (
            <div key={m.id} className={`tw-chat-msg ${mine ? "mine" : "theirs"}`}>
              {!mine && <span className="tw-chat-author">{m.username}</span>}
              <span className="tw-chat-text">{m.text}</span>
              {!mine && (
                <button className="tw-chat-report" onClick={() => report(m)} title="Report">⚐</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="tw-chat-reactions">
        {FREE_REACTIONS.map((e) => (
          <button key={e} className="tw-chat-reaction" onClick={() => sendReact(e)} disabled={disabled}>{e}</button>
        ))}
        {PREMIUM_REACTIONS.map((e) => (
          <button key={e}
            className="tw-chat-reaction"
            style={hasPremiumEmotes ? undefined : { opacity: 0.45, position: "relative" }}
            onClick={() => {
              if (hasPremiumEmotes) {
                sendReact(e);
              } else {
                // Soft-gated: tapping a locked emote opens the Season
                // Pass page rather than throwing an error toast. The
                // discoverability + upgrade hint in one tap.
                dispatch(pushToast({
                  icon: "⭐",
                  title: "Premium emote",
                  text: "Unlock with Season Pass premium or Pro.",
                  duration: 3500,
                }));
                dispatch(setView("season"));
              }
            }}
            disabled={disabled}
            title={hasPremiumEmotes ? "Premium emote" : "Locked — unlock with Season Pass premium or Pro"}
          >
            {e}
            {!hasPremiumEmotes && (
              <span style={{
                position: "absolute", top: -2, right: -2, fontSize: 9,
              }}>🔒</span>
            )}
          </button>
        ))}
      </div>

      <div className="tw-chat-presets">
        {PRESETS.map((p) => (
          <button key={p} className="tw-chat-preset" onClick={() => sendText(p)} disabled={disabled}>{p}</button>
        ))}
      </div>

      <form className="tw-chat-input-row" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
        <input
          className="tw-input"
          placeholder={disabled ? "Chat unavailable" : "Say something nice…"}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          disabled={disabled}
          maxLength={200}
        />
        <button type="submit" className="tw-btn" disabled={disabled || !text.trim()}>Send</button>
      </form>
      <div className="tw-chat-rules">No bullying, links, or profanity. Mods watch all chats.</div>
    </div>
  );
}

function noticeText(reason) {
  switch (reason) {
    case "profanity": return "Keep it PG.";
    case "no_links":  return "Links aren't allowed.";
    case "no_phone":  return "No personal info.";
    case "too_long":  return "Too long.";
    default:          return "Try again.";
  }
}
