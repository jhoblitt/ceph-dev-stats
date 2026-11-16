// The lanes: the line of one PR's timeline drawn for many PRs at once, one
// per row, against the calendar or against the time since each opened.

import { scaleLog, scaleUtc } from 'd3-scale';
import { type Dataset, PR_STATE } from './data';
import { DAY } from './filters';
import { formatCount } from './format';
import { HOUR, type Tick, durationTicks, logDays, spaceTicks } from './plot';
import { eventRange } from './timeline';
import { formatDate, formatDayMonth } from './timeline-axis';

/** The most lanes drawn: a canvas draws more, but a reader cannot tell more rows apart. */
export const LANE_CAP = 200;

export type LaneMode = 'calendar' | 'sinceOpening';

export interface Lane {
  /** The dataset row. */
  row: number;
  number: number;
  created: number;
  /** The first commit when it came before the opening; else null. */
  firstCommit: number | null;
  /** When it was merged or closed, or the last fetch while it is open. */
  end: number;
  state: 'merged' | 'closed' | 'open';
  /** Each stretch from a close to the reopening that ended it. */
  closed: { from: number; to: number }[];
  /** When someone commented, reviewed without approving, or ran a bot command. */
  activity: number[];
  /** When a person other than the author approved. */
  approvals: number[];
  reopened: number;
}

const LIFECYCLE = ['ready', 'draft', 'force_push', 'closed', 'reopened', 'merged'];
const STATES = { [PR_STATE.open]: 'open', [PR_STATE.merged]: 'merged', [PR_STATE.closed]: 'closed' } as const;

/** Rows by opening, newest first; at one moment, the higher number first. */
export function byOpening(data: Dataset, rows: ArrayLike<number>): number[] {
  const created = data.prs.created;
  const number = data.prs.number;
  return Array.from(rows).sort(
    (a, b) => (created[b] as number) - (created[a] as number) || (number[b] as number) - (number[a] as number),
  );
}

function lane(data: Dataset, row: number): Lane {
  const p = data.prs;
  const meta = data.meta;
  const created = p.created[row] as number;
  const first = p.first_commit[row] as number;
  const state = STATES[p.state[row] as 0 | 1 | 2];
  const closed: Lane['closed'] = [];
  const activity: number[] = [];
  const approvals: number[] = [];
  let closedAt: number | null = null;
  const [start, end] = eventRange(data, row);
  for (let e = start; e < end; e++) {
    const kind = meta.event_kinds[data.events.kind[e] as number] ?? '';
    const t = data.events.at[e] as number;
    if (kind === 'closed') closedAt ??= t;
    else if (kind === 'reopened') {
      closed.push({ from: closedAt ?? t, to: t });
      closedAt = null;
    } else if (kind === 'review_approved') approvals.push(t);
    else if (!LIFECYCLE.includes(kind)) activity.push(t);
  }
  return {
    row,
    number: p.number[row] as number,
    created,
    firstCommit: first >= 0 && first < created ? first : null,
    end: state === 'open' ? meta.fetched_through : (p.closed[row] as number),
    state,
    closed,
    activity,
    approvals,
    reopened: p.reopened[row] as number,
  };
}

/** The lanes of the first `cap` rows of `order`, and how many rows there were. */
export function laneModel(data: Dataset, order: ArrayLike<number>, cap = LANE_CAP): { lanes: Lane[]; total: number } {
  const rows = Array.from(order).slice(0, cap);
  return { lanes: rows.map((r) => lane(data, r)), total: order.length };
}

/** How far apart the lanes are, in pixels: few lanes are drawn taller than many. */
export function lanePitch(n: number): number {
  if (n <= 30) return 14;
  if (n <= 80) return 9;
  return 6;
}

/** The lane at `y` pixels below the first lane's top, or null. */
export function laneAt(y: number, pitch: number, n: number): number | null {
  const i = Math.floor(y / pitch);
  return y < 0 || i >= n ? null : i;
}

export interface LaneScale {
  /** A time of a lane, in pixels; null where the mode does not draw it. */
  x(lane: Lane, t: number): number | null;
  ticks: Tick[];
}

/**
 * The calendar runs from the lanes' earliest opening, or the period's start
 * if that is later, to their latest end; what falls before is clamped to the
 * left edge. Since opening, every lane starts at its own opening on the page's
 * log duration scale, from an hour to the longest lane, so a PR's first days
 * are not crushed by the long-lived ones; what came before the opening is
 * not drawn there.
 */
export function laneScale(mode: LaneMode, lanes: readonly Lane[], width: number, period: { start: number; end: number }): LaneScale {
  if (mode === 'calendar') {
    // From the earliest opening among the lanes, but not before the period,
    // to the latest end: the newest PRs of a long period still get the
    // width, and a PR is drawn to its end, past the period if it went on.
    const start = Math.max(period.start, Math.min(...lanes.map((l) => l.created)));
    const end = Math.max(...lanes.map((l) => l.end));
    const [from, to] = Number.isFinite(start) && Number.isFinite(end) && end > start ? [start, end] : [period.start, period.end];
    const s = scaleUtc()
      .domain([new Date(from * 1000), new Date(to * 1000)])
      .range([0, width])
      .clamp(true);
    // A tick within a day, when a few days fill the width, gives its hour.
    const raw = s.ticks(Math.max(2, Math.floor(width / 90))).map((d, i) => {
      const t = d.getTime() / 1000;
      if (t % DAY !== 0) return { at: s(d), label: d.toISOString().slice(11, 16) };
      return { at: s(d), label: i === 0 ? formatDate(t) : formatDayMonth(t) };
    });
    return { x: (_, t) => s(new Date(t * 1000)), ticks: spaceTicks(raw, 64) };
  }
  const longest = Math.max(0, ...lanes.map((l) => (l.end - l.created) / DAY));
  const [lo, hi] = logDays(longest);
  const s = scaleLog().domain([lo, hi]).range([0, width]).clamp(true);
  return {
    x: (l, t) => (t < l.created ? null : s(Math.max(HOUR, (t - l.created) / DAY))),
    ticks: spaceTicks(
      durationTicks(lo, hi).map((d) => ({ at: s(d.days), label: d.label })),
      56,
    ),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The lanes' text alternative: how many, in what order, from which PR to which, and how they ended. */
export function describeLanes(lanes: readonly Lane[], total: number, orderName: string): string {
  const first = lanes[0];
  const last = lanes.at(-1);
  if (first === undefined || last === undefined) return '';
  const count = (s: Lane['state']) => lanes.filter((l) => l.state === s).length;
  const reopened = lanes.filter((l) => l.reopened > 0).length;
  const how = total > lanes.length ? `${formatCount(lanes.length)} of ${formatCount(total)} PRs` : plural(lanes.length, 'PR');
  return (
    `The timelines of ${how}, one per row, ${orderName}: ` +
    `from #${first.number}, opened ${formatDate(first.created)}, to #${last.number}, opened ${formatDate(last.created)}. ` +
    `${formatCount(count('merged'))} merged, ${formatCount(count('closed'))} closed unmerged, ${formatCount(count('open'))} still open; ` +
    `${reopened === 0 ? 'none was' : `${formatCount(reopened)} ${reopened === 1 ? 'was' : 'were'}`} closed and reopened.`
  );
}

/** The note over lanes that do not show the whole selection; null when they do. */
export function shownNote(shown: number, total: number, orderName: string): string | null {
  return shown >= total ? null : `Showing ${formatCount(shown)} of ${formatCount(total)} PRs, ${orderName}.`;
}
