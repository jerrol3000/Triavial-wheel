require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const IS_PROD = process.env.NODE_ENV === "production";

// Pre-flight checks. In production these become hard errors — fail fast and
// loudly so a misconfigured deploy never silently serves bad responses.
function preflight() {
  const missing = [];
  const warnings = [];

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change-me-to-a-long-random-string" || process.env.JWT_SECRET === "dev-only-not-secure") {
    if (IS_PROD) missing.push("JWT_SECRET");
    else warnings.push("JWT_SECRET not set — using insecure default (dev only). All tokens reset on every restart.");
  }
  if (IS_PROD) {
    if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === "*") {
      warnings.push("CORS_ORIGIN not pinned to your frontend domain — anyone can call this API. Set it to e.g. https://yoursite.com");
    }
    if (!process.env.ADMIN_EMAILS) {
      warnings.push("ADMIN_EMAILS not set — nobody can access the admin panel.");
    }
    if (!process.env.ADMIN_SETTINGS_KEY) {
      warnings.push("ADMIN_SETTINGS_KEY not set — admin Settings panel can't store payment creds.");
    }
    if (!process.env.DB_PATH) {
      warnings.push("DB_PATH not set — SQLite file lives in ./data/. On Fly/Render with a volume, point this at the volume mount (e.g. /data/trivia.db).");
    }
  }

  warnings.forEach((w) => console.warn("[startup] ⚠ ", w));
  if (missing.length) {
    console.error("[startup] ✗ Required env vars missing in production:", missing.join(", "));
    console.error("           Set these in your hosting provider's secrets (Fly: `fly secrets set ...`).");
    process.exit(1);
  }
}
preflight();

const authRoutes = require("./routes/auth");
const statsRoutes = require("./routes/stats");
const dailyRoutes = require("./routes/daily");
const proRoutes = require("./routes/pro");
const questionRoutes = require("./routes/questions");
const adminRoutes = require("./routes/admin");
const paymentRoutes = require("./routes/payments");
const friendsRoutes = require("./routes/friends");
const storeRoutes = require("./routes/store");
const badgeRoutes = require("./routes/badges");
const notificationsRoutes = require("./routes/notifications");
const seasonRoutes = require("./routes/season");
const challengesRoutes = require("./routes/challenges");
const hlRoutes = require("./routes/hl");
const vsRoutes = require("./routes/vs");
const soloRoutes = require("./routes/solo");
const { handleWebhook } = require("./routes/pro");
const { seedFromFile, startBackgroundRefresh, getTotalCount } = require("./questions");
const { seedCatalog } = require("./cosmetics");
const badges = require("./badges");
const realtime = require("./realtime");

const app = express();

const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(cors({ origin: origins.length === 1 && origins[0] === "*" ? true : origins }));

// Stripe webhook needs the raw body — mount it BEFORE the JSON parser.
app.post("/api/pro/webhook", express.raw({ type: "application/json" }), handleWebhook);

// 6MB cap so avatar uploads (up to ~4.5MB encoded data URLs ≈ 3.4MB
// raw) succeed with headroom. Avatar validation in routes/auth.js
// enforces the actual per-field limit; this cap is the outer envelope
// so the body parser doesn't bounce the request before it reaches us.
// Every other endpoint uses tiny payloads.
app.use(express.json({ limit: "6mb" }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Hard guest cap fallback. The client (src/utils/guestLimit.js) blocks
// unregistered devices at GUEST_HARD_LIMIT rounds via localStorage, but
// that's bypassable by clearing storage / opening incognito. This
// per-IP limiter on /api/questions catches that case — an anonymous IP
// can fetch question batches at a generous-but-finite rate. Auth'd
// requests skip the limit entirely (they have an account to tie abuse
// to). Tuned to comfortably fit normal play: ~20 rounds/hr is well
// above what a real human will hit in a guest session.
app.use("/api/questions", rateLimit({
  windowMs: 60 * 60 * 1000,        // 1 hour
  max: 20,                          // ≈ 20 rounds/hr for guests
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !!(req.headers && req.headers.authorization),
  message: { error: "guest_limit", detail: "Create a free account to keep playing." },
}));

app.get("/api/health", (req, res) => {
  // Cheap healthcheck — no DB hit, no auth. Used by load balancers (Fly).
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    version: process.env.APP_VERSION || "dev",
    time: Date.now(),
  });
});

// Detail check — verifies DB connectivity + reports key facts. For deploy
// verification (curl this once after rollout).
app.get("/api/health/full", (req, res) => {
  const { getTotalCount } = require("./questions");
  const settings = require("./settings");
  const { isConfigured: cryptoConfigured } = require("./crypto");
  try {
    res.json({
      ok: true,
      env: process.env.NODE_ENV || "development",
      version: process.env.APP_VERSION || "dev",
      time: Date.now(),
      database: { questions: getTotalCount() },
      crypto: { configured: cryptoConfigured() },
      paypal: { configured: !!settings.get("PAYPAL_CLIENT_ID") && !!settings.get("PAYPAL_CLIENT_SECRET") },
      stripe: { configured: !!settings.get("STRIPE_SECRET_KEY") },
      cors_origin: process.env.CORS_ORIGIN || "*",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/daily", dailyRoutes);
app.use("/api/pro", proRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pay", paymentRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/store", storeRoutes);
app.use("/api/badges", badgeRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/season", seasonRoutes);
app.use("/api/challenges", challengesRoutes);
app.use("/api/hl", hlRoutes);
app.use("/api/vs", vsRoutes);
app.use("/api/solo", soloRoutes);

// Centralized error handler. Distinguishes CLIENT errors (oversized
// body, malformed JSON, invalid charset) from genuine SERVER errors so
// a malicious client probing edge cases doesn't get a 500 for every
// dumb input — 500s are CPU-cheap for them to spray, are noise in
// our error logs, and (worst) imply server instability when there's
// none. Body-parser sets `err.type` to specific strings we can map
// to the right 4xx status. Everything else (including unexpected
// thrown errors from route handlers) still falls through to 500.
app.use((err, req, res, next) => {
  // entity.too.large — body exceeded express.json({limit}) → 413
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large" });
  }
  // entity.parse.failed / entity.verify.failed — malformed JSON or
  // bad signature in raw-body parsers → 400
  if (err && (err.type === "entity.parse.failed" || err.type === "entity.verify.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ error: "invalid_json" });
  }
  // charset.unsupported / encoding.unsupported — same family of
  // client-input mistakes
  if (err && (err.type === "charset.unsupported" || err.type === "encoding.unsupported")) {
    return res.status(415).json({ error: "unsupported_encoding" });
  }
  // Real server-side error — log + 500.
  console.error(err);
  res.status(500).json({ error: "internal" });
});

const PORT = Number(process.env.PORT || 4000);
const httpServer = http.createServer(app);
realtime.attach(httpServer);

httpServer.listen(PORT, () => {
  console.log(`trivia-wheel API listening on :${PORT}`);
  const { isConfigured, suggestKey } = require("./crypto");
  if (!isConfigured()) {
    const k = suggestKey();
    console.log("[security] ADMIN_SETTINGS_KEY not set. Generate one and add to .env:");
    console.log(`             ADMIN_SETTINGS_KEY=${k}`);
    console.log("             (or any passphrase — server will SHA-256 derive a key)");
    console.log("           Without this, the admin Settings panel can't store payment creds.");
  }
  try {
    seedFromFile();
    console.log(`[questions] bank size: ${getTotalCount()}`);
    if (process.env.DISABLE_QUESTION_REFRESH !== "1") {
      startBackgroundRefresh();
    }
  } catch (e) {
    console.error("[questions] init failed", e);
  }
  try {
    const n = seedCatalog();
    console.log(`[cosmetics] catalog seeded with ${n} items`);
  } catch (e) {
    console.error("[cosmetics] catalog seed failed", e);
  }
  try {
    const n = badges.seedCatalog();
    console.log(`[badges] catalog seeded with ${n} items`);
  } catch (e) {
    console.error("[badges] catalog seed failed", e);
  }
});
