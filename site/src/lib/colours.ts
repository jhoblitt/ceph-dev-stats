// What every colour on the page stands for. A colour keeps one meaning
// across all the charts, so a reader who learns "orange is disclosed" is
// never told otherwise; a chart takes its colours from here and nowhere else.
//
// Validated with the dataviz skill's palette checks, in both themes, for
// every pair that touches in a chart:
// - the outcomes, all pairs (they meet as lines in one curve);
// - the review kinds, adjacent (they stack);
// - disclosure, adjacent (it stacks).
// No outcome or review-kind hue clears the floors against both disclosure
// hues, so no line is drawn over the disclosure bars: a chart that sets them
// against each other stacks them in panels on one time axis.

import type { AGE_BANDS } from './filters';

export const COLOURS = {
  /** PRs by disclosure. Nothing else uses these two. */
  notDisclosed: 'var(--series-1)',
  disclosed: 'var(--series-2)',

  /** A span's outcome: merged, responded, approved, done. */
  reached: 'var(--series-3)',
  /** Finished without it: closed unmerged, or finished without a response or an approval. */
  finishedWithout: 'var(--series-7)',
  /** No outcome yet: still open, or still waiting. */
  waiting: 'var(--series-4)',

  /** Reviews by who made them. */
  humanReviews: 'var(--series-5)',
  botReviews: 'var(--series-6)',

  /**
   * A figure that is not an entity, such as the people reviewing, a median or
   * a percentile: neutral ink, told apart by dash and marker.
   */
  statistic: 'var(--text-muted)',
  /** Bot commands, one command per panel, named by the panel. */
  command: 'var(--text-faint)',
  /** A wash behind the buckets whose value is not yet known. */
  notYetKnown: 'var(--grid)',
  /** The key of a bucket the period or the fetch cuts short; its marks are drawn faded. */
  partial: 'var(--text-faint)',
} as const;

/** The backlog's age bands, youngest first: an ordinal ramp of neutrals, since no series hue is free. */
export const AGE_COLOURS: Record<(typeof AGE_BANDS)[number]['id'], string> = {
  lt7: 'var(--ordinal-1)',
  '7-30': 'var(--ordinal-2)',
  '30-90': 'var(--ordinal-3)',
  gt90: 'var(--ordinal-4)',
};
