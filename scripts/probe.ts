// Crawl both discovery surfaces, probe every endpoint once, roll the history, write data/.
// Usage: node scripts/probe.ts [--max N]   (Node 24 runs .ts directly)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { crawlBazaar, crawlScan, mergeTargets } from '../lib/crawl.ts';
import { probeAll } from '../lib/probe.ts';
import { KEEP, scoreAll, statusClass } from '../lib/score.ts';
import type { History } from '../lib/types.ts';

const maxArg = process.argv.indexOf('--max');
const max = maxArg > -1 ? Number(process.argv[maxArg + 1]) : Infinity;

const [bazaar, scan] = await Promise.all([
  crawlBazaar(100, max),
  crawlScan().catch((e: Error) => {
    console.error('x402scan crawl failed:', e.message);
    return [];
  }),
]);
const targets = mergeTargets(bazaar, scan).slice(0, max);
console.log(`crawled bazaar=${bazaar.length} x402scan=${scan.length} unique=${targets.length}`);

const t0 = Date.now();
const probes = await probeAll(targets);
console.log(`probed ${probes.size} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const history: History = existsSync('data/history.json') ? JSON.parse(readFileSync('data/history.json', 'utf8')) : {};
for (const [url, p] of probes) history[url] = [...(history[url] ?? []), p].slice(-KEEP);
for (const url of Object.keys(history)) if (!probes.has(url)) delete history[url]; // delisted

const rows = scoreAll(targets, history);
writeFileSync('data/history.json', JSON.stringify(history));
writeFileSync('data/latest.json', JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }));

const counts: Record<string, number> = {};
for (const r of rows) counts[statusClass(r.lastStatus)] = (counts[statusClass(r.lastStatus)] ?? 0) + 1;
console.log(`wrote data/latest.json rows=${rows.length} ${JSON.stringify(counts)} priceDrift=${rows.filter((r) => r.priceDrift).length}`);
