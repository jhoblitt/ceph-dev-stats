import { describe, expect, it } from 'vitest';
import { barPath, durationTicks, endLabels, logDays, markerPath, spaceTicks, tickStride } from './plot';

describe('barPath', () => {
  it('rounds the data end and keeps the baseline square', () => {
    expect(barPath(10, 20, 8, 30, 4)).toBe('M10,50V24A4,4 0 0 1 14,20H14A4,4 0 0 1 18,24V50Z');
  });

  it('draws a plain rectangle with no radius', () => {
    expect(barPath(10, 20, 8, 30, 0)).toBe('M10,50V20H18V50Z');
  });

  it('shrinks the radius to fit a short or narrow bar', () => {
    expect(barPath(0, 0, 8, 2, 4)).toBe('M0,2V2A2,2 0 0 1 2,0H6A2,2 0 0 1 8,2V2Z');
    expect(barPath(0, 0, 4, 30, 4)).toBe('M0,30V2A2,2 0 0 1 2,0H2A2,2 0 0 1 4,2V30Z');
  });

  it('draws nothing for an empty bar', () => {
    expect(barPath(0, 0, 8, 0, 4)).toBe('');
  });
});

describe('tickStride', () => {
  it('labels every bucket when each is wide enough', () => {
    expect(tickStride(60, 48)).toBe(1);
  });

  it('skips buckets so labels do not run together', () => {
    expect(tickStride(20, 48)).toBe(3);
    expect(tickStride(0, 48)).toBe(1);
  });
});

describe('markerPath', () => {
  it('draws a different path for each shape', () => {
    const paths = (['circle', 'square', 'triangle', 'diamond'] as const).map((s) => markerPath(s));
    expect(new Set(paths).size).toBe(4);
    for (const p of paths) expect(p).toMatch(/^M/);
  });
});

describe('durations on a log axis', () => {
  it('runs from one hour to the longest duration, and at least to a day', () => {
    expect(logDays(40)).toEqual([1 / 24, 40]);
    expect(logDays(0.2)).toEqual([1 / 24, 1]);
    expect(logDays(0)).toEqual([1 / 24, 1]);
  });

  it('ticks the round durations in range, with their units', () => {
    expect(durationTicks(1 / 24, 40)).toEqual([
      { days: 1 / 24, label: '1 hour' },
      { days: 1, label: '1 day' },
      { days: 7, label: '1 week' },
      { days: 30, label: '1 month' },
    ]);
    expect(durationTicks(1 / 24, 1400).map((t) => t.label)).toEqual([
      '1 hour',
      '1 day',
      '1 week',
      '1 month',
      '3 months',
      '1 year',
    ]);
    expect(durationTicks(1 / 24, 1).map((t) => t.label)).toEqual(['1 hour', '1 day']);
  });
});

describe('spaceTicks', () => {
  it('drops a tick that would sit closer than the gap to the last one kept', () => {
    const ticks = [
      { at: 0, label: '1 hour' },
      { at: 100, label: '1 day' },
      { at: 150, label: '1 week' },
      { at: 190, label: '1 month' },
      { at: 230, label: '3 months' },
    ];
    // 1 month is 40 from 1 week; 3 months is then 80 from it.
    expect(spaceTicks(ticks, 48).map((t) => t.label)).toEqual(['1 hour', '1 day', '1 week', '3 months']);
  });

  it('measures the gap either way along the axis', () => {
    const down = [
      { at: 200, label: 'a' },
      { at: 190, label: 'b' },
      { at: 100, label: 'c' },
    ];
    expect(spaceTicks(down, 14).map((t) => t.label)).toEqual(['a', 'c']);
  });
});

describe('endLabels', () => {
  it('keeps labels that sit apart', () => {
    expect(endLabels([{ key: 'a', y: 10 }, { key: 'b', y: 40 }], 14)).toEqual([
      { key: 'a', y: 10 },
      { key: 'b', y: 40 },
    ]);
  });

  it('drops every label when two collide, leaving the legend to name the lines', () => {
    expect(endLabels([{ key: 'a', y: 10 }, { key: 'b', y: 40 }, { key: 'c', y: 50 }], 14)).toEqual([]);
  });
});
