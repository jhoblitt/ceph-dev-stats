// Review capacity against arrivals: how many PRs each person giving reviews faces,
// how many human reviews each PR opened gets, and how many PRs wait for a
// first response, week by week.

import type { Step } from './buckets';
import type { Weekly } from './weekly';

/** Each numerator over its divisor; null where the divisor is zero, never zero or infinity. */
export function ratio(numerators: readonly number[], divisors: readonly number[]): (number | null)[] {
  return numerators.map((n, i) => {
    const d = divisors[i] ?? 0;
    return d === 0 ? null : n / d;
  });
}

export interface Capacity {
  /** Each bucket's first instant, epoch seconds. */
  week: number[];
  step: Step;
  /** PRs opened, of every disclosure. */
  opened: number[];
  /** Human reviews done, on any selected PR. */
  reviews: number[];
  /** Distinct people who gave a human review. */
  reviewers: number[];
  /** Selected PRs waiting for a first response at the bucket's end, as `awaitingResponse` counts them. */
  waiting: number[];
  /** PRs opened over people giving reviews; null with no one giving reviews. */
  openedPerReviewer: (number | null)[];
  /** Human reviews done over PRs opened; null with no PRs opened. */
  reviewsPerOpened: (number | null)[];
}

/**
 * Capacity from the weekly `opened`, `reviews` and `reviewers` series and
 * `awaitingResponse`, over one selection and period. The reviews are those
 * of that week on any selected PR, not only on the PRs opened that week:
 * reviews per PR opened compares two flows.
 */
export function capacity(
  opened: Weekly<number>,
  reviews: Weekly<number>,
  reviewers: Weekly<number>,
  waiting: Weekly<number>,
): Capacity {
  const disclosed = opened.values['disclosed'] ?? [];
  const notDisclosed = opened.values['not-disclosed'] ?? [];
  const o = opened.week.map((_, i) => (disclosed[i] ?? 0) + (notDisclosed[i] ?? 0));
  const r = opened.week.map((_, i) => reviews.values['human']?.[i] ?? 0);
  const p = opened.week.map((_, i) => reviewers.values['reviewers']?.[i] ?? 0);
  return {
    week: opened.week,
    step: opened.step,
    opened: o,
    reviews: r,
    reviewers: p,
    waiting: opened.week.map((_, i) => waiting.values['waiting']?.[i] ?? 0),
    openedPerReviewer: ratio(o, p),
    reviewsPerOpened: ratio(r, o),
  };
}

export interface WindowMean {
  /** The mean of the weeks with a value; null when none has one. */
  mean: number | null;
  weeks: number;
  /** The weeks with no value, left out of the mean. */
  missing: number;
}

/**
 * The means of the first `n` and the last `n` complete buckets, or null with
 * fewer than `2n` complete buckets to compare.
 */
export function compareEnds(
  values: readonly (number | null)[],
  complete: readonly boolean[],
  n = 4,
): { first: WindowMean; last: WindowMean } | null {
  const whole = values.flatMap((_, i) => (complete[i] ? [i] : []));
  if (whole.length < 2 * n) return null;
  const window = (indexes: number[]): WindowMean => {
    const known = indexes.map((i) => values[i] ?? null).filter((v): v is number => v !== null);
    return {
      mean: known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length,
      weeks: indexes.length,
      missing: indexes.length - known.length,
    };
  };
  return { first: window(whole.slice(0, n)), last: window(whole.slice(-n)) };
}
