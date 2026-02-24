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
- No secrets in code or logs.

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

## 14) Maintenance rule
If you notice a recurring mistake (style, security, workflow), propose a concrete update to this CLAUDE.md or the relevant @docs/* file so it does not repeat. :contentReference[oaicite:3]{index=3}