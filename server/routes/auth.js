const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { sign, rotateSession, requireAuth } = require("../auth");
const { logEvent } = require("../events");
const totp = require("../totp");
const cryptoEnv = require("../crypto");

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

// Avatar payload validator. Accepts:
//   - A short preset id like "preset:cool" / "preset:unicorn"   (≤ 32 chars)
//   - A data URL for image/{png,jpeg,gif,webp}                  (≤ 3MB encoded)
// Anything else is rejected. Returns null if valid, an error key otherwise.
const DATA_URI_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const PRESET_RE = /^preset:[a-z0-9_-]{1,24}$/;
const AVATAR_MAX = 3 * 1024 * 1024; // 3MB encoded
function validateAvatar(avatar) {
  if (avatar == null || avatar === "") return null; // clearing is OK
  const s = String(avatar);
  if (PRESET_RE.test(s)) return null;
  if (s.length > AVATAR_MAX) return "too_large";
  if (!DATA_URI_RE.test(s)) return "invalid_format";
  return null;
}

router.post("/register", (req, res) => {
  const { email, username, password, country, language, avatar } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "invalid email" });
  if (!username || !USERNAME_RE.test(username)) return res.status(400).json({ error: "username must be 3-20 chars, letters/numbers/underscore" });
  if (!password || password.length < 6) return res.status(400).json({ error: "password must be at least 6 chars" });
  const cc = country && COUNTRY_RE.test(String(country).toUpperCase()) ? String(country).toUpperCase() : null;
  const ln = language && LANGUAGE_RE.test(String(language).toLowerCase()) ? String(language).toLowerCase() : null;
  const avatarErr = validateAvatar(avatar);
  if (avatarErr) return res.status(400).json({ error: `avatar_${avatarErr}` });
  const av = avatar || null;

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  try {
    const isAdmin = ADMIN_EMAILS.has(email.toLowerCase()) ? 1 : 0;
    const info = db.prepare(
      "INSERT INTO users (email, username, password_hash, is_admin, country, language, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(email.toLowerCase(), username, hash, isAdmin, cc, ln, av, now);
    // Every new account starts with the regen-floor amount of spins so
    // they can hit the wheel immediately. Explicit value (vs relying on
    // the column DEFAULT) covers prod DBs that were created before the
    // default was bumped from 3 → 5.
    db.prepare("INSERT INTO stats (user_id, free_spins, updated_at) VALUES (?, 5, ?)").run(info.lastInsertRowid, now);
    db.prepare("INSERT INTO leaderboard (user_id, updated_at) VALUES (?, ?)").run(info.lastInsertRowid, now);
    logEvent("signup", info.lastInsertRowid, null, { country: cc, language: ln });
    const user = { id: info.lastInsertRowid, username, is_admin: !!isAdmin, country: cc, language: ln, avatar: av };
    const sid = rotateSession(info.lastInsertRowid);
    res.json({ token: sign(user, sid), user });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "email or username already taken" });
    res.status(500).json({ error: "server error" });
  }
});

router.post("/login", (req, res) => {
  const { emailOrUsername, password, totp_code } = req.body || {};
  if (!emailOrUsername || !password) return res.status(400).json({ error: "missing credentials" });
  const row = db.prepare(
    "SELECT id, username, password_hash, is_admin, banned_at, country, language, avatar, totp_secret_enc, totp_enabled, totp_backup_codes_json FROM users WHERE email = ? OR username = ?"
  ).get(String(emailOrUsername).toLowerCase(), emailOrUsername);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "wrong email/username or password" });
  }
  if (row.banned_at) return res.status(403).json({ error: "account suspended" });

  // If 2FA is enabled, require a valid TOTP code or backup code.
  if (row.totp_enabled && row.totp_secret_enc) {
    if (!totp_code) return res.status(401).json({ error: "totp_required" });
    let secret;
    try { secret = cryptoEnv.decrypt(row.totp_secret_enc); }
    catch (e) { return res.status(500).json({ error: "totp_decrypt_failed" }); }
    const cleaned = String(totp_code).replace(/\s|-/g, "").toUpperCase();
    const isCode = /^\d{6}$/.test(cleaned);
    const isBackup = /^[0-9A-F]{4}-?[0-9A-F]{4}$/.test(cleaned);
    let ok = false;
    if (isCode && totp.verify(secret, cleaned)) ok = true;
    if (!ok && isBackup && row.totp_backup_codes_json) {
      try {
        const codes = JSON.parse(row.totp_backup_codes_json);
        const idx = codes.findIndex((c) => c.replace("-", "") === cleaned.replace("-", ""));
        if (idx >= 0) {
          codes.splice(idx, 1); // one-time use
          db.prepare("UPDATE users SET totp_backup_codes_json = ? WHERE id = ?").run(JSON.stringify(codes), row.id);
          ok = true;
        }
      } catch (e) {}
    }
    if (!ok) return res.status(401).json({ error: "totp_invalid" });
  }

  logEvent("login", row.id);
  const user = {
    id: row.id, username: row.username, is_admin: !!row.is_admin,
    country: row.country, language: row.language, avatar: row.avatar,
    totp_enabled: !!row.totp_enabled,
  };
  // Rotate session_id on every login so any other device holding an
  // older token gets signed out on its next request.
  const sid = rotateSession(row.id);
  res.json({ token: sign(user, sid), user });
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
  const row = db.prepare("SELECT id, email, username, is_admin, country, language, avatar, created_at FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "not found" });
  maybeLogVisit(req.user.id);
  res.json({ ...row, is_admin: !!row.is_admin });
});

// Dedicated avatar update endpoint — accepts data URLs or preset ids.
router.put("/me/avatar", requireAuth, (req, res) => {
  const { avatar } = req.body || {};
  const err = validateAvatar(avatar);
  if (err) return res.status(400).json({ error: `avatar_${err}` });
  db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar || null, req.user.id);
  const updated = db.prepare("SELECT id, email, username, is_admin, country, language, avatar FROM users WHERE id = ?").get(req.user.id);
  res.json({ ok: true, user: { ...updated, is_admin: !!updated.is_admin } });
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
  // Password changes invalidate all sessions — mint a fresh one and
  // return a new token so the caller stays signed in on this device.
  let freshToken;
  if (new_password) {
    const sid = rotateSession(req.user.id);
    freshToken = sign({ id: req.user.id, username: req.user.username }, sid);
  }
  const updated = db.prepare("SELECT id, email, username, is_admin, country, language FROM users WHERE id = ?").get(req.user.id);
  const body = { ok: true, user: { ...updated, is_admin: !!updated.is_admin } };
  if (freshToken) body.token = freshToken;
  res.json(body);
});

// ─── 2FA (TOTP) management ───────────────────────────────────────────────
// Two-step setup. POST /2fa/init returns a secret + otpauth URI for the
// authenticator app. POST /2fa/verify confirms the user can read codes
// from the app and activates 2FA + returns backup codes ONCE.

router.post("/2fa/init", requireAuth, (req, res) => {
  if (!cryptoEnv.isConfigured()) {
    return res.status(503).json({ error: "encryption_not_configured", hint: "Set ADMIN_SETTINGS_KEY in server/.env first." });
  }
  const row = db.prepare("SELECT username, totp_enabled FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.totp_enabled) return res.status(400).json({ error: "already_enabled" });
  const secret = totp.generateSecret();
  // Store the candidate secret (still encrypted) but leave totp_enabled = 0
  // until verify succeeds, so a partial setup can't lock you out.
  const enc = cryptoEnv.encrypt(secret);
  db.prepare("UPDATE users SET totp_secret_enc = ? WHERE id = ?").run(enc, req.user.id);
  res.json({
    secret,
    otpauth_uri: totp.otpauthUri(secret, row.username),
  });
});

router.post("/2fa/verify", requireAuth, (req, res) => {
  if (!cryptoEnv.isConfigured()) return res.status(503).json({ error: "encryption_not_configured" });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "missing_code" });
  const row = db.prepare("SELECT totp_secret_enc, totp_enabled FROM users WHERE id = ?").get(req.user.id);
  if (!row || !row.totp_secret_enc) return res.status(400).json({ error: "no_setup_in_progress" });
  let secret;
  try { secret = cryptoEnv.decrypt(row.totp_secret_enc); }
  catch (e) { return res.status(500).json({ error: "decrypt_failed" }); }
  if (!totp.verify(secret, code)) return res.status(401).json({ error: "invalid_code" });
  const backup = totp.generateBackupCodes(8);
  db.prepare("UPDATE users SET totp_enabled = 1, totp_backup_codes_json = ? WHERE id = ?")
    .run(JSON.stringify(backup), req.user.id);
  res.json({ ok: true, backup_codes: backup });
});

router.post("/2fa/disable", requireAuth, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password_required" });
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: "wrong_password" });
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes_json = NULL WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

router.get("/2fa/status", requireAuth, (req, res) => {
  const row = db.prepare("SELECT totp_enabled, totp_backup_codes_json FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const backup = row.totp_backup_codes_json ? JSON.parse(row.totp_backup_codes_json) : [];
  res.json({ enabled: !!row.totp_enabled, backup_codes_remaining: backup.length });
});

module.exports = router;
