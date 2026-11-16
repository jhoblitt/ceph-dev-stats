import { describe, expect, it } from 'vitest';
import type { Dataset } from '../data';
import { AGE_BANDS, DAY, dayOf, periodRange } from '../filters';
import { defaultFilters } from '../state';
import { backlog, backlogMoment, backlogRows } from './backlog';
import type { Period } from './buckets';
import { type Event, type Row, all, at, dataset, fixture, random } from './testing';

const MERGED = 1;
const W1 = at('2026-06-01T00:00:00Z');
const NOW = at('2026-07-20T00:00:00Z');

function total(b: ReturnType<typeof backlog>): number[] {
  return b.week.map((_, i) => Object.values(b.bands).reduce((n, band) => n + (band[i] as number), 0));
}

describe('backlog', () => {
  it('leaves a PR out while it is closed, from its closed event to its reopened event', () => {
    // Opened in week 1, closed in week 2, reopened in week 4, still open.
    const data = dataset(
      [{ created: at('2026-06-02T00:00:00Z'), reopened: 1 }],
      [
        { pr: 0, at: at('2026-06-10T00:00:00Z'), kind: 'closed' },
        { pr: 0, at: at('2026-06-24T00:00:00Z'), kind: 'reopened' },
      ],
      { fetched_through: NOW },
    );
    const b = backlog(data, all(data), { start: W1, end: W1 + 42 * DAY });
    expect(b.week).toHaveLength(6);
    expect(total(b)).toEqual([1, 0, 0, 1, 1, 1]);
    expect(b.bands).toEqual({
      lt7: [1, 0, 0, 0, 0, 0],
      '7-30': [0, 0, 0, 1, 0, 0],
      '30-90': [0, 0, 0, 0, 1, 1],
      gt90: [0, 0, 0, 0, 0, 0],
    });
  });

  it('ends a reopened PR at its final disposition', () => {
    const data = dataset(
      [{ created: W1 + DAY, reopened: 1, state: MERGED, closed: at('2026-06-17T00:00:00Z') }],
      [
        { pr: 0, at: W1 + 2 * DAY, kind: 'closed' },
        { pr: 0, at: W1 + 3 * DAY, kind: 'reopened' },
        { pr: 0, at: at('2026-06-17T00:00:00Z'), kind: 'merged' },
      ],
      { fetched_through: NOW },
    );
    expect(total(backlog(data, all(data), { start: W1, end: W1 + 21 * DAY }))).toEqual([1, 1, 0]);
  });

  it('counts the PRs open at each week end in age bands, by age since opening', () => {
    const data = dataset(
      [
        { created: at('2026-06-03T00:00:00Z') },
        { created: at('2026-01-01T00:00:00Z'), in_window: 0 },
        { created: W1, state: MERGED, closed: at('2026-06-20T00:00:00Z') },
        { created: at('2026-06-08T00:00:00Z') },
      ],
      [],
      { fetched_through: NOW },
    );
    const b = backlog(data, all(data), { start: W1, end: W1 + 21 * DAY });
    expect(b.week).toEqual([W1, W1 + 7 * DAY, W1 + 14 * DAY]);
    expect(b.step).toBe('week');
    expect(b.bands).toEqual({
      lt7: [1, 0, 0],
      '7-30': [1, 3, 2],
      '30-90': [0, 0, 0],
      gt90: [1, 1, 1],
    });
  });

  it('measures the last week as of fetched_through when that comes first', () => {
    // Age 29 days on 2026-06-17, when the data was fetched; 34 at the week's end.
    const data = dataset([{ created: at('2026-05-19T00:00:00Z') }], [], {
      fetched_through: at('2026-06-17T00:00:00Z'),
    });
    const b = backlog(data, all(data), { start: W1, end: W1 + 21 * DAY });
    expect(b.bands['7-30']).toEqual([1, 1, 1]);
    expect(b.bands['30-90']).toEqual([0, 0, 0]);
  });

  it('counts only the rows selected', () => {
    const data = dataset([{ created: W1 }, { created: W1 }], [], { fetched_through: NOW });
    expect(total(backlog(data, Uint32Array.of(0), { start: W1, end: W1 + 7 * DAY }))).toEqual([1]);
  });

  it('gives an empty backlog for an empty selection', () => {
    const data = dataset([{ created: W1 }], [], { fetched_through: NOW });
    const b = backlog(data, new Uint32Array(0), { start: W1, end: W1 + 21 * DAY });
    expect(b.week).toEqual([]);
    expect(b.bands).toEqual({ lt7: [], '7-30': [], '30-90': [], gt90: [] });
  });
});

/** Every band of every bucket: the rows behind it are as many as the bar says. */
function expectAgreement(data: Dataset, period: Period) {
  const b = backlog(data, all(data), period);
  expect(b.week.length).toBeGreaterThan(1);
  b.week.forEach((week, i) => {
    const moment = backlogMoment(data, period, week);
    for (const band of AGE_BANDS) {
      const rows = backlogRows(data, all(data), band.id, moment);
      expect(rows.length, `${dayOf(week)} ${band.id}`).toBe(b.bands[band.id][i]);
    }
  });
}

describe('backlogMoment', () => {
  const data = dataset([{ created: W1 }], [], { fetched_through: NOW });

  it('is the bucket end, cut short by the period end or fetched_through', () => {
    const period = { start: W1, end: W1 + 18 * DAY };
    expect(backlogMoment(data, period, W1)).toBe(W1 + 7 * DAY);
    expect(backlogMoment(data, period, W1 + 14 * DAY)).toBe(W1 + 18 * DAY);
    const late = { start: at('2026-07-13T00:00:00Z'), end: at('2026-07-21T00:00:00Z') };
    expect(backlogMoment(data, late, at('2026-07-20T00:00:00Z'))).toBe(NOW);
  });
});

describe('backlogRows', () => {
  const fx = fixture();
  const now = fx.meta.fetched_through;
  const defaultPeriod = periodRange(defaultFilters(fx.meta));
  const earlyPeriod = periodRange({ ...defaultFilters(fx.meta), to: '2026-09-30' });

  it('gives the selected PRs open at an instant in an age band', () => {
    // Open on 2026-11-15 06:00: #65220, #66100, #66600 and #66700, each over
    // 150 days old, and #67250, opened 4.6 days before.
    expect([...backlogRows(fx, all(fx), 'gt90', now)]).toEqual([1, 2, 5, 6]);
    expect([...backlogRows(fx, all(fx), 'lt7', now)]).toEqual([11]);
    expect([...backlogRows(fx, all(fx), '7-30', now)]).toEqual([]);
    expect([...backlogRows(fx, Uint32Array.of(1, 5, 11), 'gt90', now)]).toEqual([1, 5]);
  });

  it('measures the default period last bucket at fetched_through', () => {
    const b = backlog(fx, all(fx), defaultPeriod);
    expect(backlogMoment(fx, defaultPeriod, b.week.at(-1) as number)).toBe(now);
  });

  it('agrees with every bar of the backlog over the default period', () => {
    expectAgreement(fx, defaultPeriod);
  });

  it('agrees with every bar of the backlog over a period ending before fetched_through', () => {
    expectAgreement(fx, earlyPeriod);
  });

  it('keeps a PR closed after the period ends in the bands of its last bar', () => {
    // Both opened 2026-06-03; one merged 2026-07-01, after the period and
    // before the data was fetched.
    const opened = at('2026-06-03T00:00:00Z');
    const data = dataset(
      [{ created: opened, state: MERGED, closed: at('2026-07-01T00:00:00Z') }, { created: opened }],
      [],
      { fetched_through: NOW },
    );
    const period = { start: W1, end: W1 + 21 * DAY };
    const b = backlog(data, all(data), period);
    expect(b.bands['7-30'][2]).toBe(2);
    expect([...backlogRows(data, all(data), '7-30', backlogMoment(data, period, W1 + 14 * DAY))]).toEqual([0, 1]);
    // An earlier bucket: both 5 days old on 2026-06-08.
    expect([...backlogRows(data, all(data), 'lt7', backlogMoment(data, period, W1))]).toEqual([0, 1]);
    // At fetched_through only the open one is left, 47 days old.
    expect([...backlogRows(data, all(data), '30-90', NOW)]).toEqual([1]);
  });

  it('leaves out a PR inside a closed stretch, keeps one reopened, and puts exactly 7 days in 7–30', () => {
    const data = dataset(
      [
        { created: NOW - 40 * DAY, reopened: 1 },
        { created: NOW - 40 * DAY, reopened: 1 },
        { created: NOW - 7 * DAY },
        { created: NOW - 7 * DAY + 1 },
      ],
      [
        { pr: 0, at: NOW - 3 * DAY, kind: 'closed' },
        { pr: 1, at: NOW - 3 * DAY, kind: 'closed' },
        { pr: 1, at: NOW - 2 * DAY, kind: 'reopened' },
      ],
      { fetched_through: NOW },
    );
    expect([...backlogRows(data, all(data), '30-90', NOW)]).toEqual([1]);
    expect([...backlogRows(data, all(data), '7-30', NOW)]).toEqual([2]);
    expect([...backlogRows(data, all(data), 'lt7', NOW)]).toEqual([3]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i: agrees with every bar on random rows', (seed) => {
    const rnd = random(seed);
    const fetched = at('2026-11-15T06:00:00Z');
    const rows: Row[] = [];
    const events: Event[] = [];
    for (let r = 0; r < 200; r++) {
      const created = fetched - Math.floor(rnd() * 150 * DAY);
      const state = Math.floor(rnd() * 3);
      const reopened = rnd() < 0.2 ? 1 : 0;
      const closed = state === 0 ? -1 : created + Math.floor(rnd() * (fetched - created));
      rows.push({ created, state, closed, reopened });
      if (reopened) {
        const shut = created + Math.floor(rnd() * (fetched - created));
        events.push({ pr: r, at: shut, kind: 'closed' });
        if (rnd() < 0.5) events.push({ pr: r, at: shut + Math.floor(rnd() * (fetched - shut)), kind: 'reopened' });
      }
    }
    const data = dataset(rows, events, { fetched_through: fetched });
    expectAgreement(data, periodRange(defaultFilters(data.meta)));
    expectAgreement(data, periodRange({ ...defaultFilters(data.meta), to: '2026-09-30' }));
  });

  it('gives no rows for an empty selection', () => {
    expect([...backlogRows(fx, new Uint32Array(0), 'gt90', now)]).toEqual([]);
  });
});
