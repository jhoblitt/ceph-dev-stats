// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage } from '../lib/__fixtures__/page';
import { sections } from '../lib/methods/sections';

beforeAll(() => {
  // jsdom has no matchMedia, which the theme toggle asks, nor scrolling.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  Element.prototype.scrollIntoView = function () {};
});

async function methods(files: Record<string, unknown> = {}) {
  const { props, loc } = await fixturePage('#/methods', files);
  render(App, props);
  return { main: screen.getByRole('main'), loc };
}

const article = () => screen.getByRole('main').querySelector('article') as HTMLElement;

describe('the methods page', () => {
  it('draws every section under its id, with its title', async () => {
    const { main } = await methods();
    for (const s of sections()) {
      const el = main.querySelector(`section#${s.id}`);
      expect(el, s.id).not.toBeNull();
      expect(within(el as HTMLElement).getByRole('heading', { level: 2 }).textContent).toBe(s.title);
    }
  });

  it('gives disclosure the anchor the rest of the site links to', async () => {
    const { main } = await methods();
    expect(main.querySelector('section#disclosure h2')?.textContent).toBe('Disclosure of LLM use');
  });

  it('lists every section in its contents, each link leading to a section on the page', async () => {
    const { main } = await methods();
    const nav = within(screen.getByRole('navigation', { name: 'Contents' }));
    const links = nav.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(sections().map((s) => s.title));
    for (const a of links) expect(main.querySelector(`#${a.dataset['target']}`), a.textContent ?? '').not.toBeNull();
  });

  it('moves to a section from its contents link without leaving the page', async () => {
    const { loc } = await methods();
    const before = loc.hash();
    const link = within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('link', {
      name: 'Disclosure of LLM use',
    });
    await fireEvent.click(link);
    expect(loc.hash()).toBe(before);
    expect(document.activeElement?.id).toBe('disclosure');
  });

  it('follows a link to another section inside the prose without leaving the page', async () => {
    const { loc } = await methods();
    const before = loc.hash();
    const section = document.getElementById('responses') as HTMLElement;
    await fireEvent.click(within(section).getByRole('link', { name: 'bot command' }));
    expect(loc.hash()).toBe(before);
    expect(document.activeElement?.id).toBe('commands');
  });

  it('shows the figures computed from the data, with the date the data runs to', async () => {
    await methods();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const text = article().textContent ?? '';
    expect(text).toContain('On the data as of 2026-11-15, 12 pull requests were open at some point in the window: 9 opened in it and 3 before it.');
    expect(text).toContain('1 of the 12 pull requests open at some point in the window are of unknown kind (8.3%)');
    expect(text).toContain('3 (27%) were bot commands, 2 of them by the pull request');
    expect(text).toContain('0 of the 7 force-pushes in the window (0%) and 0 of the 6 merges in the window have no commit to link to');
    const kinds = screen.getByRole('table', { name: /Where each pull request’s kind came from/ });
    expect(within(kinds).getByRole('row', { name: /the PR’s checklist/ }).textContent).toMatch(/the PR’s checklist\s*4\s*0\s*4/);
  });

  it('shows a loading state until the figures are computed', async () => {
    await methods();
    expect(screen.getByRole('status').textContent).toMatch(/Loading the data the figures on this page are computed from/);
  });

  it('keeps the prose and the other figures when a table file fails, and says which', async () => {
    await methods({ 'table-2026.json': undefined });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/table-2026\.json: HTTP 404/));
    const text = article().textContent ?? '';
    expect(text).toContain('12 pull requests were open at some point in the window');
    expect(text).toContain('(not available) of the (not available) force-pushes');
    expect(text).toContain('This table could not be computed');
    for (const s of sections()) expect(document.getElementById(s.id)).not.toBeNull();
  });

  it('keeps the prose when a year of data fails', async () => {
    await methods({ 'events-2025.json': undefined });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/events-2025\.json: HTTP 404/));
    expect(article().textContent).toContain('(not available) pull requests were open at some point in the window');
    expect(article().textContent).toContain("Ceph's rule asking for an Assisted-by trailer was a draft on 2026-10-12.");
  });
});

describe('the methods renderer', () => {
  it('never inserts markup as HTML', () => {
    const sources: Record<string, string> = import.meta.glob(['../lib/methods/*.svelte', './Methods.svelte'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(1);
    for (const [path, source] of Object.entries(sources)) expect(source, path).not.toContain('{@html');
  });
});
