// The methods page's figures as the prose shows them: each `{{name}}` in a
// section's Markdown is a sentence-sized value or a table, written here
// from the numbers `figures.ts` computes. A figure is text or a table of
// text, never markup.

import type { Dataset, Meta, TableYear } from '../data';
import { dayOf } from '../filters';
import { formatCount, formatShare } from '../format';
import {
  type CommentCounts,
  type Coverage,
  type EventRefs,
  type FamilyCount,
  KIND_SOURCE_ROWS,
  type KindSourceRow,
  type Split,
  baseRows,
  commentCounts,
  coverage,
  disclosureForms,
  eventRefs,
  familyCounts,
  firstCommitUnknown,
  kindSources,
  noCommits,
  kindUnknown,
  neverReady,
  standingUnknown,
} from './figures';

/** The figures computed from the PR and event files. */
export interface DataFigures {
  coverage: Coverage;
  neverReady: Split;
  firstCommitUnknown: Split;
  noCommits: Split;
  standingUnknown: { unknown: number; openedBefore: number };
  kindUnknown: Split;
  disclosure: Record<string, Split>;
  families: FamilyCount[];
  comments: CommentCounts;
}

/** The figures that also need each year's table file. */
export interface TableFigures {
  kindSources: Record<KindSourceRow, Split>;
  eventRefs: EventRefs[];
}

export function dataFigures(data: Dataset): DataFigures {
  const rows = baseRows(data);
  return {
    coverage: coverage(data, rows),
    neverReady: neverReady(data, rows),
    firstCommitUnknown: firstCommitUnknown(data, rows),
    noCommits: noCommits(data, rows),
    standingUnknown: standingUnknown(data, rows),
    kindUnknown: kindUnknown(data, rows),
    disclosure: disclosureForms(data, rows),
    families: familyCounts(data, rows),
    comments: commentCounts(data, rows),
  };
}

export function tableFigures(data: Dataset, tables: ReadonlyMap<number, TableYear>): TableFigures {
  const rows = baseRows(data);
  return { kindSources: kindSources(data, tables, rows), eventRefs: eventRefs(data, tables, rows) };
}

/** Something the page loads and computes once it is shown. */
export type Loadable<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

/** What a figure shows: its value, or why there is none yet. */
export type View<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };

/** A figure from what it needs: meta alone, the PR and event files, or the table files too. */
type Figure<T> =
  | { needs: 'meta'; show: (m: Meta) => T }
  | { needs: 'data'; show: (m: Meta, d: DataFigures) => T }
  | { needs: 'tables'; show: (m: Meta, d: DataFigures, t: TableFigures) => T };

const total = (s: Split) => s.main + s.other;
/** A share of a whole, or a dash for a share of nothing. */
const share = (n: number, of: number) => (of === 0 ? '–' : formatShare(n / of));
const disclosed = (d: DataFigures) =>
  Object.entries(d.disclosure).reduce((n, [form, s]) => (form === 'none' ? n : n + total(s)), 0);
const refsOf = (t: TableFigures, kind: string) => t.eventRefs.find((r) => r.kind === kind) ?? { events: 0, missing: 0 };
const forcePushes = (t: TableFigures) => refsOf(t, 'force_push');
const count = (f: (d: DataFigures) => number): Figure<string> => ({ needs: 'data', show: (_m, d) => formatCount(f(d)) });

/** Every value a sentence can name, by the name it is written under. */
export const INLINE_FIGURES: Record<string, Figure<string>> = {
  asOf: { needs: 'meta', show: (m) => dayOf(m.fetched_through) },
  windowStart: { needs: 'meta', show: (m) => dayOf(m.window_start) },
  'prs.records': count((d) => d.coverage.records),
  'prs.active': count((d) => d.coverage.active),
  'prs.openedInWindow': count((d) => d.coverage.openedInWindow),
  'prs.openedBeforeWindow': count((d) => d.coverage.active - d.coverage.openedInWindow),
  'prs.closedBeforeWindow': count((d) => d.coverage.closedBeforeWindow),
  'prs.neverReady': count((d) => total(d.neverReady)),
  'commits.firstUnknown': count((d) => total(d.firstCommitUnknown)),
  'commits.none': count((d) => total(d.noCommits)),
  'standing.unknown': count((d) => d.standingUnknown.unknown),
  'standing.unknownBeforeWindow': count((d) => d.standingUnknown.openedBefore),
  'standing.unknownInWindow': count((d) => d.standingUnknown.unknown - d.standingUnknown.openedBefore),
  'kind.unknown': count((d) => total(d.kindUnknown)),
  'kind.unknownShare': { needs: 'data', show: (_m, d) => share(total(d.kindUnknown), d.coverage.active) },
  'disclosure.disclosed': count(disclosed),
  'disclosure.share': { needs: 'data', show: (_m, d) => share(disclosed(d), d.coverage.active) },
  'comments.total': count((d) => d.comments.comments),
  'comments.commands': count((d) => d.comments.commands),
  'comments.commandShare': { needs: 'data', show: (_m, d) => share(d.comments.commands, d.comments.comments) },
  'comments.commandsByAuthor': count((d) => d.comments.commandsByAuthor),
  'comments.botAccount': count((d) => d.comments.botAccount),
  'refs.forcePushes': { needs: 'tables', show: (_m, _d, t) => formatCount(forcePushes(t).events) },
  'refs.forcePushesWithoutCommit': { needs: 'tables', show: (_m, _d, t) => formatCount(forcePushes(t).missing) },
  'refs.merges': { needs: 'tables', show: (_m, _d, t) => formatCount(refsOf(t, 'merged').events) },
  'refs.mergesWithoutCommit': { needs: 'tables', show: (_m, _d, t) => formatCount(refsOf(t, 'merged').missing) },
  'refs.forcePushShareWithoutCommit': {
    needs: 'tables',
    show: (_m, _d, t) => share(forcePushes(t).missing, forcePushes(t).events),
  },
};

export interface TableModel {
  caption: string;
  /** The column heads; the first heads the row labels. */
  head: string[];
  rows: string[][];
}

const SPLIT_HEAD = ['main', 'other branches', 'all'];
const splitCells = (s: Split) => [formatCount(s.main), formatCount(s.other), formatCount(total(s))];
const ofActive = (m: Meta, d: DataFigures, what: string, note?: string) =>
  `${what}, of the ${formatCount(d.coverage.active)} pull requests open at some point in the window, as of ${dayOf(m.fetched_through)}${note === undefined ? '' : `. ${note}`}`;

const KIND_SOURCE_LABELS: Record<KindSourceRow, string> = {
  checklist: 'the PR’s checklist',
  tracker: 'a tracker ticket’s type',
  labels: 'a kind label',
  original: 'the PR it backports',
  unknown: 'unknown: no source decided',
};

/** The disclosure forms, strongest first, under meta's names. */
const DISCLOSURE_LABELS: Record<string, string> = {
  trailer: 'a disclosing trailer, such as Assisted-by:',
  coauthor: 'Co-authored-by: naming a tool',
  description: 'disclosure phrasing in the description or a commit message',
  none: 'not disclosed',
};
const DISCLOSURE_ORDER = ['trailer', 'coauthor', 'description', 'none'];

/** What each event kind is, for the table of what links where. */
export const EVENT_LABELS: Record<string, string> = {
  comment_other: 'a comment by another person',
  comment_author: 'a comment by the PR’s author',
  command_author: 'a bot command by the PR’s author',
  command_other: 'a bot command by another person',
  bot_account: 'a comment by a bot account',
  review_approved: 'an approving review',
  review_changes: 'a review requesting changes',
  review_commented: 'a review that only comments',
  bot_review: 'a review by a bot account',
  review_author: 'a review by the PR’s author',
  ready: 'marked ready for review',
  draft: 'converted to a draft',
  force_push: 'a force-push',
  closed: 'closed',
  reopened: 'reopened',
  merged: 'merged',
};

/** Every table a section can show on a line of its own, by name. */
export const TABLE_FIGURES: Record<string, Figure<TableModel>> = {
  'table.kindSources': {
    needs: 'tables',
    show: (m, d, t) => ({
      caption: ofActive(m, d, 'Where each pull request’s kind came from'),
      head: ['decided by', ...SPLIT_HEAD],
      rows: KIND_SOURCE_ROWS.map((s) => [KIND_SOURCE_LABELS[s], ...splitCells(t.kindSources[s])]),
    }),
  },
  'table.disclosureForms': {
    needs: 'data',
    show: (m, d) => {
      const forms = Object.keys(d.disclosure);
      const ordered = [...DISCLOSURE_ORDER.filter((f) => forms.includes(f)), ...forms.filter((f) => !DISCLOSURE_ORDER.includes(f))];
      return {
        caption: ofActive(m, d, 'Pull requests by the strongest form of disclosure they make'),
        head: ['form', ...SPLIT_HEAD],
        rows: ordered.map((f) => [DISCLOSURE_LABELS[f] ?? f, ...splitCells(d.disclosure[f] as Split)]),
      };
    },
  },
  'table.families': {
    needs: 'data',
    show: (m, d) => ({
      caption: ofActive(m, d, 'Pull requests naming each tool family', 'A pull request naming two families counts under both.'),
      head: ['family', ...SPLIT_HEAD],
      rows: d.families.map((f) => [f.name, ...splitCells(f.count)]),
    }),
  },
  'table.eventRefs': {
    needs: 'tables',
    show: (m, d, t) => ({
      caption: `Events in the window on the ${formatCount(d.coverage.active)} pull requests open at some point in it, and those with no address of their own, as of ${dayOf(m.fetched_through)}`,
      head: ['event', 'events', 'no address'],
      rows: t.eventRefs.map((r) => [
        EVENT_LABELS[r.kind] ?? r.kind,
        formatCount(r.events),
        `${formatCount(r.missing)} (${share(r.missing, r.events)})`,
      ]),
    }),
  },
};

function view<T>(f: Figure<T>, meta: Meta, data: Loadable<DataFigures>, tables: Loadable<TableFigures>): View<T> {
  if (f.needs === 'meta') return { state: 'ready', value: f.show(meta) };
  if (data.state !== 'ready') return { state: data.state };
  if (f.needs === 'data') return { state: 'ready', value: f.show(meta, data.value) };
  if (tables.state !== 'ready') return { state: tables.state };
  return { state: 'ready', value: f.show(meta, data.value, tables.value) };
}

function lookup<T>(figures: Record<string, Figure<T>>, what: string, name: string): Figure<T> {
  const f = figures[name];
  if (!f) throw new Error(`no ${what} figure is named "${name}"`);
  return f;
}

/** A value written into a sentence. Throws for a name no figure has. */
export function inlineView(name: string, meta: Meta, data: Loadable<DataFigures>, tables: Loadable<TableFigures>): View<string> {
  return view(lookup(INLINE_FIGURES, 'inline', name), meta, data, tables);
}

/** A table on a line of its own. Throws for a name no table has. */
export function tableView(
  name: string,
  meta: Meta,
  data: Loadable<DataFigures>,
  tables: Loadable<TableFigures>,
): View<TableModel> {
  return view(lookup(TABLE_FIGURES, 'table', name), meta, data, tables);
}
