const db = require("./db");

// Append-only log of admin actions. Surfaced via /api/admin/audit.
function logAdmin(adminUserId, action, target = null, meta = null) {
  try {
    db.prepare(`INSERT INTO admin_audit (admin_user_id, action, target, meta, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(adminUserId || null, String(action), target == null ? null : String(target), meta ? JSON.stringify(meta) : null, Date.now());
  } catch (e) {
    console.error("[audit] log failed", e.message);
  }
}

function recent(limit = 100) {
  return db.prepare(`SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ?`).all(limit);
}

module.exports = { logAdmin, recent };
