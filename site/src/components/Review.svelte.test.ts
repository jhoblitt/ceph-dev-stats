// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import rawEvents2026 from '../lib/__fixtures__/data/events-2026.json';
import rawMeta from '../lib/__fixtures__/data/meta.json';
import { fixturePage, meta } from '../lib/__fixtures__/page';
import { periodRange } from '../lib/filters';
import { formatDays, formatShare } from '../lib/format';
import { openedIn, select } from '../lib/select';
import { defaultFilters } from '../lib/state';
import { type Curve, outcomeCurve } from '../lib/stats/curve';
import { reviewLoad } from '../lib/stats/reviewers';
import { fixture } from '../lib/stats/testing';
import { weekly } from '../lib/stats/weekly';

const NEW_COMMANDS = ['zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda'];

/** The fixture with six more commands, each run once on #66500 after its own events. */
function manyCommands(): Record<string, unknown> {
  const m = { ...rawMeta, commands: [...rawMeta.commands, ...NEW_COMMANDS.map((n) => ({ id: n, name: n }))] };
  const columns = rawEvents2026 as Record<string, number[]>;
  // #66500 is the 2026 file's row 1; its events end before row 2's begin.
  const at = (columns['pr'] as number[]).indexOf(2);
  const added: Record<string, number[]> = {
    pr: NEW_COMMANDS.map(() => 1),
    at: NEW_COMMANDS.map((_, k) => 1779450000 + k),
    kind: NEW_COMMANDS.map(() => rawMeta.event_kinds.indexOf('command_other')),
    sub: NEW_COMMANDS.map((_, k) => rawMeta.commands.length + k),
    actor: NEW_COMMANDS.map(() => -1),
  };
  const events = Object.fromEntries(
    Object.entries(columns).map(([key, col]) => [key, [...col.slice(0, at), ...(added[key] as number[]), ...col.slice(at)]]),
  );
  return { 'meta.json': m, 'events-2026.json': events };
}

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

const data = fixture();
const filters = defaultFilters(meta);
const period = periodRange(filters);
const rows = select(data, filters);
const opened = openedIn(data, rows, period);

const TITLES = [
  'PRs arriving against human review, per week',
  'Human and bot reviews per week',
  'Time to first response',
  'Time to first approval',
  'Time to merge',
  'Wait for a first response, by week opened',
  'Wait for a first approval, by week opened',
  'Wait to merge, by week opened',
  'Time after first approval',
  'First commit to opened',
  'First commit to opened, by week opened',
  'Opened to last commit',
  'Opened to last commit, by week opened',
  'Last commit to final disposition',
  'Last commit to final disposition, by week opened',
  'Bot commands per week, by command',
];

function section() {
  return within(screen.getByRole('region', { name: 'Review' }));
}

function figure(name: string): HTMLElement {
  return section().getByRole('figure', { name });
}

/** The text of each body row's cells in a figure's table. */
function cells(f: HTMLElement): string[][] {
  return within(f)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent ?? ''));
}

/** A curve's shares at `day`, read straight off the library's result. */
function sharesAt(curve: Curve, day: number): number[] {
  const names = Object.keys(curve.shares);
  let i = -1;
  while (i + 1 < curve.days.length && (curve.days[i + 1] as number) <= day) i++;
  return names.map((n, k) => (i === -1 ? (k === names.length - 1 && names.length === 3 ? 1 : 0) : (curve.shares[n] as number[])[i] as number));
}

describe('Review', () => {
  it('draws every chart, in order', async () => {
    render(App, (await fixturePage('')).props);
    expect(section().getAllByRole('figure').map((f) => f.querySelector('h3')?.textContent)).toEqual(TITLES);
  });

  it('sets the PRs arriving against the human reviews and the people reviewing that the library counts', async () => {
    render(App, (await fixturePage('')).props);
    const o = weekly(data, rows, period, 'opened').values;
    const human = weekly(data, rows, period, 'reviews').values['human'] as number[];
    const people = weekly(data, rows, period, 'reviewers').values['reviewers'] as number[];
    const nd = o['not-disclosed'] as number[];
    const d = o['disclosed'] as number[];
    expect(cells(figure(TITLES[0]!))).toEqual(
      nd.map((n, i) => [n, d[i] as number, n + (d[i] as number), human[i] as number, people[i] as number].map(String)),
    );
  });

  it('draws the human and bot reviews the library counts', async () => {
    render(App, (await fixturePage('')).props);
    const r = weekly(data, rows, period, 'reviews').values;
    const human = r['human'] as number[];
    const bot = r['bot'] as number[];
    expect(cells(figure(TITLES[1]!))).toEqual(human.map((h, i) => [h, bot[i] as number, h + (bot[i] as number)].map(String)));
  });

  it('draws the merge curve of the PRs opened in the period', async () => {
    render(App, (await fixturePage('')).props);
    const curve = outcomeCurve(data, opened, 'merge');
    const f = figure('Time to merge');
    const milestones = [1 / 24, 1, 2, 7, 14, 30, 60, 90, curve.days.at(-1) as number];
    expect(cells(f)).toEqual(milestones.map((m) => sharesAt(curve, m).map(formatShare)));
    expect(f.textContent).toContain('Median 48 days');
    // Four of seven merged, two still open: nine in ten can no longer merge.
    expect(f.textContent).toContain('90th percentile not reached: 57% merged');
  });

  it('draws the waits by week opened, telling "not yet known" from "not reached" and from no PRs', async () => {
    render(App, (await fixturePage('')).props);
    const w = weekly(data, rows, period, { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] }).values;
    const f = figure('Wait to merge, by week opened');
    const rowsOf = cells(f);
    const known = (w['0.5'] ?? []).flatMap((q, i) => (q.state === 'known' ? [[i, formatDays(q.days)] as const] : []));
    for (const [i, text] of known) expect(rowsOf[i]?.[0]).toBe(text);
    expect(rowsOf[3]?.[0]).toBe('not yet known');
    expect(rowsOf[1]?.[1]).toBe('not reached: 50% merged');
    expect(rowsOf[0]?.[0]).toBe('no PRs opened');
    expect(f.querySelectorAll('.unreached').length).toBeGreaterThan(0);
    expect(within(f).getByRole('list', { name: 'Legend' }).textContent).toMatch(/not yet known.*not reached/);
    expect(f.querySelector('.visually-hidden')?.textContent).toMatch(
      /No PRs opened in 21 weeks\. Partial: week of 2026-05-11, partial: 3 of 7 days; week of 2026-11-09, partial: 6 of 7 days\.$/,
    );
  });

  it('draws the bot commands by command, with their use', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure('Bot commands per week, by command');
    const jenkins = weekly(data, rows, period, 'commands').values['jenkins-test'] as number[];
    expect(cells(f).map((r) => r[0])).toEqual(jenkins.map(String));
    expect(f.querySelectorAll('.command')).toHaveLength(1);
    expect(within(f).queryByRole('button', { name: /^show / })).toBeNull();
    expect(f.textContent).toContain('jenkins test');
    expect(f.textContent).toMatch(/PRs opened in the period with a bot command\s*14%/);
    expect(f.textContent).toMatch(/bot commands on merged PRs\s*mean 0\.3 · median 0 · 90th percentile 1/);
  });

  it('shows the six busiest commands, ties by name, and the rest behind a control a keyboard reaches', async () => {
    render(App, (await fixturePage('', manyCommands())).props);
    const f = figure('Bot commands per week, by command');
    const names = () => [...f.querySelectorAll('.command-name')].map((p) => p.textContent);
    // Seven commands used once each: by name.
    expect(names()).toEqual(['eta', 'iota', 'jenkins test', 'kappa', 'lambda', 'theta']);
    const more = within(f).getByRole('button', { name: 'show all 7 commands' });
    expect(more.tagName).toBe('BUTTON');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    // The table and the text alternative cover every command, shown or not.
    expect(within(f).getAllByRole('columnheader').map((h) => h.textContent)).toContain('zeta');
    expect(f.querySelector('.visually-hidden')?.textContent).toContain('1 zeta');
    await fireEvent.click(more);
    expect(names()).toHaveLength(7);
    expect(within(f).getByRole('button', { name: 'show the 6 busiest commands' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('stacks PRs opened, human reviews and people reviewing in three panels, each on its own scale', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure(TITLES[0]!);
    const panels = [...f.querySelectorAll('.plot-panel')];
    expect(panels.map((p) => [p.querySelectorAll('.bar').length > 0, p.querySelectorAll('.line').length])).toEqual([
      [true, 0],
      [false, 1],
      [false, 1],
    ]);
    expect([...f.querySelectorAll('.axis-y .unit')].map((u) => u.textContent)).toEqual([
      'PRs opened per week',
      'human reviews per week',
      'people reviewing per week',
    ]);
  });

  it('says how many people did the reviews when there were ten or fewer, with no names', async () => {
    render(App, (await fixturePage('')).props);
    expect(reviewLoad(data, rows, period, 10)).toEqual({ reviewers: 4, share: 1 });
    expect(section().getByText('4 people did all of the human reviews in this period.')).toBeTruthy();
  });

  it('names the first span for backports when only other branches are selected', async () => {
    render(App, (await fixturePage('#/?target=backports')).props);
    expect(figure('Original work to backport opened')).toBeTruthy();
    expect(figure('Original work to backport opened, by week opened')).toBeTruthy();
  });

  it('keeps the plain title with every branch selected, and notes what a backport\'s first commit is', async () => {
    render(App, (await fixturePage('#/?target=all')).props);
    const f = figure('First commit to opened');
    expect(f.textContent).toContain('For a backport, the first commit is the original work’s');
    expect(figure('First commit to opened, by week opened').textContent).toContain('For a backport');
  });

  it('says what is missing, not "no PRs match", when PRs match but none was opened in the period', async () => {
    // Only PRs opened earlier are active in 2026-11-12 to 2026-11-15.
    render(App, (await fixturePage('#/?from=2026-11-12&to=2026-11-15')).props);
    expect(rows.length).toBeGreaterThan(0);
    const f = figure('Time to merge');
    expect(f.textContent).toContain('no PR was opened in this period');
    expect(f.textContent).not.toContain('no PRs match');
    expect(figure('Wait to merge, by week opened').textContent).toContain('no PR was opened in this period');
  });

  it('marks the weeks the period and the fetch cut short in the count charts', async () => {
    render(App, (await fixturePage('')).props);
    for (const name of [TITLES[0]!, TITLES[1]!, 'Bot commands per week, by command']) {
      const heads = within(figure(name))
        .getAllByRole('rowheader')
        .map((h) => h.textContent);
      expect(heads[0]).toBe('week of 2026-05-11, partial: 3 of 7 days');
      expect(heads.at(-1)).toBe('week of 2026-11-09, partial: 6 of 7 days');
    }
  });

  it('keeps the disclosure colours for disclosure alone', async () => {
    render(App, (await fixturePage('')).props);
    const marks = [...screen.getByRole('region', { name: 'Review' }).querySelectorAll<SVGElement>('.bar, .line, .marker')];
    const disclosure = marks.filter((m) => /var\(--series-[12]\)/.test(m.getAttribute('style') ?? ''));
    expect(disclosure.length).toBeGreaterThan(0);
    for (const m of disclosure) {
      expect(m.closest('figure')?.querySelector('h3')?.textContent).toBe(TITLES[0]);
      expect(m.classList.contains('bar')).toBe(true);
    }
  });

  it('says "no PRs match" in every chart when the selection is empty', async () => {
    render(App, (await fixturePage('#/?component=cephfs&kind=docs')).props);
    for (const name of TITLES) {
      const f = figure(name);
      expect(f.textContent).toContain('no PRs match');
      expect(f.querySelector('svg')).toBeNull();
    }
    expect(section().queryByText(/busiest reviewers/)).toBeNull();
  });

  it('writes a week opened, chosen in a wait chart, to the URL', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const f = figure('Wait to merge, by week opened');
    await fireEvent.click(within(f).getByRole('button', { name: /^week of 2026-07-06:/ }));
    expect(loc.hash()).toBe('#/?target=main&week=2026-07-06');
  });
});
