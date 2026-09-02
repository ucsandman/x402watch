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

const COLS = 'md:grid-cols-[3.25rem_minmax(0,1fr)_9.5rem_6rem_6rem_4.5rem_13rem]';

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
  const ok = tape.filter((s) => s === 402).length;
  return (
    <span className="tape" role="img" aria-label={`${ok} of ${tape.length} probes answered 402`}>
      {cells.map((s, i) => (
        <i key={i} data-s={s === -1 ? 'none' : s === 402 ? 'ok' : statusClass(s)} />
      ))}
    </span>
  );
}

function scoreColor(score: number) {
  return score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
}

function Strip({ r }: { r: Row }) {
  const cls = statusClass(r.lastStatus);
  const u = new URL(r.url);
  return (
    <li className={`strip grid grid-cols-[3.25rem_minmax(0,1fr)] ${COLS} gap-x-4 gap-y-1.5 items-center px-4 py-3 text-sm`}>
      <span className="font-mono text-2xl font-semibold leading-none tabular-nums self-start md:self-center pt-0.5 md:pt-0" style={{ color: scoreColor(r.score) }}>
        {r.score}
      </span>
      <span className="min-w-0">
        <a href={r.url} rel="noopener nofollow" className="font-mono text-sm md:text-[13px] break-all hover:underline">
          <span className="text-ink-soft">{u.host}</span>
          {u.pathname}
          {u.search}
        </a>
        {r.description && <span className="block text-ink-soft truncate">{r.description}</span>}
      </span>
      <span className="font-mono text-sm md:text-[13px] col-start-2 md:col-start-auto">
        {r.priceDrift ? (
          <span className="text-bad">
            <s className="text-ink-soft">{usd(r.declaredAmount)}</s> {usd(r.livePrice)}
          </span>
        ) : (
          usd(r.livePrice ?? r.declaredAmount)
        )}
        <span className="text-ink-soft"> {networkLabel(r.network)}</span>
      </span>
      <span className="col-start-2 flex flex-wrap gap-x-4 md:contents">
        <span
          className="font-mono text-sm md:text-[13px]"
          style={{ color: cls === 'paywalled' ? 'var(--ink-soft)' : cls === 'down' ? 'var(--bad)' : 'var(--warn)' }}
        >
          {cls === 'paywalled' ? `${r.medianMs} ms` : STATUS_LABEL[cls]}
        </span>
        <span className="font-mono text-sm md:text-[13px]">
          {r.payers30d !== undefined ? (
            <>
              {r.payers30d.toLocaleString()}
              <span className="md:hidden text-ink-soft"> payers</span>
            </>
          ) : (
            <span className="text-ink-soft" aria-label="no payer data">
              –
            </span>
          )}
        </span>
        <span className="font-mono text-sm md:text-[13px]">
          {Math.round(r.uptime * 100)}%<span className="md:hidden text-ink-soft"> up</span>
        </span>
      </span>
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
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <Link href="/" className="font-display text-xl font-black tracking-tight">
          x402watch
        </Link>
        <nav className="font-mono text-sm md:text-[13px] flex gap-5">
          <a href="/api/feed" className="hover:underline">
            /api/feed
          </a>
          <a href="https://github.com/ucsandman/x402watch" className="hover:underline">
            source
          </a>
          <a href="#scoring" className="hover:underline">
            how scoring works
          </a>
        </nav>
      </header>

      <section className="mt-10 md:mt-14 max-w-3xl">
        <h1 className="font-display text-[1.75rem] md:text-[2.5rem] font-black leading-[1.08] tracking-[-0.01em] text-balance">
          {feed.count.toLocaleString()} paid endpoints are listed. {c.paywalled.toLocaleString()} answered a real 402 at
          the last check.
        </h1>
        <p className="mt-5 text-base md:text-lg leading-relaxed text-ink-soft max-w-[62ch] text-pretty">
          Every x402 endpoint on the Coinbase Bazaar and x402scan, probed unpaid every six hours. A listing tells you the
          price a seller wrote down. This tells you whether the endpoint is reachable, whether it charges what it
          declared, and how fast it answers. Ranked by an assay score out of 100.
        </p>
        <p className="mt-3 font-mono text-sm md:text-[13px] text-ink-soft">
          Last check {checked.toISOString().replace('T', ' ').slice(0, 16)} UTC · {feed.count.toLocaleString()} probed
        </p>
      </section>

      <section className="mt-8 md:mt-10 flex flex-wrap gap-2 font-mono text-sm md:text-[13px]" aria-label="Filter">
        {(['paywalled', 'down', 'error', 'free', 'drift'] as const).map((k) => (
          <Link
            key={k}
            href={href({ q, status: status === k ? undefined : k })}
            aria-pressed={status === k}
            className={`inline-flex items-center min-h-11 px-3 border transition-colors duration-150 ${
              status === k ? 'bg-ink text-paper border-ink' : 'bg-paper/40 border-ink/30 hover:border-ink hover:bg-paper'
            }`}
          >
            {c[k].toLocaleString()} {STATUS_LABEL[k]}
          </Link>
        ))}
        <form className="flex w-full md:w-auto md:ml-auto" action="/" method="get" role="search">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="host, path, or description"
            aria-label="Search endpoints"
            className="min-h-11 w-full md:w-72 border border-ink/30 bg-paper px-3 placeholder:text-ink-soft focus:border-ink"
          />
          <button
            type="submit"
            className="min-h-11 border border-l-0 border-ink bg-ink px-4 text-paper hover:bg-ink/90 active:bg-ink/80"
          >
            Search
          </button>
        </form>
      </section>

      <section className="mt-6">
        <div className={`hidden md:grid ${COLS} gap-x-4 px-4 pb-2 font-mono text-[11px] uppercase tracking-wider text-ink-soft`}>
          <span>Score</span>
          <span>Endpoint</span>
          <span>Price · network</span>
          <span>Latency</span>
          <span>Payers 30d</span>
          <span>Uptime</span>
          <span>Last 30 probes</span>
        </div>
        {pg.rows.length === 0 ? (
          <p className="strip px-4 py-10 text-center text-ink-soft">
            Nothing matches{q ? ` “${q}”` : ''}. Try a host name, or{' '}
            <Link href="/" className="underline">
              clear the filter
            </Link>
            .
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {pg.rows.map((r) => (
              <Strip key={r.url} r={r} />
            ))}
          </ol>
        )}
        {pg.pages > 1 && (
          <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 font-mono text-sm md:text-[13px]" aria-label="Pages">
            <span>
              {pg.total.toLocaleString()} endpoints · page {pg.current} of {pg.pages}
            </span>
            <span className="flex gap-2">
              {pg.current > 1 && (
                <Link
                  href={href({ q, status, page: pg.current - 1 })}
                  className="inline-flex items-center min-h-11 px-3 border border-ink/30 hover:border-ink"
                >
                  Previous page
                </Link>
              )}
              {pg.current < pg.pages && (
                <Link
                  href={href({ q, status, page: pg.current + 1 })}
                  className="inline-flex items-center min-h-11 px-3 border border-ink/30 hover:border-ink"
                >
                  Next page
                </Link>
              )}
            </span>
          </nav>
        )}
      </section>

      <footer id="scoring" className="mt-16 border-t border-ink/20 pt-6 text-[14px] text-ink-soft leading-relaxed max-w-[70ch]">
        <p>
          <span className="text-ink font-medium">How the score works.</span> Uptime over the last 30 probes counts 60,
          median latency 15, declared price matching the live 402 counts 15, and a listing with a description, input
          example and output example counts 10. Probes are one request each, sent without payment; the 402 challenge
          carries the live price. Payer counts come from the Bazaar and only exist for Coinbase-facilitated endpoints.
        </p>
        <p className="mt-3">
          <span className="text-ink font-medium">Sellers:</span> fix the listing at the source and the next check picks
          it up.
        </p>
        <p className="mt-3 font-mono text-sm md:text-[13px]">
          JSON for agents:{' '}
          <a href="/api/feed?limit=50" className="underline">
            /api/feed
          </a>{' '}
          with q, status, limit, offset.
        </p>
      </footer>
    </main>
  );
}
