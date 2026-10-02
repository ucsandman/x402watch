import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { crawlScan } from './crawl.ts';

const resource = (id: number, over: Record<string, unknown> = {}) => ({
  id: `resource-${id}`,
  resource: `https://example.com/api/${id}`,
  method: 'GET',
  metadata: null,
  accepts: [],
  ...over,
});

const page = (items: unknown[], total: number, pageSize: number, index = 0) => ({
  items,
  hasNextPage: index + 1 < Math.ceil(total / pageSize),
  total_count: total,
  total_pages: Math.ceil(total / pageSize),
  page: index,
});

const response = (data: unknown) => Response.json({ result: { data: { json: data } } });

const mockFetch = (t: TestContext, handle: (url: URL, init?: RequestInit) => Response | Promise<Response>) => {
  t.after(() => t.mock.restoreAll());
  return t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    return handle(new URL(String(input)), init);
  });
};

test('crawlScan requests every page beyond 20000 resources and includes the last endpoint', async (t) => {
  const total = 20001;
  let calls = 0;
  mockFetch(t, (url) => {
    if (url.pathname.endsWith('/public.resources.search')) {
      calls++;
      return response(Array.from({ length: 20000 }, (_, i) => resource(i)));
    }
    const { pagination } = JSON.parse(url.searchParams.get('input')!).json;
    assert.deepEqual(pagination, { page: calls, page_size: 100 });
    const start = calls++ * 100;
    const items = Array.from({ length: Math.min(100, total - start) }, (_, i) => resource(start + i));
    return response(page(items, total, 100, pagination.page));
  });
  const targets = await crawlScan();
  assert.equal(targets.length, total);
  assert.equal(calls, 201);
  assert.equal(new Set(targets.map((target) => target.url)).size, total);
  assert.equal(targets.at(-1)?.url, 'https://example.com/api/20000');
});

test('crawlScan uses the free paginated route with the search membership filters and ordering', async (t) => {
  const fetch = mockFetch(t, (url, init) => {
    assert.equal(url.origin, 'https://www.x402scan.com');
    assert.equal(url.pathname, '/api/trpc/public.resources.list.paginated');
    assert.deepEqual([...url.searchParams.keys()], ['input']);
    assert.deepEqual(JSON.parse(url.searchParams.get('input')!), {
      json: {
        pagination: { page: 0, page_size: 3 },
        sorting: { id: 'lastUpdated', desc: false },
        where: {
          excluded: { is: null },
          OR: [
            { accepts: { some: {} } },
            { metadata: { path: ['authMode'], equals: 'siwx' } },
            { metadata: { path: ['authMode'], equals: 'unprotected' } },
            { metadata: { path: ['authMode'], equals: 'apiKey' } },
          ],
        },
      },
    });
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    return response(page([], 0, 3));
  });
  assert.deepEqual(await crawlScan(3), []);
  assert.equal(fetch.mock.callCount(), 1);
});

for (const total of [0, 1, 3, 4, 6, 7]) {
  test(`crawlScan completes ${total} resources across page boundaries`, async (t) => {
    let calls = 0;
    mockFetch(t, () => {
      const index = calls++;
      const start = index * 3;
      return response(page(Array.from({ length: Math.min(3, total - start) }, (_, i) => resource(start + i)), total, 3, index));
    });
    const targets = await crawlScan(3);
    assert.equal(targets.length, total);
    assert.equal(calls, Math.max(1, Math.ceil(total / 3)));
  });
}

test('crawlScan counts resource IDs even when distinct methods share a URL', async (t) => {
  let calls = 0;
  mockFetch(t, () => {
    const index = calls++;
    return response(page([resource(index, { resource: 'https://example.com/shared', method: index === 0 ? 'GET' : 'POST' })], 2, 1, index));
  });
  const targets = await crawlScan(1);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map((target) => [target.url, target.method]), [
    ['https://example.com/shared', 'GET'],
    ['https://example.com/shared', 'POST'],
  ]);
});

test('crawlScan preserves v1/v2 amounts, descriptions, methods and source while skipping empty payTo accepts', async (t) => {
  const items = [
    resource(0, {
      method: 'POST',
      metadata: { description: 'v1 endpoint' },
      accepts: [
        { payTo: '', maxAmountRequired: 'ignored', network: 'ignored' },
        { payTo: 'wallet-v1', maxAmountRequired: '100', amount: '200', network: 'base' },
      ],
    }),
    resource(1, {
      metadata: { description: 'v2 endpoint' },
      accepts: [{ payTo: 'wallet-v2', amount: '300', network: 'eip155:8453' }],
    }),
    resource(2, { method: 'PUT', accepts: [{ payTo: '', amount: 'ignored' }] }),
  ];
  mockFetch(t, () => response(page(items, 3, 100)));
  assert.deepEqual(await crawlScan(), [
    {
      url: 'https://example.com/api/0', sources: ['x402scan'], method: 'POST',
      description: 'v1 endpoint', declaredAmount: '100', network: 'base', payTo: 'wallet-v1',
      hasInputExample: false, hasOutputExample: false,
    },
    {
      url: 'https://example.com/api/1', sources: ['x402scan'], method: 'GET',
      description: 'v2 endpoint', declaredAmount: '300', network: 'eip155:8453', payTo: 'wallet-v2',
      hasInputExample: false, hasOutputExample: false,
    },
    {
      url: 'https://example.com/api/2', sources: ['x402scan'], method: 'GET',
      description: undefined, declaredAmount: undefined, network: undefined, payTo: undefined,
      hasInputExample: false, hasOutputExample: false,
    },
  ]);
});

for (const pageSize of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`crawlScan rejects invalid page size ${pageSize} before fetching`, async (t) => {
    const fetch = mockFetch(t, () => { throw new Error('fetch must not run'); });
    await assert.rejects(crawlScan(pageSize), /x402scan.*page size/i);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test('crawlScan accepts a positive page size above the default', async (t) => {
  mockFetch(t, (url) => {
    assert.equal(JSON.parse(url.searchParams.get('input')!).json.pagination.page_size, 150);
    return response(page([resource(0)], 1, 150));
  });
  assert.equal((await crawlScan(150)).length, 1);
});

for (const [name, payload] of [
  ['missing envelope', {}],
  ['null envelope', null],
  ['tRPC error', { error: { json: { message: 'failed' } } }],
  ['null data', { result: { data: { json: null } } }],
  ['old search array', { result: { data: { json: [resource(0)] } } }],
] as const) {
  test(`crawlScan rejects ${name}`, async (t) => {
    mockFetch(t, () => Response.json(payload));
    await assert.rejects(crawlScan(), /x402scan.*page/i);
  });
}

for (const [name, changes] of [
  ['missing items', { items: undefined }],
  ['object items', { items: {} }],
  ['wrong page', { page: 1 }],
  ['string page', { page: '0' }],
  ['negative total', { total_count: -1 }],
  ['fractional total', { total_count: 1.5 }],
  ['unsafe total', { total_count: Number.MAX_SAFE_INTEGER + 1 }],
  ['string total', { total_count: '1' }],
  ['missing total', { total_count: undefined }],
  ['incorrect total pages', { total_pages: 2 }],
  ['missing hasNextPage', { hasNextPage: undefined }],
  ['nonboolean hasNextPage', { hasNextPage: 'false' }],
  ['unexpected next page', { hasNextPage: true }],
  ['too many items', { items: [resource(0), resource(1)] }],
  ['missing ID', { items: [resource(0, { id: undefined })] }],
  ['empty ID', { items: [resource(0, { id: '' })] }],
  ['nonstring resource URL', { items: [resource(0, { resource: 123 })] }],
  ['null item', { items: [null] }],
] as const) {
  test(`crawlScan rejects malformed page: ${name}`, async (t) => {
    mockFetch(t, () => response({ ...page([resource(0)], 1, 2), ...changes }));
    await assert.rejects(crawlScan(2), /x402scan.*page/i);
  });
}

for (const [name, first, second, expected] of [
  ['duplicate IDs within a page', page([resource(0), resource(0)], 2, 2), undefined, /x402scan.*duplicate/i],
  ['repeated page with updated metadata', page([resource(0), resource(1)], 4, 2), page([resource(0), resource(1)], 4, 2, 1), /x402scan.*duplicate/i],
  ['repeated page metadata', page([resource(0), resource(1)], 4, 2), page([resource(0), resource(1)], 4, 2), /x402scan.*page/i],
  ['changing total', page([resource(0), resource(1)], 3, 2), page([resource(2), resource(3)], 4, 2, 1), /x402scan.*total/i],
  ['incomplete last page', page([resource(0), resource(1)], 4, 2), page([resource(2)], 4, 2, 1), /x402scan.*page/i],
  ['empty last page', page([resource(0), resource(1)], 3, 2), page([], 3, 2, 1), /x402scan.*page/i],
  ['premature last page', { ...page([resource(0), resource(1)], 3, 2), hasNextPage: false }, undefined, /x402scan.*page/i],
  ['short nonfinal page', page([resource(0)], 3, 2), undefined, /x402scan.*page/i],
] as const) {
  test(`crawlScan rejects ${name} instead of returning a partial list`, async (t) => {
    let calls = 0;
    mockFetch(t, () => response(calls++ === 0 ? first : second));
    await assert.rejects(crawlScan(2), expected);
    assert.equal(calls, second === undefined ? 1 : 2);
  });
}

for (const failedPage of [0, 1]) {
  test(`crawlScan rejects HTTP failure on page ${failedPage}`, async (t) => {
    let calls = 0;
    mockFetch(t, () => calls++ === failedPage
      ? new Response('upstream unavailable', { status: 503 })
      : response(page([resource(0)], 2, 1)));
    await assert.rejects(crawlScan(1), /x402scan 503/);
    assert.equal(calls, failedPage + 1);
  });

  test(`crawlScan propagates fetch rejection on page ${failedPage}`, async (t) => {
    const failure = new Error('fetch interrupted');
    let calls = 0;
    mockFetch(t, () => {
      if (calls++ === failedPage) throw failure;
      return response(page([resource(0)], 2, 1));
    });
    await assert.rejects(crawlScan(1), (error) => error === failure);
    assert.equal(calls, failedPage + 1);
  });
}

test('crawlScan rejects malformed JSON', async (t) => {
  mockFetch(t, () => new Response('not JSON', { status: 200 }));
  await assert.rejects(crawlScan(), SyntaxError);
});

test('crawlScan rejects a malformed success on a later page', async (t) => {
  let calls = 0;
  mockFetch(t, () => calls++ === 0 ? response(page([resource(0)], 2, 1)) : Response.json({}));
  await assert.rejects(crawlScan(1), /x402scan.*page/i);
  assert.equal(calls, 2);
});
