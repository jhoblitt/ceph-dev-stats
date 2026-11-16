import { describe, expect, it } from 'vitest';
import { DAY } from './filters';
import { LANE_CAP, byOpening, describeLanes, laneAt, laneModel, laneScale, lanePitch, lanesLine } from './lanes';
import { HOUR } from './plot';
import { META, all, at, dataset, fixture } from './stats/testing';

const T0 = at('2026-06-01T00:00:00Z');

describe('byOpening', () => {
  it('puts the newest opened first, ties by the higher number', () => {
    const data = dataset([
      { number: 1, created: T0 },
      { number: 2, created: T0 + DAY },
      { number: 3, created: T0 },
    ]);
    expect(byOpening(data, all(data))).toEqual([1, 2, 0]);
  });
});

describe('laneModel', () => {
  it('draws at most 200 lanes, in the order given, and counts the rest', () => {
    const data = dataset(Array.from({ length: 250 }, (_, i) => ({ number: 1000 + i, created: T0 + i * 3600 })));
    const order = byOpening(data, all(data));
    const { lanes, total } = laneModel(data, order);
    expect(LANE_CAP).toBe(200);
    expect(total).toBe(250);
    expect(lanes).toHaveLength(200);
    expect(lanes[0]?.number).toBe(1249);
    expect(lanes.at(-1)?.number).toBe(1050);
  });

  it('keeps a lane all of a PR the line needs', () => {
    const data = dataset(
      [{ number: 70000, created: T0, first_commit: T0 - 2 * DAY, state: 1, closed: T0 + 9 * DAY, reopened: 1 }],
      [
        { pr: 0, at: T0 + DAY, kind: 'comment_other' },
        { pr: 0, at: T0 + 2 * DAY, kind: 'review_approved' },
        { pr: 0, at: T0 + 3 * DAY, kind: 'closed' },
        { pr: 0, at: T0 + 5 * DAY, kind: 'reopened' },
        { pr: 0, at: T0 + 6 * DAY, kind: 'force_push' },
        { pr: 0, at: T0 + 7 * DAY, kind: 'command_author', sub: 0 },
        { pr: 0, at: T0 + 9 * DAY, kind: 'merged' },
      ],
    );
    expect(laneModel(data, [0]).lanes[0]).toEqual({
      row: 0,
      number: 70000,
      created: T0,
      firstCommit: T0 - 2 * DAY,
      end: T0 + 9 * DAY,
      state: 'merged',
      closed: [{ from: T0 + 3 * DAY, to: T0 + 5 * DAY }],
      activity: [T0 + DAY, T0 + 7 * DAY],
      approvals: [T0 + 2 * DAY],
      reopened: 1,
    });
  });

  it('runs an open PR to the last fetch, and leaves off a first commit after the opening', () => {
    const data = dataset([{ number: 70000, created: T0, first_commit: -1 }]);
    expect(laneModel(data, [0]).lanes[0]).toMatchObject({ state: 'open', end: META.fetched_through, firstCommit: null });
  });
});

describe('laneScale', () => {
  const data = dataset([
    { number: 1, created: T0, state: 1, closed: T0 + 10 * DAY },
    { number: 2, created: T0 + 5 * DAY, state: 2, closed: T0 + 105 * DAY },
  ]);
  const { lanes } = laneModel(data, [0, 1]);
  const [a, b] = lanes as [NonNullable<(typeof lanes)[0]>, NonNullable<(typeof lanes)[1]>];

  it('runs the calendar from the period’s start to the last lane’s end, clamping what came before', () => {
    // 104 days from the period's start to #2's close, at 10 pixels a day.
    const scale = laneScale('calendar', lanes, 1040, { start: T0 + DAY, end: T0 + 100 * DAY });
    expect(scale.x(a, T0 + DAY)).toBe(0);
    expect(scale.x(a, T0)).toBe(0);
    expect(scale.x(a, T0 + 51 * DAY)).toBeCloseTo(500, 6);
    // #2 ran on past the period, to its close.
    expect(scale.x(b, T0 + 105 * DAY)).toBeCloseTo(1040, 6);
    expect(scale.ticks.length).toBeGreaterThan(1);
  });

  it('gives the hour of a tick within a day', () => {
    const short = laneModel(dataset([{ number: 1, created: T0, state: 1, closed: T0 + 2 * DAY }]), [0]).lanes;
    const labels = laneScale('calendar', short, 1000, { start: T0, end: T0 + 100 * DAY }).ticks.map((t) => t.label);
    expect(labels).toEqual(['1 Jun 2026', '06:00', '12:00', '18:00', '2 Jun', '06:00', '12:00', '18:00', '3 Jun']);
  });

  it('narrows the calendar to the lanes when they take only part of the period', () => {
    const scale = laneScale('calendar', lanes, 1000, { start: T0 - 100 * DAY, end: T0 + 200 * DAY });
    expect(scale.x(a, T0)).toBe(0);
    expect(scale.x(b, T0 + 105 * DAY)).toBe(1000);
    expect(scale.x(a, T0 + 52.5 * DAY)).toBeCloseTo(500, 6);
  });

  it('sets every lane at its opening on the page’s log duration scale, from an hour to the longest', () => {
    const scale = laneScale('sinceOpening', lanes, 1000, { start: T0, end: T0 + 100 * DAY });
    expect(scale.x(a, a.created)).toBe(0);
    expect(scale.x(b, b.created + HOUR * DAY)).toBe(0);
    expect(scale.x(b, b.created + 100 * DAY)).toBeCloseTo(1000, 6);
    // Log scale: a day is as far from an hour as 24 days are from a day.
    const day = scale.x(a, a.created + DAY) as number;
    expect(scale.x(a, a.created + 24 * DAY)).toBeCloseTo(2 * day, 6);
    expect(scale.x(a, a.created - DAY)).toBeNull();
    expect(scale.ticks.map((t) => t.label)).toEqual(['1 hour', '1 day', '1 week', '1 month', '3 months']);
  });
});

describe('lanePitch and laneAt', () => {
  it('draws few lanes taller than many', () => {
    expect(lanePitch(10)).toBeGreaterThan(lanePitch(200));
    expect(lanePitch(200) * 200).toBeLessThanOrEqual(1200);
  });

  it('finds the lane under a point, or none', () => {
    expect(laneAt(0, 6, 3)).toBe(0);
    expect(laneAt(17.9, 6, 3)).toBe(2);
    expect(laneAt(18, 6, 3)).toBeNull();
    expect(laneAt(-1, 6, 3)).toBeNull();
  });
});

describe('describeLanes and lanesLine', () => {
  it('says what the lanes show', () => {
    const data = fixture();
    const order = byOpening(data, all(data));
    const { lanes, total } = laneModel(data, order);
    expect(describeLanes(lanes, total, 'newest opened first')).toBe(
      'The timelines of 12 PRs, one per row, newest opened first: from #67250, opened 10 Nov 2026, to #64010, opened 3 Nov 2025. ' +
        '6 merged, 1 closed unmerged, 5 still open; 1 was closed and reopened.',
    );
  });

  it('says which PRs the lanes show, how many and in what order, whatever their count', () => {
    const order = 'in the PR table’s order, by Opened, descending';
    expect(lanesLine(200, 4279, 'open at some point in the period', order, true)).toBe(
      'The 200 most recently opened of 4,279 PRs open at some point in the period, in the PR table’s order, by Opened, descending.',
    );
    expect(lanesLine(200, 4279, 'open at some point in the period', 'in the PR table’s order, by Size, descending', false)).toBe(
      'The first 200 in the PR table’s order, by Size, descending, of 4,279 PRs open at some point in the period.',
    );
    expect(lanesLine(12, 12, 'open at some point in the period', order, true)).toBe(
      '12 PRs open at some point in the period, in the PR table’s order, by Opened, descending.',
    );
    expect(lanesLine(1, 1, 'opened in the week of 2026-05-18', order, true)).toBe(
      '1 PR opened in the week of 2026-05-18, in the PR table’s order, by Opened, descending.',
    );
  });
});
