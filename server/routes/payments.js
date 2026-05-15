const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logEvent } = require("../events");

const router = express.Router();

// PayPal env config. Set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET to enable live billing.
// PAYPAL_MODE=live for production, "sandbox" for testing with a sandbox merchant.
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
const PAYPAL_API = MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const ENABLED = !!(CLIENT_ID && CLIENT_SECRET);

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_ENABLED = !!STRIPE_KEY;
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || "http://localhost:8080/?paid=1";
const STRIPE_CANCEL_URL  = process.env.STRIPE_CANCEL_URL  || "http://localhost:8080/?paid=0";
let stripeClient = null;
if (STRIPE_ENABLED) {
  try { stripeClient = require("stripe")(STRIPE_KEY); } catch (e) { console.error("[stripe] init failed:", e.message); }
}

// Currency + product catalog. Keep server-side so the price can't be tampered with.
const CATALOG = {
  coins_small:   { kind: "coins",   label: "Small coin bag",   amount: 0.99, grant: { coins: 200 } },
  coins_medium:  { kind: "coins",   label: "Coin stack",       amount: 2.99, grant: { coins: 600 } },
  coins_large:   { kind: "coins",   label: "Coin vault",       amount: 5.99, grant: { coins: 1500 } },
  powerups_starter: { kind: "powerups", label: "Starter pack",  amount: 0.99, grant: { powerups: { fifty: 5, skip: 5, freeze: 5, double: 5 } } },
  powerups_mega:    { kind: "powerups", label: "Mega pack",     amount: 2.99, grant: { powerups: { fifty: 20, skip: 20, freeze: 20, double: 20 } } },
  freespins_10:     { kind: "spins",    label: "10 Free Spins",  amount: 1.99, grant: { free_spins: 10 } },
  freespins_30:     { kind: "spins",    label: "30 Free Spins",  amount: 4.99, grant: { free_spins: 30 } },
};

router.get("/config", (req, res) => {
  res.json({
    paypal_enabled: ENABLED,
    paypal_mode: ENABLED ? MODE : null,
    paypal_client_id: ENABLED ? CLIENT_ID : null,
    stripe_enabled: STRIPE_ENABLED,
    catalog: Object.entries(CATALOG).map(([id, c]) => ({ id, label: c.label, kind: c.kind, amount: c.amount })),
  });
});

let cachedToken = null;
async function paypalAccessToken() {
  if (cachedToken && cachedToken.expires_at > Date.now() + 30 * 1000) return cachedToken.access_token;
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal_auth_${res.status}`);
  const json = await res.json();
  cachedToken = { access_token: json.access_token, expires_at: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.access_token;
}

router.post("/paypal/create-order", requireAuth, async (req, res) => {
  if (!ENABLED) return res.status(503).json({ error: "paypal_not_configured" });
  const productId = String(req.body?.product || "");
  const product = CATALOG[productId];
  if (!product) return res.status(400).json({ error: "unknown_product" });
  try {
    const token = await paypalAccessToken();
    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: "USD", value: product.amount.toFixed(2) },
          custom_id: `${req.user.id}|${productId}`,
          description: `Trivia Wheel — ${product.label}`,
        }],
        application_context: { brand_name: "Trivia Wheel", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" },
      }),
    });
    if (!orderRes.ok) {
      const t = await orderRes.text();
      console.error("[paypal] create order failed", t);
      return res.status(502).json({ error: "paypal_create_failed" });
    }
    const order = await orderRes.json();
    res.json({ id: order.id });
  } catch (e) {
    console.error("[paypal] create error", e);
    res.status(500).json({ error: "create_failed" });
  }
});

router.post("/paypal/capture-order", requireAuth, async (req, res) => {
  if (!ENABLED) return res.status(503).json({ error: "paypal_not_configured" });
  const orderId = String(req.body?.order_id || "");
  if (!orderId) return res.status(400).json({ error: "missing_order_id" });
  try {
    const token = await paypalAccessToken();
    const capRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!capRes.ok) {
      const t = await capRes.text();
      console.error("[paypal] capture failed", t);
      return res.status(502).json({ error: "paypal_capture_failed" });
    }
    const result = await capRes.json();
    if (result.status !== "COMPLETED") return res.status(400).json({ error: "not_completed", status: result.status });

    // Parse custom_id to discover the product. Verify it matches this user.
    const purchaseUnit = result.purchase_units && result.purchase_units[0];
    const customId = purchaseUnit && purchaseUnit.payments && purchaseUnit.payments.captures && purchaseUnit.payments.captures[0] && purchaseUnit.payments.captures[0].custom_id;
    const [uid, productId] = String(customId || "").split("|");
    if (Number(uid) !== req.user.id) return res.status(400).json({ error: "user_mismatch" });
    const product = CATALOG[productId];
    if (!product) return res.status(400).json({ error: "unknown_product" });

    grantProduct(req.user.id, product);
    db.prepare(`
      INSERT INTO pro_events (user_id, stripe_event_id, kind, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, `pp_${orderId}`, `paypal:${product.kind}:${productId}`, JSON.stringify({ amount: product.amount, label: product.label }), Date.now());
    logEvent("payment", req.user.id, product.amount, { gateway: "paypal", product: productId, order_id: orderId });

    res.json({ ok: true, granted: product.grant });
  } catch (e) {
    console.error("[paypal] capture error", e);
    res.status(500).json({ error: "capture_failed" });
  }
});

// Stripe Checkout — alternative to PayPal. Same catalog. One-time payment.
// Configures Apple Pay / Google Pay automatically via the Payment Element.
router.post("/stripe/checkout", requireAuth, async (req, res) => {
  if (!STRIPE_ENABLED || !stripeClient) return res.status(503).json({ error: "stripe_not_configured" });
  const productId = String(req.body?.product || "");
  const product = CATALOG[productId];
  if (!product) return res.status(400).json({ error: "unknown_product" });
  try {
    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],  // Stripe enables Apple/Google Pay automatically for compatible browsers
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `Trivia Wheel — ${product.label}` },
          unit_amount: Math.round(product.amount * 100),
        },
        quantity: 1,
      }],
      success_url: STRIPE_SUCCESS_URL + "&session={CHECKOUT_SESSION_ID}",
      cancel_url: STRIPE_CANCEL_URL,
      client_reference_id: String(req.user.id),
      metadata: { user_id: String(req.user.id), product_id: productId },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("[stripe] checkout error", e);
    res.status(500).json({ error: "stripe_checkout_failed" });
  }
});

// Verify + grant after Stripe Checkout redirects back. The frontend hits this
// with the session_id from the success_url to credit the account.
router.post("/stripe/verify", requireAuth, async (req, res) => {
  if (!STRIPE_ENABLED || !stripeClient) return res.status(503).json({ error: "stripe_not_configured" });
  const sessionId = String(req.body?.session_id || "");
  if (!sessionId) return res.status(400).json({ error: "missing_session_id" });
  try {
    const session = await stripeClient.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") return res.status(400).json({ error: "not_paid", status: session?.payment_status });
    if (Number(session.metadata?.user_id) !== req.user.id) return res.status(400).json({ error: "user_mismatch" });
    const product = CATALOG[session.metadata?.product_id];
    if (!product) return res.status(400).json({ error: "unknown_product" });

    // Idempotency: don't double-grant if the user refreshes the success page.
    const dup = db.prepare("SELECT id FROM pro_events WHERE stripe_event_id = ?").get(`stripe_session_${sessionId}`);
    if (dup) return res.json({ ok: true, granted: product.grant, idempotent: true });

    grantProduct(req.user.id, product);
    db.prepare(`
      INSERT INTO pro_events (user_id, stripe_event_id, kind, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, `stripe_session_${sessionId}`, `stripe:${product.kind}:${session.metadata.product_id}`, JSON.stringify({ amount: product.amount, label: product.label }), Date.now());
    logEvent("payment", req.user.id, product.amount, { gateway: "stripe", product: session.metadata.product_id, session_id: sessionId });
    res.json({ ok: true, granted: product.grant });
  } catch (e) {
    console.error("[stripe] verify error", e);
    res.status(500).json({ error: "verify_failed" });
  }
});

function grantProduct(userId, product) {
  const g = product.grant || {};
  if (typeof g.coins === "number") {
    db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?").run(g.coins, Date.now(), userId);
  }
  if (typeof g.free_spins === "number") {
    db.prepare("UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?").run(g.free_spins, Date.now(), userId);
  }
  if (g.powerups && typeof g.powerups === "object") {
    const row = db.prepare("SELECT powerups_json FROM stats WHERE user_id = ?").get(userId);
    const powerups = row ? JSON.parse(row.powerups_json) : { fifty: 0, skip: 0, freeze: 0, double: 0 };
    for (const [k, v] of Object.entries(g.powerups)) powerups[k] = (powerups[k] || 0) + v;
    db.prepare("UPDATE stats SET powerups_json = ?, updated_at = ? WHERE user_id = ?").run(JSON.stringify(powerups), Date.now(), userId);
  }
}

module.exports = router;
