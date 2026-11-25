import { describe, expect, it } from 'vitest';
import { facesForModel, facesFromSegments, panelAt, panelsForModel } from './faces';
import { polygonArea, polygonCentroid } from './planGeom';
import { exampleModel, realBathroomModel } from './defaults';
import type { Pt } from './types';

/** Build a segment list from [x1,y1,x2,y2] tuples. */
function segs(...items: [number, number, number, number][]) {
  return items.map(([x1, y1, x2, y2], i) => ({
    a: { x: x1, y: y1 },
    b: { x: x2, y: y2 },
    beamId: `b${i}`,
  }));
}

const square = (): [number, number, number, number][] => [
  [0, 0, 10, 0],
  [10, 0, 10, 10],
  [10, 10, 0, 10],
  [0, 10, 0, 0],
];

describe('polygonArea sign convention', () => {
  const ccw: Pt[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it('is positive for a counter-clockwise ring', () => {
    expect(polygonArea(ccw)).toBeCloseTo(1);
  });

  it('is negative for a clockwise ring', () => {
    expect(polygonArea([...ccw].reverse())).toBeCloseTo(-1);
  });

  it('gives a centroid inside the polygon', () => {
    // Guards the centroid formula against the area sign flipping under it.
    expect(polygonCentroid(ccw)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('facesFromSegments', () => {
  it('finds a single closed bay and drops the outer boundary', () => {
    const faces = facesFromSegments(segs(...square()));
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBeCloseTo(100);
  });

  it('splits a bay in two when a beam spans it', () => {
    const faces = facesFromSegments(segs(...square(), [0, 5, 10, 5]));
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => Math.round(f.area)).sort()).toEqual([50, 50]);
  });

  it('finds four panels for a cross inside a bay', () => {
    const faces = facesFromSegments(segs(...square(), [0, 5, 10, 5], [5, 0, 5, 10]));
    expect(faces).toHaveLength(4);
    expect(faces.every((f) => Math.abs(f.area - 25) < 1e-6)).toBe(true);
  });

  it('creates no panel for a beam with a free end', () => {
    const faces = facesFromSegments(segs(...square(), [5, 5, 5, 8]));
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBeCloseTo(100);
  });

  it('handles a T-junction onto the middle of an edge', () => {
    const faces = facesFromSegments(segs(...square(), [0, 5, 5, 5]));
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBeCloseTo(100);
  });

  it('splits both beams at a proper crossing', () => {
    // A plus sign with no enclosing ring encloses nothing.
    expect(facesFromSegments(segs([0, 5, 10, 5], [5, 0, 5, 10]))).toHaveLength(0);
  });

  it('ignores zero-length beams', () => {
    expect(facesFromSegments(segs(...square(), [4, 4, 4, 4]))).toHaveLength(1);
  });

  it('returns nothing for an open run of beams', () => {
    expect(facesFromSegments(segs([0, 0, 10, 0], [10, 0, 10, 10]))).toHaveLength(0);
  });

  it('finds a face per component when the plan is disconnected', () => {
    const faces = facesFromSegments(
      segs(...square(), [20, 0, 30, 0], [30, 0, 30, 10], [30, 10, 20, 10], [20, 10, 20, 0]),
    );
    expect(faces).toHaveLength(2);
  });

  it('records which beams bound a face', () => {
    const faces = facesFromSegments(segs(...square()));
    expect(faces[0]!.beamIds.sort()).toEqual(['b0', 'b1', 'b2', 'b3']);
  });

  it('names the beam behind each stretch of the boundary, in ring order', () => {
    const { edges, polygon } = facesFromSegments(segs(...square()))[0]!;
    expect(edges).toHaveLength(polygon.length);
    // Each stretch starts where the last one ended, all the way round.
    edges.forEach((edge, i) => {
      expect(edge.a).toEqual(polygon[i]);
      expect(edge.b).toEqual(polygon[(i + 1) % polygon.length]);
      // Every stretch is a piece of the beam it names.
      const seg = segs(...square())[Number(edge.beamId.slice(1))]!;
      const dx = seg.b.x - seg.a.x;
      const dy = seg.b.y - seg.a.y;
      expect((edge.b.x - edge.a.x) * dy - (edge.b.y - edge.a.y) * dx).toBeCloseTo(0);
    });
  });

  it('splits a side into a stretch each side of a T-junction', () => {
    // A beam landing on the middle of the bottom edge from outside the ring.
    const faces = facesFromSegments(segs(...square(), [5, 0, 5, -8]));
    const bottom = faces[0]!.edges.filter((e) => e.beamId === 'b0');
    expect(bottom).toHaveLength(2);
    expect(bottom.map((e) => e.a.x).sort((p, q) => p - q)).toEqual([0, 5]);
  });

  it('gives a face a stable id regardless of where the walk starts', () => {
    const forward = facesFromSegments(segs(...square()));
    const shuffled = facesFromSegments(segs(...[...square()].reverse()));
    expect(shuffled[0]!.id).toBe(forward[0]!.id);
  });
});

describe('facesForModel', () => {
  it('finds the two equal bays of the default plan', () => {
    const faces = facesForModel(exampleModel());
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => Math.round(f.area)).sort((a, b) => a - b)).toEqual([
      3000 * 6000,
      3000 * 6000,
    ]);
  });

  it('finds the two bays of the real-example plan', () => {
    const faces = facesForModel(realBathroomModel());
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => Math.round(f.area)).sort((a, b) => a - b)).toEqual([
      3250 * 6820,
      3580 * 6820,
    ]);
  });

  it('tracks a grid edit', () => {
    const model = realBathroomModel();
    // The gap between the first two X lines lives on the SECOND line's own
    // field; the first line's own field is the anchor and does nothing.
    model.grid.x[1]!.spacingFromPrev = 5000;
    const faces = facesForModel(model);
    expect(faces.map((f) => Math.round(f.area)).sort((a, b) => a - b)).toEqual([
      3250 * 6820,
      5000 * 6820,
    ]);
  });
});

describe('panelsForModel', () => {
  it('falls back to the default slab type when untagged', () => {
    const panels = panelsForModel(exampleModel());
    expect(panels.every((p) => p.slabTypeId === 'st-TS1')).toBe(true);
    expect(panels.every((p) => p.assignmentId === null)).toBe(true);
  });

  it('applies a tag to the panel containing its seed', () => {
    const model = realBathroomModel();
    model.panelAssignments = [{ id: 'pa1', seed: { x: 1000, y: 3000 }, slabTypeId: 'st-TS2' }];
    const panels = panelsForModel(model);
    const tagged = panels.filter((p) => p.slabTypeId === 'st-TS2');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]!.area).toBeCloseTo(3580 * 6820);
  });

  it('keeps the tag on the right panel after a grid spacing change', () => {
    const model = realBathroomModel();
    model.panelAssignments = [{ id: 'pa1', seed: { x: 1000, y: 3000 }, slabTypeId: 'st-TS2' }];
    model.grid.x[1]!.spacingFromPrev = 5000;
    const tagged = panelsForModel(model).filter((p) => p.slabTypeId === 'st-TS2');
    expect(tagged).toHaveLength(1);
    // Still the left bay, now wider.
    expect(tagged[0]!.area).toBeCloseTo(5000 * 6820);
  });

  it('keeps a duct tag null rather than defaulting it back to a slab', () => {
    const model = realBathroomModel();
    model.panelAssignments = [{ id: 'pa1', seed: { x: 1000, y: 3000 }, slabTypeId: null }];
    const panels = panelsForModel(model);
    const duct = panels.filter((p) => p.slabTypeId === null);
    expect(duct).toHaveLength(1);
    expect(duct[0]!.assignmentId).toBe('pa1');
    // Every other bay is untouched.
    expect(panels.filter((p) => p.slabTypeId === 'st-TS1')).toHaveLength(panels.length - 1);
  });

  it('lets the most recent tag win when seeds share a panel', () => {
    const model = exampleModel();
    model.panelAssignments = [
      { id: 'pa1', seed: { x: 1000, y: 3000 }, slabTypeId: 'st-TS2' },
      { id: 'pa2', seed: { x: 1200, y: 3200 }, slabTypeId: 'st-TS1' },
    ];
    const panel = panelAt(panelsForModel(model), { x: 1100, y: 3100 })!;
    expect(panel.slabTypeId).toBe('st-TS1');
    expect(panel.assignmentId).toBe('pa2');
  });
});

describe('panelAt', () => {
  it('returns the panel containing the point', () => {
    const panels = panelsForModel(exampleModel());
    const left = panelAt(panels, { x: 500, y: 500 });
    const right = panelAt(panels, { x: 5000, y: 500 });
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.id).not.toBe(right!.id);
  });

  it('returns null outside the framing', () => {
    expect(panelAt(panelsForModel(exampleModel()), { x: -5000, y: -5000 })).toBeNull();
  });
});
