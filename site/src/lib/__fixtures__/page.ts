// The page context over the fixture, for the specs that render the whole app.

import { get } from 'svelte/store';
import { DataLoader, parseMeta } from '../data';
import { type Page, createDataStore, createViewStore, yearsForState } from '../page';
import { type HashLocation, createStateStore } from '../state';
import { BASE, fixtureFetch } from './fetch';
import rawMeta from './data/meta.json';

export const meta = parseMeta(rawMeta);

/** A hash that lives in memory, so a spec can read what the page wrote. */
export function memoryLocation(initial: string): HashLocation & { hash: () => string } {
  let hash = initial;
  return {
    hash: () => hash,
    read: () => hash,
    push: (h) => (hash = h),
    replace: (h) => (hash = h),
    listen: () => () => {},
  };
}

/**
 * The App's props for the fixture at `hash`, with the hash it writes to;
 * `files` replaces fixture files by name, `meta.json` included.
 */
export async function fixturePage(
  hash: string,
  files: Record<string, unknown> = {},
): Promise<{ props: { page: Page }; loc: ReturnType<typeof memoryLocation> }> {
  const m = files['meta.json'] === undefined ? meta : parseMeta(files['meta.json']);
  const loc = memoryLocation(hash);
  const selection = createStateStore(m, loc);
  const loader = new DataLoader(m, BASE, fixtureFetch(files).fetch);
  const years = yearsForState(m, get(selection));
  const data = createDataStore(loader, selection, years, await loader.load(years));
  const view = createViewStore(selection, data);
  return { props: { page: { meta: m, selection, data, view, loader } }, loc };
}
