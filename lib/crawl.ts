import type { Source, Target } from './types';

const BAZAAR = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const PAYAI = 'https://facilitator.payai.network/discovery/resources';
const SCAN = 'https://www.x402scan.com/api/trpc/public.resources.search';

// Coinbase x402 Bazaar: offset-paginated, public, no key.
export function crawlBazaar(pageSize = 100, max = Infinity): Promise<Target[]> {
  return crawlDiscovery(BAZAAR, 'bazaar', pageSize, max);
}

// PayAI facilitator discovery: same /discovery/resources shape as the Bazaar, public, no key.
export function crawlPayai(pageSize = 100, max = Infinity): Promise<Target[]> {
  return crawlDiscovery(PAYAI, 'payai', pageSize, max);
}

async function crawlDiscovery(base: string, source: Source, pageSize: number, max: number): Promise<Target[]> {
  const out: Target[] = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const res = await fetch(`${base}?limit=${pageSize}&offset=${offset}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${source} ${res.status}`);
    const j = await res.json();
    for (const it of j.items ?? []) {
      const info = it.metadata?.bazaar?.info ?? it.extensions?.bazaar?.info;
      // PayAI also puts the method and example body in a top-level inputSchema when there is no bazaar extension.
      const input = info?.input ?? it.inputSchema;
      const accept = it.accepts?.[0];
      out.push({
        url: it.resource,
        sources: [source],
        method: input?.method === 'POST' ? 'POST' : 'GET',
        body: input?.body,
        description: it.description ?? accept?.description,
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
// ponytail: 20000 is the largest limit the endpoint accepts (100000 returns 500); paginate if x402scan outgrows it.
export async function crawlScan(limit = 20000): Promise<Target[]> {
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
