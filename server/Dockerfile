# syntax=docker/dockerfile:1.6

# ── Stage 1: install deps (with native build tools for better-sqlite3) ──
FROM node:20-slim AS builder
WORKDIR /app

# better-sqlite3 has prebuilt binaries for most platforms, but include build
# tools so a fall-back native build also works on fresh Debian images.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: slim runtime image ──
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/trivia.db

# Copy installed node_modules from the builder, then the source.
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Volume mount point for the SQLite file (created at runtime by Fly).
RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "index.js"]
