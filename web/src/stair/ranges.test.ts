import { describe, expect, it } from 'vitest';
import { emptyModel } from '../model/types';
import { BASE, rangeLevels, rangesOf, validateRanges } from './ranges';

const m = emptyModel(); // Story1..3, 3000 each

describe('typical ranges', () => {
  it('defaults to one range over all stories', () => {
    expect(rangesOf(m, {})).toEqual([{ id: 'all', from: BASE, to: 'Story3' }]);
    expect(rangesOf(m, { typicals: [] })).toHaveLength(1);
  });
  it('designs the first storey of a range and repeats to its top', () => {
    expect(rangeLevels(m, { id: 'a', from: 'Story1', to: 'Story3' })).toMatchObject({ story: 'Story2', z0: 3000, z1: 6000, repeats: 2 });
    expect(rangeLevels(m, { id: 'b', from: BASE, to: 'Story1' })).toMatchObject({ story: 'Story1', z0: 0, repeats: 1 });
  });
  it('flags reversed, unknown and overlapping ranges, but not touching ones', () => {
    expect(rangeLevels(m, { id: 'r', from: 'Story2', to: 'Story1' })).toBeNull();
    expect(rangeLevels(m, { id: 'u', from: 'Nope', to: 'Story1' })).toBeNull();
    expect(validateRanges(m, [{ id: 'a', from: BASE, to: 'Story1' }, { id: 'b', from: 'Story1', to: 'Story3' }])).toEqual([]);
    expect(validateRanges(m, [{ id: 'a', from: BASE, to: 'Story2' }, { id: 'b', from: 'Story1', to: 'Story3' }])).toHaveLength(1);
    expect(validateRanges(m, [{ id: 'r', from: 'Story2', to: 'Story1' }])).toHaveLength(1);
  });
});
