import { describe, expect, it } from 'vitest';
import rawMeta from './__fixtures__/data/meta.json';
import { parseMeta } from './data';
import { findLogin, handle, isBot, personHandle } from './handles';

const meta = parseMeta(rawMeta);

describe('handle', () => {
  it('links a login to its page on GitHub', () => {
    expect(handle('fixture-author-a')).toEqual({
      login: 'fixture-author-a',
      text: 'fixture-author-a',
      url: 'https://github.com/fixture-author-a',
    });
  });

  it.each(['a', 'A1-b2-C3', 'x'.repeat(39), 'dependabot[bot]'])('links %s, which has the form of a login', (login) => {
    expect(handle(login).url).toBe(`https://github.com/${encodeURIComponent(login)}`);
  });

  it('shows a deleted account as such, with no link', () => {
    expect(handle('ghost')).toEqual({ login: 'ghost', text: 'deleted account', url: null });
  });

  it.each([
    ['empty', ''],
    ['with a slash', 'ceph/ceph'],
    ['a path upward', '..'],
    ['an address', 'https://example.com'],
    ['with a space', 'two words'],
    ['with markup', '<b>x</b>'],
    ['starting with a hyphen', '-x'],
    ['too long', 'x'.repeat(40)],
    ['with a query', 'x?tab=repositories'],
    ['with a suffix other than [bot]', 'x[app]'],
  ])('shows a login that is %s as plain text, never a link', (_name, login) => {
    expect(handle(login)).toEqual({ login, text: login, url: null });
  });
});

describe('personHandle and isBot', () => {
  it("gives a person's handle by their index into people", () => {
    expect(personHandle(meta, 4).url).toBe('https://github.com/fixture-reviewer-k');
  });

  it('names the bot accounts', () => {
    expect(isBot(meta, 10)).toBe(true);
    expect(isBot(meta, 4)).toBe(false);
  });
});

describe('findLogin', () => {
  it('finds a login the data names, in any case, as the data gives it', () => {
    expect(findLogin(meta, 'fixture-author-a')).toBe('fixture-author-a');
    expect(findLogin(meta, 'Fixture-Author-A')).toBe('fixture-author-a');
  });

  it.each(['', 'someone-else', '__proto__', 'constructor'])('finds no login for %j', (login) => {
    expect(findLogin(meta, login)).toBeNull();
  });
});
