// The open backlog at the end of each week (or month), in age bands.

import type { Dataset } from '../data';
import { AGE_BANDS, type AgeBand, DAY } from '../filters';
import { type Period, type Step, bucketEnd, buckets, stepFor } from './buckets';

/** Each band's ages in days since opening, the lower bound inclusive. */
const AGE_DAYS: Record<AgeBand, readonly [number, number]> = {
  lt7: [0, 7],
  '7-30': [7, 30],
  '30-90': [30, 90],
  gt90: [90, Infinity],
};

export interface Backlog {
  /** Each bucket's first instant in epoch seconds: a Monday, or the first of a month. */
  week: number[];
  step: Step;
  /** The PRs open at each bucket's end, by age band, aligned with `week`. */
  bands: Record<AgeBand, number[]>;
}

/** The first index whose value is at least `x`. */
function lowerBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A stretch of time a row was open: the instants t with from < t <= to. */
type Stretch = (r: number, from: number, to: number) => void;

/**
 * Walks a row's open stretches. A reopened row's closed stretches run from
 * each `closed` event to the `reopened` event after it; its last open
 * stretch ends at the final disposition.
 */
function openStretches(data: Dataset): (r: number, fn: Stretch) => void {
  const p = data.prs;
  const ev = data.events;
  const closedKind = data.meta.event_kinds.indexOf('closed');
  const reopenedKind = data.meta.event_kinds.indexOf('reopened');
  return (r, fn) => {
    const end = (p.closed[r] as number) < 0 ? Infinity : (p.closed[r] as number);
    let from = p.created[r] as number;
    let open = true;
    if ((p.reopened[r] as number) > 0) {
      for (let e = lowerBound(ev.pr, r); e < ev.pr.length && ev.pr[e] === r; e++) {
        const kind = ev.kind[e];
        if (open && kind === closedKind) {
          fn(r, from, ev.at[e] as number);
          open = false;
        } else if (!open && kind === reopenedKind) {
          from = ev.at[e] as number;
          open = true;
        }
      }
    }
    if (open) fn(r, from, end);
  };
}

/**
 * The instant the backlog of the period's bucket starting at `bucket` is
 * measured: the bucket's end, or the period's end or `fetched_through` when
 * either comes first.
 */
export function backlogMoment(data: Dataset, period: Period, bucket: number): number {
  return Math.min(bucketEnd(bucket, stepFor(period)), period.end, data.meta.fetched_through);
}

/**
 * The rows open at each bucket's `backlogMoment`: opened before then and not
 * inside a closed stretch.
 */
export function backlog(data: Dataset, rows: Uint32Array, period: Period): Backlog {
  const b = buckets(period);
  if (rows.length === 0) return { week: [], step: b.step, bands: { lt7: [], '7-30': [], '30-90': [], gt90: [] } };
  const p = data.prs;
  const moments = Float64Array.from(b.starts, (s) => backlogMoment(data, period, s));
  // Per band, +1 where a row starts counting and -1 where it stops.
  const diff = AGE_BANDS.map(() => new Int32Array(moments.length + 1));

  // Counts row `r` at each moment in the stretch, in the band of its age then.
  const count: Stretch = (r, from, to) => {
    const created = p.created[r] as number;
    AGE_BANDS.forEach((band, k) => {
      const [young, old] = AGE_DAYS[band.id];
      // Times are whole seconds, so from < t <= to is from + 1 <= t < to + 1.
      const first = lowerBound(moments, Math.max(from + 1, created + young * DAY));
      const last = lowerBound(moments, Math.min(to + 1, created + old * DAY));
      if (first < last) {
        const d = diff[k] as Int32Array;
        d[first] = (d[first] as number) + 1;
        d[last] = (d[last] as number) - 1;
      }
    });
  };

  const walk = openStretches(data);
  for (let i = 0; i < rows.length; i++) walk(rows[i] as number, count);

  const bands = {} as Backlog['bands'];
  AGE_BANDS.forEach((band, k) => {
    const d = diff[k] as Int32Array;
    let running = 0;
    bands[band.id] = b.starts.map((_, w) => (running += d[w] as number));
  });
  return { week: b.starts, step: b.step, bands };
}

/**
 * The rows open at instant `at` whose age then falls in `band`. With `at`
 * the `backlogMoment` of a bucket, these are the PRs behind that band of the
 * bucket's bar.
 */
export function backlogRows(data: Dataset, rows: Uint32Array, band: AgeBand, at: number): Uint32Array {
  const p = data.prs;
  const [young, old] = AGE_DAYS[band];
  const walk = openStretches(data);
  let open = false;
  const openAt: Stretch = (_r, from, to) => {
    if (from < at && at <= to) open = true;
  };
  const out = new Uint32Array(rows.length);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const created = p.created[r] as number;
    if (!(created + young * DAY <= at && at < created + old * DAY)) continue;
    open = false;
    walk(r, openAt);
    if (open) out[n++] = r;
  }
  return out.slice(0, n);
}
