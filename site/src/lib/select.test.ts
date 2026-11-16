import { describe, expect, it } from 'vitest';
import events2025 from './__fixtures__/data/events-2025.json';
import events2026 from './__fixtures__/data/events-2026.json';
import rawMeta from './__fixtures__/data/meta.json';
import prs2025 from './__fixtures__/data/prs-2025.json';
import prs2026 from './__fixtures__/data/prs-2026.json';
import { combine, parseMeta, parseYear } from './data';
import { type Filters, dayOf, dayStart, periodRange } from './filters';
import { openedIn, openedInBucket, select } from './select';
import { defaultFilters } from './state';
import { all, at, dataset } from './stats/testing';
import { weekly } from './stats/weekly';

const meta = parseMeta(rawMeta);
const data = combine(meta, [parseYear(2025, prs2025, events2025), parseYear(2026, prs2026, events2026)]);

// Rows in the fixture: 0 #64010, 1 #65220, 2 #66100, 3 #66500, 4 #66510,
// 5 #66600, 6 #66700, 7 #66800, 8 #66900, 9 #67000, 10 #67100, 11 #67250.
const every: Filters = { ...defaultFilters(meta), target: 'all' };
const rows = (patch: Partial<Filters>) => [...select(data, { ...every, ...patch })];

describe('select', () => {
  it('selects every row with every filter at its neutral default, the whole window and all targets', () => {
    expect(rows({})).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('returns row ids in a Uint32Array', () => {
    expect(select(data, every)).toBeInstanceOf(Uint32Array);
  });

  it.each([
    ['target main', { target: 'main' }, [0, 2, 3, 4, 5, 6, 8, 9, 10]],
    ['target backports and other branches', { target: 'backports' }, [1, 7, 11]],
    ['component rgw', { component: 'rgw' }, [0, 3, 7, 9]],
    ['component mgr, one of two on #66900', { component: 'mgr' }, [5, 8, 10]],
    ['size up to 10', { size: 'le10' }, [1, 4]],
    ['size 11–100', { size: '11-100' }, [3, 6, 7, 10, 11]],
    ['size 101–1,000', { size: '101-1000' }, [0, 2, 8]],
    ['size over 1,000', { size: 'gt1000' }, [5, 9]],
    ['standing first PR', { standing: 'first' }, [3]],
    ['standing 1–9', { standing: '1-9' }, [4, 8, 10]],
    ['standing 10–99', { standing: '10-99' }, [5, 6, 11]],
    ['standing 100 or more', { standing: 'ge100' }, [7, 9]],
    ['standing unknown', { standing: 'unknown' }, [0, 1, 2]],
    ['disclosed', { disclosure: 'disclosed' }, [3, 7, 9, 10]],
    ['not disclosed', { disclosure: 'not-disclosed' }, [0, 1, 2, 4, 5, 6, 8, 11]],
    ['drafts excluded', { excludeDrafts: true }, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]],
    ['reopened only', { reopenedOnly: true }, [8]],
    // Opened before August and not finished before July.
    ['period July 2026', { from: '2026-07-01', to: '2026-07-31' }, [1, 2, 5, 6, 7, 8]],
  ] satisfies [string, Partial<Filters>, number[]][])('%s alone', (_name, patch, expected) => {
    expect(rows(patch)).toEqual(expected);
  });

  it('combines filters', () => {
    expect(rows({ target: 'main', disclosure: 'disclosed', size: 'gt1000' })).toEqual([9]);
  });

  it('selects nothing for a component meta does not name', () => {
    expect(rows({ component: 'no-such-component' })).toEqual([]);
  });
});

describe('openedInBucket', () => {
  const period = periodRange(every);
  const selected = select(data, every);
  const day = (d: string) => dayStart(d) as number;

  it('gives the selected rows opened in the window during a week', () => {
    // #66500 opened 2026-05-18 10:00 and #66510 2026-05-20 12:00.
    expect([...openedInBucket(data, selected, period, day('2026-05-18'))]).toEqual([3, 4]);
    expect([...openedInBucket(data, select(data, { ...every, size: 'le10' }), period, day('2026-05-18'))]).toEqual([4]);
  });

  it('agrees with the weekly count of PRs opened, bucket by bucket', () => {
    const opened = weekly(data, selected, period, 'opened');
    expect(opened.week.length).toBeGreaterThan(20);
    opened.week.forEach((week, i) => {
      const count = (opened.values['disclosed']?.[i] ?? 0) + (opened.values['not-disclosed']?.[i] ?? 0);
      expect(openedInBucket(data, selected, period, week).length, dayOf(week)).toBe(count);
    });
  });

  it('gives no rows for a day that does not start a bucket of the period', () => {
    expect([...openedInBucket(data, selected, period, day('2026-05-19'))]).toEqual([]);
    expect([...openedInBucket(data, selected, period, day('2027-01-04'))]).toEqual([]);
  });

  it('takes a month over a period beyond 53 weeks', () => {
    const long = dataset(
      [
        { created: at('2025-05-31T23:59:59Z') },
        { created: at('2025-06-01T00:00:00Z') },
        { created: at('2025-06-30T23:59:59Z'), in_window: 0 },
        { created: at('2025-07-01T00:00:00Z') },
      ],
      [],
    );
    const months = { start: at('2025-05-15T00:00:00Z'), end: at('2026-07-01T00:00:00Z') };
    expect([...openedInBucket(long, all(long), months, at('2025-06-01T00:00:00Z'))]).toEqual([1]);
    expect([...openedInBucket(long, all(long), months, at('2025-06-02T00:00:00Z'))]).toEqual([]);
  });
});

describe('openedIn', () => {
  it('keeps the rows opened in the window during the period', () => {
    const july = { start: Date.UTC(2026, 6, 1) / 1000, end: Date.UTC(2026, 7, 1) / 1000 };
    expect([...openedIn(data, select(data, every), july)]).toEqual([7, 8]);
  });

  it('leaves out the rows opened before the window', () => {
    const all = { start: 0, end: meta.fetched_through };
    expect([...openedIn(data, select(data, every), all)]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
