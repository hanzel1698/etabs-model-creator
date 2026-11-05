import { describe, expect, it } from 'vitest';
import { reshapeSlab, slabGrips } from './ops';

const sq = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];

describe('slab grips', () => {
  it('has a grip at each corner and edge midpoint', () => {
    expect(slabGrips(sq)).toHaveLength(8);
    expect(slabGrips(sq)[4]).toEqual({ x: 500, y: 0 });
  });
  it('corner drag keeps a rectangle rectangular', () => {
    expect(reshapeSlab(sq, 2, { x: 1500, y: 1200 })).toEqual([{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 1200 }, { x: 0, y: 1200 }]);
  });
  it('edge drag moves the edge along its normal only', () => {
    // edge 1 (x = 1000) dragged to (1400, 300): only x changes
    expect(reshapeSlab(sq, 5, { x: 1400, y: 300 })).toEqual([{ x: 0, y: 0 }, { x: 1400, y: 0 }, { x: 1400, y: 1000 }, { x: 0, y: 1000 }]);
  });
});
