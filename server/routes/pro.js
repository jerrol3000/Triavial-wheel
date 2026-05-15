const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

const hasStripe = !!process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (hasStripe) {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

router.get("/status", requireAuth, (req, res) => {
  const row = db.prepare("SELECT pro_until FROM stats WHERE user_id = ?").get(req.user.id);
  const pro = !!(row && row.pro_until && row.pro_until > Date.now());
  res.json({ pro, pro_until: row ? row.pro_until : null });
});

// POST /api/pro/checkout — returns a Stripe Checkout URL, or a placeholder if Stripe isn't configured.
router.post("/checkout", requireAuth, async (req, res) => {
  if (!hasStripe || !process.env.STRIPE_PRO_PRICE_ID) {
    // Dev/free fallback: pretend the user upgraded for 5 minutes so the UI can be exercised.
    const until = Date.now() + 5 * 60 * 1000;
    db.prepare("UPDATE stats SET pro_until = ?, updated_at = ? WHERE user_id = ?").run(until, Date.now(), req.user.id);
    return res.json({ url: null, devGranted: true, pro_until: until });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: process.env.STRIPE_SUCCESS_URL || "http://localhost:8080/?pro=success",
      cancel_url: process.env.STRIPE_CANCEL_URL || "http://localhost:8080/?pro=cancel",
      client_reference_id: String(req.user.id),
      metadata: { user_id: String(req.user.id) },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("stripe checkout error", e);
    res.status(500).json({ error: "checkout failed" });
  }
});

// Stripe webhook — mounted with raw body in index.js so we can verify the signature.
async function handleWebhook(req, res) {
  if (!hasStripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "webhooks not configured" });
  }
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  db.prepare("INSERT OR IGNORE INTO pro_events (stripe_event_id, kind, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(event.id, event.type, JSON.stringify(event.data?.object || {}), Date.now());

  if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
    const obj = event.data.object;
    const userId = Number(obj.client_reference_id || obj.metadata?.user_id);
    if (userId) {
      const until = Date.now() + 31 * 24 * 60 * 60 * 1000;
      db.prepare("UPDATE stats SET pro_until = ?, updated_at = ? WHERE user_id = ?").run(until, Date.now(), userId);
    }
  }
  if (event.type === "customer.subscription.deleted") {
    const obj = event.data.object;
    const userId = Number(obj.metadata?.user_id);
    if (userId) {
      db.prepare("UPDATE stats SET pro_until = NULL, updated_at = ? WHERE user_id = ?").run(Date.now(), userId);
    }
  }
  res.json({ received: true });
}

// POST /api/pro/buy-coins — converts a one-time payment (or dev grant) into coins.
router.post("/buy-coins", requireAuth, async (req, res) => {
  const { pack } = req.body || {};
  const packs = { small: 200, medium: 600, large: 1500 };
  const amount = packs[pack];
  if (!amount) return res.status(400).json({ error: "unknown pack" });
  // Dev fallback: grant immediately. In production this would create a Checkout session.
  db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?").run(amount, Date.now(), req.user.id);
  res.json({ ok: true, granted: amount });
});

router.post("/buy-theme", requireAuth, (req, res) => {
  const { theme_id } = req.body || {};
  const known = new Set(["classic", "neon", "midnight", "sunset", "forest", "candy"]);
  if (!known.has(theme_id)) return res.status(400).json({ error: "unknown theme" });
  const row = db.prepare("SELECT themes_json, coins FROM stats WHERE user_id = ?").get(req.user.id);
  const themes = JSON.parse(row.themes_json);
  if (themes.includes(theme_id)) return res.json({ ok: true, themes });
  const cost = theme_id === "classic" ? 0 : 200;
  if (row.coins < cost) return res.status(402).json({ error: "not enough coins" });
  themes.push(theme_id);
  db.prepare("UPDATE stats SET themes_json = ?, coins = coins - ?, updated_at = ? WHERE user_id = ?")
    .run(JSON.stringify(themes), cost, Date.now(), req.user.id);
  res.json({ ok: true, themes, cost });
});

module.exports = router;
module.exports.handleWebhook = handleWebhook;
