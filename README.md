# Trivia Wheel

An addictive trivia game with daily challenges, streaks, power-ups, local multiplayer, and shareable results. Designed for the cheapest possible production deployment.

## What's in here

- **`src/`** — React frontend (Webpack + Redux Toolkit + MUI).
- **`server/`** — Express + SQLite API.
- **`public/`** — PWA manifest, service worker, static assets.

## Quick start (development)

```sh
# Frontend
npm install
npm start          # → http://localhost:8080

# Backend (in a second terminal)
cd server && npm install
cp .env.example .env
npm start          # → http://localhost:4000
```

The frontend talks to `http://localhost:4000/api` in development. For production, set `API_BASE_URL` at build time or rely on `/api` being proxied to your backend.

## Features

### Game loop
- 10-question rounds (Easy / Medium / Hard) across 10 categories
- Score with time bonus, streak multiplier, and difficulty multiplier
- 4 power-ups: 50/50 · Skip · Freeze (+15s) · Double points
- XP, levels (with rewards), coins (earned + bought), achievements

### Retention hooks
- **Lives**: 5 lives, regen 1 every 30 min. Pro = unlimited.
- **Daily Challenge**: one shared puzzle, deterministic per-day question set, shareable result (Wordle-style block grid), daily-streak counter, leaderboard.
- **Achievements**: 15 unlockable badges. Each one tips coins.
- **Themes**: 6 wheel skins, 2 Pro-only.

### Social
- **Pass-and-Play Multiplayer** — 2–6 players, one device, fixed scoring per question, podium screen.
- Web Share API + clipboard fallback for daily results.

### Monetization
- **Trivia Pro** ($2.99/mo) — unlimited lives, no ads, Pro themes, premium categories. Wired to Stripe Checkout via `/api/pro/checkout`; falls back to a 5-minute dev grant if Stripe keys aren't set.
- **Coin packs** ($0.99 – $5.99) — `/api/pro/buy-coins` (Stripe Checkout in production).
- **Power-up packs** — purchasable with earned coins.
- **Themes** — purchasable with earned coins; Pro-only themes are subscriber perks.
- **Tip jar** — Buy Me a Coffee link (swap in your URL).
- **Ad slot** — non-intrusive placeholder on Home; replace with AdSense / Carbon Ads / Ethical Ads markup.

### PWA
- Installable on mobile via `public/manifest.json`.
- Service worker (`public/service-worker.js`) caches shell assets for offline launches.

## Deploying for cheap

**Total monthly cost ≈ $0–5.**

1. **Frontend**: `npm run build` → upload `dist/` to Cloudflare Pages, Netlify, or Vercel (all free).
2. **Backend**: SQLite + Node.
   - Cheapest: `$5/mo` Hetzner / DigitalOcean droplet, Caddy in front of Node.
   - Free: Fly.io with a 1GB persistent volume (mount at `/data`, set `DB_PATH=/data/trivia.db`).
3. **Stripe**: set up a `$2.99/mo` recurring price for Pro, copy the price ID + webhook secret into `server/.env`.
4. Point the frontend at the backend by building with `API_BASE_URL=https://api.yoursite.com/api`.

## Architecture notes

- **Cheapest DB**: SQLite via `better-sqlite3` — the entire database is one file. WAL mode enabled. Back up with `cp`. Schema migrations run automatically on boot.
- **Auth**: JWT (30-day expiry) stored in `localStorage`. Pure email/password — no third-party SSO to keep the surface small.
- **Daily questions**: deterministic from the date seed (`mulberry32`) so every player gets the same set; falls back to a bundled question bank if Open Trivia DB is down.
- **State**: Redux Toolkit. All long-lived state (stats, UI prefs) persists to `localStorage` for instant boot, and syncs to the server when the user is signed in.

## What's NOT in this repo

- Real online multiplayer (would need WebSockets). Pass-and-play covers the "play with friends" case for now.
- Real AdSense markup. The slot is a placeholder.
- Email verification / password reset. Trivial to add — out of scope for v1.
