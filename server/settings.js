const db = require("./db");
const { encrypt, decrypt, isConfigured } = require("./crypto");

// Whitelist of admin-editable settings. Anything not in this set is rejected.
// Keep it tight — these are real payment credentials and webhook secrets.
const ALLOWED = new Set([
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_SUCCESS_URL",
  "STRIPE_CANCEL_URL",
]);

const SECRET_KEYS = new Set([
  "PAYPAL_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
]);

function isAllowedKey(key) { return ALLOWED.has(key); }
function isSecret(key) { return SECRET_KEYS.has(key); }

// Resolution priority: env var first (so existing .env deployments keep working
// untouched), then DB-stored encrypted value, else null.
function get(key) {
  if (!ALLOWED.has(key)) return null;
  if (process.env[key]) return process.env[key];
  const row = db.prepare("SELECT value_encrypted FROM settings WHERE key = ?").get(key);
  if (!row) return null;
  if (!isConfigured()) {
    // Encrypted in DB but no decryption key — log a warning so the admin knows.
    console.warn(`[settings] ${key} is in DB but ADMIN_SETTINGS_KEY isn't set; ignoring`);
    return null;
  }
  try { return decrypt(row.value_encrypted); }
  catch (e) { console.error(`[settings] decrypt failed for ${key}:`, e.message); return null; }
}

function set(key, value, userId) {
  if (!ALLOWED.has(key)) throw new Error(`Setting ${key} is not editable`);
  if (!isConfigured()) throw new Error("ADMIN_SETTINGS_KEY not set — server can't encrypt new values");
  if (value == null || value === "") {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  const enc = encrypt(String(value));
  db.prepare(`
    INSERT INTO settings (key, value_encrypted, is_secret, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_encrypted = excluded.value_encrypted, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(key, enc, isSecret(key) ? 1 : 0, Date.now(), userId);
}

function mask(v) {
  if (!v) return "";
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(Math.min(20, v.length - 8))}${v.slice(-4)}`;
}

// Read-only listing for the admin UI. Secret values are returned masked.
function list() {
  const env = {};
  const dbRows = {};
  const rows = db.prepare("SELECT key, updated_at, updated_by FROM settings").all();
  rows.forEach((r) => { dbRows[r.key] = r; });

  return Array.from(ALLOWED).map((key) => {
    const fromEnv = !!process.env[key];
    const fromDb = !!dbRows[key];
    const value = get(key);
    return {
      key,
      configured: !!value,
      source: fromEnv ? "env" : (fromDb ? "db" : null),
      is_secret: isSecret(key),
      preview: value ? (isSecret(key) ? mask(value) : value) : "",
      updated_at: fromDb ? dbRows[key].updated_at : null,
      updated_by: fromDb ? dbRows[key].updated_by : null,
    };
  });
}

module.exports = { get, set, list, isAllowedKey, isSecret, isEncryptionConfigured: isConfigured };
