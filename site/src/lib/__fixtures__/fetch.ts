import type { Fetch } from '../data';
import events2026 from './data/events-2026.json';
import index from './data/index.json';
import meta from './data/meta.json';
import prs2026 from './data/prs-2026.json';
import table2026 from './data/table-2026.json';

export const FIXTURE = {
  'meta.json': meta,
  'index.json': index,
  'prs-2026.json': prs2026,
  'events-2026.json': events2026,
  'table-2026.json': table2026,
};

export const BASE = '/ceph-dev-stats/data/';

/**
 * A fetch serving the fixture under BASE, with files replaced (a string is
 * served as is) or removed (undefined, a 404), recording each URL asked for.
 */
export function fixtureFetch(overrides: Record<string, unknown> = {}): { fetch: Fetch; requested: string[] } {
  const files: Record<string, unknown> = { ...FIXTURE, ...overrides };
  const requested: string[] = [];
  const fetch: Fetch = (url) => {
    requested.push(url);
    const body = url.startsWith(BASE) ? files[url.slice(BASE.length)] : undefined;
    if (body === undefined) return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }));
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body)));
  };
  return { fetch, requested };
}

/** The number of the PR the earlier year holds. */
export const EARLIER_PR = 60010;

const YEAR = 365 * 86_400;
const PR_TIMES = ['created', 'ready', 'closed', 'first_commit', 'last_commit', 'first_response', 'first_approval'] as const;
const back = (t: number) => (t < 0 ? t : t - YEAR);

/**
 * The fixture with a year before it, for the specs about loading part of the
 * data: its window starts on 2025-01-01, and 2025's files hold #60010 alone,
 * a copy of #64010 (row 0 of 2026, merged 2026-06-10) with every time a
 * year earlier, so merged on 2025-06-10. Every PR of the fixture finished in
 * 2026 or is open, so the fixture alone has one year.
 */
export function withEarlierYear(): Record<string, unknown> {
  const events = events2026.pr.flatMap((row, e) => (row === 0 ? [e] : []));
  const prs = Object.fromEntries(
    Object.entries(prs2026).map(([column, values]) => {
      const first = values[0] as unknown;
      if (column === 'number') return [column, [EARLIER_PR]];
      if ((PR_TIMES as readonly string[]).includes(column)) return [column, [back(first as number)]];
      return [column, [first]];
    }),
  );
  const pick = <T>(column: readonly T[]) => events.map((e) => column[e] as T);
  const commits = (table2026.commits[0] ?? []).map(([sha, authored, committed]) => [
    sha,
    back(authored as number),
    back(committed as number),
  ]);
  return {
    'meta.json': { ...meta, window_start: Date.UTC(2025, 0, 1) / 1000, years: [2025, 2026] },
    'index.json': { numbers: [EARLIER_PR, ...index.numbers], years: [2025, ...index.years] },
    'prs-2025.json': prs,
    'events-2025.json': {
      pr: pick(events2026.pr),
      at: pick(events2026.at).map(back),
      kind: pick(events2026.kind),
      sub: pick(events2026.sub),
      actor: pick(events2026.actor),
    },
    'table-2025.json': {
      titles: [table2026.titles[0]],
      authors: [table2026.authors[0]],
      commits: [commits],
      refs: pick(table2026.refs),
      tickets: [table2026.tickets[0]],
      backport_of: [table2026.backport_of[0]],
      kind_source: [table2026.kind_source[0]],
    },
  };
}
