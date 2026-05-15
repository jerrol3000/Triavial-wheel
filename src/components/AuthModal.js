import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { closeModal } from "../store/uiSlice";
import { login, register, clearError } from "../store/authSlice";
import { fetchStats } from "../store/statsSlice";

export default function AuthModal() {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((s) => s.auth);
  const [tab, setTab] = useState("login");
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    dispatch(clearError());
    const action = tab === "login"
      ? login({ emailOrUsername, password })
      : register({ email, username, password });
    const res = await dispatch(action);
    if (res.meta.requestStatus === "fulfilled") {
      dispatch(fetchStats());
      dispatch(closeModal());
    }
  };

  return (
    <div className="tw-modal-backdrop" onClick={() => dispatch(closeModal())}>
      <div className="tw-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>
          {tab === "login" ? "Welcome back" : "Create account"}
        </h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
          Sync stats across devices, climb the leaderboards, and earn rewards.
        </p>

        <div className="tw-row" style={{ marginBottom: 14 }}>
          <button
            className={`tw-pill ${tab === "login" ? "" : ""}`}
            onClick={() => setTab("login")}
            style={{ cursor: "pointer", background: tab === "login" ? "rgba(124,58,237,0.4)" : undefined }}
          >Sign in</button>
          <button
            className="tw-pill"
            onClick={() => setTab("register")}
            style={{ cursor: "pointer", background: tab === "register" ? "rgba(124,58,237,0.4)" : undefined }}
          >Create</button>
        </div>

        <form onSubmit={submit} className="tw-col">
          {tab === "login" ? (
            <input className="tw-input" placeholder="Email or username" value={emailOrUsername}
                   onChange={(e) => setEmailOrUsername(e.target.value)} required autoFocus />
          ) : (
            <>
              <input className="tw-input" type="email" placeholder="Email" value={email}
                     onChange={(e) => setEmail(e.target.value)} required autoFocus />
              <input className="tw-input" placeholder="Username (3-20)" value={username}
                     onChange={(e) => setUsername(e.target.value)} required />
            </>
          )}
          <input className="tw-input" type="password" placeholder="Password (min 6)" value={password}
                 onChange={(e) => setPassword(e.target.value)} required />
          {error && <div style={{ color: "var(--bad)", fontSize: 14 }}>{error}</div>}
          <button type="submit" className="tw-btn block" disabled={loading}>
            {loading ? "..." : tab === "login" ? "Sign in" : "Create account"}
          </button>
          <button type="button" className="tw-btn ghost block" onClick={() => dispatch(closeModal())}>
            Continue without account
          </button>
        </form>

        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 16, marginBottom: 0 }}>
          You can play without an account — but you won't earn XP toward the global leaderboard or sync between devices.
        </p>
      </div>
    </div>
  );
}
