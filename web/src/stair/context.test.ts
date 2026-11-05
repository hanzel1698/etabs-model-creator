import { describe, expect, it } from 'vitest';
import { defaultStairParams, emptyModel, type Model, type StairRegion } from '../model/types';
import { stairContext } from './context';

const B = (id: string, story: string, x1: number, y1: number, x2: number, y2: number) => ({ id, story, x1, y1, x2, y2, section: 'B300x500' });
const C = (id: string, story: string, x: number, y: number) => ({ id, story, x, y, section: 'C400x400', angle: 0 });

const m: Model = {
  ...emptyModel(), // Story1..3, 3000 each
  columns: [C('edge', 'Story1', 3000, 0), C('in2', 'Story2', 1000, 1000), C('out', 'Story3', 9000, 0)],
  beams: [B('cross', 'Story2', -2000, 1000, 8000, 1000), B('far', 'Story3', 9000, 0, 9000, 6000)],
  slabs: [{ id: 's', story: 'Story1', pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }], section: 'S150' }],
  grids: [{ id: 'g', label: 'A', dir: 'Y', x1: -5000, y1: 0, x2: 20000, y2: 0, bubble: 'start' }],
  refPlanes: [
    { id: 'r1', name: 'MID1', z: 4500 },
    { id: 'r2', name: 'MID3', z: 7500 },
  ],
};
const region: StairRegion = { id: 'st', name: 'STAIR-01', x1: 3000, y1: 3000, x2: 0, y2: 0, flights: [], landings: [], spans: [], params: defaultStairParams() };

describe('stairContext', () => {
  const c = stairContext(m, region);
  it('keeps columns in the box, including one on its edge', () => {
    expect(c.columns.map((x) => x.id)).toEqual(['edge', 'in2']);
  });
  it('keeps a beam crossing the box whole', () => {
    expect(c.beams).toEqual([m.beams[0]]);
  });
  it('clips grids to the box', () => {
    expect(c.grids[0]).toMatchObject({ x1: -1, x2: 3001, y1: 0, y2: 0 });
  });
  it('stops at the highest story with something in the box, with its ref planes', () => {
    expect(c.stories.map((s) => s.name)).toEqual(['Story1', 'Story2']);
    expect(c.refPlanes.map((p) => p.name)).toEqual(['MID1']);
  });
  it('has no slabs', () => {
    expect(c.slabs).toEqual([]);
  });
  it('reaches up to a landing above the structure in the box', () => {
    const l = { id: 'l', name: 'L1', x: 0, y: 0, w: 1200, h: 1200, z: 8000, t: 200 };
    expect(stairContext(m, { ...region, landings: [l] }).stories.length).toBe(3);
  });
  it('an empty box keeps every story', () => {
    expect(stairContext(m, { ...region, x1: 50000, x2: 51000, y1: 50000, y2: 51000 }).stories.length).toBe(3);
  });
});

describe('stairContext for drawing (clipped beams)', () => {
  it('cuts beams to the box and moves their loads onto the piece', () => {
    const load = { pattern: 'SDL', kind: 'dist' as const, force: 'F' as const, dir: 'Gravity' as const, rel: false, d1: 1000, d2: 4000, v1: 5, v2: 5 };
    const far = { pattern: 'SDL', kind: 'point' as const, force: 'F' as const, dir: 'Gravity' as const, rel: false, d1: 9000, d2: 9000, v1: 5, v2: 5 };
    const mm = { ...m, beams: [{ ...m.beams[0], loads: [load, far] }] }; // beam x -2000 → 8000 at y 1000
    const b = stairContext(mm, region, true).beams[0];
    expect(b).toMatchObject({ id: 'cross', x1: -1, x2: 3001 });
    // the piece starts at x = -1, 1999 mm along the beam; the point load at 9000 is off it
    expect(b.loads!.map((l) => [l.d1, Math.round(l.d2)])).toEqual([[0, 2001]]);
  });
});
