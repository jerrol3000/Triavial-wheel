const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logEvent } = require("../events");
const settings = require("../settings");

const router = express.Router();

// Payment credentials now resolve through settings.get(), which checks env first
// then falls back to DB-stored encrypted values managed by the admin panel.
// This means flipping a key from "sandbox" to "live" no longer requires a deploy.
function paypalCreds() {
  return {
    clientId: settings.get("PAYPAL_CLIENT_ID") || "",
    clientSecret: settings.get("PAYPAL_CLIENT_SECRET") || "",
    mode: (settings.get("PAYPAL_MODE") || "sandbox").toLowerCase(),
  };
}
function paypalEnabled() {
  const c = paypalCreds();
  return !!(c.clientId && c.clientSecret);
}
function paypalApi() {
  return paypalCreds().mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function stripeKey() { return settings.get("STRIPE_SECRET_KEY") || ""; }
function stripeEnabled() { return !!stripeKey(); }
function stripeUrls() {
  return {
    success: settings.get("STRIPE_SUCCESS_URL") || "http://localhost:8080/?paid=1",
    cancel: settings.get("STRIPE_CANCEL_URL") || "http://localhost:8080/?paid=0",
  };
}
function getStripeClient() {
  const k = stripeKey();
  if (!k) return null;
  try { return require("stripe")(k); } catch (e) { console.error("[stripe] init failed:", e.message); return null; }
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
  // Season Pass premium unlock — single one-shot SKU per active
  // season. Grant handled specially via `grant.season_premium: true`
  // so the unlock targets whichever season is currently active when
  // the webhook fires (not the season at purchase-initiation time —
  // tiny edge case but matters if a season rolls over mid-checkout).
  season_premium:  { kind: "season", label: "Season Pass — Premium Track", amount: 4.99, grant: { season_premium: true } },
};

router.get("/config", (req, res) => {
  res.json({
    paypal_enabled: paypalEnabled(),
    paypal_mode: paypalEnabled() ? paypalCreds().mode : null,
    paypal_client_id: paypalEnabled() ? paypalCreds().clientId : null,
    stripe_enabled: stripeEnabled(),
    catalog: Object.entries(CATALOG).map(([id, c]) => ({ id, label: c.label, kind: c.kind, amount: c.amount })),
  });
});

let cachedToken = null;
async function paypalAccessToken() {
  if (cachedToken && cachedToken.expires_at > Date.now() + 30 * 1000) return cachedToken.access_token;
  const creds = paypalCreds();
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(`${paypalApi()}/v1/oauth2/token`, {
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
  if (!paypalEnabled()) return res.status(503).json({ error: "paypal_not_configured" });
  const productId = String(req.body?.product || "");
  const product = CATALOG[productId];
  if (!product) return res.status(400).json({ error: "unknown_product" });
  try {
    const token = await paypalAccessToken();
    const orderRes = await fetch(`${paypalApi()}/v2/checkout/orders`, {
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
  if (!paypalEnabled()) return res.status(503).json({ error: "paypal_not_configured" });
  const orderId = String(req.body?.order_id || "");
  if (!orderId) return res.status(400).json({ error: "missing_order_id" });
  try {
    const token = await paypalAccessToken();
    const capRes = await fetch(`${paypalApi()}/v2/checkout/orders/${orderId}/capture`, {
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

    // Idempotency: pro_events.stripe_event_id is UNIQUE. If PayPal (or
    // the client) re-captures the same order, the INSERT is a no-op and
    // we skip the grant + duplicate event log. Same pattern as the
    // Stripe webhook handler.
    const ins = db.prepare(`
      INSERT OR IGNORE INTO pro_events (user_id, stripe_event_id, kind, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, `pp_${orderId}`, `paypal:${product.kind}:${productId}`, JSON.stringify({ amount: product.amount, label: product.label }), Date.now());

    if (ins.changes) {
      grantProduct(req.user.id, product);
      logEvent("payment", req.user.id, product.amount, { gateway: "paypal", product: productId, order_id: orderId });
    }

    res.json({ ok: true, granted: product.grant, duplicate: ins.changes === 0 });
  } catch (e) {
    console.error("[paypal] capture error", e);
    res.status(500).json({ error: "capture_failed" });
  }
});

// Stripe Checkout — alternative to PayPal. Same catalog. One-time payment.
// Configures Apple Pay / Google Pay automatically via the Payment Element.
router.post("/stripe/checkout", requireAuth, async (req, res) => {
  const stripeClient = getStripeClient();
  if (!stripeEnabled() || !stripeClient) return res.status(503).json({ error: "stripe_not_configured" });
  const productId = String(req.body?.product || "");
  const product = CATALOG[productId];
  if (!product) return res.status(400).json({ error: "unknown_product" });
  try {
    const urls = stripeUrls();
    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `Trivia Wheel — ${product.label}` },
          unit_amount: Math.round(product.amount * 100),
        },
        quantity: 1,
      }],
      success_url: urls.success + "&session={CHECKOUT_SESSION_ID}",
      cancel_url: urls.cancel,
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
  const stripeClient = getStripeClient();
  if (!stripeEnabled() || !stripeClient) return res.status(503).json({ error: "stripe_not_configured" });
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
  // Make sure the user still has a stats row before we credit — a deleted
  // account (admin / GDPR delete during checkout) would otherwise silently
  // accept the payment and grant nothing. Throws so the caller's payment-
  // capture flow can surface a real error instead of returning 200.
  const exists = db.prepare("SELECT 1 FROM stats WHERE user_id = ?").get(userId);
  if (!exists) throw new Error("no_stats_row_for_grant");

  const g = product.grant || {};
  if (typeof g.coins === "number") {
    db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?").run(g.coins, Date.now(), userId);
  }
  if (typeof g.free_spins === "number") {
    db.prepare("UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?").run(g.free_spins, Date.now(), userId);
  }
  if (g.powerups && typeof g.powerups === "object") {
    const row = db.prepare("SELECT powerups_json FROM stats WHERE user_id = ?").get(userId);
    let powerups = { fifty: 0, skip: 0, freeze: 0, double: 0 };
    if (row && row.powerups_json) {
      try { const p = JSON.parse(row.powerups_json); if (p && typeof p === "object") powerups = p; }
      catch (e) { /* malformed json — keep defaults */ }
    }
    for (const [k, v] of Object.entries(g.powerups)) powerups[k] = (powerups[k] || 0) + v;
    db.prepare("UPDATE stats SET powerups_json = ?, updated_at = ? WHERE user_id = ?").run(JSON.stringify(powerups), Date.now(), userId);
  }
  // Season Pass premium — resolve the currently-active season at
  // grant time (not at checkout-init) so a season rollover mid-
  // purchase still credits the right pass. Upserts the user_season
  // row idempotently — re-firing the webhook is a safe no-op.
  if (g.season_premium) {
    try {
      const { currentSeason } = require("../seasons");
      const season = currentSeason();
      if (season) {
        const now = Date.now();
        db.prepare(`
          INSERT INTO user_season(user_id, season_id, xp, premium, claimed_mask, updated_at)
          VALUES (?, ?, 0, 1, 0, ?)
          ON CONFLICT(user_id, season_id) DO UPDATE SET
            premium = 1, updated_at = excluded.updated_at
        `).run(userId, season.id, now);
      }
    } catch (e) { console.error("[payments] season grant failed:", e.message); }
  }
}

module.exports = router;
