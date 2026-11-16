// The Review section's charts and figures, from the statistics library's results.

import {
  type BucketModel,
  type Coverage,
  type CurveModel,
  type LegendItem,
  type LineSeries,
  NOT_YET_KNOWN,
  type Panel,
  type Quantiles,
  type Shape,
  bucketLegend,
  describeCounts,
  partialText,
} from './charts';
import { COLOURS } from './colours';
import type { Named } from './data';
import { type Target, dayOf } from './filters';
import { bucketName, formatCount, formatDays, formatMean, formatShare } from './format';
import type { Step } from './stats/buckets';
import { COMPARE_WEEKS, type Capacity, type WindowMean, compareEnds } from './stats/capacity';
import type { CommandUse } from './stats/commands';
import { type Curve, type Outcome, type Quantile, SPAN_OUTCOMES, type Span, spanQuantile } from './stats/curve';
import type { ReviewLoad } from './stats/reviewers';
import type { WaitingSeries, Weekly } from './stats/weekly';

const plural = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A small count in words, as a sentence says it; a larger one in figures. */
const inWords = (n: number) => WORDS[n] ?? formatCount(n);

/** A ratio or a count, exactly: whole numbers as counts, else two decimals. */
export function formatRatio(v: number): string {
  return Number.isInteger(v) ? formatCount(v) : v.toFixed(2).replace(/0$/, '');
}

const NO_ONE_REVIEWING = 'no one giving reviews';
const NO_PRS_OPENED = 'no PRs opened';

/**
 * Review capacity against arrivals, per bucket: the people giving reviews,
 * the PRs opened per person giving reviews, the human reviews per PR opened, and
 * the PRs waiting for a first response at the bucket's end, each a statistic
 * in neutral ink told apart by its marker. The counts the ratios divide ride
 * along undrawn, for the readout and the table.
 */
export function capacityModel(c: Capacity): BucketModel {
  const line = (key: string, label: string, shape: Shape, values: readonly (number | null)[], missing?: string): LineSeries => {
    const l: LineSeries = { key, label, color: COLOURS.statistic, shape, values };
    if (missing) l.missing = values.map((v) => (v === null ? missing : null));
    return l;
  };
  const count = (key: string, label: string, values: readonly number[]): LineSeries => ({
    ...line(key, label, 'circle', values),
    undrawn: true,
  });
  return {
    step: c.step,
    buckets: c.week,
    bars: [],
    lines: [
      line('reviewers', 'people giving reviews', 'square', c.reviewers),
      count('opened', 'PRs opened', c.opened),
      line('openedPerReviewer', 'PRs opened per person giving reviews', 'circle', c.openedPerReviewer, NO_ONE_REVIEWING),
      count('reviews', 'human reviews', c.reviews),
      line('reviewsPerOpened', 'human reviews per PR opened', 'triangle', c.reviewsPerOpened, NO_PRS_OPENED),
      line('waiting', 'PRs waiting for a first response', 'diamond', c.waiting),
    ],
    partialNote:
      `each ratio divides two partial counts; the PRs waiting are counted at the ${c.step}'s end, ` +
      "or at the period's end or the data's last fetch if sooner",
  };
}

/**
 * The capacity chart's key: only the partial bucket's mark, since each
 * panel's title names its one line.
 */
export function capacityLegend(model: BucketModel): LegendItem[] {
  return bucketLegend(model).filter((i) => i.mark === 'partial');
}

/** The capacity chart's four panels, each on its own scale with at least three labelled ticks. */
export function capacityPanels(step: Step): Panel[] {
  return [
    { keys: ['reviewers'], unit: `people giving reviews per ${step}`, minTicks: 3 },
    { keys: ['openedPerReviewer'], unit: 'PRs opened per person giving reviews', minTicks: 3 },
    { keys: ['reviewsPerOpened'], unit: 'human reviews per PR opened', minTicks: 3 },
    {
      keys: ['waiting'],
      unit: `PRs waiting for a first response, at the end of each ${step}`,
      narrowUnit: `PRs waiting for a first response, at ${step}'s end`,
      minTicks: 3,
    },
  ];
}

/** The line under the capacity chart's title: what the reviews-per-PR panel divides. */
export function capacityNote(step: Step): string {
  return (
    `"Human reviews per PR opened" compares two flows of the same ${step}, not one group of PRs followed over time: ` +
    `the human reviews done that ${step}, on any selected PR, against the PRs opened that ${step}.`
  );
}

/**
 * What the capacity chart is missing when there are no arrivals to set it
 * against: no PR opened in the period, or none in any of its full buckets.
 * Null when there is something to draw, or no bucket at all.
 */
export function capacityNothing(c: Capacity, partial: readonly (Coverage | null)[]): string | null {
  if (c.week.length === 0) return null;
  if (c.opened.every((n) => n === 0)) return 'no PR was opened in this period, so there are no arrivals to set review against';
  const whole = c.opened.filter((_, i) => (partial[i] ?? null) === null);
  if (whole.length > 0 && whole.every((n) => n === 0)) {
    return `no PR was opened in any full ${c.step} of this period, so there are no arrivals to set review against`;
  }
  return null;
}

/** One ratio's first four and last four complete buckets, as a sentence without its full stop. */
function compareSentence(label: string, cmp: { first: WindowMean; last: WindowMean }, reason: string, step: Step): string {
  const part = (w: WindowMean, where: string) => {
    if (w.mean === null) return `none in the ${where}, ${reason} in all ${formatCount(w.weeks)}`;
    const left = w.missing > 0 ? ` (${plural(w.missing, step)} with ${reason} left out)` : '';
    return `${formatRatio(w.mean)} in the ${where}${left}`;
  };
  const n = inWords(COMPARE_WEEKS);
  return `${label}, a ${step} on average: ${part(cmp.first, `first ${n} full ${step}s`)}, ${part(cmp.last, `last ${n}`)}`;
}

/** The PRs waiting for a first response at the end of the first and the last complete bucket, and the change. */
function waitingSentence(c: Capacity, complete: readonly boolean[]): string | null {
  const whole = c.waiting.filter((_, i) => complete[i]);
  if (whole.length < 2) return null;
  const [first, last] = [whole[0] as number, whole.at(-1) as number];
  const change = last > first ? `${formatCount(last - first)} more` : last < first ? `${formatCount(first - last)} fewer` : 'no change';
  return (
    `PRs waiting for a first response: ${formatCount(first)} at the end of the first full ${c.step}, ` +
    `${formatCount(last)} at the end of the last, ${change}.`
  );
}

/**
 * The answer in words: each ratio's mean over the first four and the last
 * four complete buckets, or that there are too few complete buckets; and the
 * PRs waiting for a first response at the end of the first and the last.
 */
export function capacitySentences(c: Capacity, partial: readonly (Coverage | null)[]): string[] {
  const complete = c.week.map((_, i) => (partial[i] ?? null) === null);
  const perReviewer = compareEnds(c.openedPerReviewer, complete);
  const perOpened = compareEnds(c.reviewsPerOpened, complete);
  const waiting = waitingSentence(c, complete);
  const ratios =
    perReviewer === null || perOpened === null
      ? [
          `Too few full ${c.step}s to compare the first ${inWords(COMPARE_WEEKS)} with the last ${inWords(COMPARE_WEEKS)}: ${formatCount(complete.filter(Boolean).length)} of the ${formatCount(2 * COMPARE_WEEKS)} needed.`,
        ]
      : [
          `${compareSentence('PRs opened per person giving reviews', perReviewer, NO_ONE_REVIEWING, c.step)}.`,
          `${compareSentence('Human reviews per PR opened', perOpened, NO_PRS_OPENED, c.step)}.`,
        ];
  return waiting === null ? ratios : [...ratios, waiting];
}

/** The capacity chart's text alternative: the people giving reviews, the answer, the gaps and the partial buckets. */
export function describeCapacity(c: Capacity, partial: readonly (Coverage | null)[]): string {
  if (c.week.length === 0) return '';
  const out = [
    `By ${c.step}, ${plural(c.week.length, c.step)} from ${dayOf(c.week[0] as number)} to ${dayOf(c.week.at(-1) as number)}.`,
  ];
  const whole = c.reviewers.filter((_, i) => (partial[i] ?? null) === null);
  if (whole.length > 0) {
    out.push(`People giving reviews: from ${formatCount(Math.min(...whole))} to ${formatCount(Math.max(...whole))} a full ${c.step}.`);
  }
  out.push(...capacitySentences(c, partial));
  const gaps = (values: readonly (number | null)[], reason: string) => {
    const n = values.filter((v) => v === null).length;
    return n > 0 ? [`${reason.charAt(0).toUpperCase()}${reason.slice(1)} in ${plural(n, c.step)}.`] : [];
  };
  out.push(...gaps(c.openedPerReviewer, NO_ONE_REVIEWING), ...gaps(c.reviewsPerOpened, NO_PRS_OPENED));
  const cut = c.week.flatMap((start, i) => {
    const p = partial[i] ?? null;
    return p === null ? [] : [`${bucketName(start, c.step)}, ${partialText(p)}`];
  });
  if (cut.length > 0) {
    out.push(
      `Partial, each ratio dividing two partial counts and the PRs waiting counted at the ${c.step}'s end, ` +
        `or at the period's end or the data's last fetch if sooner: ${cut.join('; ')}.`,
    );
  }
  return out.join(' ');
}

/** The reviews per bucket, human under bot. */
export function reviewsModel(reviews: Weekly<number>): BucketModel {
  return {
    step: reviews.step,
    buckets: reviews.week,
    bars: [
      { key: 'human', label: 'human reviews', color: COLOURS.humanReviews, values: reviews.values['human'] ?? [] },
      { key: 'bot', label: 'bot reviews', color: COLOURS.botReviews, values: reviews.values['bot'] ?? [] },
    ],
    stackLabel: 'reviews',
    lines: [],
  };
}

/** The waits drawn by week opened: the median and the slowest tenth. */
export function waitingSeries(span: Span): WaitingSeries {
  return { kind: 'waitingByWeekOpened', span, quantiles: [0.5, 0.9] };
}

const OUTCOME_LABELS: { [S in Span]: Record<Outcome<S>, string> } = {
  merge: { merged: 'merged', closed: 'closed unmerged', open: 'still open' },
  response: { responded: 'responded', finished: 'finished without a response', waiting: 'still waiting' },
  approval: { approved: 'approved', finished: 'finished without an approval', waiting: 'still waiting' },
  afterApproval: { merged: 'merged', closed: 'closed unmerged', open: 'still open' },
  afterLastCommit: { merged: 'merged', closed: 'closed unmerged', open: 'still open' },
  firstCommitToOpened: { done: 'opened' },
  openedToLastCommit: { done: 'last commit made' },
};

/** A quantile that has no value, in words: why. Null for a known one, or for no PR to measure. */
function quantileText(q: Quantile, span: Span): string | null {
  switch (q.state) {
    case 'known':
    case 'none':
      return null;
    case 'notYetKnown':
      return NOT_YET_KNOWN;
    case 'notReached': {
      const first = SPAN_OUTCOMES[span][0];
      return `not reached: ${formatShare(q.share)} ${(OUTCOME_LABELS[span] as Record<string, string>)[first] as string}`;
    }
  }
}

/**
 * The median and 90th-percentile waits by bucket opened, both in neutral ink,
 * the percentile dashed. A quantile not yet known shades its bucket; one that
 * can no longer be reached is marked and says the outcome's share; a bucket
 * with nothing to measure says so, apart from both.
 */
export function waitsModel(waiting: Weekly<Quantile>, opened: Weekly<number>, span: Span): BucketModel {
  const nd = opened.values['not-disclosed'] ?? [];
  const d = opened.values['disclosed'] ?? [];
  const line = (key: '0.5' | '0.9', label: string, shape: Shape): LineSeries => {
    const q = waiting.values[key] ?? [];
    const l: LineSeries = {
      key,
      label,
      color: COLOURS.statistic,
      shape,
      values: q.map((v) => (v.state === 'known' ? v.days : null)),
      missing: q.map((v) => quantileText(v, span)),
      unreached: q.map((v) => v.state === 'notReached'),
    };
    if (key === '0.9') l.dashed = true;
    return l;
  };
  const median = waiting.values['0.5'] ?? [];
  const p90 = waiting.values['0.9'] ?? [];
  return {
    step: waiting.step,
    buckets: waiting.week,
    bars: [],
    lines: [line('0.5', 'median', 'circle'), line('0.9', '90th percentile', 'square')],
    notes: waiting.week.map((_, i) => {
      if (median[i]?.state !== 'none') return null;
      return (nd[i] ?? 0) + (d[i] ?? 0) === 0 ? 'no PRs opened' : 'no PR to measure';
    }),
    shade: waiting.week.map((_, i) => median[i]?.state === 'notYetKnown' || p90[i]?.state === 'notYetKnown'),
    shadeLabel: NOT_YET_KNOWN,
  };
}

// An outcome's colour is its role, the same in every chart: reached it,
// finished without it, or still waiting for it.
const ROLE_COLOURS = [COLOURS.reached, COLOURS.finishedWithout, COLOURS.waiting];
const SHAPES: readonly Shape[] = ['circle', 'square', 'triangle'];

/** A span's outcome curve with its outcomes named; with three, the last is what remains. */
export function curveModel<S extends Span>(curve: Curve<Outcome<S>>, span: S): CurveModel {
  const outcomes: readonly Outcome<S>[] = SPAN_OUTCOMES[span];
  const labels: Record<Outcome<S>, string> = OUTCOME_LABELS[span];
  return {
    days: curve.days,
    series: outcomes.map((o, k) => ({
      key: o,
      label: labels[o],
      color: ROLE_COLOURS[k] as string,
      shape: SHAPES[k] as Shape,
      values: curve.shares[o],
      remains: outcomes.length === 3 && k === 2,
    })),
  };
}

/**
 * The median and 90th percentile of a span's first outcome, written: a
 * duration, "not yet known", or "not reached" with the outcome's share.
 */
export function curveQuantiles<S extends Span>(curve: Curve<Outcome<S>>, span: S): Quantiles {
  const write = (p: number) => {
    const q = spanQuantile(curve, span, p);
    return q.state === 'known' ? formatDays(q.days) : (quantileText(q, span) ?? NOT_YET_KNOWN);
  };
  return { median: write(0.5), p90: write(0.9) };
}

/**
 * What a curve with PRs selected but nothing to measure is missing, in its
 * own words. `opened` is how many selected PRs were opened in the period.
 */
export function curveNothing(span: Span, opened: number): string {
  if (opened === 0) return 'no PR was opened in this period';
  switch (span) {
    case 'response':
    case 'approval':
      return 'no PR opened in this period has been ready for review';
    case 'afterApproval':
      return 'no PR opened in this period has been approved';
    case 'afterLastCommit':
      return 'no PR opened in this period has a known last commit';
    case 'firstCommitToOpened':
      return 'no PR opened in this period has a known first commit before its opening';
    case 'openedToLastCommit':
      return 'no PR opened in this period has finished with a known last commit';
    case 'merge':
      return 'no PR opened in this period can be measured';
  }
}

/**
 * What a waits chart is missing when no bucket of it has anything to measure,
 * in the words its curve uses; null when some bucket has a wait to draw.
 */
export function waitsNothing(model: BucketModel, span: Span, opened: number): string | null {
  if (opened > 0 && model.notes?.some((n) => n === null)) return null;
  return curveNothing(span, opened);
}

const SPAN_TITLES: Record<'firstCommitToOpened' | 'openedToLastCommit' | 'afterLastCommit', string> = {
  firstCommitToOpened: 'First commit to opened',
  openedToLastCommit: 'Opened to last commit',
  afterLastCommit: 'Last commit to final disposition',
};

/**
 * A span's title. A backport's first commit is the original work's, so with
 * only backports selected the first span measures how long after it the
 * backport was opened.
 */
export function spanTitle(span: keyof typeof SPAN_TITLES, target: Target): string {
  if (span === 'firstCommitToOpened' && target === 'backports') return 'Original work to backport opened';
  return SPAN_TITLES[span];
}

/** A note under a span's title, where the selection mixes what it measures; else undefined. */
export function spanNote(span: keyof typeof SPAN_TITLES, target: Target): string | undefined {
  return span === 'firstCommitToOpened' && target === 'all'
    ? 'For a backport, the first commit is the original work’s, so this is how long after it the backport was opened.'
    : undefined;
}

/** How many commands' panels show before "show all". */
export const BUSIEST_COMMANDS = 6;

/** The bot commands per bucket, one bar series per command used, the most used first, ties by name. */
export function commandsModel(commands: Weekly<number>, names: readonly Named[]): BucketModel {
  const used = names
    .map((c) => {
      const values = commands.values[c.id] ?? [];
      return { c, values, total: values.reduce((a, b) => a + b, 0) };
    })
    .filter((u) => u.total > 0)
    .sort((a, b) => b.total - a.total || a.c.name.localeCompare(b.c.name, 'en'));
  return {
    step: commands.step,
    buckets: commands.week,
    bars: used.map((u) => ({ key: u.c.id, label: u.c.name, color: COLOURS.command, values: u.values })),
    lines: [],
  };
}

export interface CommandFigures {
  /** The share of the PRs opened in the period with a bot command. */
  share: string | null;
  /** The bot commands on each merged PR; null when none merged. */
  merged: { mean: string; median: string; p90: string } | null;
}

export function commandFigures(use: CommandUse): CommandFigures {
  return {
    share: use.share === null ? null : formatShare(use.share),
    merged:
      use.merged === null
        ? null
        : { mean: formatMean(use.merged.mean), median: formatCount(use.merged.median), p90: formatCount(use.merged.p90) },
  };
}

/** The text alternative of the bot-command chart: each command's count, then their use. */
export function commandSummary(model: BucketModel, figures: CommandFigures): string {
  const out = [describeCounts(model)];
  if (figures.share !== null) out.push(`${figures.share} of the PRs opened in the period had a bot command.`);
  const m = figures.merged;
  out.push(
    m === null
      ? 'No PR opened in the period has merged.'
      : `Bot commands on merged PRs: mean ${m.mean}, median ${m.median}, 90th percentile ${m.p90}.`,
  );
  return out.join(' ');
}

/**
 * Who carried the human reviews, as one sentence with no names: with ten
 * reviewers or fewer, how many people did them; with more, the share of the
 * ten busiest.
 */
export function reviewerShareText(load: ReviewLoad): string {
  if (load.share === null) return 'There were no reviews in this period.';
  if (load.reviewers === 0) return 'The human reviews in this period came from accounts that no longer exist.';
  if (load.reviewers > 10) {
    return `The ten busiest of ${formatCount(load.reviewers)} reviewers did ${formatShare(load.share)} of the human reviews in this period.`;
  }
  const people = `${formatCount(load.reviewers)} ${load.reviewers === 1 ? 'person' : 'people'}`;
  // Reviews by deleted accounts have no person to count, so all can fall short of 100%.
  const what = load.share >= 1 ? 'all' : formatShare(load.share);
  return `${people} did ${what} of the human reviews in this period.`;
}
