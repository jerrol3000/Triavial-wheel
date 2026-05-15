// AES-256-GCM envelope encryption for admin-editable secrets.
// The master key (KEK) lives in ADMIN_SETTINGS_KEY env var and never in the DB.
// DB rows store ciphertext + IV + auth-tag. A DB-only compromise yields nothing.
const crypto = require("crypto");

const ALGO = "aes-256-gcm";

function getKey() {
  const raw = process.env.ADMIN_SETTINGS_KEY;
  if (!raw) return null;
  // Accept either a 64-char hex string (32 bytes) directly, OR any passphrase
  // (derive via SHA-256 so the user can use a passphrase if they want).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function isConfigured() {
  return !!getKey();
}

// Stored format: "v1:<base64 iv>:<base64 tag>:<base64 ciphertext>"
function encrypt(plaintext) {
  const key = getKey();
  if (!key) throw new Error("ADMIN_SETTINGS_KEY not set");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

function decrypt(payload) {
  const key = getKey();
  if (!key) throw new Error("ADMIN_SETTINGS_KEY not set");
  const parts = String(payload).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Bad ciphertext format");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// Used to suggest a fresh key for first-time setup (printed to logs once).
function suggestKey() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { encrypt, decrypt, isConfigured, suggestKey };
