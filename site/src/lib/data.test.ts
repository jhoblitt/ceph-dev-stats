import { describe, expect, it } from 'vitest';
import events2025 from './__fixtures__/data/events-2025.json';
import events2026 from './__fixtures__/data/events-2026.json';
import rawMeta from './__fixtures__/data/meta.json';
import prs2025 from './__fixtures__/data/prs-2025.json';
import prs2026 from './__fixtures__/data/prs-2026.json';
import table2025 from './__fixtures__/data/table-2025.json';
import table2026 from './__fixtures__/data/table-2026.json';
import { BASE, fixtureFetch } from './__fixtures__/fetch';
import {
  DataError,
  DataLoader,
  combine,
  loadMeta,
  parseEvents,
  parseMeta,
  parsePrs,
  parseTable,
  parseYear,
  yearsFor,
} from './data';

const meta = parseMeta(rawMeta);
const SHA = /^[0-9a-f]{40}$/;

describe('parseMeta', () => {
  it('reads the fixture', () => {
    expect(meta.repo).toBe('ceph/ceph');
    expect(meta.window_start).toBe(Date.UTC(2026, 4, 15) / 1000);
    expect(meta.years).toEqual([2025, 2026]);
    expect(meta.components.map((c) => c.id)).toEqual(['cephfs', 'mgr', 'rbd', 'rgw']);
    expect(meta.disclosure).toEqual(['none', 'description', 'coauthor', 'trailer']);
    expect(meta.kinds).toEqual([
      { id: 'bugfix', name: 'Bug fix' },
      { id: 'feature', name: 'Feature' },
      { id: 'cleanup', name: 'Cleanup' },
      { id: 'docs', name: 'Documentation' },
      { id: 'other', name: 'Other' },
    ]);
  });

  it('rejects a meta without a dictionary, naming the file and the field', () => {
    const { bases: _, ...withoutBases } = rawMeta;
    expect(() => parseMeta(withoutBases)).toThrow(DataError);
    expect(() => parseMeta(withoutBases)).toThrow(/meta\.json.*bases/);
  });

  it('rejects a meta without kinds, or with kinds that are not {id, name}', () => {
    const { kinds: _, ...withoutKinds } = rawMeta;
    expect(() => parseMeta(withoutKinds)).toThrow(/meta\.json.*kinds/);
    expect(() => parseMeta({ ...rawMeta, kinds: ['bugfix'] })).toThrow(/meta\.json.*kinds/);
  });

  it.each(['unknown', 'all'])('rejects a kind whose id is %s, a choice of the Kind filter itself', (id) => {
    const kinds = [...rawMeta.kinds, { id, name: 'Something' }];
    expect(() => parseMeta({ ...rawMeta, kinds })).toThrow(DataError);
    expect(() => parseMeta({ ...rawMeta, kinds })).toThrow(new RegExp(`meta\\.json.*kinds.*"${id}"`));
  });

  it('rejects a time that is not a number', () => {
    expect(() => parseMeta({ ...rawMeta, fetched_through: '2026-11-15T06:00:00Z' })).toThrow(/fetched_through/);
  });
});

describe('parsePrs', () => {
  it('reads the columns into typed arrays', () => {
    const prs = parsePrs(prs2026, 'prs-2026.json', meta);
    expect(prs.number).toBeInstanceOf(Int32Array);
    expect(prs.created).toBeInstanceOf(Float64Array);
    expect([...prs.number]).toEqual(prs2026.number);
    expect([...prs.first_commit]).toEqual(prs2026.first_commit);
    expect(prs.components).toEqual(prs2026.components);
  });

  it('reads the kind column, -1 for unknown', () => {
    const prs = parsePrs(prs2026, 'prs-2026.json', meta);
    expect(prs.kind).toBeInstanceOf(Int32Array);
    expect([...prs.kind]).toEqual([2, 0, 3, 2, 1, 0, 1, 4, 1, 3]);
    expect([...parsePrs(prs2025, 'prs-2025.json', meta).kind]).toEqual([0, -1]);
  });

  it('rejects a year file whose columns differ in length, naming the file and the column', () => {
    const short = { ...prs2026, deletions: prs2026.deletions.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(DataError);
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(/prs-2026\.json.*deletions/);
  });

  it('rejects a ragged column of a different length too', () => {
    const short = { ...prs2026, families: prs2026.families.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(/families/);
  });

  it('rejects a missing column', () => {
    const { standing: _, ...withoutStanding } = prs2026;
    expect(() => parsePrs(withoutStanding, 'prs-2026.json', meta)).toThrow(/standing/);
  });

  it('rejects a value that is not an integer, which would become NaN', () => {
    const bad = { ...prs2026, ready: prs2026.ready.map((v, i) => (i === 3 ? null : v)) };
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(/ready/);
  });

  it('rejects a file that is not an object of columns', () => {
    expect(() => parsePrs([1, 2, 3], 'prs-2026.json', meta)).toThrow(/prs-2026\.json/);
  });

  // Each index column against its dictionary in the fixture's meta: 4 bases,
  // 4 disclosures, 3 families, 4 components and 5 kinds.
  const at3 = <T>(column: readonly T[], value: T) => column.map((v, i) => (i === 3 ? value : v));
  it.each([
    ['kind past the last kind', 'kind', { kind: at3(prs2026.kind, 5) }],
    ['kind below -1', 'kind', { kind: at3(prs2026.kind, -2) }],
    ['base past the last base', 'base', { base: at3(prs2026.base, 4) }],
    ['base of -1', 'base', { base: at3(prs2026.base, -1) }],
    ['disclosure past the last form', 'disclosure', { disclosure: at3(prs2026.disclosure, 4) }],
    ['family past the last family', 'families', { families: at3(prs2026.families, [0, 3]) }],
    ['component past the last component', 'components', { components: at3(prs2026.components, [4]) }],
  ])('rejects a %s, naming the file and the column', (_name, column, patch) => {
    const bad = { ...prs2026, ...patch };
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(DataError);
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(new RegExp(`prs-2026\\.json.*"${column}".*row 3`));
  });

  it('accepts every kind in the dictionary and -1', () => {
    const kinds = [-1, 0, 1, 2, 3, 4, 4, 4, 4, 4];
    expect([...parsePrs({ ...prs2026, kind: kinds }, 'prs-2026.json', meta).kind]).toEqual(kinds);
  });
});

describe('parseEvents', () => {
  it('rejects columns of different lengths', () => {
    const short = { ...events2026, actor: events2026.actor.slice(1) };
    expect(() => parseEvents(short, 'events-2026.json', 10, meta)).toThrow(/events-2026\.json.*actor/);
  });

  it('rejects an event on a row the year does not have', () => {
    expect(() => parseEvents(events2026, 'events-2026.json', 3, meta)).toThrow(/events-2026\.json.*pr/);
  });

  // Event 16 is a command_author with sub 0; meta has 15 event kinds and 2 commands.
  const at16 = (column: readonly number[], value: number) => column.map((v, i) => (i === 16 ? value : v));
  it.each([
    ['kind past the last event kind', 'kind', { kind: at16(events2026.kind, 15) }],
    ['command past the last command', 'sub', { sub: at16(events2026.sub, 2) }],
    ['command without a command', 'sub', { sub: at16(events2026.sub, -1) }],
  ])('rejects a %s, naming the file and the column', (_name, column, patch) => {
    const bad = { ...events2026, ...patch };
    expect(() => parseEvents(bad, 'events-2026.json', 10, meta)).toThrow(DataError);
    expect(() => parseEvents(bad, 'events-2026.json', 10, meta)).toThrow(
      new RegExp(`events-2026\\.json.*"${column}".*16`),
    );
  });
});

describe('parseTable', () => {
  const y2026 = parseYear(2026, prs2026, events2026, meta);
  const parse = (raw: unknown) => parseTable(raw, 'table-2026.json', y2026, meta);
  const table = parse(table2026);

  it('reads the titles and authors, one per row', () => {
    expect(table.titles).toEqual(table2026.titles);
    expect(table.authors).toEqual(table2026.authors);
  });

  it('reads each row its commits as [sha, authored, committed]', () => {
    expect(table.commits).toHaveLength(10);
    // #66500, one commit authored and committed at 2026-05-18 09:30.
    expect(table.commits[1]).toEqual([[expect.stringMatching(SHA), 1779096600, 1779096600]]);
    table.commits.forEach((list, r) => {
      expect(list, `row ${r}`).toHaveLength(prs2026.commits[r] as number);
      expect(list.at(-1)?.[2], `row ${r}`).toBe(prs2026.last_commit[r]);
    });
  });

  it('reads one ref per event, in the events file order', () => {
    expect(table.refs).toHaveLength(events2026.pr.length);
    expect(table.refs[0]).toMatch(/^[1-9]\d*$/); // comment_other: a comment id
    expect(table.refs[7]).toMatch(SHA); // merged: the merge commit
    expect(table.refs[21]).toBe(''); // reopened
    expect(table.refs[30]).toMatch(/^[1-9]\d*$/); // ready: an event id
    expect(table.refs[34]).toBe(''); // bot_account without an id
  });

  it('reads the tickets, the PR a backport is of, and where each kind came from', () => {
    expect(table.tickets).toEqual([[], [72001], [], [], [72510], [72140], [72377, 72378], [], [], []]);
    expect(table.backport_of).toEqual([0, 0, 0, 0, 0, 66500, 0, 0, 0, 67010]);
    expect(table.kind_source).toEqual([
      'labels',
      'checklist',
      'checklist',
      'checklist',
      'checklist',
      'original',
      'tracker',
      'labels',
      'labels',
      'labels',
    ]);
  });

  it('reads a kind source of "" for an unknown kind', () => {
    const y2025 = parseYear(2025, prs2025, events2025, meta);
    expect(parseTable(table2025, 'table-2025.json', y2025, meta).kind_source).toEqual(['tracker', '']);
  });

  const sha = 'a'.repeat(40);
  const at = <T>(column: readonly T[], i: number, value: T) => column.map((v, j) => (j === i ? value : v));
  it.each([
    ['titles one short', 'titles', { titles: table2026.titles.slice(1) }],
    ['commits one short', 'commits', { commits: table2026.commits.slice(1) }],
    ['a commit without its committed time', 'commits', { commits: at(table2026.commits, 2, [[sha, 1]]) }],
    ['a commit whose sha is not 40 hex digits', 'commits', { commits: at(table2026.commits, 2, [['abc', 1, 2]]) }],
    ['a commit whose time is not a number', 'commits', { commits: at(table2026.commits, 2, [[sha, '1', 2]]) }],
    ['refs one short of the events', 'refs', { refs: table2026.refs.slice(1) }],
    ['a merge ref that is not a sha', 'refs', { refs: at(table2026.refs, 7, '3412345678') }],
    ['a comment ref that is a sha', 'refs', { refs: at(table2026.refs, 0, sha) }],
    ['a ref that is not an id', 'refs', { refs: at(table2026.refs, 0, 'issuecomment-1') }],
    ['tickets one short', 'tickets', { tickets: table2026.tickets.slice(1) }],
    ['a ticket that is not a positive number', 'tickets', { tickets: at(table2026.tickets, 1, [0]) }],
    ['backport_of one short', 'backport_of', { backport_of: table2026.backport_of.slice(1) }],
    ['a negative backport_of', 'backport_of', { backport_of: at(table2026.backport_of, 5, -1) }],
    ['kind_source one short', 'kind_source', { kind_source: table2026.kind_source.slice(1) }],
    ['an unheard-of kind source', 'kind_source', { kind_source: at(table2026.kind_source, 0, 'guess') }],
    ['no kind source for a known kind', 'kind_source', { kind_source: at(table2026.kind_source, 0, '') }],
  ])('rejects %s, naming the file and the column', (_name, column, patch) => {
    const bad = { ...table2026, ...patch };
    expect(() => parse(bad)).toThrow(DataError);
    expect(() => parse(bad)).toThrow(new RegExp(`table-2026\\.json.*"${column}"`));
  });

  it('rejects a kind source for an unknown kind', () => {
    const y2025 = parseYear(2025, prs2025, events2025, meta);
    const bad = { ...table2025, kind_source: ['tracker', 'labels'] };
    expect(() => parseTable(bad, 'table-2025.json', y2025, meta)).toThrow(/table-2025\.json.*"kind_source".*row 1/);
  });

  it('rejects a missing column', () => {
    const { refs: _, ...withoutRefs } = table2026;
    expect(() => parse(withoutRefs)).toThrow(/table-2026\.json.*"refs"/);
  });
});

describe('combine', () => {
  const y2025 = parseYear(2025, prs2025, events2025, meta);
  const y2026 = parseYear(2026, prs2026, events2026, meta);
  const data = combine(meta, [y2025, y2026]);

  it('appends the years in order, so a row id is global', () => {
    expect(data.size).toBe(12);
    expect([...data.prs.number]).toEqual([...prs2025.number, ...prs2026.number]);
    expect(data.years).toEqual([
      { year: 2025, first: 0, count: 2 },
      { year: 2026, first: 2, count: 10 },
    ]);
  });

  it('moves each event onto its global row', () => {
    expect(data.events.pr.length).toBe(events2025.pr.length + events2026.pr.length);
    expect([...data.events.pr]).toEqual([...events2025.pr, ...events2026.pr.map((p) => p + 2)]);
    expect([...data.events.at]).toEqual([...events2025.at, ...events2026.at]);
  });

  it('gives an empty dataset for no years', () => {
    const empty = combine(meta, []);
    expect(empty.size).toBe(0);
    expect(empty.prs.number.length).toBe(0);
    expect(empty.events.pr.length).toBe(0);
    expect(empty.prs.families).toEqual([]);
  });
});

describe('yearsFor', () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  it('loads every year up to the end of the period, since older PRs are still worked on', () => {
    expect(yearsFor(meta, at('2026-11-16T00:00:00Z'))).toEqual([2025, 2026]);
  });

  it('leaves out years opened after the period ends', () => {
    const longer = { ...meta, years: [2024, 2025, 2026] };
    expect(yearsFor(longer, at('2026-01-01T00:00:00Z'))).toEqual([2024, 2025]);
    expect(yearsFor(longer, at('2025-07-01T00:00:00Z'))).toEqual([2024, 2025]);
  });
});

describe('loadMeta', () => {
  it('loads and parses meta.json', async () => {
    const { fetch } = fixtureFetch();
    expect(await loadMeta(BASE, fetch)).toEqual(meta);
  });

  it('names meta.json when it cannot be loaded', async () => {
    const { fetch } = fixtureFetch({ 'meta.json': undefined });
    await expect(loadMeta(BASE, fetch)).rejects.toThrow(/meta\.json.*404/);
  });

  it('names meta.json when it is not JSON', async () => {
    const { fetch } = fixtureFetch({ 'meta.json': '{"repo": ' });
    await expect(loadMeta(BASE, fetch)).rejects.toThrow(/meta\.json/);
  });
});

describe('DataLoader', () => {
  it('loads the years asked for into one dataset', async () => {
    const { fetch } = fixtureFetch();
    const { dataset, errors } = await new DataLoader(meta, BASE, fetch).load([2025, 2026]);
    expect(errors).toEqual([]);
    expect(dataset.size).toBe(12);
  });

  it('does not fetch the tables until asked, then fetches the one year', async () => {
    const { fetch, requested } = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetch);
    await loader.load([2025, 2026]);
    expect(requested.some((u) => u.includes('table-'))).toBe(false);
    const table = await loader.table(2026);
    expect(table.titles).toEqual(table2026.titles);
    expect(table.authors).toEqual(table2026.authors);
    expect(table.refs).toEqual(table2026.refs);
    expect(table.kind_source).toEqual(table2026.kind_source);
    expect(requested.filter((u) => u.includes('table-'))).toEqual([`${BASE}table-2026.json`]);
  });

  it('fetches each file once across loads', async () => {
    const { fetch, requested } = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetch);
    await loader.load([2026]);
    await loader.load([2025, 2026]);
    expect(requested.filter((u) => u.endsWith('prs-2026.json'))).toHaveLength(1);
  });

  it('reports a year file that fails to load by name, and loads the rest', async () => {
    const { fetch } = fixtureFetch({ 'prs-2025.json': undefined });
    const { dataset, errors } = await new DataLoader(meta, BASE, fetch).load([2025, 2026]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'prs-2025.json', year: 2025 });
    expect(errors[0]?.message).toMatch(/404/);
    expect(dataset.size).toBe(10);
    expect(dataset.years.map((y) => y.year)).toEqual([2026]);
  });

  it('reports a year whose columns differ in length by name, and loads the rest', async () => {
    const { fetch } = fixtureFetch({ 'events-2026.json': { ...events2026, kind: events2026.kind.slice(2) } });
    const { dataset, errors } = await new DataLoader(meta, BASE, fetch).load([2025, 2026]);
    expect(errors.map((e) => e.file)).toEqual(['events-2026.json']);
    expect(dataset.years.map((y) => y.year)).toEqual([2025]);
  });

  it('rejects a table whose length differs from its year', async () => {
    const { fetch } = fixtureFetch({ 'table-2026.json': { ...table2026, titles: table2026.titles.slice(1) } });
    const loader = new DataLoader(meta, BASE, fetch);
    await expect(loader.table(2026)).rejects.toThrow(/table-2026\.json.*titles/);
  });

  it('rejects a table whose refs do not match its year events', async () => {
    const { fetch } = fixtureFetch({ 'table-2026.json': { ...table2026, refs: table2026.refs.slice(1) } });
    const loader = new DataLoader(meta, BASE, fetch);
    await expect(loader.table(2026)).rejects.toThrow(/table-2026\.json.*"refs".*events-2026\.json has 35 events/);
  });
});
