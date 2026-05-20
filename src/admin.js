import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

const API = process.env.API_BASE_URL || "http://localhost:4000/api";
const TOKEN_KEY = "trivia-wheel-admin:token";

const api = axios.create({ baseURL: API, timeout: 12000 });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

const CATEGORIES = [
  { id: 9,  name: "General Knowledge" },
  { id: 11, name: "Entertainment: Film" },
  { id: 14, name: "Entertainment: Television" },
  { id: 17, name: "Science & Nature" },
  { id: 21, name: "Sports" },
  { id: 22, name: "Geography" },
  { id: 12, name: "Entertainment: Music" },
  { id: 18, name: "Science: Computers" },
  { id: 20, name: "Mythology" },
  { id: 27, name: "Animals" },
];
const DIFFS = ["easy", "medium", "hard"];

// ─── Toasts ─────────────────────────────────────────────────────────────────
let toastSeq = 1;
const ToastContext = React.createContext({ push: () => {} });
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = "ok") => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  const view = (
    <>
      {toasts.map((t) => (
        <div key={t.id} className={`adm-toast ${t.kind}`}>{t.msg}</div>
      ))}
    </>
  );
  return { push, view };
}

// ─── App shell ──────────────────────────────────────────────────────────────
function App() {
  const toasts = useToasts();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLoading(false); return; }
    api.get("/auth/me")
      .then((r) => {
        if (r.data.is_admin) setMe(r.data);
        else { localStorage.removeItem(TOKEN_KEY); toasts.push("Not an admin account", "err"); }
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="adm-login"><div className="adm-card">Loading…</div></div>;
  }

  if (!me) {
    return <Login onLogin={setMe} toasts={toasts} />;
  }

  const PAGES = {
    dashboard: Dashboard,
    analytics: Analytics,
    users: Users,
    questions: Questions,
    daily: Daily,
    moderation: Moderation,
    events: Events,
    refresh: Refresh,
    settings: AdminSettings,
    security: AdminSecurity,
  };
  const Page = PAGES[view] || Dashboard;

  return (
    <ToastContext.Provider value={toasts}>
      <div className="adm-layout">
        <Sidebar
          view={view}
          setView={setView}
          me={me}
          onLogout={() => { localStorage.removeItem(TOKEN_KEY); setMe(null); }}
        />
        <main className="adm-main">
          <Page toasts={toasts} me={me} />
        </main>
        {toasts.view}
      </div>
    </ToastContext.Provider>
  );
}

function Sidebar({ view, setView, me, onLogout }) {
  const items = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "analytics", icon: "📈", label: "Analytics" },
    { id: "users",     icon: "👥", label: "Users" },
    { id: "questions", icon: "❓", label: "Questions" },
    { id: "daily",     icon: "📅", label: "Daily" },
    { id: "moderation", icon: "🛡️", label: "Moderation" },
    { id: "events",    icon: "💳", label: "Pro Events" },
    { id: "refresh",   icon: "🔄", label: "Bank Refresh" },
    { id: "settings",  icon: "🔑", label: "Payments / Settings" },
    { id: "security",  icon: "🔒", label: "Security (2FA)" },
  ];
  return (
    <aside className="adm-sidebar">
      <div className="adm-sidebar-title">
        <img src="/logo-no-background.png" alt="" />
        Trivia Admin
      </div>
      <a className="adm-nav-btn" href="/" title="Return to the player-facing game"
         style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.18))", border: "1px solid rgba(124,58,237,0.4)", marginBottom: 8 }}>
        🎡 Back to the game
      </a>
      {items.map((it) => (
        <button
          key={it.id}
          className={`adm-nav-btn ${view === it.id ? "active" : ""}`}
          onClick={() => setView(it.id)}
        >
          <span>{it.icon}</span> {it.label}
        </button>
      ))}
      <div className="adm-nav-spacer" />
      <div className="adm-nav-user">
        Signed in as <strong style={{ color: "var(--text)" }}>@{me.username}</strong>
      </div>
      <button className="adm-btn ghost" onClick={onLogout}>Sign out</button>
      <a className="adm-btn ghost" style={{ textAlign: "center", textDecoration: "none", marginTop: 4 }} href="/">← Back to game</a>
    </aside>
  );
}

// ─── Login ──────────────────────────────────────────────────────────────────
function Login({ onLogin, toasts }) {
  const [emailOrUsername, setEU] = useState("");
  const [password, setPw] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requireTotp, setRequireTotp] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { emailOrUsername, password };
      if (requireTotp) payload.totp_code = totpCode;
      const { data } = await api.post("/auth/login", payload);
      if (!data.user?.is_admin) {
        toasts.push("This account is not an admin.", "err");
        setLoading(false);
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      onLogin(data.user);
    } catch (e) {
      const err = e?.response?.data?.error || "Login failed";
      if (err === "totp_required") {
        setRequireTotp(true);
        toasts.push("Enter the 6-digit code from your authenticator app.", "ok");
      } else if (err === "totp_invalid") {
        toasts.push("Invalid 2FA code. Try again.", "err");
      } else {
        toasts.push(err, "err");
      }
    }
    setLoading(false);
  };

  return (
    <div className="adm-login">
      <form className="adm-card adm-login-card" onSubmit={submit}>
        <h2 style={{ margin: "0 0 4px" }}>Trivia Admin</h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0 }}>Admin accounts only.</p>
        <div className="adm-col">
          <input className="adm-input" placeholder="Email or username" value={emailOrUsername}
                 onChange={(e) => setEU(e.target.value)} autoFocus required disabled={requireTotp} />
          <input className="adm-input" type="password" placeholder="Password" value={password}
                 onChange={(e) => setPw(e.target.value)} required disabled={requireTotp} />
          {requireTotp && (
            <input className="adm-input" placeholder="2FA code (or backup code)"
                   value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                   inputMode="numeric" autoFocus required maxLength={9} />
          )}
          <button className="adm-btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : requireTotp ? "Verify" : "Sign in"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 0, marginTop: 14 }}>
          Set <code>ADMIN_EMAILS</code> in <code>server/.env</code> to promote accounts on register / boot.
        </p>
        {toasts.view}
      </form>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ toasts }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/overview")
      .then((r) => setData(r.data))
      .catch((e) => toasts.push(e?.response?.data?.error || "load failed", "err"));
  }, [toasts]);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  if (!data) return <div>Loading…</div>;

  const accuracy = data.games.correct + data.games.incorrect > 0
    ? Math.round((data.games.correct / (data.games.correct + data.games.incorrect)) * 100)
    : 0;

  return (
    <>
      <div className="adm-header">
        <h1>Dashboard</h1>
        <button className="adm-btn ghost" onClick={load}>Refresh</button>
      </div>

      <div className="adm-grid adm-grid-4 adm-mb">
        <StatCard label="Users" value={data.users.total} sub={`+${data.users.new_7d} this week`} />
        <StatCard label="Pro subscribers" value={data.users.pro} sub={`${pct(data.users.pro, data.users.total)}% of users`} />
        <StatCard label="Question bank" value={data.questions.total} sub={`${data.questions.buckets.length} buckets`} />
        <StatCard label="Games played" value={data.games.total} sub={`${accuracy}% accuracy`} />
        <StatCard label="Daily plays today" value={data.daily.plays_today} sub={data.daily.date} />
        <StatCard label="Banned" value={data.users.banned} />
        <StatCard label="Admins" value={data.users.admins} />
        <StatCard label="Pro events" value={data.pro_events} sub="webhook history" />
      </div>

      <div className="adm-grid adm-grid-2">
        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Recent sign-ups</h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>User</th><th>Email</th><th>Joined</th></tr></thead>
              <tbody>
                {data.recent_signups.map((u) => (
                  <tr key={u.id}>
                    <td>@{u.username} {u.is_admin && <span className="adm-tag admin">admin</span>}</td>
                    <td className="mono">{u.email}</td>
                    <td>{timeAgo(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Top leaderboard</h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>#</th><th>User</th><th>Level</th><th style={{ textAlign: "right" }}>High score</th></tr></thead>
              <tbody>
                {data.top_leaderboard.map((r, i) => (
                  <tr key={r.username + i}>
                    <td>{i + 1}</td>
                    <td>@{r.username}</td>
                    <td>L{r.level}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{r.high_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="adm-card" style={{ marginTop: 16 }}>
        <div className="adm-row adm-mb">
          <h3 style={{ margin: 0 }}>Question bank coverage</h3>
          <div className="adm-spacer" />
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Target: 30+ per bucket</span>
        </div>
        <div className="adm-grid adm-grid-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{cat.name}</div>
              {DIFFS.map((d) => {
                const b = data.questions.buckets.find((x) => x.category_id === cat.id && x.difficulty === d);
                const n = b ? b.count : 0;
                const w = Math.min(100, Math.round((n / 30) * 100));
                return (
                  <div key={d} className="adm-row" style={{ gap: 8, marginBottom: 4 }}>
                    <span className={`adm-tag ${d}`} style={{ minWidth: 60, textAlign: "center" }}>{d}</span>
                    <div className="adm-bucket-bar"><div style={{ width: `${w}%` }} /></div>
                    <span className="mono" style={{ minWidth: 30, textAlign: "right" }}>{n}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="adm-card">
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value">{value ?? 0}</div>
      {sub && <div className="adm-stat-sub">{sub}</div>}
    </div>
  );
}

// ─── Users ──────────────────────────────────────────────────────────────────
function Users({ toasts, me }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");           // "" | banned | admins | pro | test
  const [inactiveDays, setInactiveDays] = useState(0); // 0 | 30 | 60 | 90
  const [data, setData] = useState({ total: 0, users: [] });
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(null);
  // selectedIds: Set of user_ids the admin has ticked. Persists across
  // page navigations within the same Users mount, so a workflow like
  // "page 1: select 5, page 2: select 10, then bulk delete 15" works
  // naturally. Wiped on filter/search change because the criteria
  // changing means "those rows aren't the user's mental model anymore".
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { kind: "delete"|"ban"|"unban", ids: [...] }
  const limit = 50;

  const load = useCallback(() => {
    const params = { q, limit, offset };
    if (filter) params.filter = filter;
    if (inactiveDays > 0) params.inactive_days = inactiveDays;
    api.get("/admin/users", { params })
      .then((r) => setData(r.data))
      .catch((e) => toasts.push(e?.response?.data?.error || "load failed", "err"));
  }, [q, filter, inactiveDays, offset, toasts]);
  useEffect(() => { load(); }, [load]);

  // Wipe selection whenever the search/filter/page criteria changes —
  // staying selected across criteria changes confuses the admin (and
  // would let them accidentally bulk-delete users they can no longer
  // see).
  useEffect(() => { setSelectedIds(new Set()); }, [q, filter, inactiveDays, offset]);

  const isSelectable = (u) => u.id !== me.id && !u.is_admin; // server enforces too
  const visibleSelectable = data.users.filter(isSelectable);
  const allPageSelected = visibleSelectable.length > 0
    && visibleSelectable.every((u) => selectedIds.has(u.id));
  const somePageSelected = !allPageSelected && visibleSelectable.some((u) => selectedIds.has(u.id));

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const u of visibleSelectable) next.delete(u.id);
      } else {
        for (const u of visibleSelectable) next.add(u.id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Open the confirm dialog for the requested action. Dialog itself
  // does the API call so we can keep the trigger handlers tiny.
  const askBulk = (kind) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirmAction({ kind, ids });
  };

  const runBulk = async ({ kind, ids }) => {
    setBulkBusy(true);
    try {
      const path = kind === "delete" ? "/admin/users/bulk-delete"
                 : kind === "ban"    ? "/admin/users/bulk-ban"
                                     : "/admin/users/bulk-unban";
      const r = await api.post(path, { user_ids: ids });
      const n = r.data.deleted ?? r.data.banned ?? r.data.unbanned ?? 0;
      const skipped = r.data.skipped || [];
      const verb = kind === "delete" ? "Deleted" : kind === "ban" ? "Banned" : "Unbanned";
      const skipNote = skipped.length ? ` · ${skipped.length} skipped (self / admins)` : "";
      toasts.push(`${verb} ${n}${skipNote}`, "ok");
      clearSelection();
      setConfirmAction(null);
      load();
    } catch (e) {
      toasts.push(e?.response?.data?.error || "Bulk action failed", "err");
    } finally {
      setBulkBusy(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <>
      <div className="adm-header">
        <h1>Users</h1>
        <div className="adm-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input className="adm-input" placeholder="Search email or username" value={q}
                 onChange={(e) => { setOffset(0); setQ(e.target.value); }} style={{ width: 260 }} />
        </div>
      </div>

      {/* Filter chips. Quick scoping so the admin can bulk-act on a
          meaningful subset (banned cleanup, test-account purge,
          inactive culling) without typing search strings. Multi-state
          radio behavior: tap once to apply, tap again to clear. */}
      <div className="adm-row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <FilterChip active={filter === "banned"}  onClick={() => { setOffset(0); setFilter(filter === "banned" ? "" : "banned"); }}>🚫 Banned</FilterChip>
        <FilterChip active={filter === "test"}    onClick={() => { setOffset(0); setFilter(filter === "test" ? "" : "test"); }}>🧪 Test accounts</FilterChip>
        <FilterChip active={filter === "admins"}  onClick={() => { setOffset(0); setFilter(filter === "admins" ? "" : "admins"); }}>🛡️ Admins</FilterChip>
        <FilterChip active={filter === "pro"}     onClick={() => { setOffset(0); setFilter(filter === "pro" ? "" : "pro"); }}>⭐ Pro</FilterChip>
        <span style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
        <FilterChip active={inactiveDays === 30}  onClick={() => { setOffset(0); setInactiveDays(inactiveDays === 30 ? 0 : 30); }}>😴 Inactive 30d+</FilterChip>
        <FilterChip active={inactiveDays === 90}  onClick={() => { setOffset(0); setInactiveDays(inactiveDays === 90 ? 0 : 90); }}>💤 Inactive 90d+</FilterChip>
        {(filter || inactiveDays > 0 || q) && (
          <button className="adm-btn ghost sm" onClick={() => { setQ(""); setFilter(""); setInactiveDays(0); setOffset(0); }}>
            Clear all
          </button>
        )}
      </div>

      {/* Sticky bulk-action bar — shows ONLY when 1+ row is selected.
          Sliding-in pattern is more discoverable than a hidden menu
          and stays out of the way otherwise. Counts + clear inline so
          the admin can always see how many they're about to affect. */}
      {selectedCount > 0 && (
        <div className="adm-card" style={{
          background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(239,68,68,0.10))",
          border: "1px solid rgba(245,158,11,0.4)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap", marginBottom: 8,
        }}>
          <div style={{ fontWeight: 600 }}>
            {selectedCount} user{selectedCount === 1 ? "" : "s"} selected
          </div>
          <div className="adm-row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="adm-btn warn sm" disabled={bulkBusy} onClick={() => askBulk("ban")}>
              🚫 Ban
            </button>
            <button className="adm-btn ghost sm" disabled={bulkBusy} onClick={() => askBulk("unban")}>
              ✓ Unban
            </button>
            <button className="adm-btn danger sm" disabled={bulkBusy} onClick={() => askBulk("delete")}>
              🗑 Delete
            </button>
            <button className="adm-btn ghost sm" disabled={bulkBusy} onClick={clearSelection}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                    onChange={togglePage}
                    disabled={visibleSelectable.length === 0}
                    title={
                      visibleSelectable.length === 0
                        ? "Nothing on this page can be bulk-acted (admins / self)"
                        : allPageSelected ? "Unselect all on this page" : "Select all on this page"
                    }
                  />
                </th>
                <th>User</th><th>Email</th><th>Level</th><th>Coins</th>
                <th>Games</th><th>High</th><th>Status</th><th>Joined</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const selectable = isSelectable(u);
                const checked = selectedIds.has(u.id);
                return (
                  <tr key={u.id} style={{
                    background: checked ? "rgba(245,158,11,0.08)" : undefined,
                  }}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select @${u.username}`}
                        checked={checked}
                        disabled={!selectable}
                        onChange={() => toggleOne(u.id)}
                        title={!selectable ? (u.id === me.id ? "Can't bulk-act on yourself" : "Can't bulk-act on admins") : ""}
                      />
                    </td>
                    <td>@{u.username}</td>
                    <td className="mono">{u.email}</td>
                    <td>L{u.level || 1}</td>
                    <td>{u.coins || 0}</td>
                    <td>{u.games_played || 0}</td>
                    <td>{u.high_score || 0}</td>
                    <td>
                      {u.is_admin && <span className="adm-tag admin">admin</span>}{" "}
                      {u.pro && <span className="adm-tag pro">pro</span>}{" "}
                      {u.banned_at && <span className="adm-tag banned">banned</span>}
                    </td>
                    <td>{timeAgo(u.created_at)}</td>
                    <td>
                      <button className="adm-btn ghost sm" onClick={() => setEditing(u)}>Manage</button>
                    </td>
                  </tr>
                );
              })}
              {!data.users.length && (
                <tr><td colSpan={10} style={{ color: "var(--text-dim)", textAlign: "center" }}>No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="adm-pager">
          <span>Showing {data.users.length} of {data.total}</span>
          <div className="adm-row">
            <button className="adm-btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</button>
            <button className="adm-btn ghost sm" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>Next →</button>
          </div>
        </div>
      </div>

      {editing && <UserEditor user={editing} me={me} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} toasts={toasts} />}

      {confirmAction && (
        <BulkConfirm
          action={confirmAction}
          users={data.users}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => runBulk(confirmAction)}
          busy={bulkBusy}
        />
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      className={`adm-btn ${active ? "" : "ghost"} sm`}
      onClick={onClick}
      style={{
        fontWeight: active ? 700 : 500,
        background: active ? "linear-gradient(135deg, #f59e0b, #ef4444)" : undefined,
        color: active ? "#fff" : undefined,
        border: active ? "none" : undefined,
      }}
    >
      {children}
    </button>
  );
}

// ─── Bulk action confirmation ──────────────────────────────────────────────
// Hard delete forces the admin to TYPE "DELETE" before the button
// enables. Cheap, well-established friction that turns a one-misclick
// data-loss event into a deliberate action. Ban / unban are reversible
// so they just need a single-click confirm.
function BulkConfirm({ action, users, onCancel, onConfirm, busy }) {
  const [typed, setTyped] = useState("");
  const isDelete = action.kind === "delete";
  const REQUIRED = "DELETE";
  const verbVerb = isDelete ? "Delete" : action.kind === "ban" ? "Ban" : "Unban";
  const verbVerbing = isDelete ? "Deleting" : action.kind === "ban" ? "Banning" : "Unbanning";
  const verbed = isDelete ? "deleted" : action.kind === "ban" ? "banned" : "unbanned";

  // Resolve usernames for the IDs in this action — the list might span
  // multiple pages, but for any IDs not in the current page's data we
  // just show the raw id. Server also returns its own skipped list
  // post-action, so showing "id X" here for off-page rows is honest
  // about what we know.
  const labels = action.ids.map((id) => {
    const u = users.find((x) => x.id === id);
    return u ? `@${u.username}` : `id ${id}`;
  });
  const preview = labels.slice(0, 8).join(", ") + (labels.length > 8 ? `, +${labels.length - 8} more` : "");

  const okToFire = !busy && (!isDelete || typed === REQUIRED);

  return (
    <div className="adm-modal-backdrop" onClick={onCancel}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <h2 style={{ marginTop: 0, color: isDelete ? "var(--bad)" : undefined }}>
          {verbVerb} {action.ids.length} user{action.ids.length === 1 ? "" : "s"}?
        </h2>

        {isDelete && (
          <div style={{
            background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13,
          }}>
            <strong>This is irreversible.</strong> All of these users' stats, friends,
            challenges, leaderboard entries, cosmetics, badges, and chat history will
            be permanently removed (FK cascades). Server skips bootstrap admins + you.
          </div>
        )}

        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14 }}>
          <strong style={{ color: "var(--text)" }}>Affecting:</strong> {preview}
        </div>

        {isDelete && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>
              Type <code style={{ color: "var(--bad)" }}>{REQUIRED}</code> to confirm:
            </label>
            <input
              className="adm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={REQUIRED}
              autoFocus
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
        )}

        <div className="adm-row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="adm-btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`adm-btn ${isDelete ? "danger" : action.kind === "ban" ? "warn" : ""}`}
            onClick={onConfirm}
            disabled={!okToFire}
          >
            {busy ? `${verbVerbing}…` : `${verbVerb} ${action.ids.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserEditor({ user, me, onClose, onSaved, toasts }) {
  const [busy, setBusy] = useState(false);
  const isSelf = user.id === me.id;

  const patch = async (body, msg) => {
    setBusy(true);
    try {
      await api.put(`/admin/users/${user.id}`, body);
      toasts.push(msg || "Saved", "ok");
      onSaved();
    } catch (e) {
      toasts.push(e?.response?.data?.error || "Failed", "err");
    }
    setBusy(false);
  };

  const del = async () => {
    if (!confirm(`Delete @${user.username}? This is irreversible.`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toasts.push("User deleted", "ok");
      onSaved();
    } catch (e) {
      toasts.push(e?.response?.data?.error || "Failed", "err");
    }
    setBusy(false);
  };

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>@{user.username}</h2>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 14 }}>
          {user.email} · joined {timeAgo(user.created_at)}
        </div>

        <div className="adm-grid adm-grid-2 adm-mb">
          <Stat l="Level" v={user.level || 1} />
          <Stat l="XP" v={user.xp || 0} />
          <Stat l="Coins" v={user.coins || 0} />
          <Stat l="High score" v={user.high_score || 0} />
          <Stat l="Games" v={user.games_played || 0} />
          <Stat l="Daily streak" v={(user.current_daily_streak || 0) + " / best " + (user.longest_daily_streak || 0)} />
        </div>

        <h3 style={{ marginTop: 0 }}>Admin actions</h3>
        <div className="adm-col">
          <button className="adm-btn ghost" disabled={busy || isSelf}
                  onClick={() => patch({ is_admin: !user.is_admin }, user.is_admin ? "Demoted" : "Promoted")}>
            {user.is_admin ? "Demote from admin" : "Promote to admin"}
          </button>
          <button className={`adm-btn ${user.banned_at ? "good" : "warn"}`} disabled={busy || isSelf}
                  onClick={() => patch({ banned: !user.banned_at }, user.banned_at ? "Unbanned" : "Banned")}>
            {user.banned_at ? "Unban" : "Ban"}
          </button>
          <div className="adm-row">
            <button className="adm-btn ghost" disabled={busy} onClick={() => patch({ grant_pro_days: 30 }, "Granted 30 days Pro")}>+30 days Pro</button>
            <button className="adm-btn ghost" disabled={busy} onClick={() => patch({ grant_pro_days: 365 }, "Granted 1 year Pro")}>+1 year Pro</button>
            <button className="adm-btn ghost" disabled={busy} onClick={() => patch({ grant_pro_days: 0 }, "Pro revoked")}>Revoke Pro</button>
          </div>
          <div className="adm-row">
            <button className="adm-btn ghost" disabled={busy} onClick={() => patch({ set_coins: (user.coins || 0) + 500 }, "+500 coins")}>+500 🪙</button>
            <button className="adm-btn ghost" disabled={busy} onClick={() => patch({ set_coins: 0 }, "Coins reset")}>Zero coins</button>
          </div>
          <button className="adm-btn warn" disabled={busy} onClick={() => confirm("Reset all stats for this user?") && patch({ reset_stats: true }, "Stats reset")}>
            Reset all stats
          </button>
          <button className="adm-btn danger" disabled={busy || isSelf} onClick={del}>Delete user</button>
        </div>

        <div className="adm-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button className="adm-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ l, v }) {
  return (
    <div>
      <div className="adm-stat-label">{l}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
    </div>
  );
}

// ─── Questions ──────────────────────────────────────────────────────────────
function Questions({ toasts }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [diff, setDiff] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ total: 0, questions: [] });
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const limit = 50;

  const load = useCallback(() => {
    const params = { q, limit, offset };
    if (cat) params.category = cat;
    if (diff) params.difficulty = diff;
    api.get("/admin/questions", { params })
      .then((r) => setData(r.data))
      .catch((e) => toasts.push(e?.response?.data?.error || "load failed", "err"));
  }, [q, cat, diff, offset, toasts]);
  useEffect(() => { load(); }, [load]);

  const del = async (id) => {
    if (!confirm("Delete this question?")) return;
    try {
      await api.delete(`/admin/questions/${id}`);
      toasts.push("Deleted", "ok");
      load();
    } catch (e) { toasts.push("Failed", "err"); }
  };

  return (
    <>
      <div className="adm-header">
        <h1>Questions <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-dim)" }}>· {data.total}</span></h1>
        <div className="adm-row">
          <button className="adm-btn ghost" onClick={() => setBulkOpen(true)}>Bulk import</button>
          <button className="adm-btn" onClick={() => setAdding(true)}>+ Add question</button>
        </div>
      </div>

      <div className="adm-card adm-mb">
        <div className="adm-grid adm-grid-4">
          <input className="adm-input" placeholder="Search question or answer" value={q}
                 onChange={(e) => { setOffset(0); setQ(e.target.value); }} />
          <select className="adm-select" value={cat} onChange={(e) => { setOffset(0); setCat(e.target.value); }}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="adm-select" value={diff} onChange={(e) => { setOffset(0); setDiff(e.target.value); }}>
            <option value="">All difficulties</option>
            {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="adm-btn ghost" onClick={load}>Reload</button>
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>ID</th><th>Category</th><th>Diff</th><th>Question</th><th>Source</th><th>Served</th><th></th></tr>
            </thead>
            <tbody>
              {data.questions.map((qq) => (
                <tr key={qq.id}>
                  <td className="mono">{qq.id}</td>
                  <td style={{ maxWidth: 160 }}>{qq.category_name}</td>
                  <td><span className={`adm-tag ${qq.difficulty}`}>{qq.difficulty}</span></td>
                  <td style={{ maxWidth: 360 }}><div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{qq.question}</div></td>
                  <td className="mono">{qq.source}</td>
                  <td>{qq.served_count}</td>
                  <td>
                    <div className="adm-row">
                      <button className="adm-btn ghost sm" onClick={() => setEditing(qq)}>Edit</button>
                      <button className="adm-btn danger sm" onClick={() => del(qq.id)}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data.questions.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-dim)" }}>No questions match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="adm-pager">
          <span>Showing {data.questions.length} of {data.total}</span>
          <div className="adm-row">
            <button className="adm-btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</button>
            <button className="adm-btn ghost sm" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>Next →</button>
          </div>
        </div>
      </div>

      {(editing || adding) && (
        <QuestionEditor
          question={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { setEditing(null); setAdding(false); load(); }}
          toasts={toasts}
        />
      )}
      {bulkOpen && <BulkImport onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); load(); }} toasts={toasts} />}
    </>
  );
}

function QuestionEditor({ question, onClose, onSaved, toasts }) {
  const [form, setForm] = useState(question ? {
    category_id: question.category_id,
    difficulty: question.difficulty,
    question: question.question,
    correct_answer: question.correct_answer,
    incorrect_answers: Array.isArray(question.incorrect_answers) ? question.incorrect_answers : JSON.parse(question.incorrect_answers || "[]"),
  } : {
    category_id: CATEGORIES[0].id, difficulty: "easy",
    question: "", correct_answer: "",
    incorrect_answers: ["", "", ""],
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (question) await api.put(`/admin/questions/${question.id}`, form);
      else await api.post("/admin/questions", form);
      toasts.push(question ? "Saved" : "Added", "ok");
      onSaved();
    } catch (err) {
      toasts.push(err?.response?.data?.error || "Failed", "err");
    }
    setBusy(false);
  };

  const setIncorrect = (i, v) => {
    const next = form.incorrect_answers.slice();
    next[i] = v;
    setForm({ ...form, incorrect_answers: next });
  };

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <form className="adm-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>{question ? "Edit question" : "Add question"}</h2>
        <div className="adm-col">
          <div className="adm-grid adm-grid-2">
            <select className="adm-select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="adm-select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <textarea className="adm-textarea" placeholder="Question text" value={form.question}
                    onChange={(e) => setForm({ ...form, question: e.target.value })} required />
          <input className="adm-input" placeholder="✓ Correct answer" value={form.correct_answer}
                 onChange={(e) => setForm({ ...form, correct_answer: e.target.value })} required />
          {[0, 1, 2].map((i) => (
            <input key={i} className="adm-input" placeholder={`✕ Incorrect answer ${i + 1}`}
                   value={form.incorrect_answers[i] || ""} onChange={(e) => setIncorrect(i, e.target.value)} required />
          ))}
          <div className="adm-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="adm-btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="adm-btn" disabled={busy}>{busy ? "Saving…" : (question ? "Save" : "Add")}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function BulkImport({ onClose, onDone, toasts }) {
  const [text, setText] = useState(`[\n  {\n    "category_id": 9,\n    "difficulty": "easy",\n    "question": "Sample question?",\n    "correct_answer": "Right",\n    "incorrect_answers": ["Wrong 1", "Wrong 2", "Wrong 3"]\n  }\n]`);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    let items;
    try { items = JSON.parse(text); } catch (e) { toasts.push("Invalid JSON", "err"); return; }
    if (!Array.isArray(items)) { toasts.push("Expected a JSON array", "err"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/questions/bulk", { items });
      toasts.push(`Added ${data.added}, skipped ${data.skipped}${data.errors?.length ? `, ${data.errors.length} errors` : ""}`, "ok");
      onDone();
    } catch (e) { toasts.push("Failed", "err"); }
    setBusy(false);
  };

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Bulk import questions</h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
          Paste a JSON array. Required fields per item: <code>category_id</code>, <code>difficulty</code>, <code>question</code>, <code>correct_answer</code>, <code>incorrect_answers</code> (array of 3).
        </p>
        <textarea className="adm-textarea" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="adm-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="adm-btn ghost" onClick={onClose}>Cancel</button>
          <button className="adm-btn" onClick={submit} disabled={busy}>{busy ? "Importing…" : "Import"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Daily ──────────────────────────────────────────────────────────────────
function Daily({ toasts }) {
  const [date, setDate] = useState(() => todayKey());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/admin/daily/${date}`)
      .then((r) => setData(r.data))
      .catch((e) => toasts.push(e?.response?.data?.error || "load failed", "err"));
  }, [date, toasts]);
  useEffect(() => { load(); }, [load]);

  const regenerate = async () => {
    if (!confirm(`Regenerate the question set for ${date}? Players who haven't played yet will see new questions.`)) return;
    setBusy(true);
    try {
      await api.post("/admin/daily/regenerate", { date });
      toasts.push("Regenerated", "ok");
      load();
    } catch (e) { toasts.push("Failed", "err"); }
    setBusy(false);
  };

  return (
    <>
      <div className="adm-header">
        <h1>Daily Challenge</h1>
        <div className="adm-row">
          <input className="adm-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 180 }} />
          <button className="adm-btn warn" onClick={regenerate} disabled={busy}>Regenerate set</button>
        </div>
      </div>

      <div className="adm-grid adm-grid-2">
        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Question set ({data?.questions?.length || 0})</h3>
          {data?.questions?.length ? data.questions.map((q, i) => (
            <div key={q.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="adm-row" style={{ marginBottom: 4 }}>
                <span className="adm-tag">{i + 1}</span>
                <span className="adm-tag">{q.category_name}</span>
                <span className={`adm-tag ${q.difficulty}`}>{q.difficulty}</span>
              </div>
              <div style={{ fontWeight: 500 }}>{q.question}</div>
              <div style={{ fontSize: 12, color: "var(--good)", marginTop: 4 }}>✓ {q.correct_answer}</div>
            </div>
          )) : <div style={{ color: "var(--text-dim)" }}>No set generated for this date yet.</div>}
        </div>

        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Leaderboard ({data?.scores?.length || 0})</h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>#</th><th>User</th><th>Score</th><th>Correct</th><th>Time</th></tr></thead>
              <tbody>
                {data?.scores?.map((s, i) => (
                  <tr key={s.username + i}>
                    <td>{i + 1}</td>
                    <td>@{s.username}</td>
                    <td>{s.score}</td>
                    <td>{s.correct}/{s.total}</td>
                    <td className="mono">{(s.time_ms / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
                {!data?.scores?.length && <tr><td colSpan={5} style={{ color: "var(--text-dim)", textAlign: "center" }}>No scores submitted yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Events ─────────────────────────────────────────────────────────────────
function Events({ toasts }) {
  const [events, setEvents] = useState([]);
  const [scores, setScores] = useState([]);
  useEffect(() => {
    api.get("/admin/pro-events").then((r) => setEvents(r.data)).catch(() => {});
    api.get("/admin/scores").then((r) => setScores(r.data)).catch(() => {});
  }, []);
  return (
    <>
      <div className="adm-header"><h1>Activity</h1></div>
      <div className="adm-grid adm-grid-2">
        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Stripe / Pro events</h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Kind</th><th>User</th><th>Stripe ID</th><th>When</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td><span className="adm-tag">{e.kind}</span></td>
                    <td>{e.user_id || "—"}</td>
                    <td className="mono" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{e.stripe_event_id || "—"}</td>
                    <td>{timeAgo(e.created_at)}</td>
                  </tr>
                ))}
                {!events.length && <tr><td colSpan={4} style={{ color: "var(--text-dim)", textAlign: "center" }}>No events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Recent daily scores</h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Date</th><th>User</th><th>Score</th><th>When</th></tr></thead>
              <tbody>
                {scores.map((s, i) => (
                  <tr key={i}>
                    <td className="mono">{s.date}</td>
                    <td>@{s.username}</td>
                    <td>{s.score} ({s.correct}/{s.total})</td>
                    <td>{timeAgo(s.submitted_at)}</td>
                  </tr>
                ))}
                {!scores.length && <tr><td colSpan={4} style={{ color: "var(--text-dim)", textAlign: "center" }}>No scores yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Refresh page ───────────────────────────────────────────────────────────
function Refresh({ toasts }) {
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const load = () => api.get("/admin/overview").then((r) => setStats(r.data)).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);

  const refresh = async (force) => {
    setBusy(true);
    try {
      await api.post("/admin/questions/refresh", { force });
      toasts.push(`Background refresh started${force ? " (force)" : ""}`, "ok");
    } catch (e) { toasts.push("Failed", "err"); }
    setBusy(false);
  };

  return (
    <>
      <div className="adm-header"><h1>Bank Refresh</h1></div>
      <div className="adm-card adm-mb">
        <p style={{ marginTop: 0, color: "var(--text-dim)" }}>
          The server tops up under-stocked buckets from Open Trivia DB every 6h on its own.
          Use these buttons to trigger a sweep immediately. Throttled to ~1 request per 5s to respect their rate limit.
        </p>
        <div className="adm-row">
          <button className="adm-btn" onClick={() => refresh(false)} disabled={busy}>Run refresh now</button>
          <button className="adm-btn warn" onClick={() => refresh(true)} disabled={busy}>Force refresh (fills to max)</button>
        </div>
      </div>
      {stats && (
        <div className="adm-card">
          <h3 style={{ marginTop: 0 }}>Bucket health</h3>
          <div className="adm-grid adm-grid-3">
            {CATEGORIES.map((cat) => (
              <div key={cat.id}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{cat.name}</div>
                {DIFFS.map((d) => {
                  const b = stats.questions.buckets.find((x) => x.category_id === cat.id && x.difficulty === d);
                  const n = b ? b.count : 0;
                  const w = Math.min(100, Math.round((n / 30) * 100));
                  return (
                    <div key={d} className="adm-row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className={`adm-tag ${d}`} style={{ minWidth: 60, textAlign: "center" }}>{d}</span>
                      <div className="adm-bucket-bar"><div style={{ width: `${w}%` }} /></div>
                      <span className="mono" style={{ minWidth: 30, textAlign: "right" }}>{n}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Analytics ──────────────────────────────────────────────────────────────
function Analytics({ toasts }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/analytics").then((r) => setData(r.data)).catch((e) => toasts.push("load failed", "err"));
  }, [toasts]);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  if (!data) return <div>Loading…</div>;

  return (
    <>
      <div className="adm-header">
        <h1>Analytics</h1>
        <button className="adm-btn ghost" onClick={load}>Refresh</button>
      </div>

      <div className="adm-grid adm-grid-4 adm-mb">
        <BigStat label="Visits today" v={data.visits.today.count} sub={`${data.visits.unique_today} unique users`} />
        <BigStat label="Visits this week" v={data.visits.week.count} sub={`${data.visits.unique_week} unique users`} />
        <BigStat label="Visits this month" v={data.visits.month.count} sub={`${data.visits.unique_month} unique users`} />
        <BigStat label="Signups today" v={data.signups.today.count} sub={`${data.signups.week.count} this week`} />
      </div>

      <div className="adm-grid adm-grid-4 adm-mb">
        <BigStat label="Ads watched today" v={data.ad_watches.today.count} />
        <BigStat label="Ads this week" v={data.ad_watches.week.count} />
        <BigStat label="Ads this month" v={data.ad_watches.month.count} />
        <BigStat label="Logins today" v={data.logins.today.count} />
      </div>

      <div className="adm-grid adm-grid-3 adm-mb">
        <BigStat label="Revenue today"    v={`$${data.payments.today.revenue.toFixed(2)}`} sub={`${data.payments.today.count} purchases`} />
        <BigStat label="Revenue this week"  v={`$${data.payments.week.revenue.toFixed(2)}`} sub={`${data.payments.week.count} purchases`} />
        <BigStat label="Revenue this month" v={`$${data.payments.month.revenue.toFixed(2)}`} sub={`${data.payments.month.count} purchases`} />
      </div>

      <div className="adm-card adm-mb">
        <h3 style={{ marginTop: 0 }}>Daily breakdown (last 30 days)</h3>
        <Sparkline title="Visits" data={data.daily.visits} field="count" color="var(--accent)" />
        <Sparkline title="Ads watched" data={data.daily.ad_watches} field="count" color="var(--info)" />
        <Sparkline title="Revenue ($)" data={data.daily.payments} field="amount" color="var(--good)" />
      </div>
    </>
  );
}

function BigStat({ label, v, sub }) {
  return (
    <div className="adm-card">
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value">{v ?? 0}</div>
      {sub && <div className="adm-stat-sub">{sub}</div>}
    </div>
  );
}

function Sparkline({ title, data, field, color }) {
  // 30-day bar chart inline. Today on the right.
  const days = [];
  const map = new Map((data || []).map((d) => [d.day, d]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const row = map.get(day);
    days.push({ day, value: row ? Number(row[field] || 0) : 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.value));
  const total = days.reduce((a, b) => a + b.value, 0);
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="adm-row" style={{ marginBottom: 6 }}>
        <strong>{title}</strong>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ color: "var(--text-dim)" }}>30d total: {field === "amount" ? `$${total.toFixed(2)}` : total}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
        {days.map((d) => (
          <div key={d.day} title={`${d.day} · ${field === "amount" ? "$" + d.value.toFixed(2) : d.value}`}
            style={{
              flex: 1,
              height: `${Math.max(2, (d.value / max) * 100)}%`,
              background: color,
              opacity: d.value === 0 ? 0.15 : 0.85,
              borderRadius: 2,
            }} />
        ))}
      </div>
    </div>
  );
}

// ─── Moderation ─────────────────────────────────────────────────────────────
function Moderation({ toasts }) {
  const [reports, setReports] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [chat, setChat] = useState([]);
  const [tab, setTab] = useState("reports");
  const [filteredOnly, setFilteredOnly] = useState(false);

  const loadAll = useCallback(() => {
    api.get("/admin/moderation/reports").then((r) => setReports(r.data)).catch(() => {});
    api.get("/admin/moderation/mutes").then((r) => setMutes(r.data)).catch(() => {});
    api.get(`/admin/moderation/chat${filteredOnly ? "?filtered=1" : ""}`).then((r) => setChat(r.data)).catch(() => {});
  }, [filteredOnly]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const resolve = async (id) => {
    try { await api.post(`/admin/moderation/reports/${id}/resolve`); toasts.push("Resolved", "ok"); loadAll(); }
    catch (e) { toasts.push("Failed", "err"); }
  };
  const mute = async (userId, hours) => {
    const reason = prompt("Reason for mute (optional):") || "";
    try { await api.post("/admin/moderation/mute", { user_id: userId, hours, reason }); toasts.push(`Muted for ${hours}h`, "ok"); loadAll(); }
    catch (e) { toasts.push("Failed", "err"); }
  };
  const unmute = async (userId) => {
    try { await api.post("/admin/moderation/unmute", { user_id: userId }); toasts.push("Unmuted", "ok"); loadAll(); }
    catch (e) { toasts.push("Failed", "err"); }
  };

  return (
    <>
      <div className="adm-header">
        <h1>Moderation</h1>
        <button className="adm-btn ghost" onClick={loadAll}>Refresh</button>
      </div>

      <div className="adm-row adm-mb">
        {["reports", "mutes", "chat"].map((t) => (
          <button key={t}
            className={`adm-btn ${tab === t ? "" : "ghost"}`}
            onClick={() => setTab(t)}
            style={{ textTransform: "capitalize" }}>
            {t}{t === "reports" && reports.length ? ` · ${reports.length}` : ""}
          </button>
        ))}
      </div>

      {tab === "reports" && (
        <div className="adm-card">
          {!reports.length && <div style={{ color: "var(--text-dim)", textAlign: "center", padding: 20 }}>No open reports. Nice.</div>}
          {reports.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="adm-row" style={{ marginBottom: 4 }}>
                <span className="adm-tag">{r.room_code || "—"}</span>
                <span style={{ fontWeight: 700 }}>@{r.author}</span>
                <span style={{ color: "var(--text-dim)", fontSize: 12 }}>· reported by @{r.reporter}</span>
                <span style={{ color: "var(--text-dim)", fontSize: 12, marginLeft: "auto" }}>{timeAgo(r.created_at)}</span>
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: 13, background: "var(--panel-2)", padding: 10, borderRadius: 8 }}>
                {r.filtered ? <span style={{ color: "var(--bad)" }}>[filtered: not displayed] </span> : null}{r.text}
              </div>
              <div className="adm-row" style={{ marginTop: 8 }}>
                <button className="adm-btn warn sm" onClick={() => mute(r.author_id, 24)}>Mute 24h</button>
                <button className="adm-btn danger sm" onClick={() => mute(r.author_id, 24 * 7)}>Mute 1 week</button>
                <button className="adm-btn ghost sm" onClick={() => resolve(r.id)}>Mark resolved</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "mutes" && (
        <div className="adm-card">
          {!mutes.length && <div style={{ color: "var(--text-dim)", textAlign: "center", padding: 20 }}>No active mutes.</div>}
          <table className="adm-table">
            <thead><tr><th>User</th><th>Expires</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {mutes.map((m) => (
                <tr key={m.user_id}>
                  <td>@{m.username}</td>
                  <td className="mono">{new Date(m.muted_until).toLocaleString()}</td>
                  <td>{m.reason || "—"}</td>
                  <td><button className="adm-btn good sm" onClick={() => unmute(m.user_id)}>Unmute</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "chat" && (
        <div className="adm-card">
          <div className="adm-row adm-mb">
            <label className="adm-row" style={{ gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={filteredOnly} onChange={(e) => setFilteredOnly(e.target.checked)} />
              Show only filtered (blocked) messages
            </label>
          </div>
          <table className="adm-table">
            <thead><tr><th>When</th><th>User</th><th>Room</th><th>Message</th></tr></thead>
            <tbody>
              {chat.map((m) => (
                <tr key={m.id} style={m.filtered ? { background: "rgba(239,68,68,0.05)" } : {}}>
                  <td className="mono">{timeAgo(m.created_at)}</td>
                  <td>@{m.username}</td>
                  <td className="mono">{m.room_code || "—"}</td>
                  <td>{m.filtered && <span className="adm-tag banned">filtered</span>} {m.text}</td>
                </tr>
              ))}
              {!chat.length && <tr><td colSpan={4} style={{ color: "var(--text-dim)", textAlign: "center" }}>No chat messages.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Settings (payment credentials) ─────────────────────────────────────────
function AdminSettings({ toasts }) {
  const [config, setConfig] = useState(null);
  const [dirty, setDirty] = useState({}); // { KEY: newValue }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/settings").then((r) => setConfig(r.data)).catch(() => toasts.push("load failed", "err"));
  }, [toasts]);
  useEffect(() => { load(); }, [load]);

  if (!config) return <div>Loading…</div>;

  const save = async () => {
    if (Object.keys(dirty).length === 0) return;
    setBusy(true);
    try {
      const { data } = await api.put("/admin/settings", dirty);
      if (data.errors && data.errors.length) {
        toasts.push(`Saved with errors: ${data.errors.map((e) => `${e.key}=${e.error}`).join(", ")}`, "err");
      } else {
        toasts.push(`Saved ${data.applied.length} setting${data.applied.length === 1 ? "" : "s"}`, "ok");
      }
      setDirty({});
      setConfig({ ...config, settings: data.settings });
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "encryption_not_configured") {
        toasts.push("Set ADMIN_SETTINGS_KEY in server/.env first — see hint above", "err");
      } else {
        toasts.push(err || "save failed", "err");
      }
    }
    setBusy(false);
  };

  const onChange = (key, value) => {
    setDirty({ ...dirty, [key]: value });
  };

  const onClear = (key) => {
    setDirty({ ...dirty, [key]: "" });
  };

  // Group: PayPal vs Stripe.
  const paypalKeys = config.settings.filter((s) => s.key.startsWith("PAYPAL_"));
  const stripeKeys = config.settings.filter((s) => s.key.startsWith("STRIPE_"));

  return (
    <>
      <div className="adm-header">
        <h1>Payments &amp; Settings</h1>
        <button className="adm-btn" onClick={save} disabled={busy || Object.keys(dirty).length === 0}>
          {busy ? "Saving…" : `Save ${Object.keys(dirty).length || ""} change${Object.keys(dirty).length === 1 ? "" : "s"}`.trim()}
        </button>
      </div>

      {!config.encryption_configured && (
        <div className="adm-card" style={{ background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.5)", marginBottom: 16 }}>
          <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 6 }}>🔐 Encryption key not configured</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 10 }}>
            Add this to <code>server/.env</code> and restart the server. The key never leaves your filesystem — a database breach alone won't expose your payment credentials.
          </div>
          {config.suggest_key && (
            <div className="adm-card" style={{ padding: 10, fontFamily: "JetBrains Mono", fontSize: 12, overflow: "auto" }}>
              ADMIN_SETTINGS_KEY={config.suggest_key}
            </div>
          )}
        </div>
      )}

      <SettingsGroup title="PayPal" items={paypalKeys} dirty={dirty} onChange={onChange} onClear={onClear} />
      <SettingsGroup title="Stripe" items={stripeKeys} dirty={dirty} onChange={onChange} onClear={onClear} />

      <div className="adm-card" style={{ background: "rgba(124,58,237,0.08)", borderColor: "rgba(124,58,237,0.3)" }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 6 }}>How resolution works</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
          1. <strong>Environment variables win.</strong> If a key is set in <code>server/.env</code>, the DB value is ignored.<br />
          2. <strong>DB-stored values are encrypted</strong> at rest using <code>ADMIN_SETTINGS_KEY</code> (AES-256-GCM).<br />
          3. <strong>Switching modes</strong> (e.g. PayPal sandbox → live): change <code>PAYPAL_MODE</code> here, no redeploy.<br />
          4. <strong>Removing</strong> a value here doesn't touch your env vars — the env values still take effect.
        </div>
      </div>
    </>
  );
}

function SettingsGroup({ title, items, dirty, onChange, onClear }) {
  if (!items.length) return null;
  return (
    <div className="adm-card adm-mb">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {items.map((s) => {
        const current = dirty[s.key] != null ? dirty[s.key] : (s.preview || "");
        const sourceTag = s.source === "env"
          ? <span className="adm-tag" title="From server/.env — DB value ignored">env</span>
          : s.source === "db"
            ? <span className="adm-tag" title="Stored encrypted in DB">db</span>
            : null;
        return (
          <div key={s.key} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div className="adm-row" style={{ marginBottom: 6 }}>
              <strong style={{ fontFamily: "JetBrains Mono", fontSize: 13 }}>{s.key}</strong>
              {sourceTag}
              {s.is_secret && <span className="adm-tag" style={{ background: "rgba(245,158,11,0.2)", color: "#fcd34d" }}>secret</span>}
              <div className="adm-spacer" />
              {dirty[s.key] != null && <span style={{ fontSize: 11, color: "var(--warn)" }}>● unsaved</span>}
            </div>
            <input
              className="adm-input"
              type={s.is_secret ? "password" : "text"}
              placeholder={s.source === "env" ? "(set via env var — leave empty in DB)" : "Not set"}
              value={dirty[s.key] != null ? dirty[s.key] : (s.is_secret ? "" : (s.preview || ""))}
              onChange={(e) => onChange(s.key, e.target.value)}
              disabled={s.source === "env"}
            />
            {s.is_secret && s.preview && dirty[s.key] == null && (
              <div style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--text-dim)", marginTop: 4 }}>
                Current: {s.preview}
              </div>
            )}
            {s.source === "db" && dirty[s.key] == null && (
              <button className="adm-btn ghost sm" style={{ marginTop: 6 }} onClick={() => onClear(s.key)}>
                Clear this value
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 2FA management ─────────────────────────────────────────────────────────
function AdminSecurity({ toasts }) {
  const [status, setStatus] = useState(null);
  const [setupData, setSetupData] = useState(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [backupCodes, setBackupCodes] = useState(null);
  const [disablePwd, setDisablePwd] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/auth/2fa/status").then((r) => setStatus(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/2fa/init");
      setSetupData(data);
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "encryption_not_configured") {
        toasts.push("Set ADMIN_SETTINGS_KEY in server/.env first (Payments tab)", "err");
      } else {
        toasts.push(err || "failed", "err");
      }
    }
    setBusy(false);
  };

  const verify = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/2fa/verify", { code: verifyCode });
      setBackupCodes(data.backup_codes);
      setSetupData(null);
      setVerifyCode("");
      load();
      toasts.push("2FA enabled — save your backup codes!", "ok");
    } catch (e) {
      toasts.push(e?.response?.data?.error || "verify failed", "err");
    }
    setBusy(false);
  };

  const disable = async () => {
    if (!disablePwd) return;
    if (!confirm("Disable 2FA? Your account will be less secure.")) return;
    setBusy(true);
    try {
      await api.post("/auth/2fa/disable", { password: disablePwd });
      setDisablePwd("");
      setBackupCodes(null);
      load();
      toasts.push("2FA disabled", "ok");
    } catch (e) {
      toasts.push(e?.response?.data?.error || "failed", "err");
    }
    setBusy(false);
  };

  return (
    <>
      <div className="adm-header"><h1>Security</h1></div>

      <div className="adm-card adm-mb">
        <div className="adm-row">
          <h3 style={{ margin: 0 }}>Two-factor authentication</h3>
          <div className="adm-spacer" />
          {status && (
            <span className="adm-tag" style={{ background: status.enabled ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)" }}>
              {status.enabled ? "✓ Enabled" : "✗ Disabled"}
            </span>
          )}
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 8 }}>
          Adds a TOTP code requirement on login. Compatible with Google Authenticator, Authy, 1Password, Bitwarden.
        </p>

        {!status?.enabled && !setupData && !backupCodes && (
          <button className="adm-btn" disabled={busy} onClick={startSetup}>
            Enable 2FA
          </button>
        )}

        {setupData && (
          <div className="adm-card" style={{ background: "var(--panel-2)" }}>
            <strong>1. Scan or paste this into your authenticator app</strong>
            <div className="adm-card" style={{ padding: 10, marginTop: 8, fontFamily: "JetBrains Mono", fontSize: 12, overflow: "auto" }}>
              <div style={{ marginBottom: 6 }}>Secret: <strong>{setupData.secret}</strong></div>
              <div style={{ color: "var(--text-dim)", wordBreak: "break-all" }}>{setupData.otpauth_uri}</div>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>
              Most apps accept the URI as a deep link. Otherwise type the secret manually.
            </p>
            <strong>2. Enter the 6-digit code shown in your app:</strong>
            <div className="adm-row" style={{ marginTop: 6 }}>
              <input className="adm-input" placeholder="123456" maxLength={6} inputMode="numeric"
                     value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} autoFocus />
              <button className="adm-btn" onClick={verify} disabled={busy || verifyCode.length !== 6}>Verify</button>
            </div>
          </div>
        )}

        {backupCodes && (
          <div className="adm-card" style={{ background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.5)" }}>
            <strong>💾 Save these backup codes — they're shown only once!</strong>
            <div style={{ marginTop: 8, fontFamily: "JetBrains Mono", fontSize: 14, lineHeight: 1.8 }}>
              {backupCodes.map((c) => <div key={c}>{c}</div>)}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
              Each works once. Use them to log in if you lose your authenticator.
            </p>
            <button className="adm-btn ghost" onClick={() => setBackupCodes(null)}>I've saved them</button>
          </div>
        )}

        {status?.enabled && !setupData && !backupCodes && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>
              Backup codes remaining: <strong>{status.backup_codes_remaining}</strong>
            </div>
            <div className="adm-row">
              <input className="adm-input" type="password" placeholder="Confirm with your password"
                     value={disablePwd} onChange={(e) => setDisablePwd(e.target.value)} />
              <button className="adm-btn danger" disabled={busy || !disablePwd} onClick={disable}>Disable 2FA</button>
            </div>
          </div>
        )}
      </div>

      <div className="adm-card">
        <h3 style={{ marginTop: 0 }}>Recent admin audit log</h3>
        <AuditLog toasts={toasts} />
      </div>
    </>
  );
}

function AuditLog({ toasts }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get("/admin/audit").then((r) => setRows(r.data)).catch(() => {});
  }, []);
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{timeAgo(r.created_at)}</td>
              <td>#{r.admin_user_id}</td>
              <td className="mono">{r.action}</td>
              <td className="mono">{r.target || "—"}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} style={{ color: "var(--text-dim)", textAlign: "center" }}>No audit entries yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0; }
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function timeAgo(ms) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

createRoot(document.getElementById("admin-root")).render(<App />);
