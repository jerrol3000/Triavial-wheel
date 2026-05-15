const jwt = require("jsonwebtoken");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || "dev-only-not-secure";

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    SECRET,
    { expiresIn: "30d" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    req.user = jwt.verify(token, SECRET);
    // Reject banned users.
    const row = db.prepare("SELECT banned_at FROM users WHERE id = ?").get(req.user.id);
    if (row && row.banned_at) return res.status(403).json({ error: "banned" });
    next();
  } catch (e) {
    res.status(401).json({ error: "invalid token" });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
    } catch (e) {
      // ignore — anonymous
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    req.user = jwt.verify(token, SECRET);
    const row = db.prepare("SELECT is_admin, banned_at FROM users WHERE id = ?").get(req.user.id);
    if (!row || row.banned_at) return res.status(403).json({ error: "forbidden" });
    if (!row.is_admin) return res.status(403).json({ error: "admin only" });
    next();
  } catch (e) {
    res.status(401).json({ error: "invalid token" });
  }
}

module.exports = { sign, requireAuth, optionalAuth, requireAdmin };
