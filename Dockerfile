# ─── Stage 1: Install dependencies + build SDK, Agent SDK, Tenant UI ─────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (layer cache — only re-runs if lockfile changes)
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/sdk/package.json packages/sdk/
COPY packages/agent-sdk/package.json packages/agent-sdk/
COPY packages/tenant-ui/package.json packages/tenant-ui/
RUN npm ci --ignore-scripts

# Build SDK (esbuild → packages/server/public/sdk/cobrowse.js)
COPY packages/sdk/ packages/sdk/
RUN npm run build:sdk

# Build Agent SDK (esbuild → packages/server/public/sdk/cobrowse-agent.js)
COPY packages/agent-sdk/ packages/agent-sdk/
RUN npm run build:agent-sdk

# Build Tenant UI (vite → packages/server/public/tenant-ui/)
COPY packages/tenant-ui/ packages/tenant-ui/
RUN npm run build:tenant-ui

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

# Copy built SDK bundles from builder stage
COPY --from=builder /app/packages/server/public/sdk/cobrowse.js packages/server/public/sdk/cobrowse.js
COPY --from=builder /app/packages/server/public/sdk/cobrowse.min.js packages/server/public/sdk/cobrowse.min.js
COPY --from=builder /app/packages/server/public/sdk/cobrowse.js.map packages/server/public/sdk/cobrowse.js.map
COPY --from=builder /app/packages/server/public/sdk/cobrowse-agent.js packages/server/public/sdk/cobrowse-agent.js

# Copy built Tenant UI from builder stage
COPY --from=builder /app/packages/server/public/tenant-ui/ packages/server/public/tenant-ui/

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
