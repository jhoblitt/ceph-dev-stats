// Filters to a selection of rows. The selection is of PRs; an event is in it
// when its PR is.

import type { Dataset, Meta } from './data';
import { type Filters, SIZE_BANDS, STANDING_BANDS, UNKNOWN_KIND, periodRange } from './filters';
import { type Period, bucketOf, buckets } from './stats/buckets';

/**
 * The rows the filters select, ascending. The period keeps every PR active in
 * it: opened before its end and not finished before its start, so a PR opened
 * earlier and still worked on counts in the calendar charts.
 */
export function select(data: Dataset, filters: Filters): Uint32Array {
  const p = data.prs;
  const meta = data.meta;
  const { start, end } = periodRange(filters);
  const main = meta.bases.indexOf('main');
  const component = filters.component === null ? -1 : meta.components.findIndex((c) => c.id === filters.component);
  const kind = kindValue(meta, filters.kind);
  const size = SIZE_BANDS.find((b) => b.id === filters.size);
  const standing = STANDING_BANDS.find((b) => b.id === filters.standing);
  const none = meta.disclosure.indexOf('none');

  const out = new Uint32Array(data.size);
  let n = 0;
  for (let r = 0; r < data.size; r++) {
    if (!((p.created[r] as number) < end)) continue;
    const closed = p.closed[r] as number;
    if (closed >= 0 && closed < start) continue;
    if (filters.target === 'main' && p.base[r] !== main) continue;
    if (filters.target === 'backports' && p.base[r] === main) continue;
    if (filters.component !== null && !(p.components[r] as readonly number[]).includes(component)) continue;
    if (size) {
      const lines = (p.additions[r] as number) + (p.deletions[r] as number);
      if (lines < size.min || lines > size.max) continue;
    }
    if (standing) {
      const s = p.standing[r] as number;
      if (s < standing.min || s > standing.max) continue;
    }
    if (filters.disclosure === 'disclosed' && p.disclosure[r] === none) continue;
    if (filters.disclosure === 'not-disclosed' && p.disclosure[r] !== none) continue;
    if (kind !== null && p.kind[r] !== kind) continue;
    if (filters.excludeDrafts && p.draft[r] === 1) continue;
    if (filters.reopenedOnly && !((p.reopened[r] as number) > 0)) continue;
    out[n++] = r;
  }
  return out.slice(0, n);
}

/**
 * The `kind` value the Kind filter keeps: null for every kind, -1 for the
 * unknown ones, and -2, which no row has, for a kind meta does not name.
 */
function kindValue(meta: Meta, id: string | null): number | null {
  if (id === null) return null;
  if (id === UNKNOWN_KIND.id) return -1;
  const i = meta.kinds.findIndex((k) => k.id === id);
  return i === -1 ? -2 : i;
}

/**
 * The rows of a selection opened in the window during the period: those the
 * outcome curves and the charts by week opened are about.
 */
export function openedIn(data: Dataset, rows: Uint32Array, period: Period): Uint32Array {
  const p = data.prs;
  return rows.filter((r) => {
    const created = p.created[r] as number;
    return p.in_window[r] === 1 && created >= period.start && created < period.end;
  });
}

/**
 * The rows of a selection opened in the window during the bucket that starts
 * at `bucket`, a week or a month by the period's step: the PRs behind a bar
 * of the weekly `opened` series. No rows when `bucket` starts none of the
 * period's buckets.
 */
export function openedInBucket(data: Dataset, rows: Uint32Array, period: Period, bucket: number): Uint32Array {
  const b = buckets(period);
  const w = b.starts.indexOf(bucket);
  if (w === -1) return new Uint32Array(0);
  const p = data.prs;
  return rows.filter((r) => p.in_window[r] === 1 && bucketOf(b, p.created[r] as number) === w);
}
