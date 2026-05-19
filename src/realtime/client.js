import { getToken } from "../api/client";

// API_BASE_URL is "http://host/api" in dev, "/api" in prod (via Netlify proxy).
// WS_BASE_URL is the full ws:// or wss:// origin to connect to — defaults
// to deriving from API_BASE_URL in dev, and is pinned to the Fly backend
// in prod since Netlify doesn't proxy WebSocket upgrades.
function wsUrl() {
  let origin = process.env.WS_BASE_URL || "";
  if (!origin) {
    const apiBase = process.env.API_BASE_URL || "/api";
    if (apiBase.startsWith("http")) {
      origin = new URL(apiBase).origin;
    } else {
      origin = window.location.origin;
    }
  }
  // Normalize to ws/wss scheme regardless of how the origin came in.
  const protocol = /^https|^wss/.test(origin) ? "wss:" : "ws:";
  const host = origin.replace(/^(https?|wss?):/, "");
  const token = getToken();
  return `${protocol}${host}/ws?token=${encodeURIComponent(token || "")}`;
}

// HTTP endpoint we can probe to distinguish "server is down" from "WS endpoint specifically broken".
function healthUrl() {
  const apiBase = process.env.API_BASE_URL || "/api";
  return apiBase + "/health";
}

// Terminal WS errors — the client should NOT keep reconnecting after
// any of these because retrying won't help (token is bad, user is
// banned). Without this guard the previous client looped forever:
// open → server sends auth_required → server closes → onclose retries
// → repeat. UI showed "Connecting to live server…" indefinitely.
const TERMINAL_WS_ERRORS = new Set(["auth_required", "forbidden", "banned"]);

class RealtimeClient {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.queue = [];
    this.reconnectAttempts = 0;
    this.shouldReconnect = false;
    this.connecting = false;
    this.pingTimer = null;
    this.lastError = null;
    this.lastUrl = null;
    // Sticky terminal-error flag. Stays set until forceReconnect()
    // clears it (e.g., after the user signs back in). Prevents the
    // retry loop on stale tokens.
    this.terminalError = null;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { this.listeners.forEach((f) => { try { f(msg); } catch (e) {} }); }

  // Snapshot of current client state — used by the debug panel so the
  // user can SEE exactly what's happening when "connecting" hangs.
  // Returns synchronously so the UI updates every render without
  // a network call.
  state() {
    const READY_STATE_LABEL = ["CONNECTING (0)", "OPEN (1)", "CLOSING (2)", "CLOSED (3)"];
    return {
      readyState: this.ws ? this.ws.readyState : null,
      readyStateLabel: this.ws ? READY_STATE_LABEL[this.ws.readyState] : "no socket",
      connecting: this.connecting,
      shouldReconnect: this.shouldReconnect,
      reconnectAttempts: this.reconnectAttempts,
      terminalError: this.terminalError,
      lastError: this.lastError,
      lastUrl: this.lastUrl || wsUrl(),
      hasToken: !!getToken(),
      lastCloseCode: this.lastCloseCode || null,
      lastCloseReason: this.lastCloseReason || null,
    };
  }

  // Manual diagnostic — pings /api/health to confirm the backend is reachable at all.
  async diagnose() {
    const url = healthUrl();
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        return { reachable: true, api: data, wsUrl: this.lastUrl || wsUrl(), token: !!getToken(), error: this.lastError };
      }
      return { reachable: false, status: r.status, wsUrl: this.lastUrl || wsUrl(), token: !!getToken(), error: this.lastError };
    } catch (e) {
      return { reachable: false, network_error: String(e && e.message || e), wsUrl: this.lastUrl || wsUrl(), token: !!getToken(), error: this.lastError };
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (this.terminalError) {
      // Already gave up; don't quietly retry without a forceReconnect.
      this.emit({ type: "error", error: this.terminalError });
      return;
    }
    if (!getToken()) {
      this.terminalError = "auth_required";
      this.lastError = "auth_required";
      this.emit({ type: "error", error: "auth_required" });
      return;
    }
    this.shouldReconnect = true;
    this.connecting = true;
    this.lastUrl = wsUrl();
    let ws;
    try {
      ws = new WebSocket(this.lastUrl);
    } catch (e) {
      this.lastError = `init: ${e && e.message || "failed"}`;
      this.emit({ type: "error", error: "ws_init_failed", detail: this.lastError });
      this.connecting = false;
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.emit({ type: "open" });
      while (this.queue.length) ws.send(this.queue.shift());
      // Clear any leftover interval before starting a new one — guards
      // against double-connect leaks if onopen fires twice.
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), 20 * 1000);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); }
      catch (err) { return; /* ignore malformed */ }
      // Server-sent terminal errors lock the client out of further
      // reconnect attempts — retrying with the same bad token would
      // just hit the same wall. Cleared only by forceReconnect()
      // (typically after re-sign-in). Without this guard the client
      // got stuck in an open→error→close→reconnect loop and the
      // "Connecting to live server…" banner never went away.
      if (msg && msg.type === "error" && TERMINAL_WS_ERRORS.has(msg.error)) {
        this.terminalError = msg.error;
        this.shouldReconnect = false;
        this.lastError = msg.error;
      }
      this.emit(msg);
    };
    ws.onclose = (e) => {
      this.connecting = false;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      this.lastCloseCode = e && e.code;
      this.lastCloseReason = (e && e.reason) || null;
      this.lastError = e && e.code !== 1000 ? `close ${e.code}${e.reason ? ` ${e.reason}` : ""}` : null;
      this.emit({ type: "close", code: e && e.code, reason: e && e.reason });
      // Don't retry on a terminal error (already set by onmessage)
      // or when we've hit the give-up cap.
      if (this.terminalError) {
        // Emit an explicit "give up" signal so the UI can show a
        // specific error state instead of staying on "Connecting…".
        this.emit({ type: "error", error: this.terminalError });
        return;
      }
      if (this.shouldReconnect && this.reconnectAttempts < 6) {
        // Backoff capped lower (6 attempts, ~8 s max delay) so a
        // genuine outage gives up faster and the UI can show the
        // error state instead of a forever-spinner. 6 attempts of
        // exponential backoff cover ~15 s total — enough to ride
        // out a brief Fly cold-start, short enough not to mask a
        // real problem.
        const delay = Math.min(8000, 500 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts += 1;
        setTimeout(() => this.connect(), delay);
      } else if (this.reconnectAttempts >= 6) {
        // Give-up state — stop trying. Emits BOTH an error AND a
        // synthetic session_ended so any active match-screen tears down
        // and shows a clear message rather than freezing on stale state.
        this.shouldReconnect = false;
        this.emit({ type: "error", error: "give_up", detail: this.lastError });
        this.emit({ type: "session_ended", reason: "connection_lost" });
      }
    };
    ws.onerror = () => {
      // The browser doesn't expose useful error detail for security reasons; the close handler will run with code 1006.
      this.lastError = this.lastError || "connection failed (server unreachable or wrong URL)";
    };
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) try { this.ws.close(1000, "client_disconnect"); } catch (e) {}
    this.ws = null;
  }

  // For a manual user-triggered retry — resets backoff AND clears any
  // sticky terminal error so a fresh sign-in (or just a network blip)
  // can re-attempt without surgery.
  forceReconnect() {
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.terminalError = null;
    this.shouldReconnect = true;
    if (this.ws) try { this.ws.close(); } catch (e) {}
    this.ws = null;
    this.connect();
  }

  send(msg) {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) this.ws.send(raw);
    else { this.queue.push(raw); this.connect(); }
  }
}

export const rt = new RealtimeClient();
