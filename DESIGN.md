# x402watch design system

## Visual theme

Assay office: a mid-tone grey-green ground, cream paper strips for each endpoint, a punch-tape strip of the last 30 probes as the signature element, and a score whose color is the verdict. Light theme only; the page is read at a desk, in daylight, while comparing options.

## Color palette

| Token | Value | Role |
| --- | --- | --- |
| `--ground` | #c6ccc0 | page background |
| `--ground-deep` | #aeb5a8 | strip drop edge |
| `--paper` | #f7f3e8 | endpoint strips, inputs |
| `--paper-edge` | #d9d2bf | strip edge, empty tape cells |
| `--ink` | #141b22 | text, selected chip, primary button |
| `--ink-soft` | #4a5560 | secondary text (6.5:1 on paper, 4.6:1 on ground) |
| `--ok` | #1e6b4f | score ≥ 80, tape cell answered 402 |
| `--warn` | #8a5a00 | score 50 to 79, tape cell free or rejecting |
| `--bad` | #b23a2b | score < 50, tape cell down, live price on drift |
| `--brass` | #f0b429 | reserved accent, currently unused |

## Typography

- Display: Unbounded 700/900. Wordmark and the one headline only. Never in data, labels, or buttons.
- Body: IBM Plex Sans 400/500/600.
- Data: IBM Plex Mono 400/500 with tabular numerals for every number, URL, and label in the table.
- Scale: 11px column labels (uppercase, tracked), 13px data, 14px strip body, 16 to 18px lede, headline 30 to 44px.

## Components

- Strip: one endpoint. Paper background, 1px paper-edge bottom, 2px ground-deep drop. Seven columns on desktop (score, endpoint, price and network, latency, payers 30d, uptime, tape); stacks under the endpoint on mobile.
- Tape: 30 cells, oldest left. Filled ok green = 402, red = down, short warn = free or rejecting, faint outline = no probe yet.
- Filter chips: bordered mono labels with counts; selected chip inverts to ink on paper. 44px minimum height.
- Search: paper input plus ink submit button, joined.
- Score: Plex Mono 600 at 24px, colored by threshold.

## Layout

Max width 80rem, 1rem side padding (2rem from md). Headline block capped at 48rem. Strips separated by 6px. Column labels appear only from md.

## Motion

Strip hover slides 2px right over 120ms ease-out. Nothing else moves. Reduced motion disables the slide.
