import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import rawMeta from './__fixtures__/data/meta.json';
import { parseMeta } from './data';
import {
  type AppState,
  type HashLocation,
  createStateStore,
  defaultState,
  hashFromState,
  parseHash,
  routeHash,
  stateFromHash,
} from './state';

const meta = parseMeta(rawMeta);

// The fixture's window starts 2026-05-15 and was fetched through 2026-11-15.
const defaults: AppState = {
  route: 'report',
  filters: {
    from: '2026-05-15',
    to: '2026-11-15',
    target: 'main',
    component: null,
    size: null,
    standing: null,
    disclosure: null,
    excludeDrafts: false,
    reopenedOnly: false,
  },
  week: null,
  band: null,
  pr: null,
};

function withFilters(patch: Partial<AppState['filters']>): AppState {
  return { ...defaults, filters: { ...defaults.filters, ...patch } };
}

describe('stateFromHash defaults', () => {
  it.each(['', '#', '#/', '#/?'])('yields the defaults for %j', (hash) => {
    expect(stateFromHash(hash, meta)).toEqual(defaults);
  });

  it('matches defaultState', () => {
    expect(defaultState(meta)).toEqual(defaults);
  });
});

describe('round trip through the hash', () => {
  const full: AppState = {
    route: 'methods',
    filters: {
      from: '2026-06-01',
      to: '2026-09-30',
      target: 'backports',
      component: 'rgw',
      size: '101-1000',
      standing: 'unknown',
      disclosure: 'not-disclosed',
      excludeDrafts: true,
      reopenedOnly: true,
    },
    week: '2026-06-01',
    band: '30-90',
    pr: 66600,
  };

  it('preserves every field at once', () => {
    expect(stateFromHash(hashFromState(full, meta), meta)).toEqual(full);
  });

  it.each([
    ['route', { route: 'methods' }],
    ['period', { filters: { ...defaults.filters, from: '2026-07-01', to: '2026-07-31' } }],
    ['target all', { filters: { ...defaults.filters, target: 'all' } }],
    ['target backports', { filters: { ...defaults.filters, target: 'backports' } }],
    ['component', { filters: { ...defaults.filters, component: 'cephfs' } }],
    ['size band', { filters: { ...defaults.filters, size: 'le10' } }],
    ['standing band', { filters: { ...defaults.filters, standing: 'first' } }],
    ['disclosure', { filters: { ...defaults.filters, disclosure: 'disclosed' } }],
    ['drafts', { filters: { ...defaults.filters, excludeDrafts: true } }],
    ['reopened', { filters: { ...defaults.filters, reopenedOnly: true } }],
    ['week', { week: '2026-11-09' }],
    ['band', { band: 'lt7' }],
    ['pr', { pr: 64010 }],
  ] satisfies [string, Partial<AppState>][])('preserves %s', (_name, patch) => {
    const state = { ...defaults, ...patch };
    expect(stateFromHash(hashFromState(state, meta), meta)).toEqual(state);
  });

  it('writes only the target for the defaults, so the default period follows the data', () => {
    expect(hashFromState(defaults, meta)).toBe('#/?target=main');
  });

  it('writes a period that differs from the default', () => {
    const params = new URLSearchParams(hashFromState(withFilters({ from: '2026-06-01' }), meta).split('?')[1]);
    expect(params.get('from')).toBe('2026-06-01');
    expect(params.has('to')).toBe(false);
  });

  it('puts the route in the hash path', () => {
    expect(hashFromState({ ...defaults, route: 'methods' }, meta)).toMatch(/^#\/methods\?/);
    expect(hashFromState(defaults, meta)).toMatch(/^#\/\?/);
  });

  it('keeps the filters and selection when changing page', () => {
    expect(stateFromHash(routeHash(full, 'report', meta), meta)).toEqual({ ...full, route: 'report' });
  });
});

describe('unknown values fall back to their defaults', () => {
  it.each([
    ['route', '#/nowhere'],
    ['target', '#/?target=feature-branches'],
    ['component', '#/?component=no-such-component'],
    ['component named like a prototype key', '#/?component=__proto__'],
    ['size band', '#/?size=huge'],
    ['standing band', '#/?standing=veteran'],
    ['disclosure', '#/?disclosure=ai-written'],
    ['drafts', '#/?drafts=maybe'],
    ['reopened', '#/?reopened=yes'],
    ['band', '#/?band=old'],
    ['pr that is not a number', '#/?pr=abc'],
    ['pr that is zero', '#/?pr=0'],
    ['pr that is negative', '#/?pr=-3'],
    ['pr in exponent form', '#/?pr=1e4'],
    ['pr with a fraction', '#/?pr=66600.5'],
    ['week that is not a Monday', '#/?week=2026-06-02'],
    ['week that is not a date', '#/?week=soon'],
    ['an unknown parameter', '#/?colour=blue'],
  ])('%s', (_name, hash) => {
    expect(stateFromHash(hash, meta)).toEqual(defaults);
  });

  it('keeps the valid parameters beside an unknown one', () => {
    expect(stateFromHash('#/?target=all&size=huge&component=rbd', meta)).toEqual(
      withFilters({ target: 'all', component: 'rbd' }),
    );
  });

  it('takes the first of a repeated parameter', () => {
    expect(stateFromHash('#/?target=all&target=backports', meta).filters.target).toBe('all');
  });
});

describe('malformed hashes yield the defaults', () => {
  it.each([
    '#%',
    '#/?%E0%A4%A',
    '#/?target',
    '#/?&&==&',
    '##/methods',
    '#/?target=%',
    '#/?from=2026-13-45',
    '#/?from=2026-02-30',
    '#/?to=20261101',
    '#/?pr=%F0',
    'not a hash at all',
  ])('%j', (hash) => {
    expect(stateFromHash(hash, meta)).toEqual(defaults);
  });
});

describe('a period outside the data', () => {
  it.each([
    ['entirely before the window', '#/?from=2020-01-01&to=2020-02-01'],
    ['entirely after the data', '#/?from=2027-01-01&to=2027-02-01'],
    ['reversed', '#/?from=2026-09-01&to=2026-06-01'],
  ])('yields the default period when %s', (_name, hash) => {
    expect(stateFromHash(hash, meta).filters).toEqual(defaults.filters);
  });

  it('keeps the end that lies inside the data and defaults the other', () => {
    expect(stateFromHash('#/?from=2026-06-01&to=2030-01-01', meta).filters).toEqual(
      withFilters({ from: '2026-06-01' }).filters,
    );
    expect(stateFromHash('#/?from=2026-01-01&to=2026-08-31', meta).filters).toEqual(
      withFilters({ to: '2026-08-31' }).filters,
    );
  });

  it('drops a selected week that does not overlap the period', () => {
    expect(stateFromHash('#/?from=2026-07-01&to=2026-07-31&week=2026-06-01', meta).week).toBeNull();
  });

  it('keeps a selected week that overlaps the start of the period', () => {
    expect(stateFromHash('#/?from=2026-06-03&week=2026-06-01', meta).week).toBe('2026-06-01');
  });
});

describe('the selected bucket over a period beyond 53 weeks', () => {
  // Fetched through 2027-11-15, so the default period steps by month.
  const longMeta = parseMeta({ ...rawMeta, fetched_through: Date.UTC(2027, 10, 15) / 1000 });

  it('keeps the first of a month', () => {
    expect(stateFromHash('#/?week=2026-07-01', longMeta).week).toBe('2026-07-01');
  });

  it('keeps a month that overlaps the start of the period', () => {
    expect(stateFromHash('#/?week=2026-05-01', longMeta).week).toBe('2026-05-01');
  });

  it('drops a Monday that is not the first of a month, which names no bucket', () => {
    expect(stateFromHash('#/?week=2026-06-08', longMeta).week).toBeNull();
  });

  it('drops a first of the month when the period steps by week', () => {
    expect(stateFromHash('#/?to=2027-05-12&week=2026-07-01', longMeta).week).toBeNull();
    expect(stateFromHash('#/?to=2027-05-12&week=2026-07-06', longMeta).week).toBe('2026-07-06');
  });
});

describe('parseHash', () => {
  it('reads the route and the first value of each parameter', () => {
    expect(parseHash('#/methods/?target=all&pr=12&pr=13')).toEqual({
      route: 'methods',
      params: { target: 'all', pr: '12' },
    });
  });

  it('never throws on a broken escape', () => {
    expect(() => parseHash('#/?%')).not.toThrow();
  });
});

/** A HashLocation over an in-memory history, recording every write. */
function fakeLocation(initial: string) {
  let hash = initial;
  let listener: (() => void) | undefined;
  const writes: string[] = [];
  const loc: HashLocation = {
    read: () => hash,
    push: (h) => {
      hash = h;
      writes.push(`push ${h}`);
    },
    replace: (h) => {
      hash = h;
      writes.push(`replace ${h}`);
    },
    listen: (onChange) => {
      listener = onChange;
      return () => (listener = undefined);
    },
  };
  return {
    loc,
    writes,
    navigate(h: string) {
      hash = h;
      listener?.();
    },
    listening: () => listener !== undefined,
  };
}

describe('createStateStore', () => {
  it('restores the state from the hash on load and canonicalises the hash', () => {
    const f = fakeLocation('#/?pr=66600&target=all&size=huge');
    const store = createStateStore(meta, f.loc);
    expect(get(store)).toEqual({ ...withFilters({ target: 'all' }), pr: 66600 });
    expect(f.writes).toEqual(['replace #/?target=all&pr=66600']);
  });

  it('leaves a canonical hash alone on load', () => {
    const f = fakeLocation('#/?target=main');
    createStateStore(meta, f.loc);
    expect(f.writes).toEqual([]);
  });

  it('pushes a history entry for a change, or replaces when asked', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    store.update((s) => ({ ...s, pr: 66500 }), { replace: true });
    expect(f.writes).toEqual([
      'replace #/?target=main',
      'push #/?target=all',
      'replace #/?target=all&pr=66500',
    ]);
    expect(get(store).pr).toBe(66500);
  });

  it('validates what is written', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    store.set(withFilters({ component: 'no-such-component', from: '1999-01-01' }));
    expect(get(store)).toEqual(defaults);
    expect(f.writes).toEqual(['replace #/?target=main']);
  });

  it('notifies only when the state changes', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    const seen: AppState[] = [];
    store.subscribe((s) => seen.push(s));
    store.set(defaults);
    store.set(withFilters({ reopenedOnly: true }));
    expect(seen).toEqual([defaults, withFilters({ reopenedOnly: true })]);
  });

  it('follows navigation and stops on destroy', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    f.navigate('#/methods?target=backports');
    expect(get(store)).toEqual({ ...withFilters({ target: 'backports' }), route: 'methods' });
    store.destroy();
    expect(f.listening()).toBe(false);
  });
});
