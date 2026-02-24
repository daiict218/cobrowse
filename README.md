# CoBrowse Platform

Multi-tenant co-browsing SaaS. Agents see a live reconstruction of the customer's browser (DOM mirroring, not screen capture). Sensitive fields are masked client-side before anything leaves the customer's device.

---

## Architecture

```
Customer Browser → Ably relay → Agent Panel
      ↑                ↑
   cobrowse.js      Session Server (Fastify)
   (rrweb capture   ↓
    + masking)    PostgreSQL  +  In-memory cache (→ Redis in prod)
```

**DOM mirroring via rrweb** — not screen sharing. Only the web page is captured, nothing else on the customer's device. Masking is applied before rrweb serialises the DOM.

---

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- An [Ably account](https://ably.com) (free tier works)

### 1. Clone and install

```bash
cd co-browse
cp .env.example .env
npm install
```

### 2. Configure environment

Edit `.env`:
```
ABLY_API_KEY=your_ably_api_key      # from Ably dashboard → Apps → API Keys
TOKEN_SECRET=<32+ random chars>     # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DATABASE_URL=postgresql://cobrowse:cobrowse_dev@localhost:5432/cobrowse
```

### 3. Start PostgreSQL

```bash
docker-compose up -d
```

### 4. Run migrations and seed demo tenant

```bash
npm run db:migrate
npm run db:seed
```

Copy the printed SECRET KEY and PUBLIC KEY — you'll need them in step 6.

### 5. Build the SDK

```bash
npm run build:sdk
```

This bundles `cobrowse.js` → `packages/server/public/sdk/cobrowse.js`

### 6. Configure demo apps

**Agent app** — edit `packages/agent-app/app.js`:
```js
const CONFIG = {
  serverUrl: 'http://localhost:3000',
  secretKey: 'cb_sk_...',   // ← paste SECRET KEY here
};
```

**Customer app** — edit `packages/customer-app/app.js`:
```js
const CONFIG = {
  serverUrl:  'http://localhost:3000',
  publicKey:  'cb_pk_...',  // ← paste PUBLIC KEY here
  customerId: 'cust_demo_001',
};
```

### 7. Start everything

```bash
# Terminal 1 — session server
npm start

# Terminal 2 — agent demo app (http://localhost:3002)
npm start --workspace=packages/agent-app

# Terminal 3 — customer demo app (http://localhost:3001)
npm start --workspace=packages/customer-app
```

---

## Demo flow

1. Open **http://localhost:3001** — customer's insurance claim form
2. Open **http://localhost:3002** — agent console
3. In the agent console: click **Start Co-Browse**
4. Customer sees a consent overlay on their form page
5. Customer clicks **Allow** — session becomes active
6. Agent sees the customer's form in real-time in the viewer pane
7. Agent enables the pointer (🎯 button) and moves mouse — customer sees a blue ring
8. Observe: phone number, account number, routing number fields are **blank** in the agent view

---

## Project structure

```
packages/
├── server/          Session server (Fastify + PostgreSQL + Ably)
│   └── src/
│       ├── config.js             Environment config
│       ├── db/                   PostgreSQL queries and schema
│       ├── cache/                In-memory → Redis abstraction
│       ├── utils/                Logger, errors, HMAC token
│       ├── middleware/auth.js    API key authentication
│       ├── services/             Session, Ably, audit business logic
│       └── routes/               REST endpoints
│
├── sdk/             Customer JS snippet (bundles rrweb + Ably)
│   └── src/
│       ├── index.js              Public API: CoBrowse.init()
│       ├── session.js            Session lifecycle (invite → consent → capture)
│       ├── capture.js            rrweb record wrapper
│       ├── masking.js            Client-side field masking engine
│       ├── transport.js          Ably WebSocket transport
│       └── indicator.js          Active session banner + agent pointer
│
├── agent-app/       Agent demo (simulates CRM Care Consult panel)
└── customer-app/    Customer demo (simulates client website with form)
```

---

## API Reference

All agent endpoints require `X-API-Key: cb_sk_...` header.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/sessions` | secret key | Create session |
| GET | `/api/v1/sessions/:id` | secret key | Get session status |
| DELETE | `/api/v1/sessions/:id` | secret key | End session |
| POST | `/api/v1/snapshots/:id` | customer token | Store DOM snapshot |
| GET | `/api/v1/snapshots/:id` | secret key | Fetch DOM snapshot |
| GET | `/api/v1/ably-auth` | varies by role | Get scoped Ably token |
| GET | `/consent/:sessionId` | none | Consent page (HTML) |
| POST | `/consent/:sessionId/approve` | none | Customer approves |
| POST | `/consent/:sessionId/decline` | none | Customer declines |
| GET | `/api/v1/public/masking-rules` | public key | Get masking rules (SDK) |
| PUT | `/api/v1/admin/masking-rules` | secret key | Update masking rules |
| GET | `/api/v1/admin/audit/export` | secret key | Export audit CSV |

---

## Security model

| Concern | Implementation |
|---------|---------------|
| API keys in DB | SHA-256 hashed, never stored plaintext |
| Customer reconnect tokens | HMAC-SHA256 signed, session-bound, time-limited |
| Ably token scoping | Each role (customer/agent/invite) gets exact-minimum channel capability |
| Sensitive fields | Masked client-side via rrweb `maskInputSelector` before any data leaves the browser |
| Tenant isolation | All DB queries include `tenant_id` filter; Ably channels include `tenantId` prefix |
| Rate limiting | 200 req/min global per IP |
| CORS | Restricted to `allowed_domains` per tenant |
| HTTP security | Helmet.js (HSTS, CSP, X-Frame-Options, etc.) |

---

## Moving to production

| Item | Change |
|------|--------|
| Cache | Set `CACHE_DRIVER=redis` + `REDIS_URL` |
| Multiple servers | Move session timers from in-process to BullMQ/Redis |
| PostgreSQL | Use connection pooling (PgBouncer) or a managed service (Supabase, RDS) |
| SDK delivery | Host `cobrowse.min.js` on a CDN |
| Session timers | Replace `setTimeout` in `session.js` with a distributed job queue |
| Monitoring | Add Prometheus metrics at `/metrics` |

---

## Phase 2 capabilities (not in MVP)

- Agent form-fill (guided control) — add via `CoBrowse.use(agentControlPlugin)`
- SPA deep support — extend `capture.js` with `history.pushState` hooks
- Session recording/replay — rrweb already captures events; add S3 storage + replay UI
- Native mobile SDK — separate iOS/Android packages with same relay API
