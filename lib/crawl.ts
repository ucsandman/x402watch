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

// x402scan: public tRPC pagination, with the same membership as empty-query search.
// Pages are not a snapshot; reject observable changes instead of publishing a partial crawl.
export async function crawlScan(pageSize = 100): Promise<Target[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error('x402scan invalid page size');
  const items: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let page = 0; ; page++) {
    const input = encodeURIComponent(JSON.stringify({ json: {
      pagination: { page, page_size: pageSize },
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
    } }));
    const res = await fetch(`${SCAN}?input=${input}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`x402scan ${res.status}`);
    const envelope = await res.json();
    const data = envelope?.result?.data?.json;
    if (envelope?.error || !data || !Array.isArray(data.items) || data.page !== page
      || !Number.isSafeInteger(data.total_count) || data.total_count < 0
      || data.total_pages !== Math.ceil(data.total_count / pageSize)) {
      throw new Error(`x402scan invalid page ${page}`);
    }
    if (total !== undefined && data.total_count !== total) throw new Error(`x402scan total changed on page ${page}`);
    total = data.total_count as number;
    if (data.hasNextPage !== (page + 1 < data.total_pages)
      || data.items.length !== Math.min(pageSize, total - page * pageSize)) {
      throw new Error(`x402scan incomplete or inconsistent page ${page}`);
    }
    for (const it of data.items) {
      if (!it || typeof it.id !== 'string' || !it.id || typeof it.resource !== 'string' || !it.resource) {
        throw new Error(`x402scan invalid resource on page ${page}`);
      }
      if (ids.has(it.id)) throw new Error(`x402scan duplicate resource ${it.id} on page ${page}`);
      ids.add(it.id);
      items.push(it);
    }
    if (!data.hasNextPage) break;
  }
  if (ids.size !== total) throw new Error('x402scan incomplete resource total');
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
