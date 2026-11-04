import { describe, expect, it } from 'vitest';
import { hdpeTankLoad } from './waterTank';

describe('hdpeTankLoad', () => {
  it('2 × 5000 L on a 3.6 × 4.5 m panel', () => {
    const r = hdpeTankLoad(5000, 2, 200, 3.6 * 4.5);
    expect([r.L, r.W]).toEqual([4600, 2300]);
    expect(r.pad).toBeCloseTo(52.9);
    expect(r.water).toBeCloseTo(100);
    expect(r.unit).toBeCloseTo(9.44, 2);
  });
});
