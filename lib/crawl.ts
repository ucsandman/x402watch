import type { Source, Target } from './types';

const BAZAAR = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const SCAN = 'https://www.x402scan.com/api/trpc/public.resources.search';

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

// x402scan: tRPC search with an empty query returns everything up to limit.
export async function crawlScan(limit = 100000): Promise<Target[]> {
  const input = encodeURIComponent(JSON.stringify({ json: { search: '', limit } }));
  const res = await fetch(`${SCAN}?input=${input}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`x402scan ${res.status}`);
  const items: Array<Record<string, unknown>> = (await res.json()).result?.data?.json ?? [];
  return items.map((it) => {
    const accept = (it.accepts as Array<Record<string, string>> | undefined)?.[0];
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
