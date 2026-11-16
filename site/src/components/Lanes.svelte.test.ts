// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import rawPrs2026 from '../lib/__fixtures__/data/prs-2026.json';
import { fixturePage } from '../lib/__fixtures__/page';
import { at } from '../lib/stats/testing';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

/** 2026's PRs replaced by `n` open ones on main, an hour apart from 1 June, with no events. */
function manyPrs(n: number): Record<string, unknown> {
  const columns = Object.keys(rawPrs2026);
  const value = (column: string, i: number): unknown => {
    switch (column) {
      case 'number':
        return 70000 + i;
      case 'created':
      case 'ready':
        return at('2026-06-01T00:00:00Z') + i * 3600;
      case 'closed':
      case 'first_commit':
      case 'last_commit':
      case 'first_response':
      case 'first_approval':
      case 'standing':
      case 'kind':
        return -1;
      case 'in_window':
      case 'files':
      case 'commits':
        return 1;
      case 'families':
      case 'components':
        return [];
      default:
        return 0;
    }
  };
  const prs = Object.fromEntries(columns.map((c) => [c, Array.from({ length: n }, (_, i) => value(c, i))]));
  const events = { pr: [], at: [], kind: [], sub: [], actor: [] };
  return { 'prs-2026.json': prs, 'events-2026.json': events, 'table-2026.json': undefined };
}

async function lanes(hash: string, files: Record<string, unknown> = {}) {
  const { props, loc } = await fixturePage(hash, files);
  render(App, { props });
  return { section: within(screen.getByRole('region', { name: 'Timelines' })), loc };
}

describe('Lanes', () => {
  it('draws at most 200 lanes and says how many of how many', async () => {
    const { section } = await lanes('#/?target=main', manyPrs(250));
    // 250 opened in 2026 and one still open from 2025, all on main.
    expect(section.getByText('Showing 200 of 251 PRs, newest opened first.')).toBeTruthy();
    const list = section.getByRole("list", { name: /PRs in the lanes/ });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(200);
    expect(links[0]?.textContent).toBe('#70249');
    expect(links.at(-1)?.textContent).toBe('#70050');
  });

  it('describes the lanes for a reader who cannot see the canvas', async () => {
    const { section } = await lanes('#/?target=all');
    const figure = section.getByRole('figure', { name: 'Each PR’s timeline, one per row' });
    expect(figure.getAttribute('aria-describedby')).toBeTruthy();
    const summary = document.getElementById(figure.getAttribute('aria-describedby') as string);
    expect(summary?.textContent).toMatch(/^The timelines of 12 PRs, one per row, newest opened first: from #67250/);
    expect(section.queryByText(/^Showing /)).toBeNull();
    expect(section.getByRole('img').getAttribute('aria-label')).toBe('12 lanes, one per PR; each is a link in the list below.');
  });

  it('opens a PR’s timeline from its link', async () => {
    const { section, loc } = await lanes('#/?target=all');
    const list = section.getByRole("list", { name: /PRs in the lanes/ });
    const link = within(list).getByRole('link', { name: '#66500' });
    expect(link.getAttribute('href')).toBe('#/?target=all&pr=66500');
    await fireEvent.click(link);
    expect(loc.hash()).toBe('#/?target=all&pr=66500');
    expect(await screen.findByRole('region', { name: 'Timeline of #66500' })).toBeTruthy();
  });

  it('opens the PR of a tapped lane, from the tap’s own place, with no pointer move before it', async () => {
    const { section, loc } = await lanes('#/?target=all');
    const canvas = section.getByRole('img').querySelector('canvas') as HTMLCanvasElement;
    // 12 lanes are 14 pixels apart under a 4-pixel margin: y 4 + 14 + 7 is the second, #67100.
    const click = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(click, 'offsetY', { value: 4 + 14 + 7 });
    await fireEvent(canvas, click);
    expect(loc.hash()).toBe('#/?target=all&pr=67100');
  });

  it('switches the time axis to days since opening', async () => {
    const { section } = await lanes('#/?target=all');
    await fireEvent.click(section.getByRole('radio', { name: 'Days since opening' }));
    expect(section.getByText(/Each row starts when its PR opened, on a log scale/)).toBeTruthy();
    expect(section.queryByText('before opening, from the first commit')).toBeNull();
  });
});
