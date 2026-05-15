# Deploying Trivia Wheel

The frontend lives on **Netlify** (you already have this set up).
The backend lives on **Fly.io** (Node + SQLite + a persistent volume).
A `netlify.toml` proxy bridges them so the frontend just calls `/api/*` and Netlify forwards to Fly.

---

## 1. Deploy the backend to Fly.io

### One-time setup

```sh
# Install the Fly CLI (macOS)
brew install flyctl

# Sign in (or sign up — note: Fly no longer has a permanent free tier,
# but a low-traffic SQLite app fits well under $5/mo with auto-stop on)
fly auth signup            # or: fly auth login
```

### Pick a region + app name

Open [`server/fly.toml`](server/fly.toml) and edit:

- `app = "trivia-wheel-api"` → change to something globally unique you'll own (e.g. `triviawheel-jerrol`)
- `primary_region = "iad"` → pick the region closest to your players:
  - `iad` = N. Virginia · `ord` = Chicago · `lax` = Los Angeles
  - `lhr` = London · `fra` = Frankfurt · `syd` = Sydney · `nrt` = Tokyo
  - Full list: `fly platform regions`

### Create the app + persistent volume

```sh
cd server
fly apps create <your-app-name>                       # same as fly.toml `app =`
fly volumes create trivia_data --size 1 --region <region>
```

The 1 GB volume costs ~$0.15/mo and persists the SQLite database across deploys/restarts.

### Set secrets

```sh
# Required
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
fly secrets set ADMIN_EMAILS=you@yourdomain.com
fly secrets set CORS_ORIGIN=https://your-netlify-site.netlify.app

# Stripe (optional — leave unset and Pro purchases will dev-grant 5 minutes for testing)
fly secrets set STRIPE_SECRET_KEY=sk_live_...
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...
fly secrets set STRIPE_PRO_PRICE_ID=price_...
fly secrets set STRIPE_SUCCESS_URL=https://your-netlify-site.netlify.app/?pro=success
fly secrets set STRIPE_CANCEL_URL=https://your-netlify-site.netlify.app/?pro=cancel
```

### Deploy

```sh
fly deploy
```

When it finishes you'll see a URL like `https://your-app-name.fly.dev`. Test it:

```sh
curl https://your-app-name.fly.dev/api/health   # → {"ok":true}
```

### Stripe webhook (if you set Stripe keys)

In the Stripe Dashboard → **Developers → Webhooks**, add an endpoint:

- URL: `https://your-app-name.fly.dev/api/pro/webhook`
- Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`

Copy the signing secret it gives you, and update with: `fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...`

---

## 2. Wire Netlify to the Fly backend

Open [`netlify.toml`](netlify.toml) and replace `trivia-wheel-api.fly.dev` with **your** Fly app URL (no `https://` prefix needed in the placeholder, but DO keep it in the `to = "https://..."` value).

Commit and push. Netlify will redeploy and the proxy will activate:

- `https://your-site.netlify.app/api/health` → forwards to Fly
- Same-origin → no CORS headaches
- The frontend's `API_BASE_URL` default of `/api` works out of the box, no rebuild flag needed

---

## 3. First admin login

1. Open `https://your-site.netlify.app/`
2. Click **Sign in** → **Create account**
3. Use the email you put in `ADMIN_EMAILS` on Fly
4. You'll now see a **🛠️ Admin** pill in the banner. Click it to open `/admin`.

---

## Costs at a glance (Fly.io)

- 1× `shared-cpu-1x` 256 MB VM with auto-stop: **~$1.94/mo** if always-on, less if it idles
- 1 GB volume: **~$0.15/mo**
- Outbound bandwidth: free up to 100 GB/mo per region
- **Realistic monthly bill for a low-traffic game: $0–3**

To lower it further: `min_machines_running = 0` is already set, so the VM scales to zero when idle. First request after idle pays ~1 second cold-start.

---

## Backing up the SQLite DB

```sh
# Snapshot the volume (built-in, kept 5 days)
fly volumes snapshots list trivia_data
fly volumes snapshots create <volume-id>

# Or download the live DB file
fly ssh console -C "sqlite3 /data/trivia.db .dump" > backup.sql
```

---

## Troubleshooting

- **`fly deploy` fails on `better-sqlite3`**: the Dockerfile installs `python3 make g++`, but if you swapped the base image to `alpine` you'd need `python3 make g++ libc-dev` instead.
- **Frontend can't reach API**: open browser devtools → Network. If you see `localhost:4000` requests, your `netlify.toml` proxy isn't deployed yet. If you see CORS errors, double-check `CORS_ORIGIN` on Fly matches your Netlify URL exactly (no trailing slash).
- **502 from Netlify**: Fly machine is cold-starting. Refresh in a second.
- **Admin pill doesn't show**: sign out and back in — the JWT is cached and `/auth/me` populates `is_admin` on next fetch.
