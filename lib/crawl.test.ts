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
const request = (url: URL) => JSON.parse(url.searchParams.get('input')!).json;

const mockFetch = (t: TestContext, handle: (url: URL, init?: RequestInit) => Response | Promise<Response>) => {
  t.after(() => t.mock.restoreAll());
  return t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    return handle(new URL(String(input)), init);
  });
};

type Where = { id?: { lt?: string; gt?: string }; AND?: Where[] };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const inRange = (id: string, where: Where, order = compare): boolean => {
  return (!where.AND || where.AND.every((part) => inRange(id, part, order)))
    && (where.id?.lt === undefined || order(id, where.id.lt) < 0)
    && (where.id?.gt === undefined || order(id, where.id.gt) > 0);
};

// All timestamps tie. Changing sample order is valid; overlapping offset pages
// deliberately reproduce the failure seen in the live catalog.
const catalog = (t: TestContext, items: ReturnType<typeof resource>[], order = compare) => {
  let calls = 0;
  return mockFetch(t, (url) => {
    const { pagination, where } = request(url);
    const matching = items.filter((item) => inRange(item.id, where, order)).sort((a, b) => order(a.id, b.id));
    const length = Math.min(pagination.page_size, matching.length - pagination.page * pagination.page_size);
    const sample = Array.from({ length }, (_, i) => matching[Math.floor(i * matching.length / length)]);
    if (calls++ % 2 === 0) sample.reverse();
    return response(page(sample, matching.length, pagination.page_size, pagination.page));
  });
};

test('crawlScan enumerates 20001 tied resources despite reordered samples and overlapping offset pages', async (t) => {
  const items = Array.from({ length: 20001 }, (_, i) => resource(i, {
    lastUpdated: '2026-10-01T00:00:00Z',
    metadata: { authMode: ['siwx', 'unprotected', 'apiKey'][i % 3] },
  }));
  const fetch = catalog(t, items);
  const targets = await crawlScan();
  assert.equal(targets.length, items.length);
  assert.deepEqual(new Set(targets.map((target) => target.url)), new Set(items.map((item) => item.resource)));
  assert.ok(targets.some((target) => target.url === 'https://example.com/api/20000'));
  assert.ok(fetch.mock.callCount() > 1);
  for (const call of fetch.mock.calls) {
    assert.deepEqual(request(new URL(String(call.arguments[0]))).pagination, { page: 0, page_size: 1000 });
  }
});

test('crawlScan keeps the free route, membership filters, ordering and timeout on every range', async (t) => {
  const root = {
    excluded: { is: null },
    OR: [
      { accepts: { some: {} } },
      { metadata: { path: ['authMode'], equals: 'siwx' } },
      { metadata: { path: ['authMode'], equals: 'unprotected' } },
      { metadata: { path: ['authMode'], equals: 'apiKey' } },
    ],
  };
  const queries = [root, { AND: [root, { id: { lt: 'resource-1' } }] }, { AND: [root, { id: { gt: 'resource-1' } }] }];
  const pages = [page([resource(2), resource(1)], 3, 2), page([resource(0)], 1, 2), page([resource(2)], 1, 2)];
  let calls = 0;
  const fetch = mockFetch(t, (url, init) => {
    assert.equal(url.origin, 'https://www.x402scan.com');
    assert.equal(url.pathname, '/api/trpc/public.resources.list.paginated');
    assert.deepEqual([...url.searchParams.keys()], ['input']);
    assert.deepEqual(request(url), {
      pagination: { page: 0, page_size: 2 },
      sorting: { id: 'lastUpdated', desc: false },
      where: queries[calls],
    });
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    return response(pages[calls++]);
  });
  const targets = await crawlScan(2);
  assert.equal(targets.length, 3);
  assert.equal(fetch.mock.callCount(), 3);
});

for (const total of [0, 1, 3, 4, 6, 7]) {
  test(`crawlScan completes ${total} resources with a page size of 3`, async (t) => {
    const items = Array.from({ length: total }, (_, i) => resource(i));
    const fetch = catalog(t, items);
    assert.deepEqual(new Set((await crawlScan(3)).map((target) => target.url)), new Set(items.map((item) => item.resource)));
    if (total <= 3) assert.equal(fetch.mock.callCount(), 1);
  });
}

test('crawlScan handles one-row pages and non-UUID IDs using the database range order', async (t) => {
  const items = ['z', 'A', 'aa', 'é', '😀', '资源', 'a/../b', '0004', '2', '10'].map((id, i) => resource(i, { id }));
  // This collation deliberately reverses JS string ordering.
  catalog(t, items, (a, b) => -compare(a, b));
  assert.deepEqual(new Set((await crawlScan(1)).map((target) => target.url)), new Set(items.map((item) => item.resource)));
});

test('crawlScan counts resource IDs even when distinct methods share a URL', async (t) => {
  catalog(t, [
    resource(0, { resource: 'https://example.com/shared', method: 'GET' }),
    resource(1, { resource: 'https://example.com/shared', method: 'POST' }),
  ]);
  const targets = await crawlScan(1);
  assert.equal(targets.length, 2);
  assert.deepEqual(new Set(targets.map((target) => [target.url, target.method].join(' '))), new Set([
    'https://example.com/shared GET', 'https://example.com/shared POST',
  ]));
});

test('crawlScan preserves v1/v2 amounts, descriptions, methods and source while skipping empty payTo accepts', async (t) => {
  const items = [
    resource(0, {
      method: 'POST', metadata: { description: 'v1 endpoint' },
      accepts: [
        { payTo: '', maxAmountRequired: 'ignored', network: 'ignored' },
        { payTo: 'wallet-v1', maxAmountRequired: '100', amount: '200', network: 'base' },
      ],
    }),
    resource(1, { metadata: { description: 'v2 endpoint' }, accepts: [{ payTo: 'wallet-v2', amount: '300', network: 'eip155:8453' }] }),
    resource(2, { method: 'PUT', accepts: [{ payTo: '', amount: 'ignored' }] }),
  ];
  mockFetch(t, () => response(page(items, 3, 1000)));
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

test('crawlScan accepts a positive custom page size', async (t) => {
  mockFetch(t, (url) => {
    assert.equal(request(url).pagination.page_size, 150);
    return response(page([resource(0)], 1, 150));
  });
  assert.equal((await crawlScan(150)).length, 1);
});

for (const [name, payload] of [
  ['missing envelope', {}], ['null envelope', null],
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
  ['missing items', { items: undefined }], ['object items', { items: {} }],
  ['wrong page', { page: 1 }], ['string page', { page: '0' }],
  ['negative total', { total_count: -1 }], ['fractional total', { total_count: 1.5 }],
  ['unsafe total', { total_count: Number.MAX_SAFE_INTEGER + 1 }], ['string total', { total_count: '1' }],
  ['missing total', { total_count: undefined }], ['incorrect total pages', { total_pages: 2 }],
  ['missing hasNextPage', { hasNextPage: undefined }], ['nonboolean hasNextPage', { hasNextPage: 'false' }],
  ['unexpected next page', { hasNextPage: true }], ['too many items', { items: [resource(0), resource(1)] }],
  ['missing ID', { items: [resource(0, { id: undefined })] }], ['empty ID', { items: [resource(0, { id: '' })] }],
  ['nonstring resource URL', { items: [resource(0, { resource: 123 })] }], ['null item', { items: [null] }],
] as const) {
  test(`crawlScan rejects malformed page: ${name}`, async (t) => {
    mockFetch(t, () => response({ ...page([resource(0)], 1, 2), ...changes }));
    await assert.rejects(crawlScan(2), /x402scan.*page/i);
  });
}

for (const [name, pages, expected] of [
  ['duplicate IDs within a page', [page([resource(0), resource(0)], 3, 2)], /x402scan.*duplicate/i],
  ['pivot repeated in a leaf', [page([resource(2), resource(1)], 3, 2), page([resource(1)], 1, 2), page([resource(2)], 1, 2)], /x402scan.*duplicate/i],
  ['duplicate IDs across leaves', [page([resource(2), resource(3)], 5, 2), page([resource(0), resource(1)], 2, 2), page([resource(0), resource(4)], 2, 2)], /x402scan.*duplicate/i],
  ['changing total before recursion', [page([resource(0), resource(1)], 7, 2), page([resource(2), resource(3)], 4, 2), page([resource(4)], 1, 2)], /x402scan.*total/i],
  ['no progress', [page([resource(0), resource(1)], 3, 2), page([resource(2), resource(3)], 3, 2), page([], 0, 2)], /x402scan.*(?:total|progress)/i],
  ['missing child records', [page([resource(0), resource(1)], 3, 2), page([], 0, 2), page([], 0, 2)], /x402scan.*total/i],
  ['incomplete leaf', [page([resource(0), resource(1)], 4, 2), page([resource(2)], 2, 2)], /x402scan.*page/i],
  ['empty leaf with a positive count', [page([resource(0), resource(1)], 3, 2), page([], 1, 2)], /x402scan.*page/i],
  ['premature last page', [{ ...page([resource(0), resource(1)], 3, 2), hasNextPage: false }], /x402scan.*page/i],
  ['short oversized sample', [page([resource(0)], 3, 2)], /x402scan.*page/i],
  ['unexpected later page number', [page([resource(0), resource(1)], 3, 2), page([resource(2)], 1, 2, 1)], /x402scan.*page/i],
] as const) {
  test(`crawlScan rejects ${name} instead of returning a partial list`, async (t) => {
    let calls = 0;
    mockFetch(t, () => response(pages[calls++]));
    await assert.rejects(crawlScan(2), expected);
    assert.equal(calls, pages.length);
  });
}

for (const failedRequest of [0, 1, 2]) {
  test(`crawlScan rejects HTTP failure on range request ${failedRequest}`, async (t) => {
    let calls = 0;
    mockFetch(t, () => calls++ === failedRequest
      ? new Response('upstream unavailable', { status: 503 })
      : response(calls === 1 ? page([resource(0)], 2, 1) : page([], 0, 1)));
    await assert.rejects(crawlScan(1), /x402scan 503/);
    assert.equal(calls, failedRequest + 1);
  });

  test(`crawlScan propagates fetch rejection on range request ${failedRequest}`, async (t) => {
    const failure = new Error('fetch interrupted');
    let calls = 0;
    mockFetch(t, () => {
      if (calls++ === failedRequest) throw failure;
      return response(calls === 1 ? page([resource(0)], 2, 1) : page([], 0, 1));
    });
    await assert.rejects(crawlScan(1), (error) => error === failure);
    assert.equal(calls, failedRequest + 1);
  });
}

test('crawlScan rejects malformed JSON', async (t) => {
  mockFetch(t, () => new Response('not JSON', { status: 200 }));
  await assert.rejects(crawlScan(), SyntaxError);
});

test('crawlScan rejects a malformed success on a later range', async (t) => {
  let calls = 0;
  mockFetch(t, () => calls++ === 0 ? response(page([resource(0)], 2, 1)) : Response.json({}));
  await assert.rejects(crawlScan(1), /x402scan.*page/i);
  assert.equal(calls, 2);
});

for (const [name, total, expectedCalls, expected] of [
  ['depth', 66, 129, /x402scan.*depth limit/i],
  ['request', 8191, 4096, /x402scan.*request limit/i],
] as const) {
  test(`crawlScan fails closed at its ${name} bound`, async (t) => {
    let calls = 0;
    const id = (index: number) => `resource-${String(index).padStart(5, '0')}`;
    mockFetch(t, (url) => {
      const { where } = request(url);
      let low = 0;
      let high: number = total;
      const bounds = (part: Where) => {
        for (const child of part.AND ?? []) bounds(child);
        if (part.id?.lt !== undefined) high = Math.min(high, Number(part.id.lt.slice(9)));
        if (part.id?.gt !== undefined) low = Math.max(low, Number(part.id.gt.slice(9)) + 1);
      };
      bounds(where);
      const count = high - low;
      const pivot = name === 'depth' ? low : Math.floor((low + high) / 2);
      calls++;
      return response(page(count ? [resource(pivot, { id: id(pivot) })] : [], count, 1));
    });
    await assert.rejects(crawlScan(1), expected);
    assert.equal(calls, expectedCalls);
  });
}
