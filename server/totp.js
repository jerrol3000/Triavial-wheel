// Minimal RFC 6238 TOTP — compatible with Google Authenticator, Authy, 1Password.
// 6 digits, 30-second step, SHA-1, ±1 step drift tolerance.
const crypto = require("crypto");

const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32encode(buf) {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += ALPH[parseInt(chunk, 2)];
  }
  return out;
}

function base32decode(str) {
  let bits = "";
  for (const c of String(str).toUpperCase().replace(/=/g, "")) {
    const idx = ALPH.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32encode(crypto.randomBytes(20));
}

function totp(secret, time = Math.floor(Date.now() / 1000), step = 30, digits = 6) {
  const counter = Math.floor(time / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const key = base32decode(secret);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % Math.pow(10, digits)).padStart(digits, "0");
}

function verify(secret, code, opts = {}) {
  if (!secret || !code) return false;
  code = String(code).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const window = opts.window == null ? 1 : Number(opts.window);
  const now = Math.floor(Date.now() / 1000);
  for (let w = -window; w <= window; w++) {
    if (totp(secret, now + w * 30) === code) return true;
  }
  return false;
}

function otpauthUri(secret, account, issuer = "Trivia Wheel") {
  const s = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6&algorithm=SHA1`;
  return s;
}

function generateBackupCodes(n = 8) {
  // Random short codes, e.g. "A4F2-9C3D" — easy to type, hard to brute-force.
  const codes = [];
  for (let i = 0; i < n; i++) {
    const buf = crypto.randomBytes(4);
    const hex = buf.toString("hex").toUpperCase();
    codes.push(hex.slice(0, 4) + "-" + hex.slice(4));
  }
  return codes;
}

module.exports = { generateSecret, verify, otpauthUri, generateBackupCodes, totp };
