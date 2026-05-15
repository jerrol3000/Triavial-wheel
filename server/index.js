require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const statsRoutes = require("./routes/stats");
const dailyRoutes = require("./routes/daily");
const proRoutes = require("./routes/pro");
const questionRoutes = require("./routes/questions");
const adminRoutes = require("./routes/admin");
const paymentRoutes = require("./routes/payments");
const friendsRoutes = require("./routes/friends");
const { handleWebhook } = require("./routes/pro");
const { seedFromFile, startBackgroundRefresh, getTotalCount } = require("./questions");
const realtime = require("./realtime");

const app = express();

const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(cors({ origin: origins.length === 1 && origins[0] === "*" ? true : origins }));

// Stripe webhook needs the raw body — mount it BEFORE the JSON parser.
app.post("/api/pro/webhook", express.raw({ type: "application/json" }), handleWebhook);

// 4MB cap so avatar uploads (up to 3MB encoded data URLs) succeed. Larger
// requests are rejected. Every other endpoint uses tiny payloads.
app.use(express.json({ limit: "4mb" }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/daily", dailyRoutes);
app.use("/api/pro", proRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pay", paymentRoutes);
app.use("/api/friends", friendsRoutes);

app.use((err, req, res, next) => {
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
});
