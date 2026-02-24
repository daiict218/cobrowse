# ─── Stage 1: Install dependencies + build SDK ──────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (layer cache — only re-runs if lockfile changes)
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/sdk/package.json packages/sdk/
RUN npm ci --ignore-scripts

# Copy source and build SDK (esbuild → packages/server/public/sdk/cobrowse.js)
COPY packages/sdk/ packages/sdk/
RUN npm run build:sdk

# ─── Stage 2: Production image ──────────────────────────────────────────────
FROM node:22-alpine AS production

# Security: run as non-root
RUN addgroup -S cobrowse && adduser -S cobrowse -G cobrowse

# curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/

# Install production deps only (no SDK devDeps, no vitest)
RUN npm ci --omit=dev --workspace=packages/server --ignore-scripts \
    && npm cache clean --force

# Copy server source
COPY packages/server/ packages/server/

# Copy built SDK bundle from builder stage
COPY --from=builder /app/packages/server/public/sdk/cobrowse.js packages/server/public/sdk/cobrowse.js
COPY --from=builder /app/packages/server/public/sdk/cobrowse.min.js packages/server/public/sdk/cobrowse.min.js
COPY --from=builder /app/packages/server/public/sdk/cobrowse.js.map packages/server/public/sdk/cobrowse.js.map

# Own the app directory
RUN chown -R cobrowse:cobrowse /app

USER cobrowse

# Default env (overridden at runtime via -e or .env)
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Migrate (idempotent) → seed (idempotent) → start server
CMD ["sh", "-c", "node packages/server/src/db/migrate.js && node packages/server/src/db/seed.js && node packages/server/src/server.js"]
