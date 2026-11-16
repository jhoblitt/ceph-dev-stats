// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import App from './App.svelte';
import rawMeta from './lib/__fixtures__/data/meta.json';
import { BASE, fixtureFetch } from './lib/__fixtures__/fetch';
import { DataLoader, parseMeta } from './lib/data';
import { type Page, createDataStore, yearsForState } from './lib/page';
import { type HashLocation, createStateStore } from './lib/state';

const meta = parseMeta(rawMeta);

beforeAll(() => {
  // jsdom has no matchMedia; the theme toggle asks it for the system theme.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

function memoryLocation(initial: string): HashLocation & { hash: () => string } {
  let hash = initial;
  return {
    hash: () => hash,
    read: () => hash,
    push: (h) => (hash = h),
    replace: (h) => (hash = h),
    listen: () => () => {},
  };
}

async function page(hash: string, files: Record<string, unknown> = {}) {
  const loc = memoryLocation(hash);
  const selection = createStateStore(meta, loc);
  const loader = new DataLoader(meta, BASE, fixtureFetch(files).fetch);
  const years = yearsForState(meta, get(selection));
  const data = createDataStore(loader, selection, years, await loader.load(years));
  const p: Page = { meta, selection, data, loader };
  return { props: { page: p }, loc };
}

const SECTIONS = ['Velocity', 'Review', 'LLM use', 'Each PR', 'Timelines', 'Pull requests'];

describe('App', () => {
  it('draws every section, and no error, from the whole fixture', async () => {
    render(App, (await page('')).props);
    for (const name of SECTIONS) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names a year file that failed, and still draws every section', async () => {
    render(App, (await page('', { 'prs-2025.json': undefined })).props);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/PRs opened in 2025: prs-2025\.json, HTTP 404/);
    for (const name of SECTIONS) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
  });

  it('shows one PR only when a PR is selected', async () => {
    render(App, (await page('#/?pr=66600')).props);
    expect(screen.getByRole('heading', { name: 'One pull request' })).toBeTruthy();
  });

  it('has no PR section without a selected PR', async () => {
    render(App, (await page('')).props);
    expect(screen.queryByRole('heading', { name: 'One pull request' })).toBeNull();
  });

  it('says what day the data is as of', async () => {
    render(App, (await page('')).props);
    expect(screen.getByRole('banner').textContent).toMatch(/data as of 2026-11-15/);
  });

  it('footer shows the version and links to the repository', async () => {
    render(App, (await page('')).props);
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.getByText('dev')).toBeTruthy();
    expect(footer.getByRole('link', { name: 'github.com/jhoblitt/ceph-dev-stats' }).getAttribute('href')).toBe(
      'https://github.com/jhoblitt/ceph-dev-stats',
    );
  });

  it('renders the methods placeholder', async () => {
    render(App, (await page('#/methods')).props);
    expect(screen.getByRole('main').textContent).toMatch(/The methods are not written yet\./);
    expect(screen.queryByRole('heading', { name: 'Filters' })).toBeNull();
  });
});

describe('filter bar', () => {
  it('shows the defaults for a hash with unknown values', async () => {
    render(App, (await page('#/?target=nope&component=nope&disclosure=ai')).props);
    expect((screen.getByRole('radio', { name: 'main' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Component') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Disclosure') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-05-15');
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-11-15');
  });

  it('shows the filters a hash restores', async () => {
    render(App, (await page('#/?target=all&component=rbd&standing=unknown&drafts=exclude')).props);
    expect((screen.getByRole('radio', { name: 'all' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Component') as HTMLSelectElement).value).toBe('rbd');
    expect((screen.getByLabelText('Author standing (earlier PRs)') as HTMLSelectElement).value).toBe('unknown');
    expect((screen.getByLabelText('Drafts') as HTMLSelectElement).value).toBe('exclude');
  });

  it('writes a change to the hash', async () => {
    const { props, loc } = await page('');
    render(App, props);
    await fireEvent.click(screen.getByRole('radio', { name: 'backports and other branches' }));
    const size = screen.getByLabelText('Size (lines added and deleted)') as HTMLSelectElement;
    size.value = 'gt1000';
    await fireEvent.change(size);
    const reopened = screen.getByLabelText('Reopened') as HTMLSelectElement;
    reopened.value = 'only';
    await fireEvent.change(reopened);
    expect(loc.hash()).toBe('#/?target=backports&size=gt1000&reopened=only');
  });

  it('offers every kind in meta, then unknown, under a Kind label', async () => {
    render(App, (await page('')).props);
    const kind = screen.getByLabelText('Kind') as HTMLSelectElement;
    expect(kind.tagName).toBe('SELECT');
    expect([...kind.options].map((o) => [o.value, o.text])).toEqual([
      ['', 'all'],
      ['bugfix', 'Bug fix'],
      ['feature', 'Feature'],
      ['cleanup', 'Cleanup'],
      ['docs', 'Documentation'],
      ['other', 'Other'],
      ['unknown', 'unknown'],
    ]);
    expect(kind.value).toBe('');
  });

  it('shows the kind a hash restores, and all for a kind meta does not name', async () => {
    render(App, (await page('#/?kind=unknown')).props);
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('unknown');
    cleanup();
    render(App, (await page('#/?kind=refactor')).props);
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('');
  });

  it('writes a kind to the hash, and clears it for all', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const kind = screen.getByLabelText('Kind') as HTMLSelectElement;
    kind.value = 'docs';
    await fireEvent.change(kind);
    expect(loc.hash()).toBe('#/?target=main&kind=docs');
    kind.value = '';
    await fireEvent.change(kind);
    expect(loc.hash()).toBe('#/?target=main');
  });

  it('puts back a day outside the data rather than show what was typed', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const from = screen.getByLabelText('From') as HTMLInputElement;
    from.value = '2026-01-01';
    await fireEvent.change(from);
    expect(from.value).toBe('2026-05-15');
    expect(loc.hash()).toBe('#/?target=main');
  });
});
