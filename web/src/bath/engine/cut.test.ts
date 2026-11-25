import { describe, expect, it } from 'vitest';
import {
  clipToPolygon,
  cutSection,
  isClickOrderCanonical,
  mirrorRun,
  shouldMirrorForDisplay,
  subtractIntervals,
  unionIntervals,
} from './cut';
import { realBathroomModel } from './defaults';
import type { PlanModel, RunBeam, RunSlab, RunUpstand, SectionLine, SectionRun } from './types';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('unionIntervals', () => {
  it('merges overlapping and touching runs', () => {
    expect(unionIntervals([
      [0, 5],
      [4, 8],
      [8, 9],
      [20, 22],
    ])).toEqual([
      [0, 9],
      [20, 22],
    ]);
  });
});

describe('subtractIntervals', () => {
  it('punches a hole in the middle', () => {
    expect(subtractIntervals([0, 100], [[40, 60]])).toEqual([
      [0, 40],
      [60, 100],
    ]);
  });

  it('trims from the ends', () => {
    expect(subtractIntervals([0, 100], [[0, 10], [90, 100]])).toEqual([[10, 90]]);
  });

  it('can remove everything', () => {
    expect(subtractIntervals([0, 100], [[-5, 105]])).toEqual([]);
  });

  it('drops slivers rather than emitting zero-length pieces', () => {
    expect(subtractIntervals([0, 100], [[0, 99.9]])).toEqual([]);
  });
});

describe('clipToPolygon', () => {
  it('finds the crossing of a simple box', () => {
    const got = clipToPolygon({ x: -5, y: 5 }, { x: 1, y: 0 }, 20, square);
    expect(got).toHaveLength(1);
    expect(got[0]![0]).toBeCloseTo(5);
    expect(got[0]![1]).toBeCloseTo(15);
  });

  it('reports an open end when the line starts inside', () => {
    const got = clipToPolygon({ x: 5, y: 5 }, { x: 1, y: 0 }, 20, square);
    expect(got[0]![0]).toBeCloseTo(0);
    expect(got[0]![1]).toBeCloseTo(5);
  });

  it('returns nothing when the line misses', () => {
    expect(clipToPolygon({ x: -5, y: 50 }, { x: 1, y: 0 }, 20, square)).toEqual([]);
  });

  it('returns two intervals for a concave polygon', () => {
    // A 'U': the line across the opening leaves and re-enters.
    const u = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 7, y: 10 },
      { x: 7, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 10 },
      { x: 0, y: 10 },
    ];
    const got = clipToPolygon({ x: -5, y: 6 }, { x: 1, y: 0 }, 20, u);
    expect(got).toHaveLength(2);
    expect(got[0]![0]).toBeCloseTo(5);
    expect(got[0]![1]).toBeCloseTo(8);
    expect(got[1]![0]).toBeCloseTo(12);
    expect(got[1]![1]).toBeCloseTo(15);
  });

  it('works on a diagonal line', () => {
    const s = Math.SQRT1_2;
    const got = clipToPolygon({ x: -5, y: -5 }, { x: s, y: s }, 40, square);
    expect(got).toHaveLength(1);
    expect(got[0]![0]).toBeCloseTo(5 * Math.SQRT2);
    expect(got[0]![1]).toBeCloseTo(15 * Math.SQRT2);
  });
});

/** A horizontal section across the seeded plan at mid-height. */
function midLine(): SectionLine {
  const y = 3410;
  return { id: 'sl1', label: 'A-A', a: { x: -1000, y }, b: { x: 8000, y } };
}

describe('cutSection', () => {
  it('cuts the three vertical beams and the two bays between them', () => {
    const model = realBathroomModel();
    const run = cutSection(model, midLine());

    const kinds = run.items.map((i) => i.kind);
    expect(kinds).toEqual(['beam', 'slab', 'beam', 'slab', 'beam']);
    expect(run.warnings).toEqual([]);
  });

  it('gives a perpendicular cut the beam s true width', () => {
    const model = realBathroomModel();
    const run = cutSection(model, midLine());
    const beams = run.items.filter((i): i is RunBeam => i.kind === 'beam');
    for (const beam of beams) {
      expect(beam.cutWidth).toBeCloseTo(300);
      expect(beam.trueWidth).toBe(300);
      expect(beam.skew).toBeCloseTo(90);
    }
  });

  it('widens the cut by 1/sin(theta) when oblique', () => {
    const model = realBathroomModel();
    // y = x + 1000, i.e. 45 degrees, kept clear of the column corners.
    const line: SectionLine = {
      id: 'sl2',
      label: 'B-B',
      a: { x: -1000, y: 0 },
      b: { x: 8000, y: 9000 },
    };
    const run = cutSection(model, line);
    const beams = run.items.filter((i): i is RunBeam => i.kind === 'beam');
    expect(beams.length).toBeGreaterThan(0);
    for (const beam of beams) {
      expect(beam.skew).toBeCloseTo(45);
      expect(beam.cutWidth).toBeCloseTo(300 * Math.SQRT2, 1);
    }
  });

  it('cuts a beam it runs along in long section, and still cuts the ones it crosses', () => {
    const model = realBathroomModel();
    // Down grid line 13, inside the width of the vertical beam there.
    const line: SectionLine = { id: 'sl3', label: 'C-C', a: { x: 10, y: -500 }, b: { x: 10, y: 7500 } };
    const run = cutSection(model, line);

    const along = model.beams.find(
      (b) =>
        b.start.kind === 'column' &&
        b.start.columnId === 'col-13-D' &&
        b.end.kind === 'column' &&
        b.end.columnId === 'col-13-E',
    )!;

    expect(run.warnings.some((w) => w.includes('runs along'))).toBe(true);

    const longitudinal = run.items.filter((i): i is RunBeam => i.kind === 'beam' && !!i.longitudinal);
    expect(longitudinal).toHaveLength(1);
    expect(longitudinal[0]!.beamId).toBe(along.id);
    expect(longitudinal[0]!.trueWidth).toBe(300);
    expect(longitudinal[0]!.skew).toBeCloseTo(0);
    // The line covers the beam end to end (D to E, 6820 apart), so what the
    // section shows is the beam's whole length and neither bound is a break.
    expect(longitudinal[0]!.cutWidth).toBeCloseTo(6820);
    expect(longitudinal[0]!.d0Cut).toBe(false);
    expect(longitudinal[0]!.d1Cut).toBe(false);

    // The perpendicular beams on D and E are still cut normally.
    const crossed = run.items.filter((i): i is RunBeam => i.kind === 'beam' && !i.longitudinal);
    expect(crossed).toHaveLength(2);
    expect(crossed.every((b) => Math.abs(b.skew - 90) < 1e-6)).toBe(true);

    // And no slab is drawn over the stretch the beam itself occupies — inside
    // that breadth the plane is cutting beam, not slab.
    const { d0, d1 } = longitudinal[0]!;
    for (const slab of run.items.filter((i): i is RunSlab => i.kind === 'slab')) {
      expect(slab.d1 <= d0 + 1e-6 || slab.d0 >= d1 - 1e-6).toBe(true);
    }
  });

  it('breaks the long section where the line stops short of the beam ends', () => {
    const model = realBathroomModel();
    // Down the same beam, but starting and stopping inside its length.
    const line: SectionLine = { id: 'sl11', label: 'K-K', a: { x: 10, y: 1000 }, b: { x: 10, y: 5000 } };
    const run = cutSection(model, line);

    const longitudinal = run.items.find((i): i is RunBeam => i.kind === 'beam' && !!i.longitudinal)!;
    expect(longitudinal.cutWidth).toBeCloseTo(4000);
    expect(longitudinal.d0Cut).toBe(true);
    expect(longitudinal.d1Cut).toBe(true);
  });

  it('leaves an open end when the line starts inside a bay', () => {
    const model = realBathroomModel();
    // Canonical origin is the larger-x end, so that must be the one inside the bay.
    const line: SectionLine = {
      id: 'sl4',
      label: 'D-D',
      a: { x: -1000, y: 3410 },
      b: { x: 1000, y: 3410 },
    };
    const run = cutSection(model, line);
    expect(run.items[0]!.kind).toBe('slab');
    expect(run.items[0]!.d0).toBeCloseTo(0);
  });

  it('reports a line that misses the framing entirely', () => {
    const model = realBathroomModel();
    const line: SectionLine = {
      id: 'sl5',
      label: 'E-E',
      a: { x: -5000, y: -5000 },
      b: { x: -4000, y: -5000 },
    };
    const run = cutSection(model, line);
    expect(run.items).toEqual([]);
    expect(run.warnings).toContain('Section line does not cross any framing.');
  });

  it('rejects a zero-length line', () => {
    const model = realBathroomModel();
    const line: SectionLine = { id: 'sl6', label: 'F-F', a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
    expect(cutSection(model, line).items).toEqual([]);
  });

  it('carries the slab type of the panel it crossed', () => {
    const model = realBathroomModel();
    model.panelAssignments = [{ id: 'pa1', seed: { x: 1000, y: 3000 }, slabTypeId: 'st-TS2' }];
    const run = cutSection(model, midLine());
    const slabs = run.items.filter((i) => i.kind === 'slab');
    // Canonical direction runs right to left, so the smaller-x (tagged) bay comes last.
    expect(slabs[0]!.kind === 'slab' && slabs[0]!.slabTypeId).toBe('st-TS1');
    expect(slabs[1]!.kind === 'slab' && slabs[1]!.slabTypeId).toBe('st-TS2');
  });

  it('leaves a duct panel out of the run entirely', () => {
    const model = realBathroomModel();
    const withSlab = cutSection(model, midLine()).items.filter((i) => i.kind === 'slab');
    // Same seed as the tagging test above, so the bay it lands in is known.
    model.panelAssignments = [{ id: 'pa1', seed: { x: 1000, y: 3000 }, slabTypeId: null }];

    const slabs = cutSection(model, midLine()).items.filter((i) => i.kind === 'slab');
    expect(withSlab).toHaveLength(2);
    expect(slabs).toHaveLength(1);
    expect(slabs[0]!.kind === 'slab' && slabs[0]!.slabTypeId).toBe('st-TS1');
  });

  it('never overlaps two items', () => {
    const model = realBathroomModel();
    const run = cutSection(model, midLine());
    for (let i = 1; i < run.items.length; i++) {
      expect(run.items[i]!.d0).toBeGreaterThanOrEqual(run.items[i - 1]!.d1 - 1e-6);
    }
  });

  it('reads left to right on a horizontal line regardless of click order', () => {
    const model = realBathroomModel();
    const forward = cutSection(model, midLine());
    const swapped = midLine();
    [swapped.a, swapped.b] = [swapped.b, swapped.a];
    const backward = cutSection(model, swapped);
    expect(backward.items).toEqual(forward.items);
  });

  it('reads bottom to top on a vertical line regardless of click order', () => {
    const model = realBathroomModel();
    const line: SectionLine = { id: 'sl8', label: 'H-H', a: { x: 10, y: -500 }, b: { x: 10, y: 7500 } };
    const reversedClick: SectionLine = { ...line, a: line.b, b: line.a };
    expect(cutSection(model, reversedClick).items).toEqual(cutSection(model, line).items);
  });

  it('reads counter-clockwise (upper half-plane) on a skewed line regardless of click order', () => {
    const model = realBathroomModel();
    const line: SectionLine = {
      id: 'sl9',
      label: 'I-I',
      a: { x: -1000, y: 0 },
      b: { x: 8000, y: 9000 },
    };
    const reversedClick: SectionLine = { ...line, a: line.b, b: line.a };
    expect(cutSection(model, reversedClick).items).toEqual(cutSection(model, line).items);
  });

  it('does not mark a break where a column trims a slab, only where a beam does', () => {
    const model = realBathroomModel();
    // y = 170 sits inside every D-row column's half-depth (200) but outside
    // the framing beams' half-width (150) at those same grid lines, so the
    // bays here are trimmed purely by the columns, not by any beam.
    const line: SectionLine = { id: 'sl10', label: 'J-J', a: { x: -1000, y: 170 }, b: { x: 8000, y: 170 } };
    const run = cutSection(model, line);
    const slabs = run.items.filter((i): i is RunSlab => i.kind === 'slab');
    expect(slabs.length).toBeGreaterThan(0);
    for (const slab of slabs) {
      expect(slab.d0Cut).toBeFalsy();
      expect(slab.d1Cut).toBeFalsy();
    }

    // Contrast: at mid-height (away from any column) the same bays are
    // trimmed by the framing beams instead, which does get a break line.
    const midRun = cutSection(model, midLine());
    const midSlabs = midRun.items.filter((i): i is RunSlab => i.kind === 'slab');
    expect(midSlabs.length).toBeGreaterThan(0);
    for (const slab of midSlabs) {
      expect(slab.d0Cut).toBe(true);
      expect(slab.d1Cut).toBe(true);
    }
  });

  it('shows a column where the section misses the beams framing it', () => {
    const model = realBathroomModel();
    // Along the D grid line the horizontal beams are 300 wide but the columns
    // are 400, so the column corners stick out past them.
    const line: SectionLine = {
      id: 'sl7',
      label: 'G-G',
      a: { x: -1000, y: -190 },
      b: { x: 8000, y: -190 },
    };
    const run = cutSection(model, line);
    expect(run.items.some((i) => i.kind === 'column')).toBe(true);
  });
});

/** A single 300 wide beam running up the y axis, with a 150 deep upstand over its middle half. */
function upstandModel(): PlanModel {
  return {
    grid: { x: [], y: [] },
    columnTypes: [],
    columns: [],
    beamTypes: [{ id: 'bt-1', label: 'B1', width: 300, depth: 600 }],
    beams: [
      {
        id: 'beam1',
        typeId: 'bt-1',
        kind: 'primary',
        start: { kind: 'point', x: 0, y: -2000 },
        end: { kind: 'point', x: 0, y: 2000 },
      },
    ],
    upstandTypes: [{ id: 'ut-1', label: 'U1', depth: 150 }],
    upstands: [{ id: 'up1', typeId: 'ut-1', beamId: 'beam1', t0: 0.25, t1: 0.75 }],
    slabTypes: [{ id: 'st-1', label: 'TS1', thickness: 150, sink: 0 }],
    panelAssignments: [],
    sectionLines: [],
    defaultSlabTypeId: 'st-1',
  };
}

describe('cutSection — upstands', () => {
  it('marks the beam crossing when it lands inside the upstand range', () => {
    const model = upstandModel();
    // Crosses the beam at y=0 — t=0.5 on a beam running -2000 to 2000, inside [0.25, 0.75].
    const line: SectionLine = { id: 'sl', label: 'A-A', a: { x: -1000, y: 0 }, b: { x: 1000, y: 0 } };
    const run = cutSection(model, line);

    const beam = run.items.find((i): i is RunBeam => i.kind === 'beam')!;
    expect(beam.upstandDepth).toBe(150);

    const upstand = run.items.find((i): i is RunUpstand => i.kind === 'upstand')!;
    expect(upstand).toBeDefined();
    expect(upstand.upstandId).toBe('up1');
    expect(upstand.d0).toBeCloseTo(beam.d0);
    expect(upstand.d1).toBeCloseTo(beam.d1);
    expect(upstand.trueWidth).toBe(300);
  });

  it('leaves a crossing outside the upstand range unmarked', () => {
    const model = upstandModel();
    // t = (1500 - -2000) / 4000 = 0.875, outside [0.25, 0.75].
    const line: SectionLine = { id: 'sl', label: 'B-B', a: { x: -1000, y: 1500 }, b: { x: 1000, y: 1500 } };
    const run = cutSection(model, line);

    const beam = run.items.find((i): i is RunBeam => i.kind === 'beam')!;
    expect(beam.upstandDepth).toBeUndefined();
    expect(run.items.some((i) => i.kind === 'upstand')).toBe(false);
  });

  it('cuts the upstand as its own stretch of length when the section runs along the beam', () => {
    const model = upstandModel();
    const line: SectionLine = { id: 'sl', label: 'C-C', a: { x: 0, y: -1900 }, b: { x: 0, y: 1900 } };
    const run = cutSection(model, line);

    const upstand = run.items.find((i): i is RunUpstand => i.kind === 'upstand')!;
    expect(upstand).toBeDefined();
    expect(upstand.longitudinal).toBe(true);
    // t 0.25..0.75 of a 4000 beam is 2000mm of its length.
    expect(upstand.d1 - upstand.d0).toBeCloseTo(2000);
    // Neither bound was clipped — the whole upstand is inside the visible piece.
    expect(upstand.d0Cut).toBe(false);
    expect(upstand.d1Cut).toBe(false);

    // The beam itself carries no upstandDepth here — the catch check does not
    // apply to a longitudinal cut in the first place.
    const beam = run.items.find((i): i is RunBeam => i.kind === 'beam')!;
    expect(beam.upstandDepth).toBeUndefined();
  });

  it('marks a break where the section stops short of the upstand s own end', () => {
    const model = upstandModel();
    // Stops at y=500, inside the upstand's own extent (-1000 to 1000).
    const line: SectionLine = { id: 'sl', label: 'D-D', a: { x: 0, y: -1900 }, b: { x: 0, y: 500 } };
    const run = cutSection(model, line);
    const upstand = run.items.find((i): i is RunUpstand => i.kind === 'upstand')!;
    expect(upstand.d1 - upstand.d0).toBeCloseTo(1500);
    expect(upstand.d0Cut).toBe(true);
  });

  it('has nothing to mark when the beam carries no upstand at all', () => {
    const model = upstandModel();
    model.upstands = [];
    const line: SectionLine = { id: 'sl', label: 'E-E', a: { x: -1000, y: 0 }, b: { x: 1000, y: 0 } };
    const run = cutSection(model, line);
    expect(run.items.some((i) => i.kind === 'upstand')).toBe(false);
    const beam = run.items.find((i): i is RunBeam => i.kind === 'beam')!;
    expect(beam.upstandDepth).toBeUndefined();
  });
});

describe('mirrorRun', () => {
  it('reverses order and remaps each item about the run length', () => {
    const run: SectionRun = {
      length: 100,
      warnings: [],
      gridCrossings: [],
      items: [
        { kind: 'slab', d0: 0, d1: 40, slabTypeId: 'st-TS1', panelId: 'p1' },
        { kind: 'beam', d0: 40, d1: 70, beamId: 'b1', trueWidth: 30, cutWidth: 30, skew: 90 },
        { kind: 'slab', d0: 70, d1: 100, slabTypeId: 'st-TS2', panelId: 'p2' },
      ],
    };

    const mirrored = mirrorRun(run);
    expect(mirrored.length).toBe(100);
    expect(mirrored.items.map((i) => [i.d0, i.d1])).toEqual([
      [0, 30],
      [30, 60],
      [60, 100],
    ]);
    // The slab that was on the right is now on the left, and vice versa.
    expect(mirrored.items[0]!.kind === 'slab' && mirrored.items[0]!.slabTypeId).toBe('st-TS2');
    expect(mirrored.items[2]!.kind === 'slab' && mirrored.items[2]!.slabTypeId).toBe('st-TS1');
  });

  it('is its own inverse', () => {
    const model = realBathroomModel();
    const run = cutSection(model, midLine());
    expect(mirrorRun(mirrorRun(run))).toEqual(run);
  });

  it('preserves beam identity and width through the mirror', () => {
    const model = realBathroomModel();
    const run = cutSection(model, midLine());
    const mirrored = mirrorRun(run);
    const originalBeamIds = run.items.filter((i) => i.kind === 'beam').map((i) => i.beamId);
    const mirroredBeamIds = mirrored.items.filter((i) => i.kind === 'beam').map((i) => i.beamId);
    expect(new Set(mirroredBeamIds)).toEqual(new Set(originalBeamIds));
  });
});

describe('shouldMirrorForDisplay', () => {
  it('mirrors a horizontal line drawn left to right, unreversed', () => {
    // midLine() is drawn a (x:-1000, left) -> b (x:8000, right).
    const line = midLine();
    expect(isClickOrderCanonical(line.a, line.b)).toBe(false);
    expect(shouldMirrorForDisplay(line)).toBe(true);
  });

  it('does not mirror the same physical line drawn right to left, unreversed', () => {
    const line = midLine();
    const reversedClick: SectionLine = { ...line, a: line.b, b: line.a };
    expect(isClickOrderCanonical(reversedClick.a, reversedClick.b)).toBe(true);
    expect(shouldMirrorForDisplay(reversedClick)).toBe(false);
  });

  it('flips the answer when the manual "Flip view" toggle is on', () => {
    const line = midLine();
    const reversedClick: SectionLine = { ...line, a: line.b, b: line.a };
    expect(shouldMirrorForDisplay({ ...line, reversed: true })).toBe(false);
    expect(shouldMirrorForDisplay({ ...reversedClick, reversed: true })).toBe(true);
  });

  it('places the first-clicked end at screen-left either way, matching the arrow', () => {
    const model = realBathroomModel();
    const line = midLine();
    const reversedClick: SectionLine = { ...line, a: line.b, b: line.a };

    const cut = cutSection(model, line);
    const run = shouldMirrorForDisplay(line) ? mirrorRun(cut) : cut;

    const reversedCut = cutSection(model, reversedClick);
    const reversedRun = shouldMirrorForDisplay(reversedClick) ? mirrorRun(reversedCut) : reversedCut;

    // Same physical line, opposite click order -> opposite reading order on screen.
    expect(reversedRun.items).toEqual(mirrorRun(run).items);
  });

  it('handles a vertical line the same way', () => {
    const line: SectionLine = { id: 'sl10', label: 'J-J', a: { x: 10, y: -500 }, b: { x: 10, y: 7500 } };
    const reversedClick: SectionLine = { ...line, a: line.b, b: line.a };
    expect(shouldMirrorForDisplay(line)).toBe(!shouldMirrorForDisplay(reversedClick));
  });
});
