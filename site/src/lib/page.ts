// What every view on the page shares, handed down through Svelte context so
// each section reads it in its own file and none is wired through another.

import { createContext } from 'svelte';
import { type Readable, get, writable } from 'svelte/store';
import { type DataLoader, type Dataset, type LoadError, type LoadResult, type Meta, yearsFor } from './data';
import { type Filters, periodRange } from './filters';
import { keepEqual, sameFilters } from './memo';
import { select } from './select';
import type { AppState, StateStore } from './state';

export interface DataState {
  /**
   * The rows of every year the period needs that loaded: those from the
   * period's start year on, which hold every PR the period can select.
   */
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
  /** The filters and the rows they select; what every section's figures are computed from. */
  view: Readable<View>;
  /** For files fetched on demand, such as a year's table. */
  loader: DataLoader;
}

export interface View {
  dataset: Dataset;
  filters: Filters;
  /** The rows the filters select from `dataset`, ascending. */
  rows: Uint32Array;
}

export const [getPage, setPage] = createContext<Page>();

export function yearsForState(meta: Meta, state: AppState): number[] {
  return yearsFor(meta, periodRange(state.filters).start);
}

/**
 * The data for the current period: it loads the years a new period needs
 * and keeps showing the last dataset until they arrive. Only the latest
 * load is kept, so a slow one cannot overwrite a newer one. A later start
 * drops the years it no longer needs from the dataset, so every figure
 * scans only the period's years; their files stay with the loader.
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

/**
 * The selection every section reads. The state store hands out a new filters
 * object on every change of the URL, choosing a PR or a sort included, and a
 * Svelte derivation compares by identity; this one notifies only when the
 * filters' values or the dataset change, so a statistic over the selection is
 * computed again only then.
 */
export function createViewStore(
  selection: Readable<AppState>,
  data: Readable<DataState>,
): Readable<View> & { destroy(): void } {
  const keep = keepEqual(sameFilters);
  let state = get(selection);
  let dataset = get(data).dataset;
  const view = (filters: Filters): View => ({ dataset, filters, rows: select(dataset, filters) });
  let current = view(keep(state.filters));
  const inner = writable(current);

  const update = () => {
    const filters = keep(state.filters);
    if (current.filters === filters && current.dataset === dataset) return;
    current = view(filters);
    inner.set(current);
  };
  const stopState = selection.subscribe((s) => {
    state = s;
    update();
  });
  const stopData = data.subscribe((d) => {
    dataset = d.dataset;
    update();
  });
  return {
    subscribe: inner.subscribe,
    destroy: () => {
      stopState();
      stopData();
    },
  };
}
