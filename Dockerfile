# syntax=docker/dockerfile:1

# Loom — local-first Next.js app with a native better-sqlite3 module.
# Multi-stage build: compile deps once, build Next, then ship a pruned runtime.

# ---- deps: install all dependencies (build tools present for better-sqlite3) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Toolchain in case a prebuilt better-sqlite3 binary isn't available for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: produce the Next.js production build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal production image ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Reuse the already-compiled node_modules, then drop devDependencies
# (keeps the native better-sqlite3 binary, removes drizzle-kit/eslint/etc.).
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
RUN npm prune --omit=dev

# App runtime files
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY next.config.ts ./next.config.ts
COPY drizzle ./drizzle
COPY scripts ./scripts

# SQLite DB + uploaded documents live here; mount a volume to persist them.
RUN mkdir -p data
VOLUME ["/app/data"]

EXPOSE 3000

# Apply migrations, then start the server bound to all interfaces.
CMD ["sh", "-c", "node scripts/migrate.mjs && node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
