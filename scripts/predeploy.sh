#!/usr/bin/env bash
# Pre-deploy sanity checks. Runs the build, validates env files exist,
# and reports issues before you ship.
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "📋 Trivia Wheel pre-deploy checks  ($(date +%Y-%m-%d))"
echo

# 1. Server modules import cleanly.
echo "→ Checking server modules…"
( cd "$ROOT/server" && node -e "
  require('./db');
  require('./crypto');
  require('./settings');
  require('./totp');
  require('./questions');
  require('./realtime');
  require('./moderation');
  require('./routes/auth');
  require('./routes/stats');
  require('./routes/daily');
  require('./routes/pro');
  require('./routes/admin');
  require('./routes/payments');
  require('./routes/friends');
  require('./routes/questions');
  console.log('   ✓ all server modules require() cleanly');
" )

# 2. Frontend builds.
echo "→ Building frontend (production)…"
( cd "$ROOT" && npm run build > /tmp/tw-build.log 2>&1 ) || { tail -20 /tmp/tw-build.log; exit 1; }
echo "   ✓ webpack build succeeded"

# 3. Required dist artifacts.
for f in "$ROOT/dist/index.html" "$ROOT/dist/admin.html" "$ROOT/dist/style.css" "$ROOT/dist/manifest.json" "$ROOT/dist/service-worker.js"; do
  [ -f "$f" ] || { echo "   ✗ missing: $f"; exit 1; }
done
echo "   ✓ all expected dist/ assets present"

# 4. Required config files for the deploy targets we support.
for f in "$ROOT/server/Dockerfile" "$ROOT/server/fly.toml" "$ROOT/netlify.toml" "$ROOT/DEPLOY.md"; do
  [ -f "$f" ] || { echo "   ✗ missing deploy config: $f"; exit 1; }
done
echo "   ✓ deploy config files present"

# 5. Question seed bank present.
seeds=$(ls "$ROOT/server/data"/questions-seed*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$seeds" -ge 1 ] || { echo "   ✗ no question seed files found in server/data"; exit 1; }
echo "   ✓ $seeds question seed file(s)"

# 6. .env files are NOT committed (security).
if grep -qE '^\.env$' "$ROOT/server/.gitignore" || git check-ignore -q "$ROOT/server/.env" 2>/dev/null; then
  echo "   ✓ server/.env is gitignored"
else
  echo "   ⚠ server/.env is NOT in server/.gitignore — secrets could leak"
fi

# 7. dist/ should be gitignored.
if grep -q '^dist$' "$ROOT/.gitignore" 2>/dev/null; then
  echo "   ✓ dist/ is gitignored"
else
  echo "   ⚠ dist/ is NOT in .gitignore"
fi

echo
echo "✅ Pre-deploy checks passed."
echo
echo "Next steps:"
echo "  Backend:  cd server && fly deploy"
echo "  Frontend: git push origin master   (Netlify auto-deploys)"
echo "  Smoke:    curl https://YOUR_FLY_HOST/api/health/full"
