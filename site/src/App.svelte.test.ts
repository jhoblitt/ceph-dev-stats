// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import App from './App.svelte';
import rawMeta from './lib/__fixtures__/data/meta.json';
import { BASE, fixtureFetch, withEarlierYear } from './lib/__fixtures__/fetch';
import { DataLoader, type Fetch, parseMeta } from './lib/data';
import { type Page, createDataStore, createViewStore, firstYears } from './lib/page';
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

async function page(hash: string, files: Record<string, unknown> = {}, m = meta, wrap = (f: Fetch) => f) {
  const loc = memoryLocation(hash);
  const selection = createStateStore(m, loc);
  const loader = new DataLoader(m, BASE, wrap(fixtureFetch(files).fetch));
  const years = firstYears(m, get(selection));
  const data = createDataStore(loader, selection, years, await loader.load(years));
  const p: Page = { meta: m, selection, data, view: createViewStore(selection, data), loader };
  return { props: { page: p }, loc };
}

const SECTIONS = ['Velocity', 'Review', 'LLM use', 'Each PR', 'Timelines', 'Pull requests', 'People'];

describe('App', () => {
  it('draws every section, and no error, from the whole fixture', async () => {
    render(App, (await page('')).props);
    for (const name of SECTIONS) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names a year file that failed, and still draws every section', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    render(App, (await page('#/?from=2025-03-01', { ...earlier, 'prs-2025.json': undefined }, twoYears)).props);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/PRs finished in 2025: prs-2025\.json, HTTP 404/);
    for (const name of SECTIONS) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
  });

  it('shows no figure, only that it is loading, when the report is reached from the methods page before its years land', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    const held: (() => void)[] = [];
    const hold = (f: Fetch): Fetch => (url) =>
      url.includes('-2025') ? new Promise((go) => held.push(() => go(f(url)))) : f(url);
    const { props } = await page('#/methods?from=2025-03-01', earlier, twoYears, hold);
    render(App, props);
    // As following the Statistics link does: the same address, on the report.
    props.page.selection.update((s) => ({ ...s, route: 'report' }));
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Ceph pull requests' })).toBeTruthy());

    expect(screen.getByText('Loading the data for this period…')).toBeTruthy();
    expect(document.querySelector('.waiting')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(/no PRs match/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Velocity' })).toBeNull();

    for (const go of held.splice(0)) go();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Velocity' })).toBeTruthy());
    expect(document.querySelector('.waiting')).toBeNull();
    const table = within(screen.getByRole('region', { name: /^Pull requests$/ }));
    expect(table.getByRole('status').textContent).toMatch(/^10 PRs open at some point in the period/);
  });

  it('keeps the last period that loaded whole when a year an earlier start needs fails, says so, and comes back', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    render(App, (await page('', { ...earlier, 'events-2025.json': undefined }, twoYears)).props);
    const status = () => screen.getByText((_, el) => el?.classList.contains('loading') === true);
    const table = () => within(screen.getByRole('region', { name: /^Pull requests$/ }));
    const count = table().getByRole('status').textContent;

    await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/events-2025\.json, HTTP 404/));
    expect(status().textContent).toBe(
      'The data for the period chosen could not be loaded, so everything below is still for 2026-05-15 to 2026-11-15, with the filters then chosen.',
    );
    expect(table().getByRole('status').textContent).toBe(count);
    expect(screen.getByRole('region', { name: 'Velocity' }).classList.contains('stale')).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Last 6 months' }));
    await waitFor(() => expect(status().textContent).toBe(''));
    expect(screen.getByRole('region', { name: 'Velocity' }).classList.contains('stale')).toBe(false);
  });

  it('shows one PR only when a PR is selected', async () => {
    render(App, (await page('#/?pr=66600')).props);
    expect(screen.getByRole('heading', { name: 'Pull request #66600' })).toBeTruthy();
  });

  it('has no PR section without a selected PR', async () => {
    render(App, (await page('')).props);
    expect(screen.queryByRole('heading', { name: /^Pull request #/ })).toBeNull();
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

  it('renders the methods page', async () => {
    render(App, (await page('#/methods')).props);
    expect(screen.getByRole('heading', { level: 1, name: 'Methods' })).toBeTruthy();
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

  it('offers every login the data names to the Author and Reviewer filters, a bot marked', async () => {
    render(App, (await page('')).props);
    const author = screen.getByLabelText('Author') as HTMLInputElement;
    const reviewer = screen.getByLabelText('Reviewer') as HTMLInputElement;
    expect(author.type).toBe('text');
    expect(reviewer.getAttribute('list')).toBe(author.getAttribute('list'));
    const list = document.getElementById(author.getAttribute('list') as string) as HTMLDataListElement;
    expect([...list.options].map((o) => o.value)).toEqual(meta.people);
    expect([...list.options].find((o) => o.value === 'fixture-author-j')?.textContent).toBe('bot');
  });

  it('shows the author and reviewer a hash restores, each with a way to clear it', async () => {
    const { props, loc } = await page('#/?author=fixture-author-d&reviewer=fixture-author-f');
    render(App, props);
    expect((screen.getByLabelText('Author') as HTMLInputElement).value).toBe('fixture-author-d');
    expect((screen.getByLabelText('Reviewer') as HTMLInputElement).value).toBe('fixture-author-f');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear the Reviewer filter' }));
    expect(loc.hash()).toBe('#/?target=main&author=fixture-author-d');
    expect((screen.getByLabelText('Reviewer') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear the Reviewer filter' })).toBeNull();
  });

  it('writes a login typed in any case to the hash as the data gives it, and clears it when emptied', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const author = screen.getByLabelText('Author') as HTMLInputElement;
    author.value = ' Fixture-Author-A ';
    await fireEvent.change(author);
    expect(loc.hash()).toBe('#/?target=main&author=fixture-author-a');
    expect(author.value).toBe('fixture-author-a');
    author.value = '';
    await fireEvent.change(author);
    expect(loc.hash()).toBe('#/?target=main');
  });

  it('says beside the Reviewer input, in view, that it keeps the PRs reviewed or commented on in the period', async () => {
    render(App, (await page('')).props);
    const reviewer = screen.getByLabelText('Reviewer') as HTMLInputElement;
    const line = screen.getByText('PRs reviewed or commented on in the period');
    expect(line.tagName).toBe('P');
    expect(line.classList.contains('visually-hidden')).toBe(false);
    expect(reviewer.getAttribute('aria-describedby')?.split(' ')).toContain(line.id);
  });

  it('keeps the filter and says so when a login typed is not in the data', async () => {
    const { props, loc } = await page('#/?reviewer=fixture-author-e');
    render(App, props);
    const reviewer = screen.getByLabelText('Reviewer') as HTMLInputElement;
    reviewer.value = 'someone-else';
    await fireEvent.change(reviewer);
    expect(loc.hash()).toBe('#/?target=main&reviewer=fixture-author-e');
    expect(reviewer.value).toBe('fixture-author-e');
    expect(screen.getByText('No PR in the data names “someone-else”.')).toBeTruthy();
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

  describe('over a window longer than the default six months', () => {
    const long = parseMeta({ ...rawMeta, window_start: Date.UTC(2025, 0, 1) / 1000 });
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

    it('keeps a typed start before the default but inside the window', async () => {
      const { props, loc } = await page('', {}, long);
      render(App, props);
      const from = screen.getByLabelText('From') as HTMLInputElement;
      expect(from.value).toBe('2026-05-15');
      expect(from.min).toBe('2025-01-01');
      from.value = '2025-03-01';
      await fireEvent.change(from);
      expect(from.value).toBe('2025-03-01');
      expect(loc.hash()).toBe('#/?target=main&from=2025-03-01');
    });

    it('moves the period to the whole window and back to the last six months in one choice each', async () => {
      const { props, loc } = await page('#/?from=2026-07-01&to=2026-08-31', {}, long);
      render(App, props);
      expect(pressed('Last 6 months')).toBe('false');
      expect(pressed('All, from 1 Jan 2025')).toBe('false');

      await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
      expect(loc.hash()).toBe('#/?target=main&from=2025-01-01');
      expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2025-01-01');
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-11-15');
      expect(pressed('All, from 1 Jan 2025')).toBe('true');

      await fireEvent.click(screen.getByRole('button', { name: 'Last 6 months' }));
      expect(loc.hash()).toBe('#/?target=main');
      expect(pressed('Last 6 months')).toBe('true');
      expect(pressed('All, from 1 Jan 2025')).toBe('false');
    });
  });

  it('offers no choice of the whole window when it is no longer than the default', async () => {
    render(App, (await page('')).props);
    expect(screen.getByRole('button', { name: 'Last 6 months' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /^All, from/ })).toBeNull();
  });
});
