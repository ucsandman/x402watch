import Link from 'next/link';
import { counts, feed, filterRows, networkLabel, page, usd, type Query } from '@/lib/data';
import { statusClass, type StatusClass } from '@/lib/score';
import type { Row } from '@/lib/types';


const STATUS_LABEL: Record<StatusClass | 'drift', string> = {
  paywalled: 'answering 402',
  down: 'down',
  error: 'rejecting',
  free: 'no paywall',
  drift: 'price drift',
};

function href(q: Query) {
  const p = new URLSearchParams();
  if (q.q) p.set('q', q.q);
  if (q.status) p.set('status', q.status);
  if (q.page && q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

function Tape({ tape = [] }: { tape?: number[] }) {
  const cells = [...Array(30 - Math.min(tape.length, 30)).fill(-1), ...tape.slice(-30)];
  return (
    <span className="tape" aria-label={`${tape.filter((s) => s === 402).length} of ${tape.length} probes answered 402`}>
      {cells.map((s, i) => (
        <i key={i} data-s={s === -1 ? 'none' : s === 402 ? 'ok' : statusClass(s)} />
      ))}
    </span>
  );
}

function Strip({ r }: { r: Row }) {
  const cls = statusClass(r.lastStatus);
  const u = new URL(r.url);
  return (
    <li className="strip grid grid-cols-[3.5rem_1fr] md:grid-cols-[3.5rem_minmax(0,1fr)_9rem_6rem_5rem_5rem_13rem] gap-x-4 gap-y-1 items-center px-4 py-3 text-sm">
      <span className="font-display text-2xl font-bold leading-none" style={{ color: r.score >= 80 ? 'var(--ok)' : r.score >= 50 ? 'var(--warn)' : 'var(--bad)' }}>
        {r.score}
      </span>
      <span className="min-w-0">
        <a href={r.url} rel="noopener nofollow" className="font-mono text-[13px] break-all hover:underline">
          <span className="text-ink-soft">{u.host}</span>
          {u.pathname}
          {u.search}
        </a>
        {r.description && <span className="block text-ink-soft truncate">{r.description}</span>}
      </span>
      <span className="font-mono text-[13px] col-start-2 md:col-start-auto">
        {r.priceDrift ? (
          <span className="text-bad">
            <s className="text-ink-soft">{usd(r.declaredAmount)}</s> {usd(r.livePrice)}
          </span>
        ) : (
          usd(r.livePrice ?? r.declaredAmount)
        )}
        <span className="text-ink-soft"> {networkLabel(r.network)}</span>
      </span>
      <span className="font-mono text-[13px] text-ink-soft col-start-2 md:col-start-auto">
        {cls === 'paywalled' ? `${r.medianMs} ms` : STATUS_LABEL[cls]}
      </span>
      <span className="font-mono text-[13px] col-start-2 md:col-start-auto">
        {r.payers30d !== undefined ? `${r.payers30d} payers` : ''}
      </span>
      <span className="font-mono text-[13px] col-start-2 md:col-start-auto">{Math.round(r.uptime * 100)}% up</span>
      <span className="col-start-2 md:col-start-auto">
        <Tape tape={r.tape} />
      </span>
    </li>
  );
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const status = typeof sp.status === 'string' ? (sp.status as Query['status']) : undefined;
  const pageNo = Number(sp.page) || 1;
  const c = counts();
  const all = filterRows({ q, status });
  const pg = page(all, pageNo);
  const checked = new Date(feed.generatedAt);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <Link href="/" className="font-display text-xl font-black tracking-tight">
          x402watch
        </Link>
        <nav className="font-mono text-[13px] flex gap-5">
          <a href="/api/feed" className="hover:underline">
            /api/feed
          </a>
          <a href="https://github.com/ucsandman/x402watch" className="hover:underline">
            source
          </a>
        </nav>
      </header>

      <section className="mt-12 max-w-3xl">
        <h1 className="font-display text-3xl md:text-5xl font-black leading-[1.05] tracking-tight">
          {feed.count.toLocaleString()} paid endpoints are listed. {c.paywalled.toLocaleString()} answered a real 402 at the last check.
        </h1>
        <p className="mt-5 text-base md:text-lg leading-relaxed text-ink-soft max-w-2xl">
          Every x402 endpoint on the Coinbase Bazaar and x402scan, probed unpaid every six hours. A listing tells you
          the price a seller wrote down. This tells you whether the endpoint is reachable, whether it charges what it
          declared, and how fast it answers. Ranked by an assay score out of 100.
        </p>
        <p className="mt-3 font-mono text-[13px] text-ink-soft">
          Last check {checked.toISOString().replace('T', ' ').slice(0, 16)} UTC · {feed.count.toLocaleString()} probed
        </p>
      </section>

      <section className="mt-10 flex flex-wrap gap-2 font-mono text-[13px]">
        {(['paywalled', 'down', 'error', 'free', 'drift'] as const).map((k) => (
          <Link
            key={k}
            href={href({ q, status: status === k ? undefined : k })}
            className={`px-3 py-1.5 border ${status === k ? 'bg-ink text-paper border-ink' : 'border-ink/30 hover:border-ink'}`}
          >
            {c[k].toLocaleString()} {STATUS_LABEL[k]}
          </Link>
        ))}
        <form className="ml-auto flex" action="/" method="get">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="host, path, or description"
            aria-label="Search endpoints"
            className="w-64 border border-ink/30 bg-paper px-3 py-1.5 placeholder:text-ink-soft"
          />
          <button type="submit" className="border border-l-0 border-ink/30 bg-ink px-3 text-paper">
            Search
          </button>
        </form>
      </section>

      <section className="mt-6">
        <div className="hidden md:grid grid-cols-[3.5rem_minmax(0,1fr)_9rem_6rem_5rem_5rem_13rem] gap-x-4 px-4 pb-2 font-mono text-[11px] uppercase tracking-wider text-ink-soft">
          <span>Score</span>
          <span>Endpoint</span>
          <span>Price · network</span>
          <span>Latency</span>
          <span>30d</span>
          <span>Uptime</span>
          <span>Last {Math.min(30, Math.max(...feed.rows.map((r) => r.checks), 1))} probes</span>
        </div>
        {pg.rows.length === 0 ? (
          <p className="strip px-4 py-8 text-center text-ink-soft">
            Nothing matches. Clear the filter or search for a host name.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {pg.rows.map((r) => (
              <Strip key={r.url} r={r} />
            ))}
          </ol>
        )}
        {pg.pages > 1 && (
          <nav className="mt-6 flex items-center justify-between font-mono text-[13px]" aria-label="Pages">
            <span>
              {pg.total.toLocaleString()} endpoints · page {pg.current} of {pg.pages}
            </span>
            <span className="flex gap-3">
              {pg.current > 1 && (
                <Link href={href({ q, status, page: pg.current - 1 })} className="hover:underline">
                  ← newer
                </Link>
              )}
              {pg.current < pg.pages && (
                <Link href={href({ q, status, page: pg.current + 1 })} className="hover:underline">
                  next →
                </Link>
              )}
            </span>
          </nav>
        )}
      </section>

      <footer className="mt-16 border-t border-ink/20 pt-6 font-mono text-[12px] text-ink-soft leading-relaxed max-w-3xl">
        <p>
          Score = uptime over the last {30} probes (60) + median latency (15) + declared price matches the live 402
          (15) + listing has a description, input example and output example (10). Unpaid probes only: we send one
          request without payment and read the 402 challenge. Payer counts come from the Bazaar. Sellers: fix the
          listing at the source and the next check picks it up.
        </p>
        <p className="mt-2">
          JSON for agents: <a href="/api/feed?limit=50" className="underline">/api/feed</a> with q, status, limit, offset.
        </p>
      </footer>
    </main>
  );
}
