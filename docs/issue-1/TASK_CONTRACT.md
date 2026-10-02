# Complete x402scan discovery (issue #1)

This contract covers the crawler repair, independently of the existing scoring contract.
The goal is to reach resources beyond the former 20,000-row search window and prevent
an incomplete crawl from replacing the last published snapshot or erasing history.

## Evidence and scope

- [Issue #1](https://github.com/ucsandman/x402watch/issues/1) reports missing endpoints;
  its live counts are the reporter's observations, not measurements from this repair.
- Local main `31343b70e3bb45fdec0d1f1f69cc7675762ca692` and GitHub main had identical
  crawler code at inspection. The 64 intervening commits changed only generated data.
  The existing PayAI PR #2 adds a discovery source and does not fix this scan path.
- Upstream source was inspected at
  [131a5d3ca9f71f145b6da4a40334c0b52544194c](https://github.com/Merit-Systems/x402scan/tree/131a5d3ca9f71f145b6da4a40334c0b52544194c).
  See the [public router](https://github.com/Merit-Systems/x402scan/blob/131a5d3ca9f71f145b6da4a40334c0b52544194c/apps/scan/src/trpc/routers/public/resources.ts),
  [nested pagination input](https://github.com/Merit-Systems/x402scan/blob/131a5d3ca9f71f145b6da4a40334c0b52544194c/apps/scan/src/trpc/trpc.ts),
  [pagination response](https://github.com/Merit-Systems/x402scan/blob/131a5d3ca9f71f145b6da4a40334c0b52544194c/apps/scan/src/lib/pagination.ts), and
  [resource queries](https://github.com/Merit-Systems/x402scan/blob/131a5d3ca9f71f145b6da4a40334c0b52544194c/apps/scan/src/services/db/resources/resource.ts).
- `public.resources.search` has no offset/cursor input. The free tRPC list route takes
  `{ json: { pagination: { page: 0, page_size: 100 }, sorting, where } }` and returns
  `result.data.json` with `items`, `page`, `hasNextPage`, `total_count`, `total_pages`.
  The similarly named paid REST route is outside scope.

Before draft PR publication, the repair branch was based on current main
`7a7c15a34744bfd5f3ef6813af8edba58b81bffe` (65 data-only commits after local main).
On 2026-10-02 at 13:57 UTC, two authorized free GETs with `page_size: 2` returned
pages 0 and 1, four distinct resource IDs, and the same `total_count: 130343`.
This verifies the deployed request/response shape, not a complete live sweep.
The larger catalog's full-crawl duration remains a release check against the
existing 30-minute scheduled-job limit. No endpoint was probed and no production
snapshot was written.

## Edge decisions

| Question | Decision |
| --- | --- |
| Boundaries: zero, one, exact page, partial page, more than 20,000? | Specify: cover every returned resource ID, with no catalog-size cap. Reject invalid page sizes. |
| Adjacency: repeated rows at a page boundary? | Specify: reject repeated IDs; a repeat can hide a missing resource. |
| Empty/degenerate: an empty catalog or malformed envelope? | Specify: valid zero-total page returns empty; malformed or incomplete responses reject. |
| Encoding: URLs, metadata, and tRPC query JSON? | Specify: encode the JSON request, retain URL and metadata text as returned. No URL normalization. |
| Ordering/stability: tied sort keys and different methods at one URL? | Specify: sort by lastUpdated ascending, check IDs rather than URLs, and retain existing merge behavior. Upstream provides no unique tie-breaker. |
| Precision/overflow: total, page, and size arithmetic? | Specify: positive safe-integer page size, nonnegative safe-integer total, consistent page metadata and lengths. No currency arithmetic changes. |
| Idempotency: repeat a fixed fixture crawl? | Specify: same resource mapping each time; no persistent crawler state or side effects. |
| Concurrency: changed counts, errors, or separately cached pages? | Specify: reject detected inconsistencies and preserve published files. Defer transactional snapshot guarantees because the upstream API supplies neither a snapshot token nor atomic page reads. |

```yaml
contract_version: 1
subject: "x402watch issue #1: complete x402scan discovery without destructive partial publication"
generated: "2026-10-02"
must_haves:
  - id: CRAWL-01
    requirement: "Read all pages of a fixed catalog, including resources beyond row 20000, using the free nested tRPC pagination input."
    shape: [collection, numeric-range, io]
    edge_category: boundaries
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/crawl.test.ts"
  - id: CRAWL-02
    requirement: "Accept valid empty and single-page catalogs; reject malformed envelopes, missing pages, duplicates, inconsistent totals or pagination metadata, and invalid page sizes."
    shape: [collection, numeric-range, io]
    edge_category: empty
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/crawl.test.ts"
  - id: CRAWL-03
    requirement: "Keep search membership (not excluded or deprecated; payment accepts or a supported free auth mode), ignore accepts with empty payTo, and preserve target field mapping and distinct resource IDs sharing a URL."
    shape: [collection, text]
    edge_category: ordering
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/crawl.test.ts"
  - id: CRAWL-04
    requirement: "Propagate first-page and later-page failures. A failed x402scan crawl must stop the probe script before probing or writing latest.json/history.json."
    shape: [stateful, io]
    edge_category: concurrency
    disposition: specify
    tier: test
    non_inferable: false
    check: "npm test"
  - id: CRAWL-05
    requirement: "A successful fixed-fixture sweep proves coverage of that fixture, not a transactional snapshot of a changing upstream catalog."
    shape: [collection, stateful]
    edge_category: concurrency
    disposition: defer
    tier: judgment
    non_inferable: false
    reason: "Upstream independently caches pages, counts outside a transaction, and sorts without a unique tie-breaker. Release validation must account for this documented API limitation."
prohibitions:
  - id: SAFE-01
    must_not: "Treat a failed x402scan discovery request as successful empty discovery and erase previously published data."
    tier: test
    repo_check: "node --test lib/probe-crawl.test.ts"
  - id: SAFE-02
    must_not: "Use credentials, paid requests, endpoint probes, production snapshot writes, or reporter contact as repair verification."
    tier: judgment
    reason: "Tests intercept fetch and use temporary synthetic snapshots. Publication approval additionally permits free read-only catalog validation, a repair branch push and a draft PR. Merge and manual deployment remain outside scope."
open_questions: []
```

The interpretation is complete discovery for a fixed catalog, with failure preserving
the previous snapshot. It is not an expansion of discovery sources or a promise of
snapshot isolation. No scoring, UI, Bazaar, deployment configuration, or stored data
changes are part of this repair.
