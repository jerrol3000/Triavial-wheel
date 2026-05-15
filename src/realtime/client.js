import { getToken } from "../api/client";

// API_BASE_URL is "http://host/api" in dev, "/api" in prod (via netlify proxy).
// The WS endpoint is at /ws on the same host as the API.
function wsUrl() {
  const apiBase = process.env.API_BASE_URL || "/api";
  let origin;
  if (apiBase.startsWith("http")) {
    origin = new URL(apiBase).origin;
  } else {
    origin = window.location.origin;
  }
  const protocol = origin.startsWith("https") ? "wss:" : "ws:";
  const host = origin.replace(/^https?:/, "");
  const token = getToken();
  return `${protocol}${host}/ws?token=${encodeURIComponent(token || "")}`;
}

// HTTP endpoint we can probe to distinguish "server is down" from "WS endpoint specifically broken".
function healthUrl() {
  const apiBase = process.env.API_BASE_URL || "/api";
  return apiBase + "/health";
}

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
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { this.listeners.forEach((f) => { try { f(msg); } catch (e) {} }); }

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
    if (!getToken()) {
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
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), 20 * 1000);
    };
    ws.onmessage = (e) => {
      try { this.emit(JSON.parse(e.data)); }
      catch (err) { /* ignore malformed */ }
    };
    ws.onclose = (e) => {
      this.connecting = false;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      this.lastError = e && e.code !== 1000 ? `close ${e.code}${e.reason ? ` ${e.reason}` : ""}` : null;
      this.emit({ type: "close", code: e && e.code, reason: e && e.reason });
      if (this.shouldReconnect && this.reconnectAttempts < 10) {
        const delay = Math.min(10000, 500 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts += 1;
        setTimeout(() => this.connect(), delay);
      } else if (this.reconnectAttempts >= 10) {
        this.emit({ type: "error", error: "give_up", detail: this.lastError });
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

  // For a manual user-triggered retry — resets backoff so it reconnects immediately.
  forceReconnect() {
    this.reconnectAttempts = 0;
    this.lastError = null;
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
