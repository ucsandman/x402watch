import type { Probe, Target } from './types';

// One unpaid request. A healthy paid endpoint answers 402 with a PAYMENT-REQUIRED header.
export async function probe(t: Target, timeoutMs = 8000): Promise<Probe> {
  const t0 = Date.now();
  try {
    const res = await fetch(t.url, {
      method: t.method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'x402watch/1 (+https://x402watch.vercel.app)',
      },
      body: t.method === 'POST' ? JSON.stringify(t.body ?? {}) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - t0;
    let p: string | undefined;
    const hdr = res.headers.get('payment-required');
    if (hdr) {
      try {
        // Compare like with like: the live option on the listed network, else the first one.
        const accepts: Array<{ network?: string; amount?: string }> = JSON.parse(Buffer.from(hdr, 'base64').toString()).accepts ?? [];
        p = (accepts.find((a) => a.network === t.network) ?? accepts[0])?.amount;
      } catch {
        // not a v2 challenge header
      }
    }
    return { t: new Date().toISOString(), s: res.status, ms, p };
  } catch {
    return { t: new Date().toISOString(), s: 0, ms: Date.now() - t0 };
  }
}

export async function probeAll(targets: Target[], concurrency = 40): Promise<Map<string, Probe>> {
  const out = new Map<string, Probe>();
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < targets.length) {
        const t = targets[i++];
        out.set(t.url, await probe(t));
      }
    }),
  );
  return out;
}
