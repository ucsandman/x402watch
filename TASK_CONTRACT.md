# Scoring contract — x402watch

What a score means, and which parts of it nothing in this repository actually decides.

`lib/score.ts` turns a pile of probes into a public 0-100 number and a `priceDrift` flag on
every listed x402 resource. Most of the rules below are written down and checked. Three are
not: they are arbitrary choices that read as reasonable, which is exactly the shape of thing a
reviewer approves confidently because the spec gave it nothing to compare against.

Run it: `node ~/.claude/tools/task-contract/task-contract.mjs TASK_CONTRACT.md --run`
(or `npm test` for the checks alone).

```yaml
contract_version: 1
subject: "x402watch: scoring a probed resource"
generated: "2026-09-15"

must_haves:
  - id: MH-01
    requirement: "402 is the healthy state for a paid resource. 0 and 5xx are down, other 4xx are errors, and anything under 400 is free."
    shape: [numeric-range]
    edge_category: boundaries
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-02
    requirement: "400 is the boundary: 399 is free, 400 is an error."
    shape: [numeric-range]
    edge_category: boundaries
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-03
    requirement: "Uptime is the fraction of stored probes that answered 402. Nothing else counts as up."
    shape: [collection, numeric-range]
    edge_category: none
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-04
    requirement: "Median latency is measured over paywalled probes only, and an even-length sample takes the upper of the two middle values rather than their mean."
    shape: [collection, numeric-range]
    edge_category: precision
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-05
    requirement: "Latency bands are inclusive at each edge: 300ms scores 15, 1000ms scores 10, 3000ms scores 5, anything slower scores 0."
    shape: [numeric-range]
    edge_category: boundaries
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-06
    requirement: "A resource that declares no amount, or a probe that returned none, can never register price drift."
    shape: [text]
    edge_category: empty
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-07
    requirement: "Completeness is 4 points for a description and 3 for each of the input and output examples. A resource at full uptime, under 300ms, not drifting, and fully documented scores exactly 100."
    shape: [numeric-range]
    edge_category: boundaries
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-08
    requirement: "Rows sort by score descending, breaking ties on 30-day payers, with a missing payer count sorting as zero rather than dropping the row."
    shape: [collection]
    edge_category: ordering
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-09
    requirement: "A target with no probe history still produces a row rather than disappearing from the board."
    shape: [collection]
    edge_category: empty
    disposition: specify
    tier: test
    non_inferable: false
    check: "node --test lib/score.test.ts"

  - id: MH-10
    requirement: "Whether price drift means the two amount strings differ, or the two AMOUNTS differ. Both sides are smallest-units strings compared with !==, so '1000' and '1000.0' are the same money and count as drift today. Nothing in the repo says which was meant, and the published drift count depends entirely on the answer."
    shape: [text, numeric-range]
    edge_category: precision
    disposition: defer
    tier: judgment
    non_inferable: true
    reason: "Underivable from the rest of the scoring rules — string identity and numeric equality are both defensible readings of 'the price changed'. Needs a stated rule, then a test on a same-value-different-spelling pair."

  - id: MH-11
    requirement: "Whether a resource that stopped charging and now answers 200 is DOWN. Uptime counts only 402, so going free reads as a total outage and costs 60 points."
    shape: [stateful]
    edge_category: none
    disposition: defer
    tier: judgment
    non_inferable: true
    reason: "The board exists to track paid resources, so counting a free resource as down is arguable — and so is treating it as a healthy resource that changed its terms. Nothing here decides which."

  - id: MH-12
    requirement: "What a never-probed resource should score. It currently gets the full 15 no-drift points for a price nobody checked, so an unprobed listing outranks a probed one that genuinely drifted."
    shape: [collection]
    edge_category: empty
    disposition: defer
    tier: judgment
    non_inferable: true
    reason: "Absence of evidence is being scored as evidence of absence. Whether unprobed should read as unknown, as zero, or as it does now is not settled anywhere."

prohibitions:
  - id: PR-01
    must_not: "Publish the request body used to probe a resource. It is needed to make the call and has no business on the public board."
    tier: test
    repo_check: "node --test lib/score.test.ts"

  - id: PR-02
    must_not: "Read as a verdict on whether a resource is trustworthy or worth paying. It measures whether an endpoint answers, answers quickly, charges what it said it would, and documented itself — nothing about what it returns."
    tier: judgment
    reason: "A stance about how the board presents itself, not a property of any function. No repo-wide rule separates a measurement from an endorsement; it lives in the page copy."
```
