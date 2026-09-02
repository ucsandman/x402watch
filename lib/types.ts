export type Source = 'bazaar' | 'x402scan';

export interface Target {
  url: string;
  sources: Source[];
  method: 'GET' | 'POST';
  body?: unknown;
  description?: string;
  declaredAmount?: string; // smallest units, as listed
  network?: string;
  payTo?: string;
  hasInputExample: boolean;
  hasOutputExample: boolean;
  payers30d?: number;
  calls30d?: number;
  lastCalledAt?: string;
}

export interface Probe {
  t: string; // ISO
  s: number; // HTTP status, 0 = unreachable
  ms: number;
  p?: string; // live amount from the 402 challenge
}

export type History = Record<string, Probe[]>;

export interface Row extends Target {
  score: number;
  uptime: number; // 0..1 over stored probes
  medianMs: number;
  lastStatus: number;
  livePrice?: string;
  priceDrift: boolean;
  checks: number;
  lastChecked: string;
  tape: number[]; // last KEEP statuses, oldest first
}
