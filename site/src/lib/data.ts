// The site data (Seam 4 of the plan), fetched at run time from `data/` under
// the site's base path: meta.json first, then the year files the period
// needs, and a year's table only when the PR table asks for it. Times are
// epoch seconds; -1 means none or unknown.

export interface Named {
  id: string;
  name: string;
}

export interface Meta {
  repo: string;
  /** When the last fetch began. */
  fetched_through: number;
  window_start: number;
  /** The years with a prs-<year>.json, ascending. */
  years: number[];
  bases: string[];
  components: Named[];
  families: Named[];
  commands: Named[];
  /** What a PR is: a bug fix, a feature, …; the `kind` column indexes it. */
  kinds: Named[];
  /** Holds `none`; every other value is a form of disclosure. */
  disclosure: string[];
  event_kinds: string[];
}

/** The `state` column. */
export const PR_STATE = { open: 0, merged: 1, closed: 2 } as const;

type ColumnKind = 'int' | 'time' | 'small' | 'lists';
type Column<K extends ColumnKind> = K extends 'int'
  ? Int32Array
  : K extends 'time'
    ? Float64Array
    : K extends 'small'
      ? Uint8Array
      : readonly (readonly number[])[];
type Columns<Spec extends Record<string, ColumnKind>> = { readonly [C in keyof Spec]: Column<Spec[C]> };

// Times are kept as doubles so they outlive 2038; `small` holds flags and
// enums that fit a byte.
const PR_SPEC = {
  number: 'int',
  created: 'time',
  ready: 'time',
  closed: 'time',
  state: 'small',
  base: 'int',
  draft: 'small',
  opened_draft: 'small',
  reopened: 'int',
  in_window: 'small',
  additions: 'int',
  deletions: 'int',
  files: 'int',
  commits: 'int',
  first_commit: 'time',
  last_commit: 'time',
  first_response: 'time',
  first_approval: 'time',
  human_reviews: 'int',
  bot_reviews: 'int',
  bot_commands: 'int',
  disclosure: 'small',
  families: 'lists',
  components: 'lists',
  standing: 'int',
  /** An index into meta's `kinds`, or -1 for unknown. */
  kind: 'int',
} as const satisfies Record<string, ColumnKind>;

const EVENT_SPEC = {
  pr: 'int',
  at: 'time',
  kind: 'small',
  sub: 'int',
  actor: 'int',
} as const satisfies Record<string, ColumnKind>;

/** One column per field of prs-<year>.json, a row per PR. */
export type PrColumns = Columns<typeof PR_SPEC>;
/** One column per field of events-<year>.json; `pr` is a row of the same dataset. */
export type EventColumns = Columns<typeof EVENT_SPEC>;

export interface YearData {
  year: number;
  prs: PrColumns;
  /** `pr` is a row of this year's `prs`. */
  events: EventColumns;
}

/** Where a year's rows sit in a dataset. */
export interface YearSpan {
  year: number;
  first: number;
  count: number;
}

/** The loaded years appended in order, so a row id is global across them. */
export interface Dataset {
  meta: Meta;
  /** The number of rows. */
  size: number;
  prs: PrColumns;
  events: EventColumns;
  years: YearSpan[];
}

/** table-<year>.json, aligned with that year's rows. */
export interface TableYear {
  titles: string[];
  authors: string[];
}

/** A data file that could not be fetched or does not have the expected shape. */
export class DataError extends Error {
  readonly file: string;
  readonly detail: string;

  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = 'DataError';
    this.file = file;
    this.detail = detail;
  }
}

export interface LoadError {
  year: number;
  file: string;
  message: string;
}

export interface LoadResult {
  dataset: Dataset;
  /** The years that failed, each naming its file; the dataset holds the rest. */
  errors: LoadError[];
}

export type Fetch = (url: string) => Promise<Response>;

const prsFile = (year: number) => `prs-${year}.json`;
const eventsFile = (year: number) => `events-${year}.json`;
const tableFile = (year: number) => `table-${year}.json`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isNamedArray(v: unknown): v is Named[] {
  return Array.isArray(v) && v.every((n) => isRecord(n) && typeof n['id'] === 'string' && typeof n['name'] === 'string');
}

export function parseMeta(raw: unknown, file = 'meta.json'): Meta {
  if (!isRecord(raw)) throw new DataError(file, 'is not an object');
  const field = <T>(name: string, ok: (v: unknown) => v is T, what: string): T => {
    const v = raw[name];
    if (!ok(v)) throw new DataError(file, `"${name}" is not ${what}`);
    return v;
  };
  const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  const isYears = (v: unknown): v is number[] => Array.isArray(v) && v.every((y) => Number.isInteger(y));
  const meta: Meta = {
    repo: field('repo', (v): v is string => typeof v === 'string', 'a string'),
    fetched_through: field('fetched_through', isTime, 'a time in epoch seconds'),
    window_start: field('window_start', isTime, 'a time in epoch seconds'),
    years: [...field('years', isYears, 'a list of years')].sort((a, b) => a - b),
    bases: field('bases', isStringArray, 'a list of strings'),
    components: field('components', isNamedArray, 'a list of {id, name}'),
    families: field('families', isNamedArray, 'a list of {id, name}'),
    commands: field('commands', isNamedArray, 'a list of {id, name}'),
    kinds: field('kinds', isNamedArray, 'a list of {id, name}'),
    disclosure: field('disclosure', isStringArray, 'a list of strings'),
    event_kinds: field('event_kinds', isStringArray, 'a list of strings'),
  };
  if (!meta.disclosure.includes('none')) throw new DataError(file, '"disclosure" has no "none"');
  if (meta.fetched_through < meta.window_start) {
    throw new DataError(file, '"fetched_through" is before "window_start"');
  }
  return meta;
}

const INT32_MAX = 2 ** 31 - 1;

function isValue(kind: ColumnKind, v: unknown): boolean {
  switch (kind) {
    case 'int':
      return Number.isInteger(v) && Math.abs(v as number) <= INT32_MAX;
    case 'time':
      return Number.isSafeInteger(v) && (v as number) >= -1;
    case 'small':
      return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;
    case 'lists':
      return Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0);
  }
}

function toColumn(kind: ColumnKind, values: unknown[]) {
  switch (kind) {
    case 'int':
      return Int32Array.from(values as number[]);
    case 'time':
      return Float64Array.from(values as number[]);
    case 'small':
      return Uint8Array.from(values as number[]);
    case 'lists':
      return values as readonly (readonly number[])[];
  }
}

/** Reads an object of equal-length columns; every column of `spec` must be there. */
function parseColumns<Spec extends Record<string, ColumnKind>>(raw: unknown, file: string, spec: Spec): Columns<Spec> {
  if (!isRecord(raw)) throw new DataError(file, 'is not an object of columns');
  const names = Object.keys(spec);
  const first = names[0];
  let length = -1;
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const kind = spec[name] as ColumnKind;
    const values = raw[name];
    if (!Array.isArray(values)) throw new DataError(file, `column "${name}" is missing`);
    if (length === -1) length = values.length;
    else if (values.length !== length) {
      throw new DataError(file, `column "${name}" has ${values.length} values where "${first}" has ${length}`);
    }
    const bad = values.findIndex((v) => !isValue(kind, v));
    if (bad !== -1) throw new DataError(file, `column "${name}" has a bad value at row ${bad}: ${JSON.stringify(values[bad])}`);
    out[name] = toColumn(kind, values);
  }
  return out as Columns<Spec>;
}

/**
 * A check that a value indexes `dictionary`, which meta calls `name`; -1 also
 * passes where `unknown` allows it. `at` names the row or event holding it.
 */
function checkIndex(file: string, column: string, dictionary: readonly unknown[], name: string, unknown: boolean) {
  return (value: number, at: string) => {
    if ((value >= 0 && value < dictionary.length) || (unknown && value === -1)) return;
    throw new DataError(
      file,
      `column "${column}" has ${value} at ${at}, outside "${name}" of ${dictionary.length} entries`,
    );
  };
}

/** Reads a prs file; every index must be inside its dictionary in `meta`. */
export function parsePrs(raw: unknown, file: string, meta: Meta): PrColumns {
  const prs = parseColumns(raw, file, PR_SPEC);
  const scalars = [
    ['base', meta.bases, 'bases', false],
    ['disclosure', meta.disclosure, 'disclosure', false],
    ['kind', meta.kinds, 'kinds', true],
  ] as const;
  for (const [column, dictionary, name, unknown] of scalars) {
    const check = checkIndex(file, column, dictionary, name, unknown);
    prs[column].forEach((v, r) => check(v, `row ${r}`));
  }
  for (const column of ['families', 'components'] as const) {
    const check = checkIndex(file, column, meta[column], column, false);
    prs[column].forEach((list, r) => list.forEach((v) => check(v, `row ${r}`)));
  }
  return prs;
}

const COMMAND_KINDS = ['command_author', 'command_other'];

/**
 * Reads an events file whose `pr` must be a row of a year with `rows` PRs,
 * whose `kind` must be in meta's `event_kinds`, and whose `sub` must be in
 * its `commands` for a command.
 */
export function parseEvents(raw: unknown, file: string, rows: number, meta: Meta): EventColumns {
  const events = parseColumns(raw, file, EVENT_SPEC);
  const bad = events.pr.findIndex((r) => r < 0 || r >= rows);
  if (bad !== -1) {
    throw new DataError(file, `column "pr" names row ${events.pr[bad]} at ${bad}, but the year has ${rows} rows`);
  }
  const kind = checkIndex(file, 'kind', meta.event_kinds, 'event_kinds', false);
  const sub = checkIndex(file, 'sub', meta.commands, 'commands', false);
  const commands = COMMAND_KINDS.map((k) => meta.event_kinds.indexOf(k)).filter((k) => k !== -1);
  events.kind.forEach((k, i) => {
    kind(k, `event ${i}`);
    if (commands.includes(k)) sub(events.sub[i] as number, `event ${i}`);
  });
  return events;
}

export function parseYear(year: number, prsRaw: unknown, eventsRaw: unknown, meta: Meta): YearData {
  const prs = parsePrs(prsRaw, prsFile(year), meta);
  return { year, prs, events: parseEvents(eventsRaw, eventsFile(year), prs.number.length, meta) };
}

/** Reads a table, which must have `rows` entries, one per row of its year. */
export function parseTable(raw: unknown, file: string, rows: number): TableYear {
  if (!isRecord(raw)) throw new DataError(file, 'is not an object of columns');
  const column = (name: string): string[] => {
    const v = raw[name];
    if (!isStringArray(v)) throw new DataError(file, `column "${name}" is not a list of strings`);
    if (v.length !== rows) throw new DataError(file, `column "${name}" has ${v.length} values where the year has ${rows} rows`);
    return v;
  };
  return { titles: column('titles'), authors: column('authors') };
}

type Typed = Int32Array | Float64Array | Uint8Array;

function joinTyped(kind: Exclude<ColumnKind, 'lists'>, cols: readonly Typed[]): Typed {
  const total = cols.reduce((n, c) => n + c.length, 0);
  const out = kind === 'int' ? new Int32Array(total) : kind === 'time' ? new Float64Array(total) : new Uint8Array(total);
  let at = 0;
  for (const c of cols) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function concat<Spec extends Record<string, ColumnKind>>(spec: Spec, parts: readonly Columns<Spec>[]): Columns<Spec> {
  const out: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(spec)) {
    const cols = parts.map((p) => p[name]);
    out[name] =
      kind === 'lists' ? (cols as (readonly (readonly number[])[])[]).flat() : joinTyped(kind, cols as Typed[]);
  }
  return out as Columns<Spec>;
}

/** The years appended in the order given, with each event moved onto its global row. */
export function combine(meta: Meta, years: readonly YearData[]): Dataset {
  const spans: YearSpan[] = [];
  let size = 0;
  for (const y of years) {
    spans.push({ year: y.year, first: size, count: y.prs.number.length });
    size += y.prs.number.length;
  }
  const events = years.map((y, i) => {
    const first = spans[i]?.first ?? 0;
    return { ...y.events, pr: y.events.pr.map((row) => row + first) };
  });
  return {
    meta,
    size,
    prs: concat(PR_SPEC, years.map((y) => y.prs)),
    events: concat(EVENT_SPEC, events),
    years: spans,
  };
}

/**
 * The years whose files a period ending at `end` (epoch seconds, exclusive)
 * needs: every year up to the one it ends in. A PR opened before the period
 * can still be reviewed, closed or waiting in it, and the calendar charts
 * count it.
 */
export function yearsFor(meta: Meta, end: number): number[] {
  const last = new Date((end - 1) * 1000).getUTCFullYear();
  return meta.years.filter((y) => y <= last);
}

async function fetchJson(fetchFn: Fetch, baseUrl: string, file: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}${file}`);
  } catch (err) {
    throw new DataError(file, `could not be fetched (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new DataError(file, `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
  try {
    return await res.json();
  } catch {
    throw new DataError(file, 'is not valid JSON');
  }
}

/** `baseUrl` ends in a slash, e.g. `/ceph-dev-stats/data/`. */
export async function loadMeta(baseUrl: string, fetchFn: Fetch): Promise<Meta> {
  return parseMeta(await fetchJson(fetchFn, baseUrl, 'meta.json'));
}

/**
 * Loads year files and tables, each at most once: a year that failed stays
 * failed until the page is reloaded, rather than being fetched again on
 * every change of filter.
 */
export class DataLoader {
  readonly meta: Meta;
  readonly #baseUrl: string;
  readonly #fetch: Fetch;
  readonly #years = new Map<number, Promise<YearData>>();
  readonly #tables = new Map<number, Promise<TableYear>>();

  constructor(meta: Meta, baseUrl: string, fetchFn: Fetch) {
    this.meta = meta;
    this.#baseUrl = baseUrl;
    this.#fetch = fetchFn;
  }

  #year(year: number): Promise<YearData> {
    let p = this.#years.get(year);
    if (!p) {
      p = Promise.all([
        fetchJson(this.#fetch, this.#baseUrl, prsFile(year)),
        fetchJson(this.#fetch, this.#baseUrl, eventsFile(year)),
      ]).then(([prs, events]) => parseYear(year, prs, events, this.meta));
      this.#years.set(year, p);
    }
    return p;
  }

  /** The years asked for, in ascending order, as one dataset; never rejects. */
  async load(years: readonly number[]): Promise<LoadResult> {
    const wanted = [...new Set(years)].sort((a, b) => a - b);
    const settled = await Promise.allSettled(wanted.map((y) => this.#year(y)));
    const loaded: YearData[] = [];
    const errors: LoadError[] = [];
    settled.forEach((s, i) => {
      const year = wanted[i] as number;
      if (s.status === 'fulfilled') loaded.push(s.value);
      else if (s.reason instanceof DataError) errors.push({ year, file: s.reason.file, message: s.reason.detail });
      else errors.push({ year, file: prsFile(year), message: String(s.reason) });
    });
    return { dataset: combine(this.meta, loaded), errors };
  }

  /** A year's titles and authors, fetched on first use. */
  table(year: number): Promise<TableYear> {
    let p = this.#tables.get(year);
    if (!p) {
      p = Promise.all([this.#year(year), fetchJson(this.#fetch, this.#baseUrl, tableFile(year))]).then(([y, raw]) =>
        parseTable(raw, tableFile(year), y.prs.number.length),
      );
      this.#tables.set(year, p);
    }
    return p;
  }
}
