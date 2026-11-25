import { describe, expect, it } from 'vitest';
import {
  beamEnds,
  beamSoffitLevel,
  beamTopLevel,
  gridExtent,
  gridPoint,
  lineOffsets,
  resolveAnchor,
  resolveBeams,
} from './grid';
import { realBathroomModel } from './defaults';
import type { PlanModel } from './types';

describe('lineOffsets', () => {
  it('accumulates spacings from the first line, whose own spacing is ignored', () => {
    // The same two real gaps as before (3580, 3250), each now attributed to
    // the line it leads TO rather than the line it leads FROM.
    const offsets = lineOffsets([
      { id: 'a', label: '13', spacingFromPrev: 0 },
      { id: 'b', label: "13'", spacingFromPrev: 3580 },
      { id: 'c', label: '14', spacingFromPrev: 3250 },
    ]);
    expect(offsets.get('a')).toBe(0);
    expect(offsets.get('b')).toBe(3580);
    expect(offsets.get('c')).toBe(6830);
  });

  it('ignores the first line s own spacingFromPrev entirely', () => {
    const offsets = lineOffsets([
      { id: 'a', label: '13', spacingFromPrev: 99999 },
      { id: 'b', label: "13'", spacingFromPrev: 1000 },
    ]);
    expect(offsets.get('a')).toBe(0);
    expect(offsets.get('b')).toBe(1000);
  });

  it('is empty for an empty grid', () => {
    expect(lineOffsets([]).size).toBe(0);
  });
});

describe('gridPoint', () => {
  it('resolves an intersection', () => {
    const m = realBathroomModel();
    expect(gridPoint(m.grid, 'gx-13p', 'gy-E')).toEqual({ x: 3580, y: 6820 });
  });

  it('returns null for an unknown line', () => {
    const m = realBathroomModel();
    expect(gridPoint(m.grid, 'nope', 'gy-E')).toBeNull();
  });
});

describe('gridExtent', () => {
  it('spans the outermost lines', () => {
    expect(gridExtent(realBathroomModel().grid)).toEqual({
      minX: 0,
      maxX: 6830,
      minY: 0,
      maxY: 6820,
    });
  });
});

describe('resolveAnchor', () => {
  it('resolves a column anchor through the grid', () => {
    const m = realBathroomModel();
    expect(resolveAnchor(m, { kind: 'column', columnId: 'col-14-D' })).toEqual({ x: 6830, y: 0 });
  });

  it('resolves a point anchor verbatim', () => {
    const m = realBathroomModel();
    expect(resolveAnchor(m, { kind: 'point', x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });

  it('resolves a parametric point on another beam', () => {
    const m = realBathroomModel();
    const along13 = m.beams.find(
      (b) => b.start.kind === 'column' && b.start.columnId === 'col-13-D',
    )!;
    // That beam runs from (0,0) to (3580,0); halfway is (1790,0).
    expect(resolveAnchor(m, { kind: 'onBeam', beamId: along13.id, t: 0.5 })).toEqual({
      x: 1790,
      y: 0,
    });
  });

  it('clamps t to the beam', () => {
    const m = realBathroomModel();
    const beam = m.beams[0]!;
    expect(resolveAnchor(m, { kind: 'onBeam', beamId: beam.id, t: 5 })).toEqual(
      resolveAnchor(m, { kind: 'onBeam', beamId: beam.id, t: 1 }),
    );
  });

  it('returns null rather than recursing forever on an anchor cycle', () => {
    const m: PlanModel = {
      ...realBathroomModel(),
      beams: [
        {
          id: 'a',
          typeId: 'bt-250x500',
          kind: 'secondary',
          start: { kind: 'onBeam', beamId: 'b', t: 0.5 },
          end: { kind: 'point', x: 0, y: 0 },
        },
        {
          id: 'b',
          typeId: 'bt-250x500',
          kind: 'secondary',
          start: { kind: 'onBeam', beamId: 'a', t: 0.5 },
          end: { kind: 'point', x: 0, y: 0 },
        },
      ],
    };
    expect(beamEnds(m, m.beams[0]!)).toBeNull();
  });

  it('returns null for a deleted column', () => {
    const m = realBathroomModel();
    expect(resolveAnchor(m, { kind: 'column', columnId: 'ghost' })).toBeNull();
  });
});

describe('resolveBeams', () => {
  it('resolves every seeded primary beam', () => {
    const m = realBathroomModel();
    expect(resolveBeams(m).size).toBe(m.beams.length);
  });

  it('omits beams that cannot resolve instead of emitting half-built ones', () => {
    const m = realBathroomModel();
    m.beams.push({
      id: 'dangling',
      typeId: 'bt-250x500',
      kind: 'secondary',
      start: { kind: 'column', columnId: 'ghost' },
      end: { kind: 'point', x: 0, y: 0 },
    });
    const resolved = resolveBeams(m);
    expect(resolved.has('dangling')).toBe(false);
    expect(resolved.size).toBe(m.beams.length - 1);
  });

  it('moves dependent beams when a grid spacing changes', () => {
    const m = realBathroomModel();
    const before = resolveBeams(m).get(m.beams[0]!.id)!;
    // The gap between the first and second X lines lives on the SECOND
    // line's own spacingFromPrev — the first line's own field is the anchor
    // and is ignored.
    m.grid.x[1]!.spacingFromPrev = 4000;
    const after = resolveBeams(m).get(m.beams[0]!.id)!;
    expect(before.end.x).toBe(3580);
    expect(after.end.x).toBe(4000);
  });
});

describe('beamSoffitLevel', () => {
  it('hangs the depth off the beam top, so a flush beam reaches its full depth', () => {
    const m = realBathroomModel();
    expect(beamSoffitLevel(m, m.beams[0]!)).toBe(600);
  });

  /**
   * The whole 600 deep section moves down with the sink. Holding the soffit at
   * 600 instead would leave a 300 deep beam, which is not what casting a beam
   * lower means.
   */
  it('carries the whole section down when the beam is sunk', () => {
    const m = realBathroomModel();
    expect(beamSoffitLevel(m, { ...m.beams[0]!, topLevel: 300 })).toBe(900);
  });

  it('carries it up for an upstand, keeping the depth', () => {
    const m = realBathroomModel();
    const beam = { ...m.beams[0]!, topLevel: -150 };
    expect(beamSoffitLevel(m, beam)).toBe(450);
    expect(beamSoffitLevel(m, beam) - beamTopLevel(beam)).toBe(600);
  });

  it('honours a per-beam depth override', () => {
    const m = realBathroomModel();
    expect(beamSoffitLevel(m, { ...m.beams[0]!, depthOverride: 750 })).toBe(750);
  });
});

describe('beamTopLevel', () => {
  it('takes the beam’s own level', () => {
    const m = realBathroomModel();
    expect(beamTopLevel({ ...m.beams[0]!, topLevel: 300 })).toBe(300);
  });

  it('reads a negative level as an upstand rather than ignoring it', () => {
    const m = realBathroomModel();
    expect(beamTopLevel({ ...m.beams[0]!, topLevel: -150 })).toBe(-150);
  });

  it('sits on the datum when the beam has no level', () => {
    const m = realBathroomModel();
    expect(beamTopLevel(m.beams[0]!)).toBe(0);
  });

  /**
   * Two beams of the same type at different levels is the case that forced the
   * sink off the type in the first place.
   */
  it('lets two beams of one type sit at different levels', () => {
    const m = realBathroomModel();
    const flush = m.beams[0]!;
    const sunk = { ...m.beams[1]!, topLevel: 300 };
    expect(flush.typeId).toBe(sunk.typeId);
    expect(beamTopLevel(flush)).toBe(0);
    expect(beamTopLevel(sunk)).toBe(300);
  });
});
