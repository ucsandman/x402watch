import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, scoreAll, statusClass, KEEP } from './score.ts';
import type { Probe, Target } from './types.ts';

// These tests pin what scoring DOES today. They are the checks a TASK_CONTRACT.md
// item points at, so a change to lib/score.ts that moves one of these rules has
// to say so out loud instead of passing review on the strength of looking
// reasonable. Several of the rules here are arbitrary — see TASK_CONTRACT.md for
// the ones nothing in this repo actually settles.

const target = (over: Partial<Target> = {}): Target => ({
  url: 'https://example.com/api',
  sources: ['bazaar'],
  method: 'GET',
  hasInputExample: false,
  hasOutputExample: false,
  ...over,
});

const probe = (s: number, ms = 100, p?: string): Probe => ({ t: '2026-09-15T00:00:00Z', s, ms, p });

// --- statusClass -------------------------------------------------------------

test('402 is the healthy state for a paid resource, not an error', () => {
  assert.equal(statusClass(402), 'paywalled');
});

test('unreachable and 5xx are down; other 4xx are errors; under 400 is free', () => {
  assert.equal(statusClass(0), 'down');
  assert.equal(statusClass(500), 'down');
  assert.equal(statusClass(503), 'down');
  assert.equal(statusClass(200), 'free');
  assert.equal(statusClass(399), 'free');
  assert.equal(statusClass(404), 'error');
  assert.equal(statusClass(401), 'error');
});

test('400 is the boundary: the first status that is not free', () => {
  assert.equal(statusClass(399), 'free');
  assert.equal(statusClass(400), 'error');
});

// --- uptime ------------------------------------------------------------------

test('uptime counts only 402 responses, so a resource that went free reads as down', () => {
  const row = score(target(), [probe(402), probe(200), probe(402), probe(200)]);
  assert.equal(row.uptime, 0.5);
});

test('a resource with no probes at all reports zero uptime, not unknown', () => {
  const row = score(target(), []);
  assert.equal(row.uptime, 0);
  assert.equal(row.checks, 0);
  assert.equal(row.lastStatus, 0);
  assert.equal(row.lastChecked, '');
});

// --- price drift -------------------------------------------------------------

test('a live amount different from the declared one is drift', () => {
  const row = score(target({ declaredAmount: '1000' }), [probe(402, 100, '2000')]);
  assert.equal(row.priceDrift, true);
});

test('a matching amount is not drift, and keeps the full 15 points', () => {
  const row = score(target({ declaredAmount: '1000' }), [probe(402, 100, '1000')]);
  assert.equal(row.priceDrift, false);
});

test('drift is a string comparison, so an equal value written differently reads as drift', () => {
  // Amounts are smallest-units strings on both sides and are compared with !==.
  // "1000" and "1000.0" are the same amount and different strings.
  const row = score(target({ declaredAmount: '1000' }), [probe(402, 100, '1000.0')]);
  assert.equal(row.priceDrift, true);
});

test('a resource that declares no amount can never drift', () => {
  const row = score(target(), [probe(402, 100, '5')]);
  assert.equal(row.priceDrift, false);
});

test('a probe that returned no amount can never drift', () => {
  const row = score(target({ declaredAmount: '1000' }), [probe(402, 100, undefined)]);
  assert.equal(row.priceDrift, false);
});

// --- latency -----------------------------------------------------------------

test('median latency is measured over paywalled probes only', () => {
  const row = score(target(), [probe(402, 100), probe(200, 9999), probe(402, 300)]);
  assert.equal(row.medianMs, 300);
});

test('an even number of samples takes the upper middle, not the mean of the two', () => {
  const row = score(target(), [probe(402, 100), probe(402, 300)]);
  assert.equal(row.medianMs, 300);
});

test('latency bands are 300ms, 1s and 3s, inclusive at each edge', () => {
  const at = (ms: number) => score(target(), [probe(402, ms)]).score - 60 - 15; // minus uptime and no-drift
  assert.equal(at(300), 15);
  assert.equal(at(301), 10);
  assert.equal(at(1000), 10);
  assert.equal(at(1001), 5);
  assert.equal(at(3000), 5);
  assert.equal(at(3001), 0);
});

// --- completeness and total --------------------------------------------------

test('completeness is 4 for a description and 3 for each example', () => {
  const full = score(
    target({ description: 'x', hasInputExample: true, hasOutputExample: true }),
    [probe(402, 100)],
  );
  assert.equal(full.score, 60 + 15 + 15 + 10);
});

test('a perfect resource scores 100 and a never-probed bare one scores 15', () => {
  const perfect = score(
    target({ description: 'x', hasInputExample: true, hasOutputExample: true }),
    [probe(402, 100)],
  );
  assert.equal(perfect.score, 100);
  // No probes: no uptime, no latency points, but the no-drift 15 still lands.
  assert.equal(score(target(), []).score, 15);
});

// --- scoreAll ----------------------------------------------------------------

test('rows sort by score, breaking ties on 30-day payers', () => {
  const history = {
    'https://a': [probe(402, 100)],
    'https://b': [probe(402, 100)],
  };
  const rows = scoreAll(
    [target({ url: 'https://a', payers30d: 1 }), target({ url: 'https://b', payers30d: 9 })],
    history,
  );
  assert.deepEqual(rows.map((r) => r.url), ['https://b', 'https://a']);
});

test('a row missing payers30d sorts as zero rather than dropping out', () => {
  const history = { 'https://a': [probe(402, 100)], 'https://b': [probe(402, 100)] };
  const rows = scoreAll(
    [target({ url: 'https://a' }), target({ url: 'https://b', payers30d: 1 })],
    history,
  );
  assert.deepEqual(rows.map((r) => r.url), ['https://b', 'https://a']);
});

test('a target with no history still produces a row', () => {
  const rows = scoreAll([target({ url: 'https://never-probed' })], {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.checks, 0);
});

test('the published row never carries the probe body', () => {
  const rows = scoreAll([target({ body: { secret: 1 } })], {});
  assert.equal('body' in rows[0]!, false);
});

test('KEEP is the retention window the tape is sized against', () => {
  assert.equal(KEEP, 30);
});
