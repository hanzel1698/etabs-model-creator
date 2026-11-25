import { describe, expect, it } from 'vitest';
import { checkBearing, uncovered } from './bearing';
import { emptyModel } from './defaults';
import type { PlanModel } from './types';

/**
 * A two-bay grid, 3000 both ways, with columns only where a test asks for one.
 *
 *   (0,3000) --- (3000,3000)
 *      |              |
 *   (0,0) ------- (3000,0)
 *
 * Beams are anchored to plain points so each test can put an end exactly where
 * it wants it, rather than having to reason about which column happens to be
 * under a grid node.
 */
function base(): PlanModel {
  return {
    ...emptyModel(),
    grid: {
      x: [
        { id: 'gx1', label: '1', spacingFromPrev: 0 },
        { id: 'gx2', label: '2', spacingFromPrev: 3000 },
      ],
      y: [
        { id: 'gy1', label: 'B', spacingFromPrev: 0 },
        { id: 'gy2', label: 'A', spacingFromPrev: 3000 },
      ],
    },
    columnTypes: [{ id: 'ct-C1', label: 'C1', width: 400, depth: 400 }],
    beamTypes: [
      { id: 'bt-600', label: 'B30X60', width: 300, depth: 600 },
      { id: 'bt-400', label: 'B25X40', width: 250, depth: 400 },
    ],
    upstandTypes: [{ id: 'ut-150', label: 'U1', depth: 150 }],
    slabTypes: [{ id: 'st-TS1', label: 'TS1', thickness: 150, sink: 0 }],
    defaultSlabTypeId: 'st-TS1',
  };
}

const at = (x: number, y: number) => ({ kind: 'point' as const, x, y });

/** A support running left to right along y = 0, from x = -1000 to x = 4000. */
function supportBeam(typeId: string, topLevel?: number) {
  return {
    id: 'support',
    typeId,
    kind: 'primary' as const,
    start: at(-1000, 0),
    end: at(4000, 0),
    ...(topLevel === undefined ? {} : { topLevel }),
  };
}

/** A 600 deep beam running up from the origin — its start lands on the support. */
function incoming(typeId = 'bt-600') {
  return {
    id: 'incoming',
    typeId,
    kind: 'secondary' as const,
    start: at(0, 0),
    end: at(0, 3000),
  };
}

const forBeam = (model: PlanModel, id: string) =>
  checkBearing(model).find((b) => b.beamId === id)!;

describe('what catches a beam end', () => {
  it('passes an end sitting inside a column, whatever the beam depth', () => {
    const model: PlanModel = {
      ...base(),
      columns: [{ id: 'c1', typeId: 'ct-C1', gx: 'gx1', gy: 'gy1' }],
      beams: [incoming()],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.supports.map((s) => s.kind)).toEqual(['column']);
    expect(start.gaps).toEqual([]);
    expect(start.pass).toBe(true);
  });

  it('reports an end with nothing under it at all', () => {
    const model: PlanModel = { ...base(), beams: [incoming()] };
    const bearing = forBeam(model, 'incoming');
    expect(bearing.pass).toBe(false);
    expect(bearing.ends.every((e) => e.supports.length === 0)).toBe(true);
    expect(bearing.ends[0]!.note).toBe('nothing catches this end');
    // The whole depth is uncaught, not merely a face of it.
    expect(bearing.ends[0]!.gaps).toEqual([{ from: 0, to: 600 }]);
    expect(bearing.warnings[0]).toContain('nothing under its first end');
  });

  it('passes a beam landing on one of its own depth', () => {
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600'), incoming()],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.supports.map((s) => s.label)).toEqual(['B30X60']);
    expect(start.pass).toBe(true);
  });

  it('leaves 200 hanging when a 600 deep beam lands on a 400 deep one', () => {
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-400'), incoming()],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.gaps).toEqual([{ from: 400, to: 600 }]);
    expect(start.note).toBe('soffit 200 uncaught');
    expect(start.pass).toBe(false);
  });

  it('leaves the top uncaught when the support is cast lower', () => {
    // Support top at 300, soffit at 900 — deep enough underneath, but its
    // material only starts 300 below where the incoming beam's top is.
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600', 300), incoming()],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.gaps).toEqual([{ from: 0, to: 300 }]);
    expect(start.note).toBe('top 300 uncaught');
  });

  it('lets an upstand over the support catch the top', () => {
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600', 150), incoming()],
      // The support runs -1000..4000, so the incoming end at x = 0 is at t = 0.2.
      upstands: [{ id: 'u1', typeId: 'ut-150', beamId: 'support', t0: 0.1, t1: 0.3 }],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.supports[0]!.top).toBe(0);
    expect(start.supports[0]!.upstandLabel).toBe('U1');
    expect(start.pass).toBe(true);
  });

  it('ignores an upstand that stops short of the end it would have caught', () => {
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600', 150), incoming()],
      // Nowhere near t = 0.2.
      upstands: [{ id: 'u1', typeId: 'ut-150', beamId: 'support', t0: 0.6, t1: 0.9 }],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.supports[0]!.upstandLabel).toBeUndefined();
    expect(start.gaps).toEqual([{ from: 0, to: 150 }]);
  });

  it('unions two supports rather than failing the beam against each', () => {
    // One shallow beam catching the top half and one sunken beam catching the
    // bottom half: neither covers 0..600 alone, together they do.
    const model: PlanModel = {
      ...base(),
      beams: [
        { ...supportBeam('bt-400'), id: 'high' },
        {
          id: 'low',
          typeId: 'bt-400',
          kind: 'primary' as const,
          start: at(0, -1000),
          end: at(0, 4000),
          topLevel: 300,
        },
        incoming(),
      ],
    };
    const start = forBeam(model, 'incoming').ends[0]!;
    expect(start.supports).toHaveLength(2);
    expect(start.gaps).toEqual([]);
    expect(start.pass).toBe(true);
  });

  it('does not count the beam itself as its own support', () => {
    const model: PlanModel = { ...base(), beams: [incoming()] };
    for (const end of forBeam(model, 'incoming').ends) {
      expect(end.supports.every((s) => s.id !== 'incoming')).toBe(true);
    }
  });

  it('only counts a support the end actually lands within', () => {
    // The far end is 3000 away from the support, well off its band.
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600'), incoming()],
    };
    const ends = forBeam(model, 'incoming').ends;
    expect(ends[0]!.supports).toHaveLength(1);
    expect(ends[1]!.supports).toEqual([]);
  });

  it('catches an end landing anywhere across the support breadth', () => {
    // 149 off the centreline of a 300 wide support: still on it.
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600'), { ...incoming(), start: at(0, 149) }],
    };
    expect(forBeam(model, 'incoming').ends[0]!.supports).toHaveLength(1);
  });

  it('drops an end just past the support face', () => {
    const model: PlanModel = {
      ...base(),
      beams: [supportBeam('bt-600'), { ...incoming(), start: at(0, 151) }],
    };
    expect(forBeam(model, 'incoming').ends[0]!.supports).toEqual([]);
  });
});

describe('uncovered', () => {
  it('returns nothing when one interval swallows the range', () => {
    expect(uncovered(0, 600, [[-100, 900]])).toEqual([]);
  });

  it('merges overlapping intervals before looking for gaps', () => {
    expect(
      uncovered(0, 600, [
        [0, 300],
        [200, 600],
      ]),
    ).toEqual([]);
  });

  it('finds a gap left between two intervals', () => {
    expect(
      uncovered(0, 600, [
        [0, 200],
        [400, 600],
      ]),
    ).toEqual([{ from: 200, to: 400 }]);
  });

  it('treats a column as covering everything', () => {
    expect(uncovered(-300, 900, [[-Infinity, Infinity]])).toEqual([]);
  });

  it('leaves a zero-depth range alone', () => {
    expect(uncovered(0, 0, [])).toEqual([]);
  });
});
