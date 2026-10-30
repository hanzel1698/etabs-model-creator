import { describe, expect, it } from 'vitest';
import { pushRecent } from './recentValues';

describe('pushRecent', () => {
  it('puts the value first and drops its older copy', () => {
    expect(pushRecent([5, 10, 2], 10)).toEqual([10, 5, 2]);
  });
  it('keeps at most six values', () => {
    expect(pushRecent([1, 2, 3, 4, 5, 6], 7)).toEqual([7, 1, 2, 3, 4, 5]);
  });
  it('compares arrays by value', () => {
    expect(pushRecent([[0, 0, -50], [1, 0, 0]], [0, 0, -50])).toEqual([[0, 0, -50], [1, 0, 0]]);
  });
});
