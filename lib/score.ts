import type { History, Probe, Row, Target } from './types';

export const KEEP = 30; // probes kept per resource, about 7 days at one probe every 6 hours

export type StatusClass = 'paywalled' | 'free' | 'error' | 'down';

export function statusClass(s: number): StatusClass {
  if (s === 402) return 'paywalled';
  if (s === 0 || s >= 500) return 'down';
  if (s < 400) return 'free';
  return 'error';
}

// 0-100. Uptime dominates; latency, honest pricing, and complete listings fill the rest.
export function score(t: Target, probes: Probe[]): Row {
  const last = probes[probes.length - 1];
  const up = probes.filter((p) => p.s === 402).length / Math.max(probes.length, 1);
  const lat = probes.filter((p) => p.s === 402).map((p) => p.ms).sort((a, b) => a - b);
  const medianMs = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const livePrice = last?.p;
  const priceDrift = Boolean(livePrice && t.declaredAmount && livePrice !== t.declaredAmount);
  const latencyPts = !lat.length ? 0 : medianMs <= 300 ? 15 : medianMs <= 1000 ? 10 : medianMs <= 3000 ? 5 : 0;
  const completeness = (t.description ? 4 : 0) + (t.hasInputExample ? 3 : 0) + (t.hasOutputExample ? 3 : 0);
  return {
    ...t,
    score: Math.round(up * 60 + latencyPts + (priceDrift ? 0 : 15) + completeness),
    uptime: up,
    medianMs,
    lastStatus: last?.s ?? 0,
    livePrice,
    priceDrift,
    checks: probes.length,
    lastChecked: last?.t ?? '',
    tape: probes.map((p) => p.s),
  };
}

export function scoreAll(targets: Target[], history: History): Row[] {
  return targets
    .map((t) => {
      const { body, ...row } = score(t, history[t.url] ?? []);
      void body; // example bodies are only needed to probe, not to publish
      return row;
    })
    .sort((a, b) => b.score - a.score || (b.payers30d ?? 0) - (a.payers30d ?? 0));
}
