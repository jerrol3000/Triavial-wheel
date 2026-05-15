const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { sign, requireAuth } = require("../auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

router.post("/register", (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "invalid email" });
  if (!username || !USERNAME_RE.test(username)) return res.status(400).json({ error: "username must be 3-20 chars, letters/numbers/underscore" });
  if (!password || password.length < 6) return res.status(400).json({ error: "password must be at least 6 chars" });

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  try {
    const isAdmin = ADMIN_EMAILS.has(email.toLowerCase()) ? 1 : 0;
    const info = db.prepare(
      "INSERT INTO users (email, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(email.toLowerCase(), username, hash, isAdmin, now);
    db.prepare("INSERT INTO stats (user_id, updated_at) VALUES (?, ?)").run(info.lastInsertRowid, now);
    db.prepare("INSERT INTO leaderboard (user_id, updated_at) VALUES (?, ?)").run(info.lastInsertRowid, now);
    const user = { id: info.lastInsertRowid, username, is_admin: !!isAdmin };
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
    "SELECT id, username, password_hash, is_admin, banned_at FROM users WHERE email = ? OR username = ?"
  ).get(String(emailOrUsername).toLowerCase(), emailOrUsername);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "wrong email/username or password" });
  }
  if (row.banned_at) return res.status(403).json({ error: "account suspended" });
  const user = { id: row.id, username: row.username, is_admin: !!row.is_admin };
  res.json({ token: sign(user), user });
});

router.get("/me", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id, email, username, is_admin, created_at FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ ...row, is_admin: !!row.is_admin });
});

module.exports = router;
