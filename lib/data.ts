import type { Row } from './types';
import { statusClass, type StatusClass } from './score';
import latest from '@/data/latest.json';

export interface Feed {
  generatedAt: string;
  count: number;
  rows: Row[];
}

export const feed = latest as Feed;

export interface Query {
  q?: string;
  status?: StatusClass | 'drift';
  page?: number;
  limit?: number;
}

export function filterRows({ q, status }: Query): Row[] {
  const needle = q?.trim().toLowerCase();
  return feed.rows.filter((r) => {
    if (status === 'drift' ? !r.priceDrift : status && statusClass(r.lastStatus) !== status) return false;
    if (!needle) return true;
    return r.url.toLowerCase().includes(needle) || (r.description ?? '').toLowerCase().includes(needle);
  });
}

export function page(rows: Row[], pageNo = 1, limit = 100) {
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const current = Math.min(Math.max(1, pageNo), pages);
  return { rows: rows.slice((current - 1) * limit, current * limit), current, pages, total: rows.length };
}

export function counts() {
  const c: Record<StatusClass | 'drift', number> = { paywalled: 0, free: 0, error: 0, down: 0, drift: 0 };
  for (const r of feed.rows) {
    c[statusClass(r.lastStatus)]++;
    if (r.priceDrift) c.drift++;
  }
  return c;
}

const NETWORKS: Record<string, string> = {
  'eip155:8453': 'Base',
  'eip155:84532': 'Base Sepolia',
  base: 'Base',
  'base-sepolia': 'Base Sepolia',
  'eip155:1': 'Ethereum',
  'eip155:137': 'Polygon',
  'eip155:43114': 'Avalanche',
  'eip155:1329': 'Sei',
};

export function networkLabel(n?: string) {
  if (!n) return '';
  if (NETWORKS[n]) return NETWORKS[n];
  if (n.startsWith('solana:')) return 'Solana';
  return n;
}

// Amounts are in the asset's smallest unit; every listed asset so far is USDC (6 decimals).
export function usd(amount?: string) {
  if (!amount) return '';
  const n = Number(amount) / 1e6;
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}
