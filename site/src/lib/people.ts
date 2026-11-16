// The People tables: their columns, how each is written and ordered, and
// which rows are shown. The figures come from stats/people.ts.

import type { Meta } from './data';
import { formatCount, formatDays, formatShare } from './format';
import { isBot, personHandle } from './handles';
import type { AuthorColumn, ReviewerColumn, Sort } from './sort';
import { type AuthorRow, MIN_PRS, type Median, type ReviewerRow } from './stats/people';
import { orderBy } from './table';

/** A cell as written, with what a reader may want beside it: the count behind a median. */
export interface Cell {
  text: string;
  /** Said to assistive technology after the text, and shown on hover. */
  detail?: string;
}

export interface PeopleColumn<C extends string, R> {
  id: C;
  label: string;
  /** Its value for ordering; null for none, which sorts last either way. */
  key(row: R, meta: Meta): number | string | null;
  cell(row: R, meta: Meta): Cell;
}

const prs = (n: number) => `${formatCount(n)} PR${n === 1 ? '' : 's'}`;

/** A median's days, or null when it has no number to show. */
export function medianKey(m: Median): number | null {
  return m.state === 'known' ? m.days : null;
}

/** A median in words: a duration, "not yet known", "not reached" or "too few", with its count. */
export function medianCell(m: Median, outcome: string): Cell {
  const over = `median over ${prs(m.prs)}`;
  switch (m.state) {
    case 'known':
      return { text: formatDays(m.days), detail: over };
    case 'notYetKnown':
      return { text: 'not yet known', detail: `${over}, too many still waiting` };
    case 'notReached':
      return { text: 'not reached', detail: `${over}, ${formatShare(m.share)} ${outcome}` };
    case 'tooFew':
      return { text: 'too few', detail: `${prs(m.prs)}, fewer than ${MIN_PRS}` };
  }
}

const count = <R>(of: (r: R) => number) => ({
  key: (r: R) => of(r),
  cell: (r: R): Cell => ({ text: formatCount(of(r)) }),
});

const personColumn = <C extends string, R extends { person: number }>(id: C, label: string): PeopleColumn<C, R> => ({
  id,
  label,
  key: (r, meta) => personHandle(meta, r.person).text,
  cell: (r, meta) => ({ text: personHandle(meta, r.person).text }),
});

export const AUTHOR_TABLE: readonly PeopleColumn<AuthorColumn, AuthorRow>[] = [
  personColumn('author', 'Author'),
  { id: 'opened', label: 'PRs opened', ...count((r) => r.opened) },
  { id: 'merged', label: 'Merged', ...count((r) => r.merged) },
  { id: 'closed', label: 'Closed unmerged', ...count((r) => r.closed) },
  { id: 'open', label: 'Still open', ...count((r) => r.open) },
  { id: 'commits', label: 'Commits', ...count((r) => r.commits) },
  { id: 'added', label: 'Lines added', ...count((r) => r.additions) },
  { id: 'deleted', label: 'Lines deleted', ...count((r) => r.deletions) },
  { id: 'lines', label: 'Lines changed', ...count((r) => r.lines) },
  {
    id: 'response',
    label: 'Median to first response',
    key: (r) => medianKey(r.response),
    cell: (r) => medianCell(r.response, 'responded'),
  },
  { id: 'merge', label: 'Median to merge', key: (r) => medianKey(r.merge), cell: (r) => medianCell(r.merge, 'merged') },
  {
    id: 'disclosed',
    label: 'Disclosing AI use',
    key: (r) => r.disclosed / r.opened,
    cell: (r) => ({ text: formatShare(r.disclosed / r.opened), detail: `${formatCount(r.disclosed)} of ${prs(r.opened)}` }),
  },
];

export const REVIEWER_TABLE: readonly PeopleColumn<ReviewerColumn, ReviewerRow>[] = [
  personColumn('reviewer', 'Reviewer'),
  { id: 'prs', label: 'PRs reviewed or commented on', ...count((r) => r.prs) },
  { id: 'approved', label: 'Reviews approving', ...count((r) => r.approved) },
  { id: 'changes', label: 'Reviews requesting changes', ...count((r) => r.changes) },
  { id: 'commented', label: 'Reviews commenting', ...count((r) => r.commented) },
  { id: 'comments', label: 'Comments', ...count((r) => r.comments) },
  { id: 'first', label: 'First responses', ...count((r) => r.firstResponses) },
  {
    id: 'response',
    label: 'Median to their first response',
    key: (r) => medianKey(r.response),
    cell: (r) => medianCell(r.response, 'responded'),
  },
];

/**
 * The rows in the order `sort` gives, as `orderBy` orders them; rows that
 * tie are in order of their handles.
 */
export function sortPeople<C extends string, R extends { person: number }>(
  rows: readonly R[],
  columns: readonly PeopleColumn<C, R>[],
  sort: Sort<C>,
  meta: Meta,
): R[] {
  const column = columns.find((c) => c.id === sort.column) ?? (columns[0] as PeopleColumn<C, R>);
  const byHandle = orderBy(rows, (r) => personHandle(meta, r.person).text, false);
  return orderBy(byHandle, (r) => column.key(r, meta), sort.descending);
}

/** The rows shown: bot accounts only when `bots` is set. */
export function shownPeople<R extends { person: number }>(rows: readonly R[], meta: Meta, bots: boolean): R[] {
  return bots ? [...rows] : rows.filter((r) => !isBot(meta, r.person));
}
