import { describe, expect, it } from 'vitest';
import table2025 from '../__fixtures__/data/table-2025.json';
import table2026 from '../__fixtures__/data/table-2026.json';
import { type TableYear, parseTable, parseYear } from '../data';
import prs2025 from '../__fixtures__/data/prs-2025.json';
import prs2026 from '../__fixtures__/data/prs-2026.json';
import events2025 from '../__fixtures__/data/events-2025.json';
import events2026 from '../__fixtures__/data/events-2026.json';
import { META, at, dataset, fixture } from '../stats/testing';
import {
  baseRows,
  commentCounts,
  coverage,
  disclosureForms,
  eventRefs,
  familyCounts,
  firstCommitUnknown,
  kindSources,
  kindUnknown,
  neverReady,
  noCommits,
  standingUnknown,
  windowPeriod,
} from './figures';

// The fixture's rows: 0 #64010 and 1 #65220 opened in 2025, before the
// window; 2 #66100 opened in 2026 before the window; 3–11 opened in it.
// Rows 1 (reef), 7 (squid) and 11 (tentacle) are not on main. Its window
// is 2026-05-15 to 2026-11-15, the day fetched_through falls on.
const data = fixture();
const rows = baseRows(data);

function fixtureTables(): Map<number, TableYear> {
  const y2025 = parseYear(2025, prs2025, events2025, META);
  const y2026 = parseYear(2026, prs2026, events2026, META);
  return new Map([
    [2025, parseTable(table2025, 'table-2025.json', y2025, META)],
    [2026, parseTable(table2026, 'table-2026.json', y2026, META)],
  ]);
}

const START = at('2026-05-15T00:00:00Z');
const END = at('2026-11-16T00:00:00Z');

describe('windowPeriod', () => {
  it('runs from the window start to the end of the day the data runs to', () => {
    expect(windowPeriod(META)).toEqual({ start: START, end: END });
  });
});

describe('baseRows', () => {
  it('keeps every PR open at some point in the window, on every branch', () => {
    expect([...rows]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('leaves out a PR finished before the window and one opened after the data ends', () => {
    const d = dataset([
      { created: at('2026-01-01T00:00:00Z'), closed: at('2026-05-14T23:59:59Z'), state: 1 },
      { created: at('2026-01-01T00:00:00Z'), closed: START, state: 2 },
      { created: at('2026-11-16T00:00:00Z') },
    ]);
    expect([...baseRows(d)]).toEqual([1]);
  });
});

describe('coverage', () => {
  it('counts the records, those open in the window and those opened in it', () => {
    expect(coverage(data, rows)).toEqual({ records: 12, active: 12, openedInWindow: 9, closedBeforeWindow: 0 });
  });

  it('counts a PR finished before the window apart', () => {
    const d = dataset([
      { created: at('2026-01-01T00:00:00Z'), closed: at('2026-02-01T00:00:00Z'), state: 1, in_window: 0 },
      { created: at('2026-01-01T00:00:00Z'), in_window: 0 },
      { created: at('2026-06-01T00:00:00Z') },
    ]);
    expect(coverage(d, baseRows(d))).toEqual({ records: 3, active: 2, openedInWindow: 1, closedBeforeWindow: 1 });
  });
});

describe('neverReady', () => {
  it('counts the drafts never made ready, by target', () => {
    expect(neverReady(data, rows)).toEqual({ main: 1, other: 0 });
  });
});

describe('firstCommitUnknown', () => {
  it('counts the PRs with commits whose first commit is unknown', () => {
    expect(firstCommitUnknown(data, rows)).toEqual({ main: 1, other: 0 });
  });

  it('does not count a PR with no commits', () => {
    const d = dataset([{ created: START, commits: 0 }, { created: START, commits: 2 }]);
    expect(firstCommitUnknown(d, baseRows(d))).toEqual({ main: 1, other: 0 });
  });
});

describe('noCommits', () => {
  it('counts the PRs with no commits, by target', () => {
    expect(noCommits(data, rows)).toEqual({ main: 0, other: 0 });
    const d = dataset([{ created: START, commits: 0 }, { created: START, commits: 0, base: 1 }, { created: START }]);
    expect(noCommits(d, baseRows(d))).toEqual({ main: 1, other: 1 });
  });
});

describe('standingUnknown', () => {
  it('counts unknown standing, and how many of those PRs were opened before the window', () => {
    expect(standingUnknown(data, rows)).toEqual({ unknown: 3, openedBefore: 3 });
  });

  it('tells an unknown standing inside the window from one before it', () => {
    const d = dataset([
      { created: START, standing: -1 },
      { created: START, standing: 4 },
      { created: at('2026-01-01T00:00:00Z'), in_window: 0, standing: -1 },
    ]);
    expect(standingUnknown(d, baseRows(d))).toEqual({ unknown: 2, openedBefore: 1 });
  });
});

describe('kindUnknown', () => {
  it('counts the PRs of unknown kind, by target', () => {
    expect(kindUnknown(data, rows)).toEqual({ main: 0, other: 1 });
  });
});

describe('disclosureForms', () => {
  it('counts each form of disclosure, and none, by target', () => {
    expect(disclosureForms(data, rows)).toEqual({
      none: { main: 6, other: 2 },
      description: { main: 0, other: 1 },
      coauthor: { main: 1, other: 0 },
      trailer: { main: 2, other: 0 },
    });
  });
});

describe('familyCounts', () => {
  it('counts the PRs naming each tool family, in meta order', () => {
    expect(familyCounts(data, rows)).toEqual([
      { id: 'claude', name: 'Claude', count: { main: 2, other: 0 } },
      { id: 'copilot', name: 'GitHub Copilot', count: { main: 1, other: 0 } },
      { id: 'unspecified', name: 'unspecified', count: { main: 0, other: 1 } },
    ]);
  });
});

describe('commentCounts', () => {
  it('counts the comments made in the window and the bot commands among them', () => {
    // Two of 2025's comments are from before the window: a comment by
    // another person on #64010 and a bot account's on #65220.
    expect(commentCounts(data, rows)).toEqual({ comments: 11, commands: 3, commandsByAuthor: 2, botAccount: 1 });
  });

  it('counts no comment for a selection without events', () => {
    const d = dataset([{ created: START }]);
    expect(commentCounts(d, baseRows(d))).toEqual({ comments: 0, commands: 0, commandsByAuthor: 0, botAccount: 0 });
  });
});

describe('kindSources', () => {
  it('counts the PRs each source of kind decided, and the unknown, by target', () => {
    expect(kindSources(data, fixtureTables(), rows)).toEqual({
      checklist: { main: 4, other: 0 },
      tracker: { main: 2, other: 0 },
      labels: { main: 3, other: 1 },
      original: { main: 0, other: 1 },
      unknown: { main: 0, other: 1 },
    });
  });

  it('throws when a year it needs has no table', () => {
    const tables = fixtureTables();
    tables.delete(2025);
    expect(() => kindSources(data, tables, rows)).toThrow(/2025/);
  });
});

describe('eventRefs', () => {
  it('counts each kind of event in the window, and those with nothing to link to', () => {
    const byKind = Object.fromEntries(eventRefs(data, fixtureTables(), rows).map((r) => [r.kind, r]));
    expect(byKind['force_push']).toEqual({ kind: 'force_push', events: 7, missing: 0 });
    expect(byKind['reopened']).toEqual({ kind: 'reopened', events: 1, missing: 1 });
    expect(byKind['bot_account']).toEqual({ kind: 'bot_account', events: 1, missing: 1 });
    expect(byKind['merged']).toEqual({ kind: 'merged', events: 6, missing: 0 });
    expect(byKind['comment_other']).toEqual({ kind: 'comment_other', events: 5, missing: 0 });
  });

  it('lists the kinds in meta order and leaves out a kind with no event', () => {
    const kinds = eventRefs(data, fixtureTables(), rows).map((r) => r.kind);
    expect(kinds).toEqual([
      'comment_other',
      'comment_author',
      'command_author',
      'command_other',
      'bot_account',
      'review_approved',
      'review_changes',
      'review_commented',
      'bot_review',
      'ready',
      'force_push',
      'closed',
      'reopened',
      'merged',
    ]);
  });

  it('counts a force-push without a commit as missing', () => {
    const d = dataset(
      [{ created: START }],
      [
        { pr: 0, at: START + 10, kind: 'force_push' },
        { pr: 0, at: START + 20, kind: 'force_push' },
        { pr: 0, at: START - 10, kind: 'force_push' },
      ],
    );
    const table: TableYear = {
      titles: ['t'],
      authors: ['a'],
      commits: [[]],
      refs: ['', '', '0123456789012345678901234567890123456789'],
      tickets: [[]],
      backport_of: [0],
      kind_source: [''],
    };
    // The events sort by time: the one before the window holds the empty
    // first ref and is not counted.
    expect(eventRefs(d, new Map([[2026, table]]), baseRows(d))).toEqual([
      { kind: 'force_push', events: 2, missing: 1 },
    ]);
  });
});
