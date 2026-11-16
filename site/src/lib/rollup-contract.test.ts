// The seam between `cephstats rollup` and the site: what the rollup writes
// for its hand-made dataset (internal/rollup/testdata/golden/, rewritten by
// `CEPHSTATS_UPDATE_GOLDEN=1 go test ./internal/rollup/`) must load through
// the site's own loader. The values checked by hand here follow from the
// records in internal/rollup/testdata/data/.
import { describe, expect, it } from 'vitest';
import { parseMeta, parseTable, parseYear } from './data';

const DIR = '../../../internal/rollup/testdata/golden/';
const files: Record<string, unknown> = import.meta.glob('../../../internal/rollup/testdata/golden/*.json', {
  eager: true,
  import: 'default',
});

function file(name: string): unknown {
  const f = files[DIR + name];
  if (f === undefined) throw new Error(`the rollup wrote no ${name}`);
  return f;
}

const at = (y: number, mo: number, d: number, h: number) => Date.UTC(y, mo - 1, d, h) / 1000;

const meta = parseMeta(file('meta.json'));
const years = meta.years.map((y) => parseYear(y, file(`prs-${y}.json`), file(`events-${y}.json`), meta));
const tables = years.map((y) => parseTable(file(`table-${y.year}.json`), `table-${y.year}.json`, y, meta));

/** The raw prs file of a year, for the columns the loader does not read. */
const rawPrs = (year: number) => file(`prs-${year}.json`) as Record<string, number[]>;
const people = (file('meta.json') as { people: string[] }).people;

describe('the rollup output for the hand-made dataset', () => {
  it('is exactly meta.json and three files for each year', () => {
    expect(meta.years).toEqual([2025, 2026]);
    const expected = ['meta.json', ...meta.years.flatMap((y) => [`prs-${y}.json`, `events-${y}.json`, `table-${y}.json`])];
    expect(Object.keys(files).map((k) => k.slice(DIR.length)).sort()).toEqual(expected.sort());
  });

  it('loads every year and table through the loader', () => {
    expect(years.map((y) => y.prs.number.length)).toEqual([1, 7]);
    expect(years.map((y) => y.events.pr.length)).toEqual([3, 27]);
    expect(tables.map((t) => t.refs.length)).toEqual([3, 27]);
    expect(meta.window_start).toBe(at(2026, 5, 15, 0));
  });

  it('writes a first response before ready as ready', () => {
    const y2026 = years[1]!;
    const row = y2026.prs.number.indexOf(66200);
    expect(y2026.prs.ready[row]).toBe(at(2026, 6, 3, 10));
    expect(y2026.prs.first_response[row]).toBe(at(2026, 6, 3, 10));
  });

  it("gives a ready event its event id as its ref", () => {
    const y2026 = years[1]!;
    const row = y2026.prs.number.indexOf(66200);
    const ready = meta.event_kinds.indexOf('ready');
    const i = y2026.events.kind.findIndex((k, e) => k === ready && y2026.events.pr[e] === row);
    expect(tables[1]!.refs[i]).toBe('28644873432');
  });

  it("writes the author's own review as review_author, with no actor and the review's id", () => {
    const y2026 = years[1]!;
    const row = y2026.prs.number.indexOf(66200);
    const own = meta.event_kinds.indexOf('review_author');
    expect(own).toBe(meta.event_kinds.indexOf('bot_review') + 1);
    const found = [...y2026.events.kind.keys()].filter((e) => y2026.events.kind[e] === own && y2026.events.pr[e] === row);
    expect(found).toHaveLength(1);
    expect(y2026.events.actor[found[0]!]).toBe(-1);
    expect(tables[1]!.refs[found[0]!]).toBe('3100000004');
    expect(y2026.prs.human_reviews[row]).toBe(2);
  });

  it("resolves a PR's author through people", () => {
    const row = years[1]!.prs.number.indexOf(66400);
    expect(people[rawPrs(2026)['author']![row]!]).toBe('ghost');
    expect(tables[1]!.authors[row]).toBe('ghost');
  });
});
