import { describe, expect, it } from 'vitest';
import type { BeamEnds } from './grid';
import { beamPolygon, beamSubPolygon, drawnBeamEnds, trimBeamEnds, type BeamBand } from './planGeom';
import type { PlanModel } from './types';

const ends = (x0: number, y0: number, x1: number, y1: number): BeamEnds => ({
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

/** A 300 wide support running up the y axis, from (0,-2000) to (0,2000). */
const upright: BeamBand = { ends: ends(0, -2000, 0, 2000), width: 300 };

describe('trimBeamEnds', () => {
  it('pulls an end that lands mid-span back to the support face', () => {
    // Anchored on the support centreline at x=0; the face is at x=150.
    const trimmed = trimBeamEnds(ends(0, 0, 3000, 0), [upright]);
    expect(trimmed.start).toEqual({ x: 150, y: 0 });
    expect(trimmed.end).toEqual({ x: 3000, y: 0 });
  });

  it('trims both ends when the beam spans between two supports', () => {
    const far: BeamBand = { ends: ends(3000, -2000, 3000, 2000), width: 200 };
    const trimmed = trimBeamEnds(ends(0, 0, 3000, 0), [upright, far]);
    expect(trimmed.start).toEqual({ x: 150, y: 0 });
    expect(trimmed.end).toEqual({ x: 2900, y: 0 });
  });

  it('leaves an end alone when nothing supports it', () => {
    const free = ends(1000, 0, 3000, 0);
    expect(trimBeamEnds(free, [upright])).toEqual(free);
  });

  /**
   * The case the mid-span test exists for: at a corner both beams end at the
   * same point, so trimming each back to the other's face would leave the
   * corner uncovered.
   */
  it('does not trim at a corner, where the support ends at the same point', () => {
    const corner: BeamBand = { ends: ends(0, 0, 0, 2000), width: 300 };
    const beam = ends(0, 0, 3000, 0);
    expect(trimBeamEnds(beam, [corner])).toEqual(beam);
  });

  it('ignores a parallel neighbour, which has no face to clip against', () => {
    const parallel: BeamBand = { ends: ends(-2000, 0, 2000, 0), width: 300 };
    const beam = ends(0, 0, 3000, 0);
    expect(trimBeamEnds(beam, [parallel])).toEqual(beam);
  });

  /** A skew landing has further to travel to clear the same breadth. */
  it('measures the trim along the beam, so a skew end clears the full face', () => {
    const trimmed = trimBeamEnds(ends(0, 0, 3000, 3000), [upright]);
    expect(trimmed.start.x).toBeCloseTo(150, 6);
    // 45 degrees: 150 across the face is 150 * sqrt(2) along the beam.
    expect(Math.hypot(trimmed.start.x, trimmed.start.y)).toBeCloseTo(150 * Math.SQRT2, 6);
  });

  it('keeps the untrimmed rectangle when the trims would swallow the beam', () => {
    const wide: BeamBand = { ends: ends(0, -2000, 0, 2000), width: 3000 };
    const stub = ends(0, 0, 200, 0);
    expect(trimBeamEnds(stub, [wide])).toEqual(stub);
  });

  it('returns a zero-length beam unchanged', () => {
    const degenerate = ends(0, 0, 0, 0);
    expect(trimBeamEnds(degenerate, [upright])).toEqual(degenerate);
  });
});

describe('beamSubPolygon', () => {
  it('returns a rectangle over the requested stretch, at the full width', () => {
    const poly = beamSubPolygon(ends(0, 0, 3000, 0), 300, 0.2, 0.6);
    // t=0.2 -> x=600, t=0.6 -> x=1800, half-width 150 either side of the centreline.
    expect(poly).toEqual([
      { x: 600, y: 150 },
      { x: 600, y: -150 },
      { x: 1800, y: -150 },
      { x: 1800, y: 150 },
    ]);
  });

  it('matches the whole-beam polygon when t0/t1 are 0 and 1', () => {
    const full = ends(0, 0, 3000, 0);
    expect(beamSubPolygon(full, 300, 0, 1)).toEqual(beamPolygon(full, 300));
  });

  it('works along a vertical beam too', () => {
    const poly = beamSubPolygon(ends(0, 0, 0, 4000), 200, 0.25, 0.75);
    expect(poly[0]).toEqual({ x: -100, y: 1000 });
    expect(poly[2]).toEqual({ x: 100, y: 3000 });
  });
});

describe('drawnBeamEnds', () => {
  const model = (): PlanModel => ({
    grid: { x: [], y: [] },
    columnTypes: [],
    columns: [],
    beamTypes: [
      { id: 'bt-300', label: 'B-300x600', width: 300, depth: 600 },
      { id: 'bt-200', label: 'B-200x500', width: 200, depth: 500 },
    ],
    beams: [
      {
        id: 'support',
        typeId: 'bt-300',
        kind: 'primary',
        start: { kind: 'point', x: 0, y: -2000 },
        end: { kind: 'point', x: 0, y: 2000 },
      },
      {
        id: 'landing',
        typeId: 'bt-200',
        kind: 'secondary',
        start: { kind: 'point', x: 0, y: 0 },
        end: { kind: 'point', x: 3000, y: 0 },
      },
    ],
    upstandTypes: [],
    upstands: [],
    slabTypes: [],
    panelAssignments: [],
    sectionLines: [],
    defaultSlabTypeId: '',
  });

  it('trims each beam against the others, but never against itself', () => {
    const m = model();
    const resolved = new Map<string, BeamEnds>([
      ['support', ends(0, -2000, 0, 2000)],
      ['landing', ends(0, 0, 3000, 0)],
    ]);
    const out = drawnBeamEnds(m, resolved);
    expect(out.get('landing')).toEqual({ start: { x: 150, y: 0 }, end: { x: 3000, y: 0 } });
    // The support runs through, so it keeps its own full length.
    expect(out.get('support')).toEqual(ends(0, -2000, 0, 2000));
  });

  it('omits whatever resolveBeams omitted', () => {
    const m = model();
    const resolved = new Map<string, BeamEnds>([['landing', ends(0, 0, 3000, 0)]]);
    const out = drawnBeamEnds(m, resolved);
    expect(out.has('support')).toBe(false);
    // With the support gone there is nothing to trim against.
    expect(out.get('landing')).toEqual(ends(0, 0, 3000, 0));
  });
});
