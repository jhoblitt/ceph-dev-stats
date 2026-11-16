import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import rawMeta from './__fixtures__/data/meta.json';
import { BASE, fixtureFetch } from './__fixtures__/fetch';
import { DataLoader, type Fetch, type Meta, parseMeta } from './data';
import { createDataStore, yearsForState } from './page';
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
