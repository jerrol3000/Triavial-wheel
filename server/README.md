# Trivia Wheel — Backend

Node + Express + SQLite. Cheapest possible stack — the SQLite file lives next to the server, so any $5/mo VPS, the Fly.io / Render / Railway free tier, or a Raspberry Pi will run this.

## Quick start

```sh
cd server
cp .env.example .env
npm install
npm start
```

API listens on `:4000` by default. Health check at `GET /api/health`.

## Endpoints

| Method | Path                          | Auth   | Notes                                              |
| ------ | ----------------------------- | ------ | -------------------------------------------------- |
| POST   | `/api/auth/register`          | —      | `{ email, username, password }` → `{ token, user }` |
| POST   | `/api/auth/login`             | —      | `{ emailOrUsername, password }` → `{ token, user }` |
| GET    | `/api/auth/me`                | yes    | Current user                                       |
| GET    | `/api/stats`                  | yes    | Full stats blob (xp, level, coins, powerups, etc.) |
| PUT    | `/api/stats`                  | yes    | Patch allowed fields (coins, powerups, themes...)  |
| POST   | `/api/stats/game`             | yes    | Submit end-of-game results                         |
| POST   | `/api/stats/achievement`      | yes    | Unlock an achievement                              |
| GET    | `/api/stats/leaderboard`      | —      | Top 50 high scores                                 |
| GET    | `/api/daily/today`            | opt    | `{ date, seed, alreadyPlayed }`                    |
| POST   | `/api/daily/submit`           | yes    | Submit daily result (once per day)                 |
| GET    | `/api/daily/leaderboard`      | —      | Today's leaderboard                                |
| GET    | `/api/pro/status`             | yes    | Pro subscription state                             |
| POST   | `/api/pro/checkout`           | yes    | Create a Stripe Checkout session (or dev-grant)    |
| POST   | `/api/pro/buy-coins`          | yes    | `{ pack: 'small' \| 'medium' \| 'large' }`         |
| POST   | `/api/pro/buy-theme`          | yes    | `{ theme_id }` — spends coins                      |
| POST   | `/api/pro/webhook`            | Stripe | Subscription lifecycle events (signed)             |

## Stripe

To enable real payments, fill these in `.env`:

- `STRIPE_SECRET_KEY` — from the Stripe dashboard
- `STRIPE_PRO_PRICE_ID` — the price ID for Trivia Pro (e.g. $2.99/mo recurring)
- `STRIPE_WEBHOOK_SECRET` — from `stripe listen --forward-to localhost:4000/api/pro/webhook`

Until those are set, `POST /api/pro/checkout` returns `devGranted: true` and unlocks Pro for 5 minutes — useful for exercising the UI without real billing.

## Database

SQLite file at `./data/trivia.db` (configurable via `DB_PATH`). The schema is created automatically on first boot. Back it up by copying the file.

WAL mode is enabled, so reads don't block writes.

## Deploy

The cheapest path:

1. Buy a $5/mo VPS (Hetzner, DigitalOcean, Vultr).
2. `git clone`, `cd server`, `npm ci`, set up `.env`, run under `pm2` or `systemd`.
3. Put Caddy or nginx in front for HTTPS.

Or use **Fly.io** / **Render** free tier — both support persistent disks for the SQLite file. For Fly: `fly volumes create trivia_data --size 1` and mount at `/data`, then set `DB_PATH=/data/trivia.db`.
