// What every colour on the page stands for. A colour keeps one meaning
// across all the charts, so a reader who learns "orange is disclosed" is
// never told otherwise; a chart takes its colours from here and nowhere else.
//
// Validated with the dataviz skill's palette checks, in both themes, for
// every pair that touches in a chart:
// - the outcomes, all pairs (they meet as lines in one curve);
// - the review kinds, adjacent (they stack);
// - disclosure, adjacent (it stacks).
// The PRs naming a tool family all disclose, so the family panels are drawn
// in the disclosed colour, each named by its panel.
// No outcome or review-kind hue clears the floors against both disclosure
// hues, so no line is drawn over the disclosure bars: a chart that sets them
// against each other stacks them in panels on one time axis.

import type { AGE_BANDS } from './filters';

export const COLOURS = {
  /** PRs by disclosure, and the tool families named by the disclosing. Nothing else uses these two. */
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

/**
 * The timelines of PRs. Colour says who acted, in the review hues' meaning
 * (another person, a bot), or how the PR ended, in the outcome hues'; the
 * PR's own lifecycle and its author's activity are ink. Shape and row tell
 * the kinds apart, never colour alone.
 *
 * Validated as they meet: within a row, another person against a bot
 * (adjacent), and the outcomes all pairs on the PR's line. The outcome hues
 * fail against both review hues in dark mode (merged against another
 * person, CVD ΔE 1.6; merged against a bot, normal-vision ΔE 9.8; still open
 * against a bot, CVD ΔE 3.0), so the line never shares a row with them, a
 * row of ink lies between, and the lanes draw their events in ink.
 */
export const TIMELINE_COLOURS = {
  /** The PR's own line and lifecycle: opened, its commits, ready, draft, force-push, reopened. */
  lifecycle: 'var(--text)',
  /** What the PR's author did on it. */
  author: 'var(--text-muted)',
  /** The stretch before the PR opened, and the lanes' events. */
  quiet: 'var(--text-faint)',
  byOther: COLOURS.humanReviews,
  byBot: COLOURS.botReviews,
  merged: COLOURS.reached,
  /** A close, and a stretch the PR spent closed. */
  closed: COLOURS.finishedWithout,
  open: COLOURS.waiting,
  command: COLOURS.command,
  /** The wash behind a cut or stretched stretch of the time axis. */
  axisNote: COLOURS.notYetKnown,
} as const;

/** The backlog's age bands, youngest first: an ordinal ramp of neutrals, since no series hue is free. */
export const AGE_COLOURS: Record<(typeof AGE_BANDS)[number]['id'], string> = {
  lt7: 'var(--ordinal-1)',
  '7-30': 'var(--ordinal-2)',
  '30-90': 'var(--ordinal-3)',
  gt90: 'var(--ordinal-4)',
};
