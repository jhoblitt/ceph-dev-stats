import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { BASE, fixtureFetch, withEarlierYear } from './__fixtures__/fetch';
import { type Dataset, DataLoader, type Fetch, type Meta, type YearData, combine, parseMeta, yearsFor } from './data';
import { type Filters, dayOf, periodRange } from './filters';
import { createDataStore, createViewStore, firstYears, yearsForState } from './page';
import { select } from './select';
import { backlog } from './stats/backlog';
import { commandUse } from './stats/commands';
import { outcomeCurve } from './stats/curve';
import { authorRows, reviewerRows } from './stats/people';
import { reviewLoad } from './stats/reviewers';
import { type Event, type Row, at, dataset, random } from './stats/testing';
import { weekly } from './stats/weekly';
import { type AppState, defaultFilters, defaultState } from './state';

// The fixture with 2025 before it: the window starts 2025-01-01, 2025's files
// hold #60010 alone, merged 2025-06-10, and 2026's the fixture's twelve.
const earlier = withEarlierYear();
const meta: Meta = parseMeta(earlier['meta.json']);
const recent = defaultState(meta);
const back: AppState = { ...recent, filters: { ...recent.filters, from: '2025-03-01' } };

/** The fixture's fetch with 2025 before it, holding back every response until `release` is called. */
function gatedFetch() {
  const { fetch, requested } = fixtureFetch(earlier);
  const waiting: (() => void)[] = [];
  const gated: Fetch = (url) => new Promise((resolve) => waiting.push(() => resolve(fetch(url))));
  return {
    fetch: gated,
    requested,
    release: () => waiting.splice(0).forEach((go) => go()),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('yearsForState', () => {
  it('needs the last year alone for the default period, the last six months', () => {
    expect(recent.filters.from).toBe('2026-05-15');
    expect(yearsForState(meta, recent)).toEqual([2026]);
  });

  it('needs the years from the start of a period reaching back', () => {
    expect(yearsForState(meta, back)).toEqual([2025, 2026]);
  });
});

describe('createDataStore', () => {
  it('loads the years an earlier start needs, keeping the last dataset meanwhile', async () => {
    const gate = gatedFetch();
    const loader = new DataLoader(meta, BASE, gate.fetch);
    const selection = writable(recent);
    const years = yearsForState(meta, recent);
    const first = loader.load(years);
    gate.release();
    const data = createDataStore(loader, selection, years, await first);
    expect(get(data).dataset.size).toBe(12);
    expect(gate.requested.some((u) => u.includes('2025'))).toBe(false);

    selection.set(back);
    expect(get(data)).toMatchObject({ loading: true });
    expect(get(data).dataset.size).toBe(12);

    gate.release();
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    expect(get(data).errors).toEqual([]);
    expect(get(data).dataset.size).toBe(13);
    expect(gate.requested.filter((u) => u.includes('2025'))).toEqual([`${BASE}prs-2025.json`, `${BASE}events-2025.json`]);
  });

  it('keeps only the latest load when an earlier one lands after it', async () => {
    const gate = gatedFetch();
    const loader = new DataLoader(meta, BASE, gate.fetch);
    const selection = writable(recent);
    const years = yearsForState(meta, recent);
    const first = loader.load(years);
    gate.release();
    const data = createDataStore(loader, selection, years, await first);

    // Move the start back while 2025's files are held back, then forward again.
    selection.set(back);
    selection.set(recent);
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    expect(get(data).dataset.size).toBe(12);

    gate.release();
    await loader.load([2025, 2026]);
    await settle();
    expect(get(data).dataset.size).toBe(12);
  });

  it('does not reload when the period changes within the same years', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(recent);
    const years = yearsForState(meta, recent);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const before = requested.length;
    const shown = get(data);
    selection.set({ ...recent, filters: { ...recent.filters, from: '2026-01-01' } });
    selection.set({ ...recent, filters: { ...recent.filters, from: '2026-07-01', to: '2026-08-31' } });
    expect(requested.length).toBe(before);
    expect(get(data)).toBe(shown);
  });

  it('drops the earlier year again, without fetching, when the start moves forward into the last year', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(back);
    const years = yearsForState(meta, back);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    expect(get(data).dataset.size).toBe(13);
    const before = requested.length;

    selection.set(recent);
    await vi.waitFor(() => expect(get(data).dataset.size).toBe(12));
    expect(get(data).dataset.years.map((y) => y.year)).toEqual([2026]);
    expect(requested.length).toBe(before);
  });
});

describe('the methods route', () => {
  const onMethods: AppState = { ...back, route: 'methods' };

  it('loads no year before it first draws, whatever period the address carries for the report', () => {
    expect(firstYears(meta, onMethods)).toEqual([]);
    expect(firstYears(meta, back)).toEqual([2025, 2026]);
  });

  it("loads the report's period only when the reader comes to the report", async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(onMethods);
    const years = firstYears(meta, onMethods);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    selection.set({ ...onMethods, section: 'limits' });
    selection.set({ ...onMethods, filters: { ...onMethods.filters, from: '2025-01-01' } });
    expect(requested).toEqual([]);
    expect(get(data).loading).toBe(false);

    selection.set({ ...back, filters: { ...back.filters, from: '2025-01-01' } });
    expect(get(data).loading).toBe(true);
    await vi.waitFor(() => expect(get(data).dataset.size).toBe(13));
    expect(requested.filter((u) => u.includes('prs-'))).toEqual([`${BASE}prs-2025.json`, `${BASE}prs-2026.json`]);
  });
});

describe('createViewStore', () => {
  async function stores() {
    const { fetch } = fixtureFetch(earlier);
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(recent);
    const years = yearsForState(meta, recent);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const view = createViewStore(selection, data);
    const seen: unknown[] = [];
    view.subscribe((v) => seen.push(v));
    return { selection, data, view, seen };
  }

  it('selects the rows the filters keep from the loaded data', async () => {
    const { view, data } = await stores();
    expect(get(view).dataset).toBe(get(data).dataset);
    expect(get(view).filters).toEqual(recent.filters);
    expect(get(view).rows.length).toBeGreaterThan(0);
  });

  it('keeps its identity when a change of the URL leaves the filters as they were', async () => {
    const { selection, view, seen } = await stores();
    const first = get(view);
    selection.set({ ...recent, filters: { ...recent.filters }, pr: 66500 });
    selection.set({ ...recent, filters: { ...recent.filters }, sort: { column: 'size', descending: true } });
    selection.set({ ...recent, filters: { ...recent.filters }, week: '2026-06-01' });
    expect(get(view)).toBe(first);
    expect(seen).toHaveLength(1);
  });

  it('selects again when a filter changes', async () => {
    const { selection, view, seen } = await stores();
    const before = get(view).rows.length;
    selection.set({ ...recent, filters: { ...recent.filters, target: 'all' } });
    expect(seen).toHaveLength(2);
    expect(get(view).filters.target).toBe('all');
    expect(get(view).rows.length).toBeGreaterThan(before);
  });

  it('selects again from a dataset that lands for an earlier start, and counts the PR that year holds', async () => {
    const { selection, view } = await stores();
    const numbers = () => [...get(view).rows].map((r) => get(view).dataset.prs.number[r]);
    expect(numbers()).not.toContain(60010);
    selection.set(back);
    await vi.waitFor(() => expect(get(view).dataset.size).toBe(13));
    expect(numbers()).toContain(60010);
  });
});

// The proof that loading only the years from the period's start on loses
// nothing: over random data partitioned as the rollup does, by the year each
// PR finished in, every selection and every figure computed from the years a
// period loads equals the one computed from every year.
describe('the years a period loads hold its whole selection', () => {
  const NOW = at('2026-11-15T06:00:00Z');
  const FIRST = at('2019-01-01T00:00:00Z');
  const KINDS = ['comment_other', 'comment_author', 'review_approved', 'review_changes', 'review_commented', 'merged'];
  const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

  /** Random PRs and events from 2019 on, as year files by the year each PR finished in. */
  function history(seed: number): { meta: Meta; years: YearData[] } {
    const rnd = random(seed);
    const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a));
    const byYear = new Map<number, { rows: Row[]; events: Event[] }>();
    for (let n = 0; n < 600; n++) {
      const created = between(FIRST, NOW);
      const state = Math.floor(rnd() * 3);
      const closed = state === 0 ? -1 : between(created, NOW);
      const year = state === 0 ? yearOf(NOW) : yearOf(closed);
      const file = byYear.get(year) ?? { rows: [], events: [] };
      byYear.set(year, file);
      const row = file.rows.length;
      const end = closed === -1 ? NOW : closed;
      file.rows.push({
        number: 1000 + n,
        created,
        closed,
        state,
        base: Math.floor(rnd() * 2),
        author: Math.floor(rnd() * 8),
        first_response: rnd() < 0.7 ? between(created, end + 1) : -1,
        additions: Math.floor(rnd() * 500),
        bot_commands: Math.floor(rnd() * 3),
      });
      for (let k = Math.floor(rnd() * 6); k > 0; k--) {
        const kind = KINDS[Math.floor(rnd() * KINDS.length)] as string;
        const actor = kind === 'comment_other' || kind.startsWith('review_') ? Math.floor(rnd() * 8) : -1;
        file.events.push({ pr: row, at: between(created, end + 1), kind, actor });
      }
    }
    const window = { window_start: FIRST, fetched_through: NOW };
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const files = years.map((year) => {
      const { rows, events } = byYear.get(year) as { rows: Row[]; events: Event[] };
      const d = dataset(rows, events, window);
      return { year, prs: d.prs, events: d.events };
    });
    return { meta: { ...dataset([], [], window).meta, years }, years: files };
  }

  function figures(data: Dataset, filters: Filters) {
    const rows = select(data, filters);
    const period = periodRange(filters);
    return {
      selected: [...rows].map((r) => data.prs.number[r]),
      authors: authorRows(data, rows),
      reviewers: reviewerRows(data, rows, period),
      reviewLoad: reviewLoad(data, rows, period, 3),
      backlog: backlog(data, rows, period),
      merged: weekly(data, rows, period, 'merged'),
      reviews: weekly(data, rows, period, 'reviews'),
      weeklyReviewers: weekly(data, rows, period, 'reviewers'),
      curve: outcomeCurve(data, rows, 'response'),
      commands: commandUse(data, rows),
    };
  }

  it.each([1, 2, 3, 4, 5])('equal over every year and over the years loaded, seed %i', (seed) => {
    const { meta: m, years } = history(seed);
    const whole = combine(m, years);
    const rnd = random(seed * 7919);
    for (let k = 0; k < 20; k++) {
      const start = FIRST + Math.floor(rnd() * (NOW - FIRST));
      const end = start + Math.floor(rnd() * (NOW - start));
      const filters: Filters = {
        ...defaultFilters(m),
        from: dayOf(start),
        to: dayOf(end),
        target: (['main', 'backports', 'all'] as const)[k % 3] as Filters['target'],
        reviewer: k % 4 === 0 ? (m.people[k % 8] ?? null) : null,
      };
      const wanted = yearsFor(m, periodRange(filters).start);
      const loaded = combine(
        m,
        years.filter((y) => wanted.includes(y.year)),
      );
      expect(loaded.size, `${filters.from} to ${filters.to}`).toBeLessThanOrEqual(whole.size);
      expect(figures(loaded, filters), `${filters.from} to ${filters.to}`).toEqual(figures(whole, filters));
    }
  });

  it('never selects a PR finished before the period starts, the one a year before the start would hold', () => {
    const start = at('2026-01-01T00:00:00Z');
    const d = dataset([
      { created: at('2025-03-01T00:00:00Z'), state: 1, closed: start - 1 },
      { created: at('2025-03-01T00:00:00Z'), state: 1, closed: start },
      { created: at('2025-03-01T00:00:00Z'), state: 0 },
    ]);
    const filters: Filters = { ...defaultFilters(d.meta), from: '2026-01-01', to: '2026-03-31', target: 'all' };
    expect([...select(d, filters)]).toEqual([1, 2]);
  });
});
