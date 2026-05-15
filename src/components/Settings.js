import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useT, LANGUAGES, COUNTRIES } from "../i18n";
import { api } from "../api/client";
import { toggleSound, pushToast, setView } from "../store/uiSlice";
import { logout, fetchMe } from "../store/authSlice";

export default function Settings() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const soundOn = useSelector((s) => s.ui.soundOn);
  const { t, lang, setLang } = useT();
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [country, setCountry] = useState(user?.country || "");

  const saveLanguage = async (code) => {
    setLang(code); // immediate local switch
    if (user) {
      try { await api.put("/auth/me", { language: code }); dispatch(fetchMe()); } catch (e) {}
    }
    dispatch(pushToast({ icon: "🌐", title: t("settings.saved") }));
  };

  const saveCountry = async (cc) => {
    setCountry(cc);
    if (user) {
      try { await api.put("/auth/me", { country: cc }); dispatch(fetchMe()); } catch (e) {}
    }
    dispatch(pushToast({ icon: "🌎", title: t("settings.saved") }));
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put("/auth/me", { current_password: currentPassword, new_password: newPassword });
      setCurrentPassword(""); setNewPassword("");
      dispatch(pushToast({ icon: "🔒", title: "Password updated" }));
    } catch (err) {
      dispatch(pushToast({ icon: "⚠️", title: err?.response?.data?.error || "failed" }));
    }
    setBusy(false);
  };

  return (
    <div className="tw-col">
      <h1 style={{ margin: "8px 0" }}>⚙️ {t("settings.title")}</h1>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{t("settings.preferences")}</div>

        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>{t("settings.language")}</label>
        <div className="tw-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 14 }}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              className="tw-pill"
              onClick={() => saveLanguage(l.code)}
              title={l.name}
              style={{
                cursor: "pointer",
                background: lang === l.code ? "linear-gradient(135deg, var(--primary), var(--primary-2))" : undefined,
                border: lang === l.code ? "none" : undefined,
                color: "#fff",
              }}
            >
              {l.name}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>{t("settings.country")}</label>
        <select className="tw-input" style={{ marginTop: 6, marginBottom: 14 }}
                value={country} onChange={(e) => saveCountry(e.target.value)}>
          <option value="">—</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>

        <div className="tw-row" style={{ justifyContent: "space-between", paddingTop: 6 }}>
          <span>{t("settings.sound")}</span>
          <button className="tw-pill" style={{ cursor: "pointer" }} onClick={() => dispatch(toggleSound())}>
            {soundOn ? "🔊 On" : "🔇 Off"}
          </button>
        </div>
      </div>

      {user ? (
        <>
          <div className="tw-card">
            <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t("settings.account")}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 14 }}>
              <strong>@{user.username}</strong> · {user.email}
            </div>
            <form onSubmit={changePassword} className="tw-col">
              <div style={{ fontWeight: 600 }}>{t("settings.changePassword")}</div>
              <input className="tw-input" type="password" placeholder={t("settings.currentPassword")}
                     value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              <input className="tw-input" type="password" placeholder={t("settings.newPassword")}
                     value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              <button className="tw-btn block" type="submit" disabled={busy || !currentPassword || !newPassword}>
                {busy ? "..." : t("settings.changePassword")}
              </button>
            </form>
          </div>

          <div className="tw-card" style={{ borderColor: "rgba(239,68,68,0.4)" }}>
            <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{t("settings.dangerZone")}</div>
            <button className="tw-btn ghost block" onClick={() => { dispatch(logout()); dispatch(setView("home")); }}>
              {t("settings.logout")}
            </button>
          </div>
        </>
      ) : (
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ color: "var(--text-dim)" }}>Sign in to manage your account.</div>
        </div>
      )}
    </div>
  );
}
