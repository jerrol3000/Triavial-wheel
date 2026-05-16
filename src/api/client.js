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

// Auto-logout on 401 ("missing token" or "invalid token"). Avoids the
// confusing state where the UI shows the user as signed in but every
// authed request silently fails. Common trigger: server restarted with
// a new JWT_SECRET, invalidating tokens minted by the old process.
//
// On 2xx responses, if the server sent X-Refresh-Token (sliding-window
// renewal — fires when the current token is past half its lifetime),
// transparently swap in the fresh one so the player effectively never
// gets logged out while they're active.
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
      // Don't auto-logout on /login itself — that 401 is just "wrong password".
      if (!url.includes("/auth/login")) {
        setToken(null);
        remove("user");
        try {
          window.dispatchEvent(new CustomEvent("trivia_auth_expired", {
            detail: { url, error: err.response.data && err.response.data.error },
          }));
        } catch (e) {}
      }
    }
    return Promise.reject(err);
  }
);
