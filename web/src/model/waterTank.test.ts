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

  it('adds a 120 mm roof and one 230 × 450 beam 4.5 m long', () => {
    const r = rccTankLoad(10000, 200, 3600, 4500, 3.6 * 4.5, { t: 120, beams: [{ b: 230, d: 450, len: 4.5 }] });
    expect(r.roofSlab).toBeCloseTo(48.6);
    expect(r.beams).toBeCloseTo(11.644, 3);
    expect(r.total).toBeCloseTo(165.204, 3);
    expect(r.unit).toBeCloseTo(10.198, 3);
  });

  it('one 200 mm partition along X splits 3.2 × 4.1 m inside into two compartments', () => {
    const r = rccTankLoad(10000, 200, 3600, 4500, 3.6 * 4.5, undefined, { n: 1, along: 'X', freeboard: 300 });
    expect(r.partArea).toBeCloseTo(0.64); // 3.2 m long × 0.2 m
    expect(r.innerArea).toBeCloseTo(12.48);
    expect(r.h).toBe(0.9); // 10 / 12.48 = 0.801 → 0.9
    expect(r.water).toBeCloseTo(112.32);
    expect(r.partWalls).toBeCloseTo(0.64 * 1.2 * 25);
    expect(r.total).toBeCloseTo(112.32 + 19.2);
  });
});
