import type { Source, Target } from './types';

const BAZAAR = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const SCAN = 'https://www.x402scan.com/api/trpc/public.resources.list.paginated';

// Coinbase x402 Bazaar: offset-paginated, public, no key.
export async function crawlBazaar(pageSize = 100, max = Infinity): Promise<Target[]> {
  const out: Target[] = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const res = await fetch(`${BAZAAR}?limit=${pageSize}&offset=${offset}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`bazaar ${res.status}`);
    const j = await res.json();
    for (const it of j.items ?? []) {
      const info = it.metadata?.bazaar?.info ?? it.extensions?.bazaar?.info;
      const input = info?.input;
      const accept = it.accepts?.[0];
      out.push({
        url: it.resource,
        sources: ['bazaar'],
        method: input?.method === 'POST' ? 'POST' : 'GET',
        body: input?.body,
        description: it.description,
        declaredAmount: accept?.amount ?? accept?.maxAmountRequired,
        network: accept?.network,
        payTo: accept?.payTo,
        hasInputExample: Boolean(input?.body ?? input?.queryParams),
        hasOutputExample: info?.output?.example !== undefined,
        payers30d: it.quality?.l30DaysUniquePayers,
        calls30d: it.quality?.l30DaysTotalCalls,
        lastCalledAt: it.quality?.lastCalledAt,
      });
    }
    if (offset + pageSize >= (j.pagination?.total ?? 0)) break;
  }
  return out;
}

// x402scan: split oversized ID ranges instead of relying on unstable offset ordering.
// Ranges are not a snapshot; reject observable changes instead of publishing a partial crawl.
export async function crawlScan(pageSize = 1000): Promise<Target[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error('x402scan invalid page size');
  type ScanPage = { items: Array<Record<string, unknown> & { id: string }>; total_count: number };
  const items: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  const membership = {
    excluded: { is: null },
    OR: [
      { accepts: { some: {} } },
      { metadata: { path: ['authMode'], equals: 'siwx' } },
      { metadata: { path: ['authMode'], equals: 'unprotected' } },
      { metadata: { path: ['authMode'], equals: 'apiKey' } },
    ],
  };
  let requests = 0;
  async function read(where: Record<string, unknown>): Promise<ScanPage> {
    if (requests >= 4096) throw new Error('x402scan request limit exceeded');
    requests++;
    const input = encodeURIComponent(JSON.stringify({ json: {
      pagination: { page: 0, page_size: pageSize },
      sorting: { id: 'lastUpdated', desc: false },
      where,
    } }));
    const res = await fetch(`${SCAN}?input=${input}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`x402scan ${res.status}`);
    const envelope = await res.json();
    const data = envelope?.result?.data?.json;
    if (envelope?.error || !data || !Array.isArray(data.items) || data.page !== 0
      || !Number.isSafeInteger(data.total_count) || data.total_count < 0
      || data.total_pages !== Math.ceil(data.total_count / pageSize)) {
      throw new Error(`x402scan invalid page on request ${requests}`);
    }
    if (data.hasNextPage !== (data.total_count > pageSize)
      || data.items.length !== Math.min(pageSize, data.total_count)) {
      throw new Error(`x402scan incomplete or inconsistent page on request ${requests}`);
    }
    const pageIds = new Set<string>();
    for (const it of data.items) {
      if (!it || typeof it.id !== 'string' || !it.id || typeof it.resource !== 'string' || !it.resource) {
        throw new Error(`x402scan invalid resource on page request ${requests}`);
      }
      if (pageIds.has(it.id)) throw new Error(`x402scan duplicate resource ${it.id} on page request ${requests}`);
      pageIds.add(it.id);
    }
    return data;
  }
  function add(it: ScanPage['items'][number]) {
    if (ids.has(it.id)) throw new Error(`x402scan duplicate resource ${it.id} across ranges`);
    ids.add(it.id);
    items.push(it);
  }
  async function collect(where: Record<string, unknown>, data: ScanPage, depth: number): Promise<void> {
    if (data.total_count <= pageSize) {
      for (const it of data.items) add(it);
      return;
    }
    if (depth >= 64) throw new Error('x402scan depth limit exceeded');
    // JS ordering only chooses a sampled pivot; the database defines each range.
    const sample = [...data.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const pivot = sample[Math.floor((sample.length - 1) / 2)];
    const leftWhere = { AND: [where, { id: { lt: pivot.id } }] };
    const rightWhere = { AND: [where, { id: { gt: pivot.id } }] };
    const left = await read(leftWhere);
    const right = await read(rightWhere);
    if (left.total_count >= data.total_count || right.total_count >= data.total_count
      || left.total_count + right.total_count + 1 !== data.total_count) {
      throw new Error('x402scan inconsistent range totals');
    }
    add(pivot);
    await collect(leftWhere, left, depth + 1);
    await collect(rightWhere, right, depth + 1);
  }
  const root = await read(membership);
  await collect(membership, root, 0);
  if (ids.size !== root.total_count) throw new Error('x402scan incomplete resource total');
  return items.map((it) => {
    const accept = (it.accepts as Array<Record<string, string>> | undefined)?.find((a) => a.payTo !== '');
    return {
      url: String(it.resource),
      sources: ['x402scan' as Source],
      method: it.method === 'POST' ? 'POST' : 'GET',
      description: (it.metadata as { description?: string } | null)?.description,
      declaredAmount: accept?.maxAmountRequired ?? accept?.amount,
      network: accept?.network,
      payTo: accept?.payTo,
      hasInputExample: false,
      hasOutputExample: false,
    };
  });
}

export function mergeTargets(...lists: Target[][]): Target[] {
  const byUrl = new Map<string, Target>();
  for (const t of lists.flat()) {
    const prev = byUrl.get(t.url);
    if (!prev) {
      byUrl.set(t.url, { ...t });
      continue;
    }
    byUrl.set(t.url, {
      ...prev,
      ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== false)),
      sources: [...new Set([...prev.sources, ...t.sources])],
    });
  }
  return [...byUrl.values()];
}
