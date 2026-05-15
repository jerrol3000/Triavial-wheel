import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { TRANSLATIONS, LANGUAGES, COUNTRY_TO_LANG, COUNTRIES } from "./translations";
import { load, save } from "../utils/storage";

const STORAGE_KEY = "lang";

// Pick a sensible default: stored choice > user's account language >
// COUNTRY_TO_LANG[user.country] > navigator.language base code > English.
export function detectInitialLanguage(user) {
  const stored = load(STORAGE_KEY, null);
  if (stored && TRANSLATIONS[stored]) return stored;
  if (user?.language && TRANSLATIONS[user.language]) return user.language;
  if (user?.country && COUNTRY_TO_LANG[user.country] && TRANSLATIONS[COUNTRY_TO_LANG[user.country]]) {
    return COUNTRY_TO_LANG[user.country];
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    const base = String(navigator.language).split("-")[0].toLowerCase();
    if (TRANSLATIONS[base]) return base;
  }
  return "en";
}

const I18nContext = createContext({ lang: "en", t: (k) => k, setLang: () => {} });

export function I18nProvider({ user, children }) {
  const [lang, setLangState] = useState(() => detectInitialLanguage(user));

  // Re-detect when the user changes (e.g. sign in/out, settings update).
  useEffect(() => {
    const stored = load(STORAGE_KEY, null);
    if (stored) return; // user explicitly chose — respect that.
    setLangState(detectInitialLanguage(user));
  }, [user?.id, user?.country, user?.language]);

  const setLang = useCallback((code) => {
    if (!TRANSLATIONS[code]) return;
    setLangState(code);
    save(STORAGE_KEY, code);
  }, []);

  const t = useCallback((key, vars) => {
    const pack = TRANSLATIONS[lang] || TRANSLATIONS.en;
    let str = pack[key];
    if (str == null) str = TRANSLATIONS.en[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
    return str;
  }, [lang]);

  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}

export { LANGUAGES, COUNTRIES, COUNTRY_TO_LANG };
