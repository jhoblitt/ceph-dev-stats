import { describe, expect, it } from 'vitest';
import events2025 from '../__fixtures__/data/events-2025.json';
import events2026 from '../__fixtures__/data/events-2026.json';
import prs2025 from '../__fixtures__/data/prs-2025.json';
import prs2026 from '../__fixtures__/data/prs-2026.json';
import table2025 from '../__fixtures__/data/table-2025.json';
import table2026 from '../__fixtures__/data/table-2026.json';
import { parseTable, parseYear } from '../data';
import { META, fixture } from '../stats/testing';
import {
  type DataFigures,
  INLINE_FIGURES,
  type Loadable,
  TABLE_FIGURES,
  type TableFigures,
  dataFigures,
  inlineView,
  tableFigures,
  tableView,
} from './present';

const data = fixture();
const tables = new Map([
  [2025, parseTable(table2025, 'table-2025.json', parseYear(2025, prs2025, events2025, META), META)],
  [2026, parseTable(table2026, 'table-2026.json', parseYear(2026, prs2026, events2026, META), META)],
]);
const d: Loadable<DataFigures> = { state: 'ready', value: dataFigures(data) };
const t: Loadable<TableFigures> = { state: 'ready', value: tableFigures(data, tables) };
const loading = { state: 'loading' } as const;
const failed = { state: 'error', message: 'prs-2026.json: HTTP 404' } as const;

const value = (name: string) => {
  const v = inlineView(name, META, d, t);
  if (v.state !== 'ready') throw new Error(`${name} is ${v.state}`);
  return v.value;
};

describe('inline figures on the fixture', () => {
  it.each([
    ['asOf', '2026-11-15'],
    ['windowStart', '2026-05-15'],
    ['prs.records', '12'],
    ['prs.active', '12'],
    ['prs.openedInWindow', '9'],
    ['prs.openedBeforeWindow', '3'],
    ['prs.closedBeforeWindow', '0'],
    ['prs.neverReady', '1'],
    ['commits.firstUnknown', '1'],
    ['commits.none', '0'],
    ['standing.unknown', '3'],
    ['standing.unknownBeforeWindow', '3'],
    ['standing.unknownInWindow', '0'],
    ['kind.unknown', '1'],
    // 1 of 12.
    ['kind.unknownShare', '8.3%'],
    // #66500, #66800, #67000 and #67100.
    ['disclosure.disclosed', '4'],
    ['disclosure.share', '33%'],
    ['comments.total', '11'],
    ['comments.commands', '3'],
    // 3 of 11.
    ['comments.commandShare', '27%'],
    ['comments.commandsByAuthor', '2'],
    ['comments.botAccount', '1'],
    ['refs.forcePushes', '7'],
    ['refs.forcePushesWithoutCommit', '0'],
    ['refs.forcePushShareWithoutCommit', '0%'],
    ['refs.merges', '6'],
    ['refs.mergesWithoutCommit', '0'],
  ])('%s is %s', (name, expected) => {
    expect(value(name)).toBe(expected);
  });

  it('has a spec above for every inline figure', () => {
    expect(Object.keys(INLINE_FIGURES).length).toBe(27);
  });
});

describe('figure states', () => {
  it('shows a figure of meta at once', () => {
    expect(inlineView('asOf', META, loading, loading)).toEqual({ state: 'ready', value: '2026-11-15' });
  });

  it('waits for the data, and for the tables when it needs them', () => {
    expect(inlineView('prs.active', META, loading, loading)).toEqual({ state: 'loading' });
    expect(inlineView('prs.active', META, d, loading).state).toBe('ready');
    expect(inlineView('refs.forcePushes', META, d, loading)).toEqual({ state: 'loading' });
  });

  it('fails a figure whose data or tables failed, and no other', () => {
    expect(inlineView('prs.active', META, failed, loading)).toEqual({ state: 'error' });
    expect(inlineView('refs.forcePushes', META, d, failed)).toEqual({ state: 'error' });
    expect(inlineView('prs.active', META, d, failed).state).toBe('ready');
    expect(inlineView('refs.forcePushes', META, failed, loading)).toEqual({ state: 'error' });
  });

  it('throws for a name no figure has', () => {
    expect(() => inlineView('prs.nothing', META, d, t)).toThrow(/no inline figure is named "prs.nothing"/);
    expect(() => tableView('table.nothing', META, d, t)).toThrow(/no table figure is named "table.nothing"/);
  });
});

describe('table figures on the fixture', () => {
  const model = (name: string) => {
    const v = tableView(name, META, d, t);
    if (v.state !== 'ready') throw new Error(`${name} is ${v.state}`);
    return v.value;
  };

  it('has a spec below for every table', () => {
    expect(Object.keys(TABLE_FIGURES)).toEqual([
      'table.kindSources',
      'table.disclosureForms',
      'table.families',
      'table.eventRefs',
    ]);
  });

  it('says where each kind came from, by target', () => {
    expect(model('table.kindSources')).toEqual({
      caption:
        'Where each pull request’s kind came from, of the 12 pull requests open at some point in the window, as of 2026-11-15',
      head: ['decided by', 'main', 'other branches', 'all'],
      rows: [
        ['the PR’s checklist', '4', '0', '4'],
        ['a tracker ticket’s type', '2', '0', '2'],
        ['a kind label', '3', '1', '4'],
        ['the PR it backports', '0', '1', '1'],
        ['unknown: no source decided', '0', '1', '1'],
      ],
    });
  });

  it('lists the forms of disclosure strongest first', () => {
    expect(model('table.disclosureForms').rows).toEqual([
      ['a disclosing trailer, such as Assisted-by:', '2', '0', '2'],
      ['Co-authored-by: naming a tool', '1', '0', '1'],
      ['disclosure phrasing in the description or a commit message', '0', '1', '1'],
      ['not disclosed', '6', '2', '8'],
    ]);
  });

  it('lists the tool families in meta order', () => {
    expect(model('table.families').caption).toBe(
      'Pull requests naming each tool family, of the 12 pull requests open at some point in the window, as of 2026-11-15. A pull request naming two families counts under both.',
    );
    expect(model('table.families').rows).toEqual([
      ['Claude', '2', '0', '2'],
      ['GitHub Copilot', '1', '0', '1'],
      ['unspecified', '0', '1', '1'],
    ]);
  });

  it('counts the events with no address of their own', () => {
    const rows = model('table.eventRefs').rows;
    expect(rows).toContainEqual(['reopened', '1', '1 (100%)']);
    expect(rows).toContainEqual(['a force-push', '7', '0 (0%)']);
    expect(rows).toContainEqual(['a comment by a bot account', '1', '1 (100%)']);
    expect(rows).toHaveLength(14);
  });
});
