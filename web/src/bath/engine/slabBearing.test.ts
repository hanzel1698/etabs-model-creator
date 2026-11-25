import { describe, expect, it } from 'vitest';
import { emptyModel } from './defaults';
import { facesForModel } from './faces';
import { checkSlabBearing, coalesce } from './slabBearing';
import type { Beam, PlanModel } from './types';

/**
 * One 3000 x 3000 bay, framed by four beams anchored to plain points so each
 * test can re-level or re-size a single side of it.
 *
 *   (0,3000) --N-- (3000,3000)
 *      |               |
 *      W               E
 *      |               |
 *    (0,0) --- S --- (3000,0)
 */
function base(): PlanModel {
  return {
    ...emptyModel(),
    beamTypes: [
      { id: 'bt-500', label: 'B25X50', width: 250, depth: 500 },
      { id: 'bt-400', label: 'B25X40', width: 250, depth: 400 },
    ],
    upstandTypes: [{ id: 'ut-150', label: 'U1', depth: 150 }],
    slabTypes: [
      { id: 'st-TS1', label: 'TS1', thickness: 150, sink: 0 },
      { id: 'st-TS2', label: 'TS2', thickness: 150, sink: 300 },
    ],
    defaultSlabTypeId: 'st-TS1',
    beams: ring(),
  };
}

const at = (x: number, y: number) => ({ kind: 'point' as const, x, y });

function ring(): Beam[] {
  const side = (id: string, x0: number, y0: number, x1: number, y1: number): Beam => ({
    id,
    typeId: 'bt-500',
    kind: 'primary',
    start: at(x0, y0),
    end: at(x1, y1),
  });
  return [
    side('S', 0, 0, 3000, 0),
    side('E', 3000, 0, 3000, 3000),
    side('N', 3000, 3000, 0, 3000),
    side('W', 0, 3000, 0, 0),
  ];
}

/** Re-level or re-type one side of the ring. */
function withSide(model: PlanModel, id: string, change: Partial<Beam>): PlanModel {
  return { ...model, beams: model.beams.map((b) => (b.id === id ? { ...b, ...change } : b)) };
}

/** Tag the one bay with a slab type, or with null for a duct. */
function tagged(model: PlanModel, slabTypeId: string | null): PlanModel {
  return {
    ...model,
    panelAssignments: [{ id: 'pa1', seed: { x: 1500, y: 1500 }, slabTypeId }],
  };
}

const only = (model: PlanModel) => checkSlabBearing(model)[0]!;

describe('what catches a slab side', () => {
  it('passes a flush slab framed all round by beams deep enough for it', () => {
    const bay = only(base());
    expect(bay.sides).toHaveLength(4);
    expect(bay.pass).toBe(true);
    expect(bay.warnings).toEqual([]);
  });

  it('names one side per beam, in ring order', () => {
    expect(only(base()).sides.map((s) => s.beamId).sort()).toEqual(['E', 'N', 'S', 'W']);
  });

  it('fails the one side whose beam does not reach the slab soffit', () => {
    // TS2 sinks 300 with a 150 slab, so its soffit is at 450 — past the 400
    // deep beam on the south side, and well within the 500 deep rest.
    const model = tagged(withSide(base(), 'S', { typeId: 'bt-400' }), 'st-TS2');
    const bay = only(model);
    const failing = bay.sides.filter((s) => !s.pass);

    expect(bay.pass).toBe(false);
    expect(failing.map((s) => s.beamId)).toEqual(['S']);
    expect(failing[0]!.margin).toBe(-50);
    expect(failing[0]!.topPass).toBe(true);
    expect(failing[0]!.note).toBe('soffit 50 short');
    expect(bay.warnings[0]).toContain('TS2 is not caught along B25X40');
  });

  it('does not judge a duct at all — there is no slab there to catch', () => {
    // The same beam that fails under a slab, with the bay tagged as a duct.
    const model = tagged(withSide(base(), 'W', { topLevel: 300 }), null);
    expect(checkSlabBearing(model)).toEqual([]);
  });

  it('fails a side whose beam is cast below the slab it should carry', () => {
    // Flush slab, but the west beam has been run down 300 for the bay beyond it.
    const bay = only(withSide(base(), 'W', { topLevel: 300 }));
    const failing = bay.sides.filter((s) => !s.pass);

    expect(failing.map((s) => s.beamId)).toEqual(['W']);
    expect(failing[0]!.topMargin).toBe(-300);
    expect(failing[0]!.note).toBe('beam top 300 too low');
    expect(bay.warnings[0]).toContain('nothing to bear on');
  });

  it('reports both faces of one side when both are wrong', () => {
    // Both can only fail at once against a band shallower than the slab is
    // thick: sinking a beam past the slab top drops its soffit with it, so the
    // usual sunken beam fails the top face and passes the soffit comfortably.
    const model = withSide(base(), 'W', { topLevel: 20, depthOverride: 100 });
    const side = only(model).sides.find((s) => s.beamId === 'W')!;

    expect(side.topPass).toBe(false);
    expect(side.soffitPass).toBe(false);
    expect(side.note).toBe('beam top 20 too low, soffit 30 short');
  });

  it('points each side inward, into its own panel', () => {
    const bay = only(base());
    for (const side of bay.sides) {
      const toCentre = { x: bay.centroid.x - side.mid.x, y: bay.centroid.y - side.mid.y };
      expect(side.inward.x * toCentre.x + side.inward.y * toCentre.y).toBeGreaterThan(0);
    }
  });

  it('quotes the slab edge as half the beam breadth off the centreline', () => {
    expect(only(base()).sides.every((s) => s.inset === 125)).toBe(true);
  });

  it('reports a side only as far as the beams framing it, not to their centrelines', () => {
    // The bay is 3000 centre to centre with 250 wide beams all round, so the
    // slab itself runs 125 .. 2875 — the rest of each centreline is the beam
    // framing into that corner, and no concern of this side.
    const south = only(base()).sides.find((s) => s.beamId === 'S')!;
    expect(south.a).toEqual({ x: 125, y: 0 });
    expect(south.b).toEqual({ x: 2875, y: 0 });
    expect(south.mid.x).toBe(1500);
  });

  it('meets a skewed beam where their two faces actually cross', () => {
    // The west side replaced by a diagonal landing at (1000, 0). Half its
    // breadth is the wrong answer at a skew, and not even in a fixed direction:
    // this one leans away, so its centreline has already retreated by the time
    // it reaches slab level, and it gives up LESS than half its breadth.
    const model: PlanModel = {
      ...base(),
      beams: [
        ...ring().filter((b) => b.id !== 'W'),
        { id: 'W', typeId: 'bt-500', kind: 'primary', start: at(0, 3000), end: at(1000, 0) },
      ],
    };
    const south = only(model).sides.find((s) => s.beamId === 'S')!;

    // Where the diagonal's own face sits at the height of the south slab edge:
    // its centreline there, plus the run across to its face at that height.
    const lean = 1000 / 3000;
    const skew = 3000 / Math.hypot(1000, 3000);
    expect(south.a.x).toBeCloseTo(1000 - lean * 125 + 125 / skew, 6);
    expect(south.a.x).toBeLessThan(1125);
    // Still square at the other end, where the east beam is.
    expect(south.b.x).toBe(2875);
  });

  it('leaves a side alone when the framing would swallow it whole', () => {
    // A 200 long stub of slab between two 250 wide beams: there is no slab edge
    // left to mark, so the centreline stretch stands rather than inverting.
    const model: PlanModel = {
      ...base(),
      beams: [
        { id: 'S', typeId: 'bt-500', kind: 'primary', start: at(0, 0), end: at(200, 0) },
        { id: 'E', typeId: 'bt-500', kind: 'primary', start: at(200, 0), end: at(200, 3000) },
        { id: 'N', typeId: 'bt-500', kind: 'primary', start: at(200, 3000), end: at(0, 3000) },
        { id: 'W', typeId: 'bt-500', kind: 'primary', start: at(0, 3000), end: at(0, 0) },
      ],
    };
    const south = only(model).sides.find((s) => s.beamId === 'S')!;
    expect(south.a).toEqual({ x: 0, y: 0 });
    expect(south.b).toEqual({ x: 200, y: 0 });
  });

  it('skips a panel whose slab type has been deleted', () => {
    const model = { ...base(), defaultSlabTypeId: 'st-gone' };
    expect(checkSlabBearing(model)).toEqual([]);
  });
});

describe('upstands over part of a side', () => {
  /** The west beam run down 300, with a nib over its middle third. */
  function withNib(t0: number, t1: number): PlanModel {
    const model = withSide(base(), 'W', { topLevel: 300 });
    return { ...model, upstands: [{ id: 'u1', typeId: 'ut-150', beamId: 'W', t0, t1 }] };
  }

  it('splits the side where the nib starts and stops', () => {
    const west = only(withNib(0.3, 0.7)).sides.filter((s) => s.beamId === 'W');
    expect(west).toHaveLength(3);
    expect(west.map((s) => s.upstandLabel)).toEqual([undefined, 'U1', undefined]);
    // The stretches tile the side, end to end.
    expect(west[0]!.b).toEqual(west[1]!.a);
    expect(west[1]!.b).toEqual(west[2]!.a);
  });

  it('still fails the stretch under a nib too short to reach the slab top', () => {
    // 150 of nib on a beam sunk 300 leaves its top at 150, still below the
    // flush slab — so every stretch fails, the nibbed one by less.
    const west = only(withNib(0.3, 0.7)).sides.filter((s) => s.beamId === 'W');
    expect(west.map((s) => s.topMargin)).toEqual([-300, -150, -300]);
    expect(west.every((s) => !s.pass)).toBe(true);
  });

  it('passes only the stretch a deep enough nib covers', () => {
    const model = withNib(0.3, 0.7);
    const west = only({
      ...model,
      upstandTypes: [{ id: 'ut-150', label: 'U1', depth: 300 }],
    }).sides.filter((s) => s.beamId === 'W');

    expect(west.map((s) => s.pass)).toEqual([false, true, false]);
    expect(west[1]!.topMargin).toBe(0);
  });

  it('leaves a side alone when the nib runs its whole length', () => {
    const model = withNib(0, 1);
    const west = only({
      ...model,
      upstandTypes: [{ id: 'ut-150', label: 'U1', depth: 300 }],
    }).sides.filter((s) => s.beamId === 'W');

    expect(west).toHaveLength(1);
    expect(west[0]!.pass).toBe(true);
  });
});

describe('coalesce', () => {
  it('joins the stretches a T-junction splits one side into', () => {
    // A beam landing on the middle of the south side from OUTSIDE the bay: it
    // frames no panel here, but it does split the south centreline in two.
    const model: PlanModel = {
      ...base(),
      beams: [
        ...ring(),
        { id: 'T', typeId: 'bt-500', kind: 'secondary', start: at(1500, 0), end: at(1500, -2000) },
      ],
    };
    const south = only(model).sides.filter((s) => s.beamId === 'S');

    expect(facesForModel(model)[0]!.edges.filter((e) => e.beamId === 'S')).toHaveLength(2);
    expect(south).toHaveLength(1);
    // One side, corner to corner — the T-junction in the middle of it is not a
    // corner of anything, so it does not shorten what the side covers either.
    expect(south[0]!.a.x).toBe(125);
    expect(south[0]!.b.x).toBe(2875);
  });

  it('joins a run that wraps round the start of the ring', () => {
    const edges = [
      { a: { x: 5, y: 0 }, b: { x: 10, y: 0 }, beamId: 'a' },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 10 }, beamId: 'b' },
      { a: { x: 10, y: 10 }, b: { x: 0, y: 0 }, beamId: 'c' },
      { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, beamId: 'a' },
    ];
    const merged = coalesce(edges);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, beamId: 'a' });
  });

  it('leaves a ring whose ends belong to different beams alone', () => {
    const edges = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, beamId: 'a' },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 10 }, beamId: 'b' },
      { a: { x: 10, y: 10 }, b: { x: 0, y: 10 }, beamId: 'c' },
      { a: { x: 0, y: 10 }, b: { x: 0, y: 0 }, beamId: 'd' },
    ];
    expect(coalesce(edges)).toEqual(edges);
  });

  it('takes an empty boundary as it finds it', () => {
    expect(coalesce([])).toEqual([]);
  });
});
