import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import rawMeta from './__fixtures__/data/meta.json';
import { BASE, fixtureFetch } from './__fixtures__/fetch';
import { DataLoader, type Fetch, type Meta, parseMeta } from './data';
import { createDataStore, createViewStore, yearsForState } from './page';
import { type AppState, defaultState } from './state';

// A window that starts in 2025, so a period can end before 2026 does.
const meta: Meta = { ...parseMeta(rawMeta), window_start: Date.UTC(2025, 5, 2) / 1000 };
const whole = defaultState(meta);
const in2025: AppState = { ...whole, filters: { ...whole.filters, to: '2025-12-31' } };

/** The fixture's fetch, holding back every response until `release` is called. */
function gatedFetch() {
  const { fetch } = fixtureFetch();
  const waiting: (() => void)[] = [];
  const gated: Fetch = (url) => new Promise((resolve) => waiting.push(() => resolve(fetch(url))));
  return {
    fetch: gated,
    release: () => waiting.splice(0).forEach((go) => go()),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createDataStore', () => {
  it('loads the years a wider period needs, keeping the last dataset meanwhile', async () => {
    const gate = gatedFetch();
    const loader = new DataLoader(meta, BASE, gate.fetch);
    const selection = writable(in2025);
    const years = yearsForState(meta, in2025);
    expect(years).toEqual([2025]);
    const first = loader.load(years);
    gate.release();
    const data = createDataStore(loader, selection, years, await first);
    expect(get(data).dataset.size).toBe(2);

    selection.set(whole);
    expect(get(data)).toMatchObject({ loading: true });
    expect(get(data).dataset.size).toBe(2);

    gate.release();
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    expect(get(data).errors).toEqual([]);
    expect(get(data).dataset.size).toBe(12);
  });

  it('keeps only the latest load when an earlier one lands after it', async () => {
    const gate = gatedFetch();
    const loader = new DataLoader(meta, BASE, gate.fetch);
    const selection = writable(in2025);
    const years = yearsForState(meta, in2025);
    const first = loader.load(years);
    gate.release();
    const data = createDataStore(loader, selection, years, await first);

    // Widen the period while 2026's files are held back, then narrow it again.
    selection.set(whole);
    selection.set(in2025);
    await vi.waitFor(() => expect(get(data).loading).toBe(false));
    expect(get(data).dataset.size).toBe(2);

    gate.release();
    await loader.load([2025, 2026]);
    await settle();
    expect(get(data).dataset.size).toBe(2);
  });

  it('does not reload when the period changes within the same years', async () => {
    const { fetch, requested } = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(whole);
    const years = yearsForState(meta, whole);
    createDataStore(loader, selection, years, await loader.load(years));
    const before = requested.length;
    selection.set({ ...whole, filters: { ...whole.filters, from: '2026-07-01' } });
    expect(requested.length).toBe(before);
  });
});

describe('createViewStore', () => {
  async function stores() {
    const { fetch } = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(whole);
    const years = yearsForState(meta, whole);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const view = createViewStore(selection, data);
    const seen: unknown[] = [];
    view.subscribe((v) => seen.push(v));
    return { selection, data, view, seen };
  }

  it('selects the rows the filters keep from the loaded data', async () => {
    const { view, data } = await stores();
    expect(get(view).dataset).toBe(get(data).dataset);
    expect(get(view).filters).toEqual(whole.filters);
    expect(get(view).rows.length).toBeGreaterThan(0);
  });

  it('keeps its identity when a change of the URL leaves the filters as they were', async () => {
    const { selection, view, seen } = await stores();
    const first = get(view);
    selection.set({ ...whole, filters: { ...whole.filters }, pr: 66500 });
    selection.set({ ...whole, filters: { ...whole.filters }, sort: { column: 'size', descending: true } });
    selection.set({ ...whole, filters: { ...whole.filters }, week: '2026-06-01' });
    expect(get(view)).toBe(first);
    expect(seen).toHaveLength(1);
  });

  it('selects again when a filter changes', async () => {
    const { selection, view, seen } = await stores();
    const before = get(view).rows.length;
    selection.set({ ...whole, filters: { ...whole.filters, target: 'all' } });
    expect(seen).toHaveLength(2);
    expect(get(view).filters.target).toBe('all');
    expect(get(view).rows.length).toBeGreaterThan(before);
  });

  it('selects again from a dataset that lands for a wider period', async () => {
    const { fetch } = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetch);
    const selection = writable(in2025);
    const years = yearsForState(meta, in2025);
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const view = createViewStore(selection, data);
    expect(get(view).dataset.size).toBe(2);
    selection.set(whole);
    await vi.waitFor(() => expect(get(view).dataset.size).toBe(12));
    expect(get(view).dataset).toBe(get(data).dataset);
  });
});
