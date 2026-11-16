import type { Fetch } from '../data';
import events2025 from './data/events-2025.json';
import events2026 from './data/events-2026.json';
import meta from './data/meta.json';
import prs2025 from './data/prs-2025.json';
import prs2026 from './data/prs-2026.json';
import table2025 from './data/table-2025.json';
import table2026 from './data/table-2026.json';

export const FIXTURE = {
  'meta.json': meta,
  'prs-2025.json': prs2025,
  'prs-2026.json': prs2026,
  'events-2025.json': events2025,
  'events-2026.json': events2026,
  'table-2025.json': table2025,
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
