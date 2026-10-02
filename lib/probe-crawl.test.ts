import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const pageToFail of [0, 1]) {
  test(`x402scan failure on page ${pageToFail} leaves the published snapshot and history untouched`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'x402watch-crawl-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'data'));
    const fixtures = {
      'latest.json': JSON.stringify({ generatedAt: '2026-10-01T00:00:00Z', count: 0, rows: [] }),
      'history.json': JSON.stringify({ 'https://example.com/retained': [{ t: '2026-10-01', s: 402, ms: 1 }] }),
    };
    for (const [name, contents] of Object.entries(fixtures)) writeFileSync(join(dir, 'data', name), contents);

    // All fetches are intercepted in the child process: no catalog or endpoint is contacted.
    const mock = `
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.cdp.coinbase.com') {
          return Response.json({ items: [], pagination: { total: 0 } });
        }
        if (url.hostname === 'www.x402scan.com') {
          const page = JSON.parse(url.searchParams.get('input')).json.pagination?.page ?? 0;
          if (page >= ${pageToFail}) return new Response('', { status: 503 });
          const items = Array.from({ length: 100 }, (_, i) => ({
            id: 'resource-' + i, resource: 'https://example.com/api/' + i, method: 'GET', accepts: [],
          }));
          return Response.json({ result: { data: { json: {
            items, page, total_count: 101, total_pages: 2, hasNextPage: true,
          } } } });
        }
        throw new Error('Unexpected endpoint probe: ' + url);
      };
    `;
    const result = spawnSync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(mock)}`,
      fileURLToPath(new URL('../scripts/probe.ts', import.meta.url)),
    ], { cwd: dir, encoding: 'utf8', timeout: 10000 });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /x402scan.*503/);
    assert.doesNotMatch(result.stdout, /probed|wrote/);
    for (const [name, contents] of Object.entries(fixtures)) {
      assert.equal(readFileSync(join(dir, 'data', name), 'utf8'), contents, `${name} must not change`);
    }
  });
}
