import { describe, expect, it } from 'vitest';
import type { Dataset, PrColumns } from '../data';
import { DAY } from '../filters';
import { backlog } from './backlog';
import { outcomeCurve } from './curve';
import { META, all, random } from './testing';
import { weekly } from './weekly';

const ROWS = 100_000;
const EVENTS_PER_ROW = 20;
const START = Date.UTC(2026, 4, 15) / 1000;
const NOW = START + 183 * DAY;
const PERIOD = { start: START, end: NOW };

/** 100,000 PRs and 2,000,000 events spread over six months. */
function synthetic(): Dataset {
  const rnd = random(42);
  const time = (from: number) => from + Math.floor(rnd() * (NOW - from));
  const created = new Float64Array(ROWS);
  const closed = new Float64Array(ROWS);
  const state = new Uint8Array(ROWS);
  const response = new Float64Array(ROWS);
  for (let r = 0; r < ROWS; r++) {
    created[r] = time(START);
    state[r] = Math.floor(rnd() * 3);
    closed[r] = state[r] === 0 ? -1 : time(created[r] as number);
    response[r] = rnd() < 0.7 ? time(created[r] as number) : -1;
  }
  const prs: PrColumns = {
    number: Int32Array.from({ length: ROWS }, (_, i) => i + 1),
    created,
    ready: created,
    closed,
    state,
    base: new Int32Array(ROWS),
    draft: new Uint8Array(ROWS),
    opened_draft: new Uint8Array(ROWS),
    reopened: new Int32Array(ROWS),
    in_window: new Uint8Array(ROWS).fill(1),
    additions: new Int32Array(ROWS).fill(10),
    deletions: new Int32Array(ROWS),
    files: new Int32Array(ROWS).fill(1),
    commits: new Int32Array(ROWS).fill(1),
    first_commit: new Float64Array(ROWS).fill(-1),
    last_commit: new Float64Array(ROWS).fill(-1),
    first_response: response,
    first_approval: new Float64Array(ROWS).fill(-1),
    human_reviews: new Int32Array(ROWS),
    bot_reviews: new Int32Array(ROWS),
    bot_commands: new Int32Array(ROWS),
    disclosure: new Uint8Array(ROWS),
    families: Array.from({ length: ROWS }, () => []),
    components: Array.from({ length: ROWS }, () => []),
    standing: new Int32Array(ROWS),
    kind: new Int32Array(ROWS).fill(-1),
  };
  const n = ROWS * EVENTS_PER_ROW;
  const pr = new Int32Array(n);
  const at = new Float64Array(n);
  const kind = new Uint8Array(n);
  const actor = new Int32Array(n);
  for (let r = 0, e = 0; r < ROWS; r++) {
    let t = created[r] as number;
    for (let k = 0; k < EVENTS_PER_ROW; k++, e++) {
      t += Math.floor(rnd() * DAY);
      pr[e] = r;
      at[e] = t;
      kind[e] = Math.floor(rnd() * META.event_kinds.length);
      actor[e] = Math.floor(rnd() * 500);
    }
  }
  return {
    meta: { ...META, window_start: START, fetched_through: NOW },
    size: ROWS,
    prs,
    events: { pr, at, kind, sub: new Int32Array(n).fill(-1), actor },
    years: [{ year: 2026, first: 0, count: ROWS, firstEvent: 0, eventCount: n }],
  };
}

function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('at 100,000 PRs and 2,000,000 events', () => {
  const data = synthetic();
  const rows = all(data);

  it('computes an outcome curve well inside a second', () => {
    expect(timed(() => outcomeCurve(data, rows, 'response'))).toBeLessThan(1000);
  });

  it('computes a weekly series over the events well inside a second', () => {
    expect(timed(() => weekly(data, rows, PERIOD, 'reviewers'))).toBeLessThan(1000);
  });

  it('computes the waiting quantiles by week opened well inside a second', () => {
    const series = { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] } as const;
    expect(timed(() => weekly(data, rows, PERIOD, series))).toBeLessThan(1000);
  });

  it('computes the backlog well inside a second', () => {
    expect(timed(() => backlog(data, rows, PERIOD))).toBeLessThan(1000);
  });
});
