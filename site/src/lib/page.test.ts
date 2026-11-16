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

describe('the view while the years a period needs load', () => {
  /** The stores over the fixture with 2025 before it, recording every view they hand out. */
  async function watched(fetch: Fetch, start: AppState = recent) {
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(start);
    const years = yearsForState(meta, start);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const view = createViewStore(selection, data);
    const seen: { from: string; target: string; years: number[]; size: number; selected: number; pending: boolean }[] = [];
    view.subscribe((v) =>
      seen.push({
        from: v.filters.from,
        target: v.filters.target,
        years: v.dataset.years.map((y) => y.year),
        size: v.dataset.size,
        selected: v.rows.length,
        pending: v.pending,
      }),
    );
    return { selection, data, view, seen };
  }

  it('shows the previous selection until every year the new one needs has landed, then the new one in one step', async () => {
    const gate = gatedFetch();
    const first = watched(gate.fetch);
    gate.release();
    const { selection, data, seen } = await first;

    selection.set(back);
    expect(get(data).loading).toBe(true);
    gate.release();
    await vi.waitFor(() => expect(get(data).loading).toBe(false));

    expect(seen).toEqual([
      { from: '2026-05-15', target: 'main', years: [2026], size: 12, selected: seen[0]?.selected, pending: false },
      { from: '2026-05-15', target: 'main', years: [2026], size: 12, selected: seen[0]?.selected, pending: true },
      { from: '2025-03-01', target: 'main', years: [2025, 2026], size: 13, selected: seen[2]?.selected, pending: false },
    ]);
    // #60010, merged 2025-06-10, is in the new selection and was in no earlier one.
    expect(seen[2]?.selected).toBe((seen[0]?.selected ?? 0) + 1);
  });

  it('never computes the new period over fewer years when a year it needs fails, and lets the reader back', async () => {
    const { fetch } = fixtureFetch({ ...earlier, 'events-2025.json': undefined });
    const { selection, data, view, seen } = await watched(fetch);

    selection.set(back);
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    expect(get(data).errors.map((e) => e.file)).toEqual(['events-2025.json']);
    expect(seen.every((s) => s.from === '2026-05-15')).toBe(true);
    expect(get(view)).toMatchObject({ pending: true, filters: recent.filters });

    selection.set({ ...back, filters: { ...back.filters, target: 'all' } });
    expect(get(view)).toMatchObject({ pending: true, filters: recent.filters });

    selection.set({ ...recent, filters: { ...recent.filters, target: 'all' } });
    await vi.waitFor(() => expect(get(view).filters.target).toBe('all'));
    expect(get(view)).toMatchObject({ pending: false, filters: { from: '2026-05-15', target: 'all' } });
  });

  it('changes at once, and is never pending, for a filter that needs no new year', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const { selection, seen } = await watched(fetch);
    const before = requested.length;
    selection.set({ ...recent, filters: { ...recent.filters, from: '2026-07-01', target: 'all' } });
    expect(seen.map((s) => [s.from, s.target, s.pending])).toEqual([
      ['2026-05-15', 'main', false],
      ['2026-07-01', 'all', false],
    ]);
    expect(requested.length).toBe(before);
  });

  it('changes at once for a later start, over the years it already has, and keeps its figures when the fewer years land', async () => {
    const { fetch } = fixtureFetch(earlier);
    const { selection, data, seen } = await watched(fetch, back);
    selection.set(recent);
    // The fewer years are loaded already, so they are taken at once too.
    expect(get(data).dataset.size).toBe(12);
    expect(seen.map((s) => [s.from, s.years.join(), s.pending])).toEqual([
      ['2025-03-01', '2025,2026', false],
      ['2026-05-15', '2025,2026', false],
      ['2026-05-15', '2026', false],
    ]);
    expect(seen[2]?.selected).toBe(seen[1]?.selected);
  });

  it('keeps today’s behaviour over a first load with a failed year: what loaded is shown, and a filter needing no new year changes at once', async () => {
    const { fetch } = fixtureFetch({ ...earlier, 'prs-2025.json': undefined });
    const { selection, view } = await watched(fetch, back);
    expect(get(view)).toMatchObject({ pending: false, filters: back.filters });
    expect(get(view).dataset.years.map((y) => y.year)).toEqual([2026]);
    selection.set({ ...back, filters: { ...back.filters, target: 'all' } });
    expect(get(view)).toMatchObject({ pending: false, filters: { target: 'all' } });
  });
});

describe('the view when the report is reached from another route', () => {
  const onMethods: AppState = { ...recent, route: 'methods' };

  /** The stores as main.ts makes them at `start`, recording every view they hand out. */
  async function from(start: AppState, fetch: Fetch, before?: (loader: DataLoader) => Promise<unknown>) {
    const loader = new DataLoader(meta, BASE, fetch);
    await before?.(loader);
    const selection = writable(start);
    const years = firstYears(meta, start);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const view = createViewStore(selection, data);
    const seen: { from: string; years: number[]; selected: number; pending: boolean; first: boolean }[] = [];
    view.subscribe((v) =>
      seen.push({
        from: v.filters.from,
        years: v.dataset.years.map((y) => y.year),
        selected: v.rows.length,
        pending: v.pending,
        first: v.first,
      }),
    );
    return { selection, data, view, seen, loader };
  }

  it('is pending, with no figures to show, until the years the report needs land after the methods page', async () => {
    const gate = gatedFetch();
    const { selection, data, seen } = await from(onMethods, gate.fetch);
    expect(seen).toEqual([{ from: '2026-05-15', years: [], selected: 0, pending: true, first: true }]);

    selection.set(back);
    expect(get(data).loading).toBe(true);
    gate.release();
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    const shown = seen.findIndex((s) => !s.pending);
    expect(seen.slice(0, shown).every((s) => s.pending && s.first)).toBe(true);
    expect(seen.slice(shown)).toEqual([{ from: '2025-03-01', years: [2025, 2026], selected: 10, pending: false, first: false }]);
  });

  it('takes the report up at once, fetching nothing, over the years the methods page has loaded', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    // The methods page loads the default period's years through the same loader.
    const { selection, data, seen } = await from(onMethods, fetch, (loader) => loader.load([2026]));
    const before = requested.length;
    selection.set(recent);
    expect(get(data).loading).toBe(false);
    expect(seen.at(-1)).toEqual({ from: '2026-05-15', years: [2026], selected: 9, pending: false, first: false });
    expect(seen.slice(1).every((s) => !s.pending)).toBe(true);
    expect(requested.length).toBe(before);
  });

  it('keeps the report’s last figures, pending, when the address changes the period on the methods page, until the report’s years land', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const { selection, data, seen } = await from(recent, fetch);
    expect(seen.at(-1)).toMatchObject({ from: '2026-05-15', pending: false });

    const before = requested.length;
    selection.set({ ...back, route: 'methods' });
    expect(get(data).loading).toBe(false);
    expect(requested.length).toBe(before);
    selection.set(back);
    expect(get(data).loading).toBe(true);
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    const shown = seen.findIndex((s) => s.from === '2025-03-01');
    expect(seen.slice(1, shown).every((s) => s.pending && s.from === '2026-05-15' && s.years.join() === '2026')).toBe(true);
    expect(seen.slice(shown)).toEqual([{ from: '2025-03-01', years: [2025, 2026], selected: 10, pending: false, first: false }]);
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
