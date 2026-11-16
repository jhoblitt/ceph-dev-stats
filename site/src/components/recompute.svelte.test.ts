// @vitest-environment jsdom
// A change of the URL that leaves the filters alone, such as choosing a PR or
// a table's order, must not compute the statistics of the selection again.
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.svelte';
import { fixturePage } from '../lib/__fixtures__/page';

const calls = vi.hoisted(() => ({ weekly: 0, backlog: 0, outcomeCurve: 0, select: 0, byOpening: 0, laneModel: 0 }));
const timelines = vi.hoisted(() => ({ prTimeline: 0 }));

vi.mock('../lib/lanes', async (original) => {
  const m = await original<typeof import('../lib/lanes')>();
  return {
    ...m,
    byOpening: (...args: Parameters<typeof m.byOpening>) => {
      calls.byOpening++;
      return m.byOpening(...args);
    },
    laneModel: (...args: Parameters<typeof m.laneModel>) => {
      calls.laneModel++;
      return m.laneModel(...args);
    },
  };
});

vi.mock('../lib/timeline', async (original) => {
  const m = await original<typeof import('../lib/timeline')>();
  return {
    ...m,
    prTimeline: (...args: Parameters<typeof m.prTimeline>) => {
      timelines.prTimeline++;
      return m.prTimeline(...args);
    },
  };
});

vi.mock('../lib/stats/weekly', async (original) => {
  const m = await original<typeof import('../lib/stats/weekly')>();
  return {
    ...m,
    weekly: (...args: Parameters<typeof m.weekly>) => {
      calls.weekly++;
      return m.weekly(...args);
    },
  };
});

vi.mock('../lib/stats/backlog', async (original) => {
  const m = await original<typeof import('../lib/stats/backlog')>();
  return {
    ...m,
    backlog: (...args: Parameters<typeof m.backlog>) => {
      calls.backlog++;
      return m.backlog(...args);
    },
  };
});

vi.mock('../lib/stats/curve', async (original) => {
  const m = await original<typeof import('../lib/stats/curve')>();
  return {
    ...m,
    outcomeCurve: (...args: Parameters<typeof m.outcomeCurve>) => {
      calls.outcomeCurve++;
      return m.outcomeCurve(...args);
    },
  };
});

vi.mock('../lib/select', async (original) => {
  const m = await original<typeof import('../lib/select')>();
  return {
    ...m,
    select: (...args: Parameters<typeof m.select>) => {
      calls.select++;
      return m.select(...args);
    },
  };
});

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

beforeEach(() => {
  calls.weekly = calls.backlog = calls.outcomeCurve = calls.select = calls.byOpening = calls.laneModel = 0;
  timelines.prTimeline = 0;
});

async function rendered(hash = '') {
  const { props } = await fixturePage(hash);
  render(App, props);
  await tick();
  return { selection: props.page.selection, before: { ...calls } };
}

describe("Velocity's and Review's statistics", () => {
  it('are computed once on the first render', async () => {
    const { before } = await rendered();
    expect(before.weekly).toBeGreaterThan(0);
    expect(before.backlog).toBeGreaterThan(0);
    expect(before.outcomeCurve).toBeGreaterThan(0);
    expect(before.select).toBe(1);
  });

  it('are not computed again when a PR is chosen', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, pr: 66500 }));
    await tick();
    expect(calls).toEqual(before);
  });

  it("are not computed again when the PR table's order changes", async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, sort: { column: 'size', descending: true } }));
    await tick();
    expect(calls).toEqual(before);
  });

  it('are computed again when a filter changes', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    await tick();
    expect(calls.select).toBe(before.select + 1);
    expect(calls.weekly).toBeGreaterThan(before.weekly);
    expect(calls.backlog).toBeGreaterThan(before.backlog);
    expect(calls.outcomeCurve).toBeGreaterThan(before.outcomeCurve);
  });
});

// The counts above cover the lanes' rows too: `byOpening` orders the
// selection and `laneModel` builds a lane per PR.
describe("The lanes' rows", () => {
  it('are built once on the first render', async () => {
    const { before } = await rendered();
    expect(before.byOpening).toBe(1);
    expect(before.laneModel).toBe(1);
  });

  it('are not built again when a PR is chosen or the PR table is sorted', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, pr: 66500 }));
    await tick();
    selection.update((s) => ({ ...s, sort: { column: 'size', descending: true } }));
    await tick();
    expect(calls.byOpening).toBe(before.byOpening);
    expect(calls.laneModel).toBe(before.laneModel);
  });

  it('are built again when a filter changes', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, filters: { ...s.filters, kind: 'feature' } }));
    await tick();
    expect(calls.byOpening).toBe(before.byOpening + 1);
    expect(calls.laneModel).toBe(before.laneModel + 1);
  });
});

describe("The chosen PR's timeline", () => {
  it('is built for the PR chosen, again when another is chosen, and not when the PR table is sorted', async () => {
    const { selection } = await rendered('#/?pr=66500');
    await vi.waitFor(() => expect(timelines.prTimeline).toBeGreaterThan(0));
    await tick();
    const first = timelines.prTimeline;
    selection.update((s) => ({ ...s, sort: { column: 'size', descending: true } }));
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(timelines.prTimeline).toBe(first);
    selection.update((s) => ({ ...s, pr: 66600 }));
    await vi.waitFor(() => expect(timelines.prTimeline).toBeGreaterThan(first));
  });
});
