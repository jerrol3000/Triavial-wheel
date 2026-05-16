import React, { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { closeModal } from "../store/uiSlice";
import { login, register, clearError } from "../store/authSlice";
import { fetchStats } from "../store/statsSlice";
import { useT, LANGUAGES, COUNTRIES, COUNTRY_TO_LANG } from "../i18n";
import AvatarPicker from "./AvatarPicker";

export default function AuthModal() {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((s) => s.auth);
  const modal = useSelector((s) => s.ui.modal);
  const { t, lang, setLang } = useT();
  // Honor caller-requested initial tab (e.g., guest-limit card asks for
  // the register tab directly so the path is "Sign up" → fill form).
  const initialTab = (modal && typeof modal === "object" && modal.data && modal.data.tab) || "login";
  const reason = modal && typeof modal === "object" && modal.data && modal.data.reason;
  const [tab, setTab] = useState(initialTab);
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Default to detected country, default language to matched one.
  const detectedCountry = useMemo(() => {
    try {
      const locale = (navigator.languages && navigator.languages[0]) || navigator.language || "";
      const region = locale.split("-")[1];
      return region ? region.toUpperCase() : "";
    } catch (e) { return ""; }
  }, []);
  const [country, setCountry] = useState(detectedCountry || "");
  const [language, setLanguage] = useState(lang);
  const [avatar, setAvatar] = useState("preset:cool");
  const [showAvatar, setShowAvatar] = useState(false);

  // When country changes, auto-suggest the matching language if user hasn't manually picked.
  const onCountryChange = (cc) => {
    setCountry(cc);
    const suggested = COUNTRY_TO_LANG[cc];
    if (suggested) { setLanguage(suggested); setLang(suggested); }
  };

  const submit = async (e) => {
    e.preventDefault();
    dispatch(clearError());
    const action = tab === "login"
      ? login({ emailOrUsername, password })
      : register({ email, username, password, country: country || null, language: language || lang, avatar });
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
          {tab === "login" ? t("auth.welcome") : t("auth.createAccount")}
        </h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
          Sync stats across devices, climb the leaderboards, and earn rewards.
        </p>
        {reason === "guest_limit" && (
          <div style={{
            margin: "0 0 12px",
            padding: "10px 12px",
            background: "rgba(124,58,237,0.14)",
            border: "1px solid rgba(124,58,237,0.4)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--text)",
          }}>
            🎟️ You've reached the guest round limit. Create a free account to
            keep playing — it takes 10 seconds.
          </div>
        )}

        <div className="tw-row" style={{ marginBottom: 14 }}>
          <button
            className="tw-pill"
            onClick={() => setTab("login")}
            style={{ cursor: "pointer", background: tab === "login" ? "rgba(124,58,237,0.4)" : undefined }}
          >{t("auth.signin")}</button>
          <button
            className="tw-pill"
            onClick={() => setTab("register")}
            style={{ cursor: "pointer", background: tab === "register" ? "rgba(124,58,237,0.4)" : undefined }}
          >{t("auth.create")}</button>
        </div>

        <form onSubmit={submit} className="tw-col">
          {tab === "login" ? (
            <input className="tw-input" placeholder={t("auth.emailOrUsername")} value={emailOrUsername}
                   onChange={(e) => setEmailOrUsername(e.target.value)} required autoFocus />
          ) : (
            <>
              <input className="tw-input" type="email" placeholder={t("auth.email")} value={email}
                     onChange={(e) => setEmail(e.target.value)} required autoFocus />
              <input className="tw-input" placeholder={t("auth.username")} value={username}
                     onChange={(e) => setUsername(e.target.value)} required />
              <div className="tw-grid-2">
                <select className="tw-input" value={country} onChange={(e) => onCountryChange(e.target.value)} title={t("auth.country")}>
                  <option value="">{t("auth.country")} —</option>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                <select className="tw-input" value={language} onChange={(e) => { setLanguage(e.target.value); setLang(e.target.value); }} title={t("auth.language")}>
                  {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </div>
              <button type="button" className="tw-btn ghost block" onClick={() => setShowAvatar((v) => !v)} style={{ marginTop: 4 }}>
                {showAvatar ? "Hide profile picture options" : "Choose a profile picture"}
              </button>
              {showAvatar && (
                <AvatarPicker value={avatar} onChange={setAvatar} compact />
              )}
            </>
          )}
          <input className="tw-input" type="password" placeholder={t("auth.password")} value={password}
                 onChange={(e) => setPassword(e.target.value)} required />
          {error && <div style={{ color: "var(--bad)", fontSize: 14 }}>{error}</div>}
          <button type="submit" className="tw-btn block" disabled={loading}>
            {loading ? "..." : tab === "login" ? t("auth.signin") : t("auth.createAccount")}
          </button>
          <button type="button" className="tw-btn ghost block" onClick={() => dispatch(closeModal())}>
            {t("auth.continueGuest")}
          </button>
        </form>

        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 16, marginBottom: 0 }}>
          {t("auth.guestNote")}
        </p>
      </div>
    </div>
  );
}
