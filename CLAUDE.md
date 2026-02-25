# CLAUDE.md
# Co-browse product repo guidance for Claude Code.
# Goal: behave like a pragmatic Architect + Product Manager: clarify outcomes, propose options, execute safely.

## 1) One-line context
This is a secure, low-latency co-browse platform (agent + customer) for real-time guided support and assisted workflows. :contentReference[oaicite:0]{index=0}

## 2) Working contract (how you should operate)
- Start every task by restating: (a) user goal, (b) user persona, (c) success metric, (d) constraints, (e) risks.
- Ask 3–7 clarifying questions only if ambiguity blocks correct execution. Otherwise, make explicit assumptions and proceed.
- Always present at least 2 solution options with tradeoffs (latency, complexity, security, cost, operability).
- Prefer “smallest safe step” sequencing: design slice → instrument → ship behind flag → expand.
- If touching security, auth, data handling, or recording: do threat model notes + abuse cases before coding.
- If you propose a big refactor: provide a migration plan and rollback plan.

## 3) Product intent and scope guardrails
### Primary users
- Agent (support, sales, success) wants to guide and troubleshoot fast.
- Customer wants help without losing privacy or control.

### Outcomes (must map work to these)
- Reduce time-to-resolution (TTR)
- Increase first contact resolution (FCR)
- Increase conversion or task completion (if sales-led co-browse)
- Maintain customer trust (privacy, consent, transparency)

### Non-goals (unless explicitly asked)
- Full remote control without continuous customer consent
- Recording everything by default
- Collecting sensitive inputs (passwords, OTPs, card data)

### “Definition of done” for any feature PR
- Feature has measurable success metric and event instrumentation
- Consent and privacy UX covered (copy + states + edge cases)
- Security review checklist passed (see section 8)
- Load and latency acceptance criteria defined and tested
- Rollout plan: flag, ramp, monitoring, rollback

## 4) Architecture principles (co-browse specific)
- Consent-first: customer can pause, stop, and see what is shared.
- Least privilege: agents never get more power than needed.
- Redaction by default for sensitive fields and regions.
- Deterministic session state: reconnect should restore safely.
- Observability is a feature: metrics, logs, traces, session timeline.

## 5) Repository navigation and progressive disclosure
Keep this file short and high-signal. Put deep, topic-specific rules in separate docs and only load when relevant. :contentReference[oaicite:1]{index=1}

Before starting substantial work, read the relevant docs:
- @README.md (product overview, local setup)
- @docs/ARCHITECTURE.md (high-level system design + boundaries)
- @docs/SECURITY.md (threat model, privacy, redaction rules)
- @docs/PROTOCOL.md (event schema, ordering, idempotency)
- @docs/OBSERVABILITY.md (metrics, logging conventions)
- @docs/PRD_TEMPLATE.md (product spec format)
- @docs/ADR_TEMPLATE.md (architecture decision record format)

Note: Claude can automatically pull CLAUDE.md context from parent directories when files are referenced. :contentReference[oaicite:2]{index=2}

## 6) System boundaries (assumed default, adjust to repo reality)
### Core components
- Web SDK (embedded in customer site/app)
- Agent Console (web app)
- Realtime Gateway (WebSocket or WebRTC data channel)
- Session Service (auth, consent state, participants, capabilities)
- Event Store (optional: timeline, audit, playback)
- Policy Service (redaction rules, domain allowlists, PII policies)

### Primary data flows
- Join session → consent handshake → capability negotiation
- Realtime events: viewport, scroll, pointer, highlights, form assist, annotations
- Optional: DOM diff or “guided overlay” updates
- Telemetry: latency, reconnects, drops, permission changes, redaction hits

## 7) Coding standards (repo-wide)
- Favor explicitness over magic.
- Keep modules small and testable.
- No breaking API changes without versioning plan.
- All network messages are schema-validated.
- All timestamps use a single time source strategy (server authoritative if needed).
- **ZERO secrets in code — ABSOLUTE RULE.** Never hardcode, paste, or use as a fallback default any API key, secret key, token, password, private key, or credential in source files. Not even in demo apps, test fixtures, config defaults, or comments. All secrets must come from environment variables or server-injected config at runtime. Violations are blocking — stop and fix before committing. If you see an existing hardcoded secret, remove it immediately.

## 8) Security and privacy requirements (non-negotiable)
### Consent and control
- Customer must explicitly start sharing.
- Customer can pause/resume/stop instantly.
- Agent actions must respect capability gating.

### Redaction and sensitive data handling
- Treat passwords, OTP, payment fields, health and identity data as sensitive by default.
- Implement both:
  - Field-level masking (input types, name patterns, selectors)
  - Region-level masking (CSS selectors, coordinates, allowlist mode)
- Never log raw sensitive fields. Store only derived signals (masked, hashed, counts).

### Threat model checklist (include in PR description for security-touching work)
- What can a malicious agent do?
- What can a malicious customer do?
- What can a network attacker do?
- What happens on reconnect, multi-tab, or session hijack attempts?
- How do we prevent replay, injection, event forgery, privilege escalation?

## 9) Realtime protocol requirements
- All events must be:
  - Versioned
  - Idempotent where possible
  - Ordered or conflict-resolved (define strategy: sequence numbers, vector clocks, server ordering)
  - Rate-limited and backpressure-aware
- Define hard budgets:
  - P95 end-to-end event latency target
  - Max event size
  - Max events per second per participant
- Reconnect behavior must be deterministic:
  - Resync strategy
  - State snapshot boundaries
  - Drop and recover semantics

## 10) Observability and analytics (must ship with features)
### Technical metrics
- Session join success rate
- Reconnect rate and time-to-recover
- Event latency (client→server→client), P50/P95/P99
- Packet loss or WS disconnects
- Redaction hit rate
- Crash and error rate per component

### Product metrics
- Sessions started per active agent
- Share acceptance rate
- Pause/stop rate (and reasons)
- TTR delta with and without co-browse
- FCR delta
- Customer satisfaction signal (post-session prompt)

## 11) Testing expectations
- Unit tests for protocol and state machines
- Integration tests for join/consent/reconnect
- Load tests for gateway (concurrency and burst)
- Security tests: authz checks, replay protection, injection attempts
- Browser coverage: latest Chrome + Safari + Firefox, plus mobile WebView if applicable

## 12) PR review checklist (use as your own rubric)
- Does the change improve a stated outcome or metric?
- Are tradeoffs documented?
- Are edge cases covered (multi-tab, refresh, flaky network, role changes)?
- Are logs safe and useful?
- Is backward compatibility preserved or versioned?
- Is rollout guarded (feature flag, config, kill switch)?
- Is there a rollback plan?

## 13) How to collaborate with me (the repo owner)
When proposing a plan, format it as:
1) Goal and success metric
2) Constraints and assumptions
3) Options with tradeoffs
4) Recommended approach
5) Sequenced milestones (MVP → Hardening → Scale)
6) Risks and mitigations
7) Open questions

## 14) Git and PR workflow (mandatory)
- **One feature = one branch.** Create a new branch (e.g. `feat/feature-name`) for every task.
- **Never push directly to `main`.** Always open a PR and wait for the owner to merge. **No exceptions** — not even for "quick fixes", deploy hotfixes, or config changes. Create a branch, push, PR, merge. If urgency tempts you to skip this, that's the exact moment you must not.
- **Never modify existing tests** unless explicitly asked. Write new test files for new functionality.
- **Always run tests** before committing to verify nothing is broken.
- **Rebuild the SDK** (`npm run build:sdk`) after any change to `packages/sdk/src/` — the browser loads the bundled `cobrowse.js`, not source files.
- **Rebuild the Agent SDK** (`npm run build:agent-sdk`) after any change to `packages/agent-sdk/src/`.
- **Dotenv loads from `packages/server/.env`**, not the repo root `.env`. Set server env vars there.
- **Demo keys** (`DEMO_SECRET_KEY`, `DEMO_PUBLIC_KEY`) must be set in `packages/server/.env` for the demo apps to authenticate. Run `npm run db:seed` to generate them.

## 15) Railway / Nixpacks deployment gotchas
- **Nixpacks prunes non-server workspaces.** Only `packages/server/` survives into the runtime container. Demo apps, SDKs, and other workspace packages are removed. Any files the server needs at runtime must live under `packages/server/`.
- **Demo app files** live in `packages/server/public/demo/{customer,agent}/`. If you update `packages/customer-app/` or `packages/agent-app/`, sync changes to the `public/demo/` copies too.
- **Shell `&&` chains break on Railway.** Railway kills the container when intermediate `node` processes exit. Use `packages/server/src/startup.js` (single long-running process) instead of chaining `node migrate.js && node seed.js && node server.js`.
- **Pin Node.js version.** `.node-version` is set to `22`. Dependency `jose` v6 requires Node >= 20. Do not downgrade.
- **rrweb Replayer** — use `mouseTail: false` in production/deployed viewers. With network latency, mouse trail events accumulate and cover the entire view.
- **Dev-only endpoints** (e.g. `/api/v1/admin/demo-jwt`) must also be gated on `DEMO_SECRET_KEY` presence, not just `isDev`, so they work on Railway demo deployments.
- **Deploy with `railway up --detach`** (uploads local files). `railway redeploy` only restarts the last successful image — it won't pick up new code.

## 16) Frontend styling conventions (mandatory for tenant-ui)
- **No inline styles.** Never use `style={{}}` in JSX. All styles go in `.module.scss` files.
- **SCSS modules** — every component/page gets a co-located `ComponentName.module.scss` file, imported as `import s from './ComponentName.module.scss'`.
- **Class name serialization** — Vite is configured to produce plain readable class names in development (e.g. `LoginPage_wrapper`) and hashed/serialized names in production (e.g. `_a1b2c3`). This is handled in `packages/tenant-ui/vite.config.js` via `css.modules.generateScopedName`.
- **Global utility classes** (`.btn`, `.card`, `.form-group`, `.form-input`, `.page-header`, `.badge`, etc.) are defined in `packages/tenant-ui/src/styles/global.scss` and used as plain `className` strings. Do not duplicate these in SCSS modules.
- **CSS custom properties** are defined in `packages/tenant-ui/src/styles/variables.scss` — reference them as `var(--color-primary)`, `var(--space-md)`, etc. Do not hardcode color or spacing values.
- **Dynamic values** (e.g. a `size` prop) are the only acceptable use of inline `style` — and only for the specific dynamic property, not for layout or theming.
- **Rebuild the tenant UI** (`npm run build:tenant-ui`) after any changes to `packages/tenant-ui/src/`.

## 17) Frontend auth and security conventions (mandatory)
- **Cookies only for auth.** Session tokens are stored in httpOnly, SameSite=Strict, Secure (prod) cookies set by the server. **NEVER** use localStorage, sessionStorage, or JS-accessible cookies for auth tokens — they are vulnerable to XSS.
- **`credentials: 'include'`** on all API calls so the browser sends the session cookie automatically.
- **GuestRoute** wraps the login page — if a user is already authenticated, they get redirected to the dashboard. No authenticated user should ever see the login form.
- **ProtectedRoute** wraps all authenticated pages — if not authenticated, redirect to login.
- **401 auto-redirect** — the `apiFetch` client automatically redirects to `/portal/login` on 401 responses (except for auth endpoints themselves).
- **No tokens in URLs** — never pass session tokens, API keys, or secrets as query parameters.

## 18) UI component design principles (mandatory for tenant-ui)

### Layout
- **Fluid content areas.** Never set `max-width` on layout containers (main, panels). Let individual page components (cards, tables, forms) define their own `max-width` if needed. Parent containers must expand to fill available space.
- **CSS custom properties for all dimensions.** Define widths, heights, breakpoints in `variables.scss`. Components read variables — never hardcode pixel values for layout dimensions.
- **Constant padding.** Layout padding (`var(--space-xl) var(--space-2xl)`) stays fixed regardless of component state changes (collapsed, expanded, resized). Changing padding during transitions causes layout jank.

### Animation and transitions
- **Duration: 200ms. Easing: `cubic-bezier(0.2, 0, 0, 1)`.** The standard for all layout transitions (width, margin, height). Faster than 150ms feels jumpy; slower than 300ms feels sluggish.
- **Fade text at 150ms, geometry at 200ms.** Text opacity transitions should complete slightly before parent container finishes resizing — prevents clipped text mid-animation.
- **Animate with `opacity` and `transform` where possible.** These are GPU-composited. Use `width`/`margin`/`height` only when geometry must actually change. Never animate `display` or `visibility` alone — pair with `opacity` for smooth transitions.
- **Never conditionally render (`{show && ...}`) elements that should animate out.** Always render the element; toggle `opacity: 0` + `width: 0` or `height: 0` via CSS class so the exit animation plays.

### Interactive elements
- **Minimum 40px hit target.** All clickable elements (buttons, nav links, icons) must have at least 40x40px clickable area (via padding, min-width/height). Icons themselves can be 18–24px but the tap target must be larger.
- **`title` attribute for icon-only states.** Any element that hides its text label must have a `title` tooltip so the action remains discoverable on hover.
- **Visible focus and hover states.** Every interactive element needs `:hover` (background or color shift) and `:focus-visible` (outline or ring). Use `transition: background 0.15s` for hover feedback.

### Overflow and clipping
- **`overflow: hidden` on resizable containers.** Any component that changes dimensions (sidebar, accordion, drawer) must clip its children to prevent content leaking during transitions.
- **`white-space: nowrap` on labels inside resizable containers.** Prevents text from reflowing mid-transition.

### State persistence
- **Persist UI preferences in `localStorage`.** Collapse state, sort order, selected tabs, panel sizes — any user choice that should survive page refresh. Use short keys (e.g. `'sb'`). Read in `useState` initializer: `useState(() => localStorage.getItem(key))`.

## 19) Maintenance rule
If you notice a recurring mistake (style, security, workflow), propose a concrete update to this CLAUDE.md or the relevant @docs/* file so it does not repeat. :contentReference[oaicite:3]{index=3}