// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { BASE, fixtureFetch } from '../lib/__fixtures__/fetch';
import rawEvents2026 from '../lib/__fixtures__/data/events-2026.json';
import rawMeta from '../lib/__fixtures__/data/meta.json';
import rawPrs2026 from '../lib/__fixtures__/data/prs-2026.json';
import rawTable2026 from '../lib/__fixtures__/data/table-2026.json';
import { fixturePage, memoryLocation, meta } from '../lib/__fixtures__/page';
import { DataLoader } from '../lib/data';
import { createDataStore, createViewStore, yearsForState } from '../lib/page';
import { createStateStore } from '../lib/state';
import { at } from '../lib/stats/testing';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

type Columns = Record<string, unknown[]>;
const append = (raw: unknown, extra: Record<string, unknown[]>): Columns =>
  Object.fromEntries(Object.entries(raw as Columns).map(([k, col]) => [k, [...col, ...(extra[k] ?? [])]]));

const SHA = (c: string) => c.repeat(40);
const PR = 'https://github.com/ceph/ceph/pull/67300';
const OPENED = at('2026-08-03T09:00:00Z');
const hour = (h: number) => OPENED + h * 3600;
const KINDS = [...rawMeta.event_kinds, 'review_author'];

/** Every event kind on one PR, an hour apart, with the ref each address is built from. */
const EVERY: { kind: string; ref: string; sub?: number; name: string; href: string | null }[] = [
  { kind: 'comment_other', ref: '101', name: 'Comment by another person', href: `${PR}#issuecomment-101` },
  { kind: 'comment_author', ref: '102', name: 'Comment by the author', href: `${PR}#issuecomment-102` },
  { kind: 'command_author', ref: '103', sub: 0, name: 'Bot command by the author: jenkins test', href: `${PR}#issuecomment-103` },
  { kind: 'command_other', ref: '104', sub: 1, name: 'Bot command by another person: /config check ok', href: `${PR}#issuecomment-104` },
  { kind: 'bot_account', ref: '105', name: 'Comment by a bot account', href: `${PR}#issuecomment-105` },
  { kind: 'review_approved', ref: '201', name: 'Review approving', href: `${PR}#pullrequestreview-201` },
  { kind: 'review_changes', ref: '202', name: 'Review requesting changes', href: `${PR}#pullrequestreview-202` },
  { kind: 'review_commented', ref: '203', name: 'Review commenting', href: `${PR}#pullrequestreview-203` },
  { kind: 'bot_review', ref: '204', name: 'Review by a bot', href: `${PR}#pullrequestreview-204` },
  { kind: 'review_author', ref: '205', name: 'Reply by the author in a review thread', href: `${PR}#pullrequestreview-205` },
  { kind: 'draft', ref: '301', name: 'Converted to draft', href: `${PR}#event-301` },
  { kind: 'ready', ref: '302', name: 'Marked ready for review', href: `${PR}#event-302` },
  { kind: 'force_push', ref: SHA('a'), name: 'Force-push', href: `https://github.com/ceph/ceph/commit/${SHA('a')}` },
  { kind: 'force_push', ref: '', name: 'Force-push', href: null },
  { kind: 'closed', ref: '303', name: 'Closed for 1 hour', href: `${PR}#event-303` },
  { kind: 'reopened', ref: '', name: 'Reopened after 1 hour closed', href: PR },
  { kind: 'merged', ref: SHA('b'), name: 'Merged', href: `https://github.com/ceph/ceph/commit/${SHA('b')}` },
];

/** The fixture with #67300 added as the 2026 file's last row, carrying every event kind. */
function withEveryKind(): Record<string, unknown> {
  const row = (rawPrs2026 as Columns)['number']?.length as number;
  const prs = append(rawPrs2026, {
    number: [67300],
    created: [OPENED],
    ready: [OPENED],
    closed: [hour(EVERY.length)],
    state: [1],
    base: [0],
    draft: [0],
    opened_draft: [0],
    reopened: [1],
    in_window: [1],
    additions: [10],
    deletions: [2],
    files: [1],
    commits: [1],
    first_commit: [hour(-20)],
    last_commit: [hour(13)],
    first_response: [hour(1)],
    first_approval: [hour(6)],
    human_reviews: [3],
    bot_reviews: [1],
    bot_commands: [2],
    disclosure: [0],
    families: [[]],
    components: [[]],
    standing: [-1],
    kind: [-1],
    author: [0],
  });
  const events = append(rawEvents2026, {
    pr: EVERY.map(() => row),
    at: EVERY.map((_, i) => hour(i + 1)),
    kind: EVERY.map((e) => KINDS.indexOf(e.kind)),
    sub: EVERY.map((e) => e.sub ?? -1),
    actor: EVERY.map(() => -1),
  });
  const table = append(rawTable2026, {
    titles: ['mgr: a PR with every event'],
    authors: ['someone'],
    commits: [[[SHA('c'), hour(-20), hour(13)]]],
    refs: EVERY.map((e) => e.ref),
    tickets: [[]],
    backport_of: [0],
    kind_source: [''],
  });
  return {
    'meta.json': { ...rawMeta, event_kinds: KINDS },
    'prs-2026.json': prs,
    'events-2026.json': events,
    'table-2026.json': table,
  };
}

async function timeline(hash: string, files: Record<string, unknown> = {}) {
  const { props } = await fixturePage(hash, files);
  render(App, { props });
  return screen.findByRole('region', { name: /^Timeline of #/ });
}

describe('PrTimeline', () => {
  it('draws one mark per event, in time order, each linked to the address its id or SHA gives', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const marks = within(group).getAllByRole('link');
    const named = marks.map((m) => m.getAttribute('aria-label') ?? '');
    const expected = [
      'First commit',
      'Opened',
      ...EVERY.slice(0, 12).map((e) => e.name),
      'Last commit',
      ...EVERY.slice(12).map((e) => e.name),
    ];
    expect(named.map((n) => n.replace(/, \d+ \w+ \d{4} \d\d:\d\d UTC.*$/, ''))).toEqual(expected);

    const events = marks.filter((m) => !/^(First commit|Opened|Last commit)/.test(m.getAttribute('aria-label') ?? ''));
    expect(events.map((m) => m.getAttribute('href'))).toEqual(EVERY.map((e) => e.href));
    expect(named[2]).toBe('Comment by another person, 3 Aug 2026 10:00 UTC');
    expect(named[named.length - 4]).toBe('Force-push, 3 Aug 2026 23:00 UTC, address not recorded');
    for (const m of marks.filter((m) => m.hasAttribute('href'))) {
      expect(m.getAttribute('target')).toBe('_blank');
      expect(m.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(within(section).getByText('Closed and reopened 1 time: for 1 hour.')).toBeTruthy();
  });

  it('takes the marks as one stop for the keyboard, the arrow keys moving along them in time order', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const marks = within(group).getAllByRole('link');
    expect(marks.map((m) => m.tabIndex).filter((t) => t === 0)).toHaveLength(1);
    (marks[0] as HTMLElement).focus();
    await fireEvent.keyDown(marks[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(marks[1]);
    await fireEvent.keyDown(marks[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(marks.at(-1));
    expect(marks.at(-1)?.tabIndex).toBe(0);
  });

  it('gives the PR’s title, branch, commits and disclosure under the heading', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const line = await within(section).findByText('mgr: a PR with every event');
    expect(line.parentElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'mgr: a PR with every event main · 1 commit · not disclosed',
    );
  });

  it('names each link of the events table for what it opens', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const table = await within(section).findByRole('table');
    expect(within(table).getByRole('link', { name: 'Review approving, 3 Aug 2026 15:00 UTC, on GitHub' }).getAttribute('href')).toBe(
      `${PR}#pullrequestreview-201`,
    );
    expect(within(table).queryAllByRole('link', { name: 'open' })).toHaveLength(0);
    expect(within(section).getByRole('group', { name: 'Legend' })).toBeTruthy();
  });

  it('starts a new PR’s timeline afresh, not carrying over the last one’s focused mark', async () => {
    const { props } = await fixturePage('#/?target=all&pr=66600');
    render(App, { props });
    const first = await screen.findByRole('region', { name: 'Timeline of #66600' });
    const marks = within(await within(first).findByRole('group', { name: /^The marks/ })).getAllByRole('link');
    (marks[0] as HTMLElement).focus();
    await fireEvent.keyDown(marks[0] as HTMLElement, { key: 'End' });
    expect(marks.at(-1)?.tabIndex).toBe(0);
    // #66100 is in the same year's table, so only the key starts its chart afresh.
    props.page.selection.update((st) => ({ ...st, pr: 66100 }));
    const next = await screen.findByRole('region', { name: 'Timeline of #66100' });
    const nextMarks = within(await within(next).findByRole('group', { name: /^The marks/ })).getAllByRole('link');
    expect(nextMarks.map((m) => m.tabIndex).indexOf(0)).toBe(0);
  });

  it('heads the timeline with the PR’s number, linked, and lists its commits by short SHA', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const heading = within(section).getByRole('heading', { level: 2 });
    expect(within(heading).getByRole('link', { name: '#67300' }).getAttribute('href')).toBe(PR);
    const commit = await within(section).findByRole('link', { name: /^Commit ccccccc/ });
    expect(commit.getAttribute('href')).toBe(`${PR}/commits/${SHA('c')}`);
    expect(commit.textContent).toBe('ccccccc');
  });

  it('leaves an unknown first commit off the line and says so', async () => {
    const section = await timeline('#/?target=all&pr=67000');
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const names = within(group)
      .getAllByRole('link')
      .map((m) => m.getAttribute('aria-label') ?? '');
    expect(names.some((n) => n.startsWith('First commit'))).toBe(false);
    expect(names.some((n) => n.startsWith('Opened'))).toBe(true);
    expect(within(section).getByText(/The first commit is unknown: .* It is left off the line\./)).toBeTruthy();
    expect(within(section).getByText('unknown')).toBeTruthy();
  });

  it('says "no such PR" for a number not in the data, and draws nothing', async () => {
    const section = await timeline('#/?target=all&pr=12345');
    expect(within(section).getByText(/no such PR: #12345 is not in the data/)).toBeTruthy();
    expect(within(section).queryByRole('group')).toBeNull();
    expect(within(section).queryByRole('figure')).toBeNull();
  });

  it('says so when the PR’s table cannot be loaded', async () => {
    const section = await timeline('#/?target=all&pr=66500', { 'table-2026.json': undefined });
    expect(await within(section).findByRole('alert')).toBeTruthy();
    expect(within(section).getByRole('alert').textContent).toMatch(/table-2026\.json.*Reloading\s+the\s+page\s+will\s+try\s+again\./s);
  });
});

describe('before the timeline is on screen', () => {
  // An IntersectionObserver that reports nothing until a spec says an element came into view.
  const observed: { node: Element; cb: (entries: { isIntersecting: boolean }[]) => void }[] = [];
  const real = globalThis.IntersectionObserver;
  beforeAll(() => {
    globalThis.IntersectionObserver = class {
      readonly cb: (entries: { isIntersecting: boolean }[]) => void;
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        this.cb = cb;
      }
      observe(node: Element) {
        observed.push({ node, cb: this.cb });
      }
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterAll(() => {
    globalThis.IntersectionObserver = real;
  });

  it('fetches no table file for a PR the link names until its section is shown, then draws it', async () => {
    const loc = memoryLocation('#/?target=all&pr=67000');
    const selection = createStateStore(meta, loc);
    const fetched = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetched.fetch);
    const years = yearsForState(meta, get(selection));
    const data = createDataStore(loader, selection, years, await loader.load(years));
    render(App, { props: { page: { meta, selection, data, view: createViewStore(selection, data), loader } } });
    const section = await screen.findByRole('region', { name: 'Timeline of #67000' });
    await new Promise((r) => setTimeout(r, 20));
    const tables = () => fetched.requested.filter((u) => u.includes('table-'));
    expect(tables()).toEqual([]);
    expect(within(section).getByText('The timeline of #67000 loads when this section is on screen.')).toBeTruthy();
    // Only the timeline's own section comes into view; the PR table stays off screen.
    for (const o of observed) if (o.node === section) o.cb([{ isIntersecting: true }]);
    await waitFor(() => expect(tables()).toEqual([`${BASE}table-2026.json`]));
    expect(await within(section).findByRole('group', { name: 'The marks on the line, in time order' })).toBeTruthy();
  });
});
