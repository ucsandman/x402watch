# x402watch

Which paid APIs actually answer. Every x402 endpoint listed on the Coinbase Bazaar and x402scan, probed unpaid every six hours, ranked by whether it is reachable, charges what it declared, and how fast it answers.

Live: https://x402watch.vercel.app · JSON: https://x402watch.vercel.app/api/feed

## Why

A listing is a seller's claim. Agents that pay per call need to know, before they sign a payment, that the endpoint is up, that the price in the 402 challenge matches the price in the directory, and roughly how long it takes. Nobody was checking. The first crawl found a listed endpoint charging ten times its declared price.

## How it works

1. `lib/crawl.ts` pulls resources from the Bazaar discovery API (offset paginated, no key) and x402scan's free `public.resources.list.paginated` route, merged by URL. For x402scan it divides the catalog into disjoint ID ranges and reads complete groups of at most 1,000 rows from page zero, avoiding unstable offset ordering. It preserves the search catalog's filters and checks group counts, unique resource IDs, and the reported total before accepting the result.
2. `lib/probe.ts` sends one unpaid request per endpoint with the listed method and example body. A healthy paid endpoint answers `402` with a `PAYMENT-REQUIRED` header; the live price is read from that header.
3. `lib/score.ts` keeps the last 30 probes per endpoint and scores 0 to 100: uptime (60), median latency (15), declared price matches live price (15), listing completeness (10).
4. `scripts/probe.ts` runs the above and writes `data/latest.json` and `data/history.json`. A failed or incomplete x402scan crawl aborts the run before probing or changing either file. A GitHub Actions cron commits the result; Vercel redeploys on push.
5. The page reads `data/latest.json` at build time. `/api/feed` serves the same rows as JSON.

## Run it

```bash
npm install
npm run probe:smoke   # full discovery, then at most 120 endpoint probes
npm run probe         # full discovery and all endpoint probes
npm run dev           # http://localhost:3000
```

No environment variables. No database.

`npm test` runs fixture-only scoring and crawl regressions without contacting catalogs or paid endpoints. `npm run lint`, `npx tsc --noEmit`, and `npm run build` check the application. The build downloads Google Fonts.

The x402scan API caches queries independently and does not expose a snapshot token or a unique sort tie-breaker. ID ranges avoid tied-sort pagination gaps for a fixed catalog. Detected count changes, duplicate IDs, incomplete groups, or exhausted traversal limits fail the crawl; a successful crawl is not proof of a transactional snapshot of a changing catalog. The source total counts resource rows, including free/auth-mode listings and separate methods at one URL; it is not a count of unique, reachable paid endpoints. Full-catalog runtime remains a release check against the existing 30-minute scheduled-job limit. See [the issue #1 crawl contract](docs/issue-1/TASK_CONTRACT.md).

## API

`GET /api/feed?q=weather&status=paywalled&limit=50&offset=0`

| Param | Values |
| --- | --- |
| `q` | substring match on URL or description |
| `status` | `paywalled` (answered 402), `down`, `error` (4xx other than 402), `free` (2xx, no paywall), `drift` (live price differs from declared) |
| `limit` | 1 to 1000, default 100 |
| `offset` | default 0 |

Rows carry `score`, `uptime`, `medianMs`, `livePrice`, `declaredAmount` (smallest units, USDC has 6 decimals), `priceDrift`, `payers30d`, `tape` (last 30 HTTP statuses).

## Sellers

Fix the listing at the source (your Bazaar discovery extension or x402scan registration). The next probe picks it up. Probes are one unpaid request each and identify as `x402watch/1`.
