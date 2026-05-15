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

class RealtimeClient {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.queue = [];
    this.reconnectAttempts = 0;
    this.shouldReconnect = false;
    this.connecting = false;
    this.pingTimer = null;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { this.listeners.forEach((f) => { try { f(msg); } catch (e) {} }); }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (!getToken()) { this.emit({ type: "error", error: "auth_required" }); return; }
    this.shouldReconnect = true;
    this.connecting = true;
    let ws;
    try { ws = new WebSocket(wsUrl()); } catch (e) {
      this.emit({ type: "error", error: "ws_init_failed" });
      this.connecting = false;
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.emit({ type: "open" });
      while (this.queue.length) ws.send(this.queue.shift());
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), 20 * 1000);
    };
    ws.onmessage = (e) => {
      try { this.emit(JSON.parse(e.data)); }
      catch (err) { /* ignore malformed */ }
    };
    ws.onclose = () => {
      this.connecting = false;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      this.emit({ type: "close" });
      if (this.shouldReconnect && this.reconnectAttempts < 10) {
        const delay = Math.min(10000, 500 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts += 1;
        setTimeout(() => this.connect(), delay);
      }
    };
    ws.onerror = () => { /* close handler does the work */ };
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) try { this.ws.close(); } catch (e) {}
    this.ws = null;
  }

  send(msg) {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) this.ws.send(raw);
    else { this.queue.push(raw); this.connect(); }
  }
}

export const rt = new RealtimeClient();
