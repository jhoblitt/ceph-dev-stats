// People as the page shows them: by GitHub login, each linked to its page on
// GitHub. The logins come from the data, so one is linked only when it has
// the form of a login and cannot carry a path, a query or another host.

import type { Meta } from './data';

/** The login GitHub gives a deleted account. */
export const GHOST = 'ghost';

/** Letters, digits and hyphens, not starting with a hyphen, at most 39; an app account adds `[bot]`. */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;

export interface Handle {
  login: string;
  /** What the page writes: the login, or "deleted account". */
  text: string;
  /** The person's page on GitHub; null for a deleted account or a login that does not have the form of one. */
  url: string | null;
}

export function handle(login: string): Handle {
  if (login === GHOST) return { login, text: 'deleted account', url: null };
  return { login, text: login, url: LOGIN.test(login) ? `https://github.com/${encodeURIComponent(login)}` : null };
}

/** The handle of `person`, an index into meta's `people`. */
export function personHandle(meta: Meta, person: number): Handle {
  return handle(meta.people[person] ?? '');
}

export function isBot(meta: Meta, person: number): boolean {
  return meta.people_bots.includes(person);
}

const indexes = new WeakMap<Meta, Map<string, number>>();

/** Each login lower-cased, to its index into `people`; GitHub does not tell logins apart by case. */
function byLogin(meta: Meta): Map<string, number> {
  const known = indexes.get(meta);
  if (known) return known;
  const m = new Map<string, number>();
  meta.people.forEach((login, i) => {
    const key = login.toLowerCase();
    if (!m.has(key)) m.set(key, i);
  });
  indexes.set(meta, m);
  return m;
}

/** The index into meta's `people` of a login in any case, or -1 when the data does not name it. */
export function personIndex(meta: Meta, login: string): number {
  return byLogin(meta).get(login.toLowerCase()) ?? -1;
}

/** A login in any case as the data gives it, or null when the data does not name it. */
export function findLogin(meta: Meta, login: string): string | null {
  const i = personIndex(meta, login);
  return i === -1 ? null : (meta.people[i] as string);
}
