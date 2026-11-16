// What every view on the page shares, handed down through Svelte context so
// each section reads it in its own file and none is wired through another.

import { createContext } from 'svelte';
import { type Readable, writable } from 'svelte/store';
import { type DataLoader, type Dataset, type LoadError, type LoadResult, type Meta, yearsFor } from './data';
import { periodRange } from './filters';
import type { AppState, StateStore } from './state';

export interface DataState {
  /** The rows of every year the period needs that loaded. */
  dataset: Dataset;
  /** The years that did not load, each naming its file. */
  errors: LoadError[];
  /** A load for a changed period is under way; `dataset` is the previous one until it lands. */
  loading: boolean;
}

export interface Page {
  meta: Meta;
  selection: StateStore;
  data: Readable<DataState>;
  /** For files fetched on demand, such as a year's table. */
  loader: DataLoader;
}

export const [getPage, setPage] = createContext<Page>();

export function yearsForState(meta: Meta, state: AppState): number[] {
  return yearsFor(meta, periodRange(state.filters).end);
}

/**
 * The data for the current period: it loads the years a new period needs
 * and keeps showing the last dataset until they arrive. Only the latest
 * load is kept, so a slow one cannot overwrite a newer one.
 */
export function createDataStore(
  loader: DataLoader,
  selection: Readable<AppState>,
  years: readonly number[],
  initial: LoadResult,
): Readable<DataState> & { destroy(): void } {
  const inner = writable<DataState>({ ...initial, loading: false });
  let shown = years.join(',');
  let latest = 0;
  const stop = selection.subscribe((state) => {
    const wanted = yearsForState(loader.meta, state);
    const key = wanted.join(',');
    if (key === shown) return;
    shown = key;
    const ticket = ++latest;
    inner.update((d) => ({ ...d, loading: true }));
    void loader.load(wanted).then((result) => {
      if (ticket === latest) inner.set({ ...result, loading: false });
    });
  });
  return { subscribe: inner.subscribe, destroy: stop };
}
