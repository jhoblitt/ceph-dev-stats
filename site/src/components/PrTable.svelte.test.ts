// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { BASE, fixtureFetch } from '../lib/__fixtures__/fetch';
import { memoryLocation, meta } from '../lib/__fixtures__/page';
import { DataLoader } from '../lib/data';
import { createDataStore, createViewStore, yearsForState } from '../lib/page';
import { createStateStore, stateFromHash } from '../lib/state';
import { fixture } from '../lib/stats/testing';
import { DEFAULT_SORT } from '../lib/sort';
import { sortRows, tableRows } from '../lib/table';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

const data = fixture();

/** The App over the fixture at `hash`, recording the files fetched. */
async function page(hash: string, files: Record<string, unknown> = {}) {
  const loc = memoryLocation(hash);
  const selection = createStateStore(meta, loc);
  const fetched = fixtureFetch(files);
  const loader = new DataLoader(meta, BASE, fetched.fetch);
  const years = yearsForState(meta, get(selection));
  const store = createDataStore(loader, selection, years, await loader.load(years));
  const view = createViewStore(selection, store);
  return { props: { page: { meta, selection, data: store, view, loader } }, loc, requested: fetched.requested };
}

function region() {
  return within(screen.getByRole('region', { name: 'Pull requests' }));
}

function table() {
  return region().getByRole('table', { name: /^Pull requests/ });
}

/** The PR numbers of the table's body rows, in order. */
function listed(): number[] {
  return within(table())
    .getAllByRole('row')
    .slice(1)
    .map((r) => Number(r.querySelector('td a')?.textContent?.replace(/\D/g, '')));
}

const expected = (hash: string) => {
  const state = stateFromHash(hash, meta);
  return [...sortRows(data, tableRows(data, state), state.sort)].map((r) => data.prs.number[r]);
};

describe('PrTable', () => {
  it('lists exactly the selected PRs, newest opened first', async () => {
    render(App, (await page('')).props);
    expect(listed()).toEqual(expected(''));
    expect(listed()).toEqual([67100, 67000, 66900, 66700, 66600, 66510, 66500, 66100, 64010]);
    expect(table().getAttribute('aria-rowcount')).toBe('10');
  });

  it('says how many PRs it lists, and how many of them were opened in the period', async () => {
    render(App, (await page('')).props);
    // Nine selected; 64010 and 66100 were opened before the period.
    expect(region().getByRole('status').textContent).toBe('9 PRs open at some point in the period, 7 of them opened in it');
  });

  it('shows what a PR is about and whether it discloses first', async () => {
    render(App, (await page('')).props);
    const heads = within(table())
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.replace(/[↑↓]/g, '').trim());
    expect(heads.slice(0, 4)).toEqual(['PR', 'Title', 'LLM use', 'Author']);
    expect(heads).toContain('First response');
  });

  it('narrows to a chosen week, says so, and widens again', async () => {
    const { props, loc } = await page('#/?week=2026-05-18');
    render(App, props);
    expect(listed()).toEqual([66510, 66500]);
    expect(region().getByText(/2 PRs opened in the week of 2026-05-18/)).toBeTruthy();
    await fireEvent.click(region().getByRole('button', { name: 'Show every selected PR' }));
    expect(loc.hash()).toBe('#/?target=main');
  });

  it('loads the table file of each year the selection needs, and no other', async () => {
    const { props, requested } = await page('#/?kind=feature');
    render(App, props);
    await waitFor(() => expect(region().getByText('mds, mgr: report stuck client requests')).toBeTruthy());
    expect(requested.filter((u) => u.includes('table-'))).toEqual([`${BASE}table-2026.json`]);
    expect(within(table()).getByText('fixture-author-a')).toBeTruthy();
  });

  it('says which year could not be loaded and keeps the others', async () => {
    render(App, (await page('', { 'table-2026.json': undefined })).props);
    await waitFor(() => expect(region().getByText(/PRs opened in 2026 could not be loaded/)).toBeTruthy());
    expect(region().getByText(/table-2026\.json: HTTP 404/)).toBeTruthy();
    await waitFor(() => expect(within(table()).getByText('rgw: fix a stall in multisite bucket sync')).toBeTruthy());
  });

  it('sorts by a column chosen, writing it to the URL, and the other way when chosen again', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const size = () => within(table()).getByRole('button', { name: /^Size/ });
    await fireEvent.click(size());
    expect(loc.hash()).toBe('#/?target=main&sort=size');
    expect(listed()).toEqual(expected('#/?sort=size'));
    expect(size().closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    await fireEvent.click(size());
    expect(loc.hash()).toBe('#/?target=main&sort=-size');
    expect(listed()).toEqual(expected('#/?sort=-size'));
    expect(listed()[0]).toBe(67000);
    expect(within(table()).getByRole('button', { name: /^Opened/ }).closest('th')?.getAttribute('aria-sort')).toBe('none');
  });

  it('goes back to the top of the list after a sort', async () => {
    render(App, (await page('')).props);
    const box = region().getByRole('region', { name: 'Pull requests, scrollable' });
    box.scrollTop = 800;
    await fireEvent.scroll(box);
    expect(box.scrollTop).toBe(800);
    await fireEvent.click(within(table()).getByRole('button', { name: /^Size/ }));
    expect(box.scrollTop).toBe(0);
  });

  it('sorts by title once the titles are there', async () => {
    render(App, (await page('#/?sort=title')).props);
    await waitFor(() => expect(within(table()).getByText('doc: fix a typo')).toBeTruthy());
    expect(listed()[0]).toBe(66510);
    expect(DEFAULT_SORT.column).toBe('opened');
  });

  it('links each number to the PR on GitHub, in a new tab', async () => {
    render(App, (await page('')).props);
    const link = within(table()).getByRole('link', { name: '#66500 on GitHub, opens in a new tab' });
    expect(link.getAttribute('href')).toBe('https://github.com/ceph/ceph/pull/66500');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('writes the PR chosen from a row to the URL, and marks the row', async () => {
    const { props, loc } = await page('');
    render(App, props);
    await waitFor(() => expect(within(table()).getByText('doc: fix a typo')).toBeTruthy());
    await fireEvent.click(within(table()).getByRole('button', { name: 'doc: fix a typo' }));
    expect(loc.hash()).toBe('#/?target=main&pr=66510');
    const row = within(table()).getByRole('button', { name: 'doc: fix a typo' }).closest('tr');
    expect(row?.getAttribute('aria-current')).toBe('true');
  });

  it('says what is missing, not "no PRs match", when a chosen week has no PRs opened in it', async () => {
    render(App, (await page('#/?week=2026-06-22')).props);
    expect(region().getByText('no PRs opened in the week of 2026-06-22')).toBeTruthy();
    expect(region().queryByText('no PRs match')).toBeNull();
    expect(region().getByRole('button', { name: 'Show every selected PR' })).toBeTruthy();
  });

  it('says "no PRs match" for an empty selection', async () => {
    render(App, (await page('#/?component=cephfs&kind=docs')).props);
    expect(region().getByText('no PRs match')).toBeTruthy();
    expect(region().queryByRole('table')).toBeNull();
  });
});

describe('before the table is on screen', () => {
  // An IntersectionObserver that reports nothing until a spec says the section came into view.
  let observed: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const real = globalThis.IntersectionObserver;
  beforeAll(() => {
    globalThis.IntersectionObserver = class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observed.push(cb);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    observed = [];
  });

  it('fetches no table file, not even for a PR the link names, until the table is shown', async () => {
    const { props, requested } = await page('#/?target=all&pr=66800');
    render(App, props);
    await new Promise((r) => setTimeout(r, 20));
    expect(requested.filter((u) => u.includes('table-'))).toEqual([]);
    for (const cb of observed) cb([{ isIntersecting: true }]);
    await waitFor(() => expect(requested.filter((u) => u.includes('table-')).length).toBeGreaterThan(0));
    expect(requested).toContain(`${BASE}table-2026.json`);
    // The timeline asks for the same file for the same PR, so the table must
    // show it loaded its own: its rows carry the titles.
    await waitFor(() => expect(within(table()).getByText('mds, mgr: report stuck client requests')).toBeTruthy());
  });

  afterAll(() => {
    globalThis.IntersectionObserver = real;
  });
});

describe('the selected PR', () => {
  function panel() {
    return region().getByRole('group', { name: /^Selected PR/ });
  }

  it('links to GitHub, says its kind and what decided it, and links its tickets and the PR it backports', async () => {
    const { props, loc } = await page('#/?target=all&pr=66800');
    render(App, props);
    await waitFor(() => expect(panel().textContent).toContain('Bug fix, from the PR it backports'));
    const open = within(panel()).getByRole('link', { name: 'Open on GitHub, #66800, opens in a new tab' });
    expect(open.textContent).toBe('Open on GitHub');
    expect(open.getAttribute('href')).toBe('https://github.com/ceph/ceph/pull/66800');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    const ticket = within(panel()).getByRole('link', { name: 'Ticket 72140 on tracker.ceph.com, opens in a new tab' });
    expect(ticket.getAttribute('href')).toBe('https://tracker.ceph.com/issues/72140');
    expect(ticket.getAttribute('target')).toBe('_blank');
    const original = within(panel()).getByRole('link', { name: '#66500 on GitHub, opens in a new tab' });
    expect(original.getAttribute('href')).toBe('https://github.com/ceph/ceph/pull/66500');
    await fireEvent.click(within(panel()).getByRole('button', { name: 'Show #66500 here' }));
    expect(loc.hash()).toBe('#/?target=all&pr=66500');
  });

  it('links a backport whose original is not in the data to GitHub only', async () => {
    render(App, (await page('#/?target=all&pr=65220')).props);
    await waitFor(() => expect(panel().textContent).toContain('unknown: nothing decided it'));
    expect(within(panel()).getByRole('link', { name: '#63980 on GitHub, opens in a new tab' })).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: /^Show #63980/ })).toBeNull();
  });

  it('lists a ticket named twice twice, without breaking', async () => {
    // The loader does not promise unique tickets: 66900's two, with the first repeated.
    const table = (await import('../lib/__fixtures__/data/table-2026.json')).default;
    const tickets = table.tickets.map((t: number[], i: number) => (i === 6 ? [72377, 72378, 72377] : t));
    render(App, (await page('#/?pr=66900', { 'table-2026.json': { ...table, tickets } })).props);
    await waitFor(() => expect(within(panel()).getAllByRole('link', { name: /^Ticket 72377 / })).toHaveLength(2));
  });

  it('shows nothing, and does not throw, for a PR not in the data', async () => {
    render(App, (await page('#/?pr=99999')).props);
    expect(region().queryByRole('group', { name: /^Selected PR/ })).toBeNull();
  });
});
