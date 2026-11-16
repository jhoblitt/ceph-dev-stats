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
  /**
   * Where the reader's last "try again" stands, until the period changes:
   * running, failed again (`at`, epoch milliseconds), or succeeded.
   */
  retry: { state: 'none' } | { state: 'running' } | { state: 'failed'; at: number } | { state: 'succeeded' };
}

export interface DataStore extends Readable<DataState> {
  /**
   * Loads the current period's years again when a year failed in a way
   * fetching again may mend; does nothing while a retry runs.
   */
  retry(): void;
  destroy(): void;
}

export interface Page {
  meta: Meta;
  selection: StateStore;
  data: DataStore;
  /** The filters and the rows they select; what every section's figures are computed from. */
  view: Readable<View>;
  /** For files fetched on demand, such as a year's table. */
  loader: DataLoader;
}

export interface View {
  dataset: Dataset;
  /** The filters the figures are for: the reader's, or while `pending` the previous ones. */
  filters: Filters;
  /** The rows the filters select from `dataset`, ascending. */
  rows: Uint32Array;
  /**
   * The reader's filters need years not loaded yet, or that failed to load,
   * so the figures are still those of the previous filters.
   */
  pending: boolean;
  /**
   * No figures have been shown yet: the reader's filters wait for their
   * years, and `rows` is empty. Always `pending` too.
   */
  first: boolean;
}

export const [getPage, setPage] = createContext<Page>();

export function yearsForState(meta: Meta, state: AppState): number[] {
  return yearsFor(meta, periodRange(state.filters).start);
}

/**
 * The years the page loads before it first draws: the period's on the
 * report, none on the methods page, which loads the default period's years
 * itself and should not wait on a period the address carries for the report.
 */
export function firstYears(meta: Meta, state: AppState): number[] {
  return state.route === 'report' ? yearsForState(meta, state) : [];
}

/**
 * The report's data for the current period: it loads the years a new period
 * needs and keeps showing the last dataset until they arrive. Only the
 * latest load is kept, so a slow one cannot overwrite a newer one. A later
 * start drops the years it no longer needs from the dataset, so every figure
 * scans only the period's years; their files stay with the loader. Nothing
 * loads while another route is shown: the report's period loads when the
 * reader comes to it. `retry` loads the current period's years again after
 * one failed to arrive, which fetches again only those that failed.
 */
export function createDataStore(
  loader: DataLoader,
  selection: Readable<AppState>,
  years: readonly number[],
  initial: LoadResult,
): DataStore {
  const inner = writable<DataState>({ ...initial, loading: false, retry: { state: 'none' } });
  let shown = years.join(',');
  let wanted: readonly number[] = years;
  let latest = 0;
  const load = (retrying: boolean) => {
    const ticket = ++latest;
    const after = (errors: readonly LoadError[]): DataState['retry'] =>
      !retrying ? { state: 'none' } : errors.length > 0 ? { state: 'failed', at: Date.now() } : { state: 'succeeded' };
    // Years another route has loaded through the same loader are taken at once.
    const have = loader.loaded(wanted);
    if (have) {
      inner.set({ ...have, loading: false, retry: after(have.errors) });
      return;
    }
    inner.update((d) => ({ ...d, loading: true, retry: retrying ? { state: 'running' } : { state: 'none' } }));
    void loader.load(wanted).then((result) => {
      if (ticket === latest) inner.set({ ...result, loading: false, retry: after(result.errors) });
    });
  };
  const stop = selection.subscribe((state) => {
    if (state.route !== 'report') return;
    const next = yearsForState(loader.meta, state);
    const key = next.join(',');
    if (key === shown) return;
    shown = key;
    wanted = next;
    load(false);
  });
  return {
    subscribe: inner.subscribe,
    retry: () => {
      const d = get(inner);
      if (d.retry.state !== 'running' && d.errors.some((e) => e.retry)) load(true);
    },
    destroy: stop,
  };
}

/**
 * Whether a section's figures are not yet the reader's whole period: the
 * view keeps a previous period's, or shows what loaded of this one while a
 * load runs that may bring the years that failed.
 */
export function sectionsStale(view: View, data: DataState): boolean {
  return view.pending || (data.loading && data.errors.length > 0);
}

/** Whether a section is about to change: it is stale and a load runs. */
export function sectionsBusy(view: View, data: DataState): boolean {
  return data.loading && sectionsStale(view, data);
}

const sameYears = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((y, i) => y === b[i]);
const yearsOf = (data: Dataset) => data.years.map((s) => s.year);

/**
 * The selection every section reads. The state store hands out a new filters
 * object on every change of the URL, choosing a PR or a sort included, and a
 * Svelte derivation compares by identity; this one notifies only when the
 * filters' values, the dataset or `pending` change, so a statistic over the
 * selection is computed again only then.
 *
 * Filters are taken up only over every year their period needs: until those
 * land, and for good when one fails, the view keeps the previous filters'
 * figures and says it is pending, so no figure is ever shown for a period
 * over fewer years than it needs. A year that failed is let off only where
 * no figures would otherwise be shown, the page's first, and for filters
 * needing the same years as those shown over the same dataset; the page's
 * alert then names it. Until the first figures can be shown the view is
 * pending with nothing to show, as when the report is reached from another
 * route and its years are still loading.
 */
export function createViewStore(
  selection: Readable<AppState>,
  data: Readable<DataState>,
): Readable<View> & { destroy(): void } {
  const keep = keepEqual(sameFilters);
  let state = get(selection);
  let dataset = get(data).dataset;
  let failed = get(data).errors.map((e) => e.year);
  const needs = (filters: Filters) => yearsFor(dataset.meta, periodRange(filters).start);
  const view = (filters: Filters): View => ({
    dataset,
    filters,
    rows: select(dataset, filters),
    pending: false,
    first: false,
  });
  let current: View = { dataset, filters: keep(state.filters), rows: new Uint32Array(0), pending: true, first: true };

  const ready = (filters: Filters) => {
    const have = yearsOf(dataset);
    const missing = needs(filters).filter((y) => !have.includes(y));
    if (missing.length === 0) return true;
    if (!missing.every((y) => failed.includes(y))) return false;
    if (current.first) return true;
    return sameYears(needs(filters), needs(current.filters)) && sameYears(have, yearsOf(current.dataset));
  };

  if (ready(current.filters)) current = view(current.filters);
  const inner = writable(current);

  const update = () => {
    const filters = keep(state.filters);
    if (!current.pending && current.filters === filters && current.dataset === dataset) return;
    if (ready(filters)) current = view(filters);
    else if (!current.pending) current = { ...current, pending: true };
    else return;
    inner.set(current);
  };
  const stopState = selection.subscribe((s) => {
    state = s;
    update();
  });
  const stopData = data.subscribe((d) => {
    dataset = d.dataset;
    failed = d.errors.map((e) => e.year);
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
