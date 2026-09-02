import { NextResponse } from 'next/server';
import { feed, filterRows, type Query } from '@/lib/data';


// GET /api/feed?q=&status=paywalled|down|error|free|drift&limit=100&offset=0
export function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get('q') ?? undefined;
  const status = (u.searchParams.get('status') ?? undefined) as Query['status'];
  const limit = Math.min(Math.max(Number(u.searchParams.get('limit')) || 100, 1), 1000);
  const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0);
  const rows = filterRows({ q, status });
  return NextResponse.json(
    { generatedAt: feed.generatedAt, total: rows.length, limit, offset, rows: rows.slice(offset, offset + limit) },
    { headers: { 'cache-control': 'public, max-age=300, s-maxage=3600', 'access-control-allow-origin': '*' } },
  );
}
