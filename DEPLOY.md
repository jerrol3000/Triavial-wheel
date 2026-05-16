# Deploying Trivia Wheel

End-to-end guide. Once you've done step 1 once, future deploys are just `git push` + `fly deploy`.

---

## Architecture

```
   ┌─ Netlify (free)                 ┌─ Fly.io / Render / VPS
   │  Static frontend (dist/)         │   Node + SQLite + WebSocket
   │  /api/* → proxied to backend ────┤   /api/* + /ws
   └─                                 └─  Persistent volume at /data
```

- **Frontend**: built to `dist/` and served by Netlify. Same-origin `/api/*` calls are proxied to the backend via `netlify.toml`.
- **Backend**: Express + better-sqlite3 + ws on Fly.io with a 1GB volume.
- **DB**: single SQLite file. Backups = `cp` the file.

---

## 1. Deploy backend to Fly.io

### One-time setup

```sh
brew install flyctl                       # or curl install
fly auth signup                            # creates account; needs a card on file
```

Open [`server/fly.toml`](server/fly.toml) and change two values:

```toml
app = "trivia-wheel-api-YOURNAME"          # globally unique
primary_region = "iad"                     # nearest region (`fly platform regions` for list)
```

### Create + provision

```sh
cd server
fly apps create trivia-wheel-api-YOURNAME
fly volumes create trivia_data --size 1 --region iad
```

### Set required secrets

These are required for production. The server **fails to boot** if `JWT_SECRET` is missing in production.

```sh
# Required
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
fly secrets set ADMIN_EMAILS=you@yourdomain.com
fly secrets set ADMIN_SETTINGS_KEY=$(openssl rand -hex 32)
fly secrets set CORS_ORIGIN=https://YOUR-NETLIFY-SITE.netlify.app
fly secrets set NODE_ENV=production
```

Payment credentials are **optional** — leave blank now and configure later from the admin panel (encrypted at rest with `ADMIN_SETTINGS_KEY`). Or pin them via env if you prefer:

```sh
# Optional — PayPal (also configurable from the admin panel)
fly secrets set PAYPAL_CLIENT_ID=AYou1...
fly secrets set PAYPAL_CLIENT_SECRET=ELxv...
fly secrets set PAYPAL_MODE=live           # or "sandbox" while testing

# Optional — Stripe (also configurable from the admin panel)
fly secrets set STRIPE_SECRET_KEY=sk_live_...
fly secrets set STRIPE_SUCCESS_URL=https://YOUR-SITE.netlify.app/?paid=1
fly secrets set STRIPE_CANCEL_URL=https://YOUR-SITE.netlify.app/?paid=0
```

### Deploy

```sh
fly deploy
```

When it finishes, copy your URL (e.g. `https://trivia-wheel-api-yourname.fly.dev`). Verify:

```sh
curl https://YOUR_FLY_HOST/api/health        # → {"ok":true,"env":"production",...}
curl https://YOUR_FLY_HOST/api/health/full   # full diagnostic — DB, crypto, payment config
```

---

## 2. Wire Netlify to the Fly backend

Open [`netlify.toml`](netlify.toml) and replace `trivia-wheel-api.fly.dev` with **your** Fly host (keep the `https://` prefix):

```toml
[[redirects]]
  from = "/api/*"
  to = "https://YOUR_FLY_HOST/api/:splat"
  status = 200
  force = true
```

Commit + push to master. Netlify auto-deploys and the proxy goes live.

---

## 3. First admin login + payment setup

1. Open `https://YOUR-NETLIFY-SITE/`
2. Sign up with the email you set in `ADMIN_EMAILS`
3. Banner shows **🛠️ Admin** pill → click → `/admin`
4. **🔒 Security tab** → enable 2FA (scan the secret into Google Authenticator) — **strongly recommended before configuring payments**
5. **🔑 Payments / Settings tab** → fill in PayPal Client ID/Secret/Mode and/or Stripe keys → Save
6. The Shop now offers real-money packs; both PayPal Smart Buttons and Stripe Checkout render side-by-side per item.

### Webhooks (optional but recommended)

**Stripe**: dashboard.stripe.com → Webhooks → Add endpoint:
- URL: `https://YOUR_FLY_HOST/api/pro/webhook`
- Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- Copy the signing secret → set `STRIPE_WEBHOOK_SECRET` in the admin Settings panel.

**PayPal**: Developer Dashboard → Apps → your app → Webhooks:
- URL: `https://YOUR_FLY_HOST/api/pro/webhook`
- Events: subscription lifecycle.

---

## Future deploys

Local pre-flight check before every push:

```sh
npm run predeploy
```

Then:

```sh
# Backend
cd server && fly deploy

# Frontend
git push origin master       # Netlify auto-deploys from master
```

---

## Environment variable matrix

| Variable | Required | Dev default | Where to set |
| --- | --- | --- | --- |
| `JWT_SECRET` | **prod — fails boot if missing** | falls back to insecure default | Fly secrets |
| `CORS_ORIGIN` | recommended in prod | `*` | Fly secrets — set to your Netlify URL |
| `ADMIN_EMAILS` | for admin access | empty | Fly secrets |
| `ADMIN_SETTINGS_KEY` | for in-app payment configuration | empty (panel disabled) | Fly secrets |
| `DB_PATH` | for persistent storage | `./data/trivia.db` | `/data/trivia.db` on Fly |
| `PORT` | optional | 4000 | Fly sets automatically (8080) |
| `NODE_ENV` | flips production guards | `development` | Fly secrets: `production` |
| `APP_VERSION` | optional, shown in /health | `dev` | git SHA, release tag, etc. |
| `PAYPAL_CLIENT_ID` / `_SECRET` / `_MODE` | for PayPal | empty | Fly secrets OR admin Settings |
| `STRIPE_SECRET_KEY` / `_WEBHOOK_SECRET` / `_PRO_PRICE_ID` | for Stripe | empty | Fly secrets OR admin Settings |
| `STRIPE_SUCCESS_URL` / `_CANCEL_URL` | for Stripe | localhost | Fly secrets OR admin |
| `DISABLE_QUESTION_REFRESH` | offline/tests | unset | set to `1` to skip opentdb sweeps |

---

## Costs (Fly.io)

- 1× `shared-cpu-1x` 256MB VM with auto-stop-when-idle: **~$0–2/mo** at low traffic
- 1 GB persistent volume: **~$0.15/mo**
- Bandwidth: 100GB outbound/mo free per region

For a low-traffic test launch: **expect under $5/mo total.**

---

## Backups

```sh
# Snapshot the Fly volume (built-in, 5-day retention)
fly volumes list
fly volumes snapshots create <volume-id>

# Or pull the DB file for a local backup
fly ssh console -C "sqlite3 /data/trivia.db .dump" > backup-$(date +%F).sql
```

---

## Troubleshooting

- **`fly deploy` fails on `better-sqlite3`** — the Dockerfile ships with `python3 make g++`. If you swapped to Alpine, also need `libc-dev`.
- **Login works but every authed request returns 401** — your `JWT_SECRET` changed between when the token was minted and now. Sign out + back in (the client auto-handles this on 401 by clearing the token and reopening the auth modal).
- **Stripe webhook signature fails** — make sure you copied the LIVE signing secret, not the test one.
- **Admin Settings says "encryption not configured"** — set `ADMIN_SETTINGS_KEY` in Fly secrets and redeploy or `fly machine restart`.
- **502 from Netlify after idle** — Fly auto-stopped the machine. First request after sleep is a ~1s cold start. Refresh.
- **CORS errors in browser console** — `CORS_ORIGIN` on Fly doesn't match your Netlify host exactly. Don't include trailing slash.
- **WebSocket fails (`/ws` 404)** — backend wasn't restarted after the realtime feature was added. `fly machine restart` or `fly deploy`.
