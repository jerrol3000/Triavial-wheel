import axios from "axios";
import { load, save, remove } from "../utils/storage";

const baseURL = process.env.API_BASE_URL || "http://localhost:4000/api";

export const api = axios.create({ baseURL, timeout: 10000 });

let token = load("token", null);
export function getToken() { return token; }
export function setToken(t) {
  token = t;
  if (t) save("token", t);
  else remove("token");
}

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Auto-logout on 401 — but ONLY for unambiguous "your token is bad"
// errors. The previous version booted on ANY 401, which caused spurious
// logouts whenever:
//   - Fly cold-started after scale-to-zero (first request dropped the
//     Authorization header through the proxy → server replied "missing
//     token" → client logged you out though the token was perfectly fine)
//   - A server deploy briefly returned 401 during rollover
//   - A transient proxy hiccup returned 401 with no error body
//
// New policy: only logout when the server explicitly told us why and the
// reason is "you can't recover from this" (invalid/expired/banned/superseded).
// Anything else — empty body, "missing token", unknown error — we keep
// the token and let the caller retry. The user retries the action and
// they're still signed in.
//
// On 2xx responses, if the server sent X-Refresh-Token (sliding-window
// renewal — fires when the current token is past half its lifetime),
// transparently swap in the fresh one so the player effectively never
// gets logged out while they're active.
const FATAL_AUTH_ERRORS = new Set([
  "invalid",
  "invalid_token",
  "expired",
  "session_superseded",
  "banned",
]);

api.interceptors.response.use(
  (res) => {
    try {
      const fresh = res && res.headers && (res.headers["x-refresh-token"] || res.headers["X-Refresh-Token"]);
      if (fresh && fresh !== token) setToken(fresh);
    } catch (e) {}
    return res;
  },
  (err) => {
    if (err && err.response && err.response.status === 401 && token) {
      const url = err.config && err.config.url ? String(err.config.url) : "";
      const reason = err.response.data && err.response.data.error;
      // Skip /login (401 there just means wrong password).
      if (!url.includes("/auth/login") && FATAL_AUTH_ERRORS.has(reason)) {
        setToken(null);
        remove("user");
        try {
          window.dispatchEvent(new CustomEvent("trivia_auth_expired", {
            detail: { url, error: reason },
          }));
        } catch (e) {}
      }
      // Else: keep the token, let the caller see the 401 and retry.
    }
    return Promise.reject(err);
  }
);
