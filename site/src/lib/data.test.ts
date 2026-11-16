import { describe, expect, it } from 'vitest';
import events2025 from './__fixtures__/data/events-2025.json';
import events2026 from './__fixtures__/data/events-2026.json';
import rawMeta from './__fixtures__/data/meta.json';
import prs2025 from './__fixtures__/data/prs-2025.json';
import prs2026 from './__fixtures__/data/prs-2026.json';
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
  parseYear,
  yearsFor,
} from './data';

const meta = parseMeta(rawMeta);

describe('parseMeta', () => {
  it('reads the fixture', () => {
    expect(meta.repo).toBe('ceph/ceph');
    expect(meta.window_start).toBe(Date.UTC(2026, 4, 15) / 1000);
    expect(meta.years).toEqual([2025, 2026]);
    expect(meta.components.map((c) => c.id)).toEqual(['cephfs', 'mgr', 'rbd', 'rgw']);
    expect(meta.disclosure).toEqual(['none', 'description', 'coauthor', 'trailer']);
  });

  it('rejects a meta without a dictionary, naming the file and the field', () => {
    const { bases: _, ...withoutBases } = rawMeta;
    expect(() => parseMeta(withoutBases)).toThrow(DataError);
    expect(() => parseMeta(withoutBases)).toThrow(/meta\.json.*bases/);
  });

  it('rejects a time that is not a number', () => {
    expect(() => parseMeta({ ...rawMeta, fetched_through: '2026-11-15T06:00:00Z' })).toThrow(/fetched_through/);
  });
});

describe('parsePrs', () => {
  it('reads the columns into typed arrays', () => {
    const prs = parsePrs(prs2026, 'prs-2026.json');
    expect(prs.number).toBeInstanceOf(Int32Array);
    expect(prs.created).toBeInstanceOf(Float64Array);
    expect([...prs.number]).toEqual(prs2026.number);
    expect([...prs.first_commit]).toEqual(prs2026.first_commit);
    expect(prs.components).toEqual(prs2026.components);
  });

  it('rejects a year file whose columns differ in length, naming the file and the column', () => {
    const short = { ...prs2026, deletions: prs2026.deletions.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json')).toThrow(DataError);
    expect(() => parsePrs(short, 'prs-2026.json')).toThrow(/prs-2026\.json.*deletions/);
  });

  it('rejects a ragged column of a different length too', () => {
    const short = { ...prs2026, families: prs2026.families.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json')).toThrow(/families/);
  });

  it('rejects a missing column', () => {
    const { standing: _, ...withoutStanding } = prs2026;
    expect(() => parsePrs(withoutStanding, 'prs-2026.json')).toThrow(/standing/);
  });

  it('rejects a value that is not an integer, which would become NaN', () => {
    const bad = { ...prs2026, ready: prs2026.ready.map((v, i) => (i === 3 ? null : v)) };
    expect(() => parsePrs(bad, 'prs-2026.json')).toThrow(/ready/);
  });

  it('rejects a file that is not an object of columns', () => {
    expect(() => parsePrs([1, 2, 3], 'prs-2026.json')).toThrow(/prs-2026\.json/);
  });
});

describe('parseEvents', () => {
  it('rejects columns of different lengths', () => {
    const short = { ...events2026, actor: events2026.actor.slice(1) };
    expect(() => parseEvents(short, 'events-2026.json', 10)).toThrow(/events-2026\.json.*actor/);
  });

  it('rejects an event on a row the year does not have', () => {
    expect(() => parseEvents(events2026, 'events-2026.json', 3)).toThrow(/events-2026\.json.*pr/);
  });
});

describe('combine', () => {
  const y2025 = parseYear(2025, prs2025, events2025);
  const y2026 = parseYear(2026, prs2026, events2026);
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
});
