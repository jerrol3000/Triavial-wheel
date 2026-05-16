const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || "dev-only-not-secure";

// Fresh random session id minted on every login / register / password change.
// Embedded in JWTs as `sid` and compared to users.session_id on each auth.
function newSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

// Persist a new session_id on the user row and return it.
function rotateSession(userId) {
  const sid = newSessionId();
  db.prepare("UPDATE users SET session_id = ? WHERE id = ?").run(sid, userId);
  return sid;
}

// Mint a JWT carrying the user's current session_id. Caller must have
// already rotated the session (or be re-issuing for an existing one).
function sign(user, sessionId) {
  if (!sessionId) throw new Error("sign() requires sessionId");
  return jwt.sign(
    { id: user.id, username: user.username, sid: sessionId },
    SECRET,
    { expiresIn: "30d" }
  );
}

// Single source of truth for "is this token still valid?". Verifies the
// JWT signature, then confirms its sid matches the user's current
// session_id (rejects superseded tokens from another device) and that
// the account isn't banned. Returns { decoded, row } on success, or
// { error: "..." } with one of: invalid, session_superseded, banned.
function verifySession(token) {
  let decoded;
  try { decoded = jwt.verify(token, SECRET); }
  catch (e) { return { error: "invalid" }; }
  const row = db.prepare(
    "SELECT id, banned_at, session_id, is_admin FROM users WHERE id = ?"
  ).get(decoded.id);
  if (!row) return { error: "invalid" };
  if (row.banned_at) return { error: "banned" };
  // Legacy tokens (no sid) and rows with no session_id yet are rejected —
  // forces a fresh login the first time after this change rolls out.
  if (!decoded.sid || !row.session_id || decoded.sid !== row.session_id) {
    return { error: "session_superseded" };
  }
  return { decoded, row };
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "missing token" });
  const result = verifySession(token);
  if (result.error === "banned") return res.status(403).json({ error: "banned" });
  if (result.error) return res.status(401).json({ error: result.error });
  req.user = result.decoded;
  next();
}

function optionalAuth(req, res, next) {
  const token = bearer(req);
  if (token) {
    const result = verifySession(token);
    if (!result.error) req.user = result.decoded;
    // Otherwise fall through anonymously — don't 401 on optional auth.
  }
  next();
}

function requireAdmin(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "missing token" });
  const result = verifySession(token);
  if (result.error === "banned") return res.status(403).json({ error: "forbidden" });
  if (result.error) return res.status(401).json({ error: result.error });
  if (!result.row.is_admin) return res.status(403).json({ error: "admin only" });
  req.user = result.decoded;
  next();
}

module.exports = { sign, rotateSession, verifySession, requireAuth, optionalAuth, requireAdmin };
