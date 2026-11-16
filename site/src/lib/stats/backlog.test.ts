import { describe, expect, it } from 'vitest';
import { DAY } from '../filters';
import { backlog } from './backlog';
import { all, at, dataset } from './testing';

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
