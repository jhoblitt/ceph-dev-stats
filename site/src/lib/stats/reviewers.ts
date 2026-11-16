// Reviewer load as a share, never as names: no view ranks people.

import type { Dataset } from '../data';
import type { Period } from './buckets';
import { HUMAN_REVIEWS, kindTable, rowMask } from './events';

/**
 * The share of the human reviews made on the rows during the period that the
 * `top` busiest people made; null when there is no review to share.
 */
export function reviewerShare(data: Dataset, rows: Uint32Array, period: Period, top: number): number | null {
  const table = kindTable(data, Object.fromEntries(HUMAN_REVIEWS.map((k) => [k, 1])));
  const mask = rowMask(data, rows);
  const ev = data.events;
  const byActor = new Map<number, number>();
  let total = 0;
  for (let e = 0; e < ev.pr.length; e++) {
    const t = ev.at[e] as number;
    if (mask[ev.pr[e] as number] !== 1 || table[ev.kind[e] as number] !== 1 || t < period.start || t >= period.end) {
      continue;
    }
    total++;
    const actor = ev.actor[e] as number;
    if (actor >= 0) byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
  }
  if (total === 0) return null;
  const busiest = [...byActor.values()].sort((a, b) => b - a).slice(0, top);
  return busiest.reduce((n, c) => n + c, 0) / total;
}
