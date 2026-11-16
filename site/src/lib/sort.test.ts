import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, SORT_COLUMNS, nextSort, parseSort, sameSort, sortParam } from './sort';
import { TABLE_COLUMNS } from './table';

describe('the sort in the URL', () => {
  it('reads a column for ascending and -column for descending', () => {
    expect(parseSort('size')).toEqual({ column: 'size', descending: false });
    expect(parseSort('-title')).toEqual({ column: 'title', descending: true });
  });

  it('falls back to newest opened first for no sort or an unknown column', () => {
    expect(DEFAULT_SORT).toEqual({ column: 'opened', descending: true });
    for (const raw of [undefined, '', '-', 'colour', '--size', 'size-']) expect(parseSort(raw)).toEqual(DEFAULT_SORT);
  });

  it('writes a sort back as it reads', () => {
    for (const column of SORT_COLUMNS) {
      for (const descending of [false, true]) {
        const sort = { column, descending };
        expect(parseSort(sortParam(sort))).toEqual(sort);
      }
    }
    expect(sortParam(DEFAULT_SORT)).toBe('-opened');
  });

  it('tells two sorts apart by column and direction', () => {
    expect(sameSort(DEFAULT_SORT, { column: 'opened', descending: true })).toBe(true);
    expect(sameSort(DEFAULT_SORT, { column: 'opened', descending: false })).toBe(false);
    expect(sameSort(DEFAULT_SORT, { column: 'size', descending: true })).toBe(false);
  });

  it('turns a column the other way when chosen again, and starts another ascending', () => {
    expect(nextSort(DEFAULT_SORT, 'opened')).toEqual({ column: 'opened', descending: false });
    expect(nextSort({ column: 'opened', descending: false }, 'opened')).toEqual(DEFAULT_SORT);
    expect(nextSort(DEFAULT_SORT, 'size')).toEqual({ column: 'size', descending: false });
  });

  it('names every column the table shows, and only those', () => {
    expect(TABLE_COLUMNS.map((c) => c.id).sort()).toEqual([...SORT_COLUMNS].sort());
  });
});
