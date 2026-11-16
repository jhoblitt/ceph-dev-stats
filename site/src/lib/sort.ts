// The PR table's order as the URL keeps it, `sort=<column>` ascending or
// `sort=-<column>` descending. Apart from the table so the URL state can
// read it without the table's row and cell code.

/** The columns a PR list can be ordered by. */
export const SORT_COLUMNS = [
  'number',
  'title',
  'author',
  'opened',
  'state',
  'kind',
  'response',
  'open',
  'size',
  'disclosure',
  'reopened',
] as const;

export type SortColumn = (typeof SORT_COLUMNS)[number];

export interface Sort {
  column: SortColumn;
  descending: boolean;
}

/** Newest opened first. */
export const DEFAULT_SORT: Sort = { column: 'opened', descending: true };

function isColumn(s: string): s is SortColumn {
  return (SORT_COLUMNS as readonly string[]).includes(s);
}

/** The URL's `sort`: `<column>` ascending, `-<column>` descending; anything else is the default. */
export function parseSort(raw: string | undefined): Sort {
  if (raw === undefined) return DEFAULT_SORT;
  const descending = raw.startsWith('-');
  const column = descending ? raw.slice(1) : raw;
  return isColumn(column) ? { column, descending } : DEFAULT_SORT;
}

export function sortParam(sort: Sort): string {
  return `${sort.descending ? '-' : ''}${sort.column}`;
}

export function sameSort(a: Sort, b: Sort): boolean {
  return a.column === b.column && a.descending === b.descending;
}

/** Choosing the sorted column turns it the other way; choosing another sorts by it ascending. */
export function nextSort(current: Sort, column: SortColumn): Sort {
  return current.column === column ? { column, descending: !current.descending } : { column, descending: false };
}
