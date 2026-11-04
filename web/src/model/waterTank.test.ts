import { describe, expect, it } from 'vitest';
import { hdpeTankLoad, rccTankLoad } from './waterTank';

describe('hdpeTankLoad', () => {
  it('2 × 5000 L on a 3.6 × 4.5 m panel', () => {
    const r = hdpeTankLoad(5000, 2, 200, 3.6 * 4.5);
    expect([r.L, r.W]).toEqual([4600, 2300]);
    expect(r.pad).toBeCloseTo(52.9);
    expect(r.water).toBeCloseTo(100);
    expect(r.unit).toBeCloseTo(9.44, 2);
  });
});

describe('rccTankLoad', () => {
  it('10000 L on a 3.6 × 4.5 m panel, 200 mm walls', () => {
    const r = rccTankLoad(10000, 200, 3600, 4500, 3.6 * 4.5);
    expect(r.innerArea).toBeCloseTo(13.12);
    expect(r.h).toBe(0.8);
    expect(r.water).toBeCloseTo(104.96);
    expect(r.unit).toBeCloseTo(6.479, 3);
  });
});
