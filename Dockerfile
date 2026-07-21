# syntax=docker/dockerfile:1

# Loom — local-first Next.js app with a native better-sqlite3 module.
# Multi-stage build: resolve dependencies, build Next, then ship a runtime image
# that carries production dependencies only.

# ---- base: toolchain + manifests shared by both installs ----
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# better-sqlite3 compiles from source whenever no prebuilt binary matches the
# target platform (notably linux/arm64), so every install stage needs a compiler.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./

# ---- prod-deps: exactly the modules the server needs at runtime ----
FROM base AS prod-deps
RUN npm ci --omit=dev

# ---- deps: the full tree, including what `next build` type-checks with ----
FROM base AS deps
RUN npm ci

# ---- build: produce the Next.js production build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal production image ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Installed clean rather than pruned out of the dev tree: `npm prune` mutates a
# tree in place and can strip files the compiled better-sqlite3 binary needs.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# App runtime files
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY next.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts

# The build cache is dead weight in the image; Next recreates what it needs.
# SQLite DB + uploaded documents live in ./data — mount a volume to persist it.
RUN rm -rf .next/cache && mkdir -p data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(()=>process.exit(0),()=>process.exit(1))"

# Apply migrations, then hand PID 1 to Next via `exec` so `docker stop` reaches
# the server and SQLite closes cleanly instead of being killed after 10s.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
