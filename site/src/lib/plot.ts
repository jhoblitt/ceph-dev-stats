// Geometry the chart parts share, kept out of the components so it can be
// tested without a DOM.

import { symbol, symbolCircle, symbolDiamond, symbolSquare, symbolTriangle } from 'd3-shape';
import type { Shape } from './charts';

const SYMBOLS = { circle: symbolCircle, square: symbolSquare, triangle: symbolTriangle, diamond: symbolDiamond };

/** A marker centred on 0,0; `size` is its area in square pixels, 64 being about 8px across. */
export function markerPath(shape: Shape, size = 64): string {
  return symbol(SYMBOLS[shape], size)() ?? '';
}

/**
 * A bar `w` wide from `y` down to `y + h`, its data end at `y` rounded by
 * `r` and its baseline square. The radius shrinks to fit a short or narrow
 * bar; an empty bar draws nothing.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return '';
  const base = y + h;
  const k = Math.min(r, h, w / 2);
  if (k <= 0) return `M${x},${base}V${y}H${x + w}V${base}Z`;
  return (
    `M${x},${base}V${y + k}A${k},${k} 0 0 1 ${x + k},${y}` +
    `H${x + w - k}A${k},${k} 0 0 1 ${x + w},${y + k}V${base}Z`
  );
}

/** An axis tick: where it sits along its axis, in the plot's pixels, and its label. */
export interface Tick {
  at: number;
  label: string;
  /** The selected bucket's tick, set in bold. */
  strong?: boolean;
}

/** An hour in days: the left (or bottom) edge of a log duration axis. */
export const HOUR = 1 / 24;

const ROUND_DURATIONS = [
  { days: HOUR, label: '1 hour' },
  { days: 1, label: '1 day' },
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
];

/**
 * A log duration axis's domain in days: from one hour, where anything shorter
 * is drawn, to the longest duration, and at least to a day.
 */
export function logDays(longest: number): [number, number] {
  return [HOUR, Math.max(1, longest)];
}

/** The round durations that fall on a log duration axis, labelled with their units. */
export function durationTicks(min: number, max: number): { days: number; label: string }[] {
  return ROUND_DURATIONS.filter((t) => t.days >= min - 1e-9 && t.days <= max + 1e-9);
}

/** The ticks that keep at least `gap` pixels from the last one kept, so labels do not run together. */
export function spaceTicks(ticks: readonly Tick[], gap: number): Tick[] {
  const out: Tick[] = [];
  for (const t of ticks) {
    const prev = out.at(-1);
    if (prev === undefined || Math.abs(t.at - prev.at) >= gap) out.push(t);
  }
  return out;
}

/** Label every n-th bucket, so labels `minLabel` pixels wide do not run together. */
export function tickStride(bucketStep: number, minLabel: number): number {
  return bucketStep <= 0 ? 1 : Math.max(1, Math.ceil(minLabel / bucketStep));
}

export interface EndLabel {
  key: string;
  y: number;
}

/**
 * The line-end labels to draw, top to bottom. When two would sit closer than
 * `gap`, none is drawn: nudged apart they would leave their lines, so the
 * legend and the markers name the lines instead.
 */
export function endLabels<L extends EndLabel>(labels: readonly L[], gap: number): L[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as L).y - (sorted[i - 1] as L).y < gap) return [];
  }
  return sorted;
}
