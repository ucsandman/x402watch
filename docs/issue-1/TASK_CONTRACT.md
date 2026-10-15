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
  `{ json: { pagination: { page: 0, page_size: 1000 }, sorting, where } }` and returns
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

The later discovery-only measurement rejected the first two 100-row pages: 200 rows
contained 193 unique IDs (seven overlaps), against a reported total of 130355. A
unique sort tie-breaker is absent, so ordinary offset pagination is unsuitable even
when its metadata is valid. The repair remains a draft pending release checks;
no full crawl or endpoint-probe run was repeated for the range follow-up.

On 2026-10-02 at 14:29 UTC, seven bounded free catalog GETs returned 56 rows in total.
The unchanged search membership counted 130376 resource rows: 120965 with payment
accepts and 9411 with a supported auth mode but no accepts. Requiring a nonempty
payment recipient also counted 120965. These are listing categories, not proven
unique URLs, positive-price services, or currently probeable endpoints. The schema's
uniqueness is `(resource, method)`, so separate methods can share a URL. Narrowing
membership would be a separate product decision and is not part of this repair.

A diagnostic prefix containing 26 IDs fit on page zero with `page_size: 1000`.
Applying `< pivot` and `>= pivot` produced disjoint 13-row groups whose union exactly
matched the parent. Production enumeration does not assume UUID or hex-formatted
IDs: IDs are database TEXT primary keys. It retains one pivot row and uses strict
`< pivot` / `> pivot` children, preserving each parent's membership and range.
Other sampled rows from an oversized group are discarded until reached as a pivot
or part of a complete leaf. Database collation defines the partition; JavaScript
sorting only selects a likely balanced pivot.

At 14:43 UTC, the actual local range crawler was run with every request restricted
by a test wrapper to that tiny diagnostic prefix. Three free GETs returned a
20-row root sample, a complete 12-row lower group, and a complete 13-row upper
group. Together with the retained pivot, the crawler accepted all 26 resource
rows. This verifies the deployed strict-range contract on a small real group;
it does not establish full-catalog reliability or runtime.

Local verification passed: 85 fixture tests, ESLint, TypeScript without emitting
files, and the production webpack build. Before implementation, the new 20001-row
tied-order fixture reproduced the duplicate-ID failure on offset page 1. Tests
also cover alternate database collation, one-row pages, traversal limits, malformed
responses, changing counts, and snapshot preservation on root/child failures.

The public API has no cursor, ID-sort option, or snapshot-aware manifest. Its
`list.all` route returns an unbounded array of nondeprecated scalar rows without
accepts or a count token, so it was not fetched as a substitute. ID range filtering
through the supported `where` input is the narrow workaround. Complete snapshot
guarantees still depend on an upstream immutable manifest or snapshot-aware cursor.

Runtime and storage also remain release gates. Full range enumeration and the
deduplicated URL count have not been measured. The existing scheduled job has a
30-minute timeout, 40 probe workers, and 8-second request timeouts. Its current
single-file history retains 30 records per URL. At the earlier planning upper
case of 153314 URLs (summed catalog rows, not measured unique URLs), even minimal
synthetic history records occupy about 202 MiB before URL keys and memory overhead.
This exceeds GitHub's 100 MiB file limit; actual storage fit is still unknown.
See [GitHub's large-file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).
No scheduler, probing-concurrency, retention, or storage implementation changes
are part of this repair. Successful fixture tests and preview builds do not
establish that the expanded scheduled job is ready to run.

## Edge decisions

| Question | Decision |
| --- | --- |
| Boundaries: zero, one, exact page, partial page, more than 20,000? | Specify: cover every resource ID in a fixed catalog using complete page-zero groups; reject rather than truncate at traversal limits. Reject invalid page sizes. |
| Adjacency: overlapping offset pages or repeated rows? | Specify: never request later offset pages. Reject repeated IDs within a response or among accepted pivots and complete leaves. |
| Empty/degenerate: an empty catalog or malformed envelope? | Specify: valid zero-total page returns empty; malformed or incomplete responses reject. |
| Encoding: URLs, metadata, and tRPC query JSON? | Specify: encode the JSON request, retain URL and metadata text as returned. No URL normalization. |
| Ordering/stability: tied sort keys and different methods at one URL? | Specify: partition by strict database ID ranges; keep lastUpdated sorting only to obtain a sample. Check IDs rather than URLs and retain existing merge behavior. |
| Precision/overflow: total, page, and size arithmetic? | Specify: positive safe-integer page size, nonnegative safe-integer total, consistent page metadata and lengths. No currency arithmetic changes. |
| Idempotency: repeat a fixed fixture crawl? | Specify: same resource mapping each time; no persistent crawler state or side effects. |
| Concurrency: changed counts, errors, or separately cached queries? | Specify: each child count must be less than the parent; child totals plus the retained pivot must equal the parent. Final unique IDs must match the root count. Reject detected inconsistencies and preserve published files. Same-cardinality changes remain undetectable without upstream snapshot support. |

```yaml
contract_version: 1
subject: "x402watch issue #1: complete x402scan discovery without destructive partial publication"
generated: "2026-10-02"
must_haves:
  - id: CRAWL-01
    requirement: "Enumerate a fixed catalog beyond row 20000 despite tied or changing sample order, using complete page-zero ID ranges on the free nested tRPC route. Retain one pivot and recurse on strict lower/upper ranges; enforce a depth limit of 64 and request limit of 4096, returning an error rather than partial discovery."
    shape: [collection, numeric-range, io]
    edge_category: boundaries
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/crawl.test.ts"
  - id: CRAWL-02
    requirement: "Accept valid empty and single-page catalogs; reject malformed envelopes, incomplete groups, duplicate accepted IDs, nonprogressing splits, inconsistent parent/child totals or pagination metadata, and invalid page sizes."
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
    requirement: "Propagate root and later-range failures. A failed x402scan crawl must stop the probe script before probing or writing latest.json/history.json."
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
    reason: "Upstream independently caches queries and counts outside a transaction. ID ranges fix tied-order coverage for a fixed catalog but do not establish an atomic snapshot. Full-catalog discovery and end-to-end runtime remain unverified release gates."
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
