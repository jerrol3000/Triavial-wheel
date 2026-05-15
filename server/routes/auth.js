const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { sign, requireAuth } = require("../auth");
const { logEvent } = require("../events");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;     // ISO-3166 alpha-2
const LANGUAGE_RE = /^[a-z]{2}$/;    // ISO-639 alpha-2

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

router.post("/register", (req, res) => {
  const { email, username, password, country, language } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "invalid email" });
  if (!username || !USERNAME_RE.test(username)) return res.status(400).json({ error: "username must be 3-20 chars, letters/numbers/underscore" });
  if (!password || password.length < 6) return res.status(400).json({ error: "password must be at least 6 chars" });
  const cc = country && COUNTRY_RE.test(String(country).toUpperCase()) ? String(country).toUpperCase() : null;
  const ln = language && LANGUAGE_RE.test(String(language).toLowerCase()) ? String(language).toLowerCase() : null;

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  try {
    const isAdmin = ADMIN_EMAILS.has(email.toLowerCase()) ? 1 : 0;
    const info = db.prepare(
      "INSERT INTO users (email, username, password_hash, is_admin, country, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(email.toLowerCase(), username, hash, isAdmin, cc, ln, now);
    db.prepare("INSERT INTO stats (user_id, updated_at) VALUES (?, ?)").run(info.lastInsertRowid, now);
    db.prepare("INSERT INTO leaderboard (user_id, updated_at) VALUES (?, ?)").run(info.lastInsertRowid, now);
    logEvent("signup", info.lastInsertRowid, null, { country: cc, language: ln });
    const user = { id: info.lastInsertRowid, username, is_admin: !!isAdmin, country: cc, language: ln };
    res.json({ token: sign(user), user });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "email or username already taken" });
    res.status(500).json({ error: "server error" });
  }
});

router.post("/login", (req, res) => {
  const { emailOrUsername, password } = req.body || {};
  if (!emailOrUsername || !password) return res.status(400).json({ error: "missing credentials" });
  const row = db.prepare(
    "SELECT id, username, password_hash, is_admin, banned_at, country, language FROM users WHERE email = ? OR username = ?"
  ).get(String(emailOrUsername).toLowerCase(), emailOrUsername);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "wrong email/username or password" });
  }
  if (row.banned_at) return res.status(403).json({ error: "account suspended" });
  logEvent("login", row.id);
  const user = { id: row.id, username: row.username, is_admin: !!row.is_admin, country: row.country, language: row.language };
  res.json({ token: sign(user), user });
});

// Throttle visit logging — at most one "visit" event per user per 15 minutes
// to keep the events table proportional to actual sessions.
const lastVisitAt = new Map();
function maybeLogVisit(userId) {
  const now = Date.now();
  const last = lastVisitAt.get(userId) || 0;
  if (now - last < 15 * 60 * 1000) return;
  lastVisitAt.set(userId, now);
  logEvent("visit", userId);
}

router.get("/me", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id, email, username, is_admin, country, language, created_at FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "not found" });
  maybeLogVisit(req.user.id);
  res.json({ ...row, is_admin: !!row.is_admin });
});

// User-editable settings: language, country, password.
router.put("/me", requireAuth, (req, res) => {
  const { country, language, current_password, new_password } = req.body || {};
  const updates = [];
  const values = [];
  if (country !== undefined) {
    if (country === null || country === "") { updates.push("country = NULL"); }
    else if (COUNTRY_RE.test(String(country).toUpperCase())) { updates.push("country = ?"); values.push(String(country).toUpperCase()); }
    else return res.status(400).json({ error: "invalid_country" });
  }
  if (language !== undefined) {
    if (language === null || language === "") { updates.push("language = NULL"); }
    else if (LANGUAGE_RE.test(String(language).toLowerCase())) { updates.push("language = ?"); values.push(String(language).toLowerCase()); }
    else return res.status(400).json({ error: "invalid_language" });
  }
  if (new_password) {
    if (!current_password) return res.status(400).json({ error: "current_password_required" });
    if (String(new_password).length < 6) return res.status(400).json({ error: "password_too_short" });
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!row || !bcrypt.compareSync(current_password, row.password_hash)) return res.status(403).json({ error: "wrong_password" });
    updates.push("password_hash = ?");
    values.push(bcrypt.hashSync(new_password, 10));
  }
  if (!updates.length) return res.json({ ok: true });
  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const updated = db.prepare("SELECT id, email, username, is_admin, country, language FROM users WHERE id = ?").get(req.user.id);
  res.json({ ok: true, user: { ...updated, is_admin: !!updated.is_admin } });
});

module.exports = router;
