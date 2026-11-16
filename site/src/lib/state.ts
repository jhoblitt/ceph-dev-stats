// The reader's filters and selection, kept in the URL hash so any view can be
// linked:
//
//   #/<route>?target=backports&from=2026-06-01&to=2026-08-31&component=rgw&kind=bugfix
//     &size=11-100&standing=first&disclosure=disclosed&drafts=exclude&reopened=only
//     &week=2026-06-01&band=lt7&pr=66600&sort=-size
//
// <route> is empty for the report or `methods`. The target is always written;
// the period only when it differs from the whole window, so a link to the
// default view keeps following the data as it grows. Parsing never throws:
// what is unknown, malformed or outside the data falls back to its default.

import { type Readable, writable } from 'svelte/store';
import type { Meta } from './data';
import {
  AGE_BANDS,
  type AgeBand,
  DISCLOSURES,
  type Filters,
  SIZE_BANDS,
  STANDING_BANDS,
  TARGETS,
  UNKNOWN_KIND,
  dayOf,
  dayStart,
  findChoice,
  isMonday,
  periodRange,
} from './filters';
import { bucketEnd, bucketStart, stepFor } from './stats/buckets';
import { DEFAULT_SORT, type Sort, parseSort, sameSort, sortParam } from './sort';

export const ROUTES = ['report', 'methods'] as const;
export type Route = (typeof ROUTES)[number];

export interface AppState {
  route: Route;
  filters: Filters;
  /**
   * The first day of the selected bucket, `YYYY-MM-DD`: a Monday, or the
   * first of a month when the period steps by month. It overlaps the period.
   */
  week: string | null;
  /** The selected age band, alone or within the selected week. */
  band: AgeBand | null;
  /** The number of the PR whose timeline is open. */
  pr: number | null;
  /** The PR table's order. */
  sort: Sort;
}

const KEYS = [
  'target',
  'from',
  'to',
  'component',
  'kind',
  'size',
  'standing',
  'disclosure',
  'drafts',
  'reopened',
  'week',
  'band',
  'pr',
  'sort',
] as const;
type Key = (typeof KEYS)[number];

/** The hash's fields as written, before validation against the data. */
export interface RawState {
  route: string;
  /** The first value of each known parameter. */
  params: Partial<Record<Key, string>>;
}

export function parseHash(hash: string): RawState {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = body.indexOf('?');
  const route = (q === -1 ? body : body.slice(0, q)).replace(/^\/+|\/+$/g, '');
  const search = new URLSearchParams(q === -1 ? '' : body.slice(q + 1));
  const params: RawState['params'] = {};
  for (const key of KEYS) {
    const value = search.get(key);
    if (value !== null) params[key] = value;
  }
  return { route, params };
}

export function defaultFilters(meta: Meta): Filters {
  return {
    from: dayOf(meta.window_start),
    to: dayOf(meta.fetched_through),
    target: 'main',
    component: null,
    size: null,
    standing: null,
    disclosure: null,
    kind: null,
    excludeDrafts: false,
    reopenedOnly: false,
  };
}

export function defaultState(meta: Meta): AppState {
  return { route: 'report', filters: defaultFilters(meta), week: null, band: null, pr: null, sort: DEFAULT_SORT };
}

function isRoute(s: string): s is Route {
  return (ROUTES as readonly string[]).includes(s);
}

/**
 * Each end of the period that is a real day inside the data is kept, the
 * other falls back to its default; a period that ends before it starts is
 * the default.
 */
function validPeriod(from: string | undefined, to: string | undefined, d: Filters): Pick<Filters, 'from' | 'to'> {
  const first = dayStart(d.from) as number;
  const last = dayStart(d.to) as number;
  const inData = (day: string | undefined): string | null => {
    if (day === undefined) return null;
    const start = dayStart(day);
    return start !== null && start >= first && start <= last ? day : null;
  };
  const period = { from: inData(from) ?? d.from, to: inData(to) ?? d.to };
  return period.from <= period.to ? period : { from: d.from, to: d.to };
}

/** A bucket of the period's step, a week or a month, that overlaps the period. */
function validWeek(week: string | undefined, filters: Filters): string | null {
  if (week === undefined) return null;
  const first = dayStart(week);
  if (first === null) return null;
  const period = periodRange(filters);
  const step = stepFor(period);
  const isStart = step === 'week' ? isMonday(week) : bucketStart(first, step) === first;
  return isStart && first < period.end && bucketEnd(first, step) > period.start ? week : null;
}

const PR_NUMBER = /^[1-9]\d{0,8}$/;

export function validateState(raw: RawState, meta: Meta): AppState {
  const d = defaultFilters(meta);
  const p = raw.params;
  const component = p.component;
  const kind = p.kind;
  const filters: Filters = {
    ...validPeriod(p.from, p.to, d),
    target: findChoice(TARGETS, p.target) ?? d.target,
    component: component !== undefined && meta.components.some((c) => c.id === component) ? component : null,
    size: findChoice(SIZE_BANDS, p.size),
    standing: findChoice(STANDING_BANDS, p.standing),
    disclosure: findChoice(DISCLOSURES, p.disclosure),
    kind: kind === UNKNOWN_KIND.id || (kind !== undefined && meta.kinds.some((k) => k.id === kind)) ? kind : null,
    excludeDrafts: p.drafts === 'exclude',
    reopenedOnly: p.reopened === 'only',
  };
  return {
    route: isRoute(raw.route) ? raw.route : 'report',
    filters,
    week: validWeek(p.week, filters),
    band: findChoice(AGE_BANDS, p.band),
    pr: p.pr !== undefined && PR_NUMBER.test(p.pr) ? Number(p.pr) : null,
    sort: parseSort(p.sort),
  };
}

export function stateFromHash(hash: string, meta: Meta): AppState {
  return validateState(parseHash(hash), meta);
}

/** The canonical hash for a state. */
export function hashFromState(state: AppState, meta: Meta): string {
  const enc = encodeURIComponent;
  const d = defaultFilters(meta);
  const f = state.filters;
  const parts = [`target=${enc(f.target)}`];
  if (f.from !== d.from) parts.push(`from=${enc(f.from)}`);
  if (f.to !== d.to) parts.push(`to=${enc(f.to)}`);
  if (f.component !== null) parts.push(`component=${enc(f.component)}`);
  if (f.kind !== null) parts.push(`kind=${enc(f.kind)}`);
  if (f.size !== null) parts.push(`size=${enc(f.size)}`);
  if (f.standing !== null) parts.push(`standing=${enc(f.standing)}`);
  if (f.disclosure !== null) parts.push(`disclosure=${enc(f.disclosure)}`);
  if (f.excludeDrafts) parts.push('drafts=exclude');
  if (f.reopenedOnly) parts.push('reopened=only');
  if (state.week !== null) parts.push(`week=${enc(state.week)}`);
  if (state.band !== null) parts.push(`band=${enc(state.band)}`);
  if (state.pr !== null) parts.push(`pr=${state.pr}`);
  if (!sameSort(state.sort, DEFAULT_SORT)) parts.push(`sort=${enc(sortParam(state.sort))}`);
  return `#/${state.route === 'report' ? '' : state.route}?${parts.join('&')}`;
}

/** The hash of a page, keeping the reader's filters and selection. */
export function routeHash(state: AppState, route: Route, meta: Meta): string {
  return hashFromState({ ...state, route }, meta);
}

/** Where the store reads and writes the hash; a fake in tests. */
export interface HashLocation {
  read(): string;
  /** Write the hash as a new history entry. */
  push(hash: string): void;
  /** Write the hash over the current history entry. */
  replace(hash: string): void;
  /** Call `onChange` when the hash changes by navigation; returns a stop function. */
  listen(onChange: () => void): () => void;
}

export function windowHashLocation(win: Window): HashLocation {
  return {
    read: () => win.location.hash,
    push: (hash) => win.history.pushState(null, '', hash),
    replace: (hash) => win.history.replaceState(null, '', hash),
    listen: (onChange) => {
      // Back and forward over pushState entries fire popstate; a typed or
      // clicked hash fires hashchange. The store ignores the duplicate.
      win.addEventListener('hashchange', onChange);
      win.addEventListener('popstate', onChange);
      return () => {
        win.removeEventListener('hashchange', onChange);
        win.removeEventListener('popstate', onChange);
      };
    },
  };
}

export interface WriteOptions {
  /** Overwrite the current history entry instead of adding one. */
  replace?: boolean;
}

export interface StateStore extends Readable<AppState> {
  set(next: AppState, opts?: WriteOptions): void;
  update(fn: (current: AppState) => AppState, opts?: WriteOptions): void;
  /** Stop following navigation. */
  destroy(): void;
}

/**
 * A store of the validated state, synchronised with the hash both ways. It
 * notifies only when the canonical hash changes.
 */
export function createStateStore(meta: Meta, loc: HashLocation): StateStore {
  const fromHash = (hash: string) => stateFromHash(hash, meta);
  const toHash = (state: AppState) => hashFromState(state, meta);
  let current = fromHash(loc.read());
  let currentHash = toHash(current);
  if (loc.read() !== currentHash) loc.replace(currentHash);
  const inner = writable(current);

  const accept = (next: AppState, hash: string) => {
    current = next;
    currentHash = hash;
    inner.set(next);
  };

  const write = (next: AppState, opts?: WriteOptions) => {
    const valid = fromHash(toHash(next));
    const hash = toHash(valid);
    if (hash === currentHash) return;
    if (opts?.replace) loc.replace(hash);
    else loc.push(hash);
    accept(valid, hash);
  };

  const stop = loc.listen(() => {
    const read = loc.read();
    const next = fromHash(read);
    const hash = toHash(next);
    if (read !== hash) loc.replace(hash);
    if (hash !== currentHash) accept(next, hash);
  });

  return {
    subscribe: inner.subscribe,
    set: write,
    update: (fn, opts) => write(fn(current), opts),
    destroy: stop,
  };
}
