# GROUND_RULES.md — ExactJSON Engineering & Operating Guardrails

Every engineer and AI assistant working in this repository MUST follow these rules without exception.

## 1. $0 Infrastructure & Free-Tier Protection
- Stay strictly inside free-tier ceilings until revenue exceeds paid hosting costs:
  - Cloudflare Workers: 100k req/day, 10ms CPU/req, 50 subrequests/req.
  - Cloudflare D1: 5M rows read/day, 100k rows written/day.
  - CDP Facilitator: 1,000 free settled txs/month.
- **Zero background auto-polling:** Dashboards and UIs load once on open and refresh only on manual user action (Refresh button or filter change).
- **Cache aggressively:** Use the 2-tier cache (`isolateCache` + best-effort `caches.default`) on all upstream API calls and D1 aggregate queries.
- **Content negotiation safety:** `GET /` MUST always emit `Vary: Accept` alongside `Cache-Control` so HTML docs and JSON index responses never cross-contaminate edge caches.
- **Keep D1 lean:** Rely on covering indexes and the daily `0 3 * * *` cron pruning unpaid `CHALLENGED_402` rows older than 7 days (`SETTLED` revenue rows are kept forever).

## 2. Paywall & Safety Invariants
- **Lazy `/v1/*`-only paywall:** Never mount or import `@x402/*` or `@coinbase/x402` on free discovery routes (`/`, `/health`, `/robots.txt`, `/sitemap.xml`, `/openapi.json`, `/llms.txt`, `/.well-known/*`). Keep `syncFacilitatorOnStart = false`.
- **Pay-only-on-success:** Only HTTP 200 responses settle payment. `400`, `404`, `502`, and `503` must NEVER settle.
- **Fail closed on security endpoints:** If primary security engines fail (e.g., RugCheck for Solana; GoPlus + Honeypot.is for EVM), return `502` — never mark missing security data as safe.
- **Keyless upstreams only:** Do not add endpoints that require paid API keys unless explicitly approved.

## 3. Brand & Quality Discipline
- Always pair **ExactJSON** with its positioning descriptor (`"Live, deterministic x402 APIs for AI agents"`) in public titles and directory listings.
- Keep endpoint prices in `src/config/catalog.ts` as the single source of truth; derive discovery prose from `CATALOG`.
- Every change must pass `npx tsc --noEmit` and `npm test` (including `tests/brandHygiene.test.ts`) with zero errors before `npx wrangler deploy` or `git push`.
- **Secrets hygiene:** Never paste, print, or commit `.dev.vars`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `DASHBOARD_TOKEN`, or wallet private keys.
