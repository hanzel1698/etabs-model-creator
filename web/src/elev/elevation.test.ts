import { describe, expect, it } from 'vitest';
import { elevationAt } from './elevation';
import { emptyModel, type Grid, type Model } from '../model/types';

const grid = (id: string, label: string, x1: number, y1: number, x2: number, y2: number): Grid => ({ id, label, dir: x1 === x2 ? 'X' : 'Y', x1, y1, x2, y2, bubble: 'start' });
const A = grid('A', 'A', -1000, 0, 13000, 0);
const m: Model = {
  ...emptyModel(),
  grids: [A, grid('1', '1', 0, -1000, 0, 6000), grid('2', '2', 6000, -1000, 6000, 6000), grid('far', '9', 20000, -1000, 20000, 6000)],
  columns: [
    { id: 'c1', story: 'Story1', x: 0, y: 0, section: 'C400x400', angle: 0 },
    { id: 'c2', story: 'Story3', base: 'Story2', x: 6000, y: 100, section: 'C400x400', angle: 0 },
    { id: 'off', story: 'Story1', x: 3000, y: 5000, section: 'C400x400', angle: 0 },
  ],
  beams: [
    { id: 'along', story: 'Story1', x1: 0, y1: 0, x2: 6000, y2: 0, section: 'B300x500' },
    { id: 'across', story: 'Story1', x1: 3000, y1: -2000, x2: 3000, y2: 2000, section: 'B300x500' },
    { id: 'framing', story: 'Story1', x1: 3000, y1: 0, x2: 3000, y2: 5000, section: 'B300x500' },
  ],
  slabs: [
    // edge on the grid: still shown
    { id: 's', story: 'Story1', section: 'S150', pts: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }, { x: 0, y: 5000 }] },
  ],
};

describe('elevation at a grid', () => {
  const e = elevationAt(m, A, 300);
  it('marks the crossing grids at their stations', () => {
    expect(e.grids.map((g) => [g.label, g.s])).toEqual([['1', 1000], ['2', 7000]]);
  });
  it('picks columns near the grid with their span and width', () => {
    expect(e.columns.map((c) => [c.id, c.s0, c.s1, c.z0, c.z1])).toEqual([
      ['c1', 800, 1200, 0, 3000],
      ['c2', 6800, 7200, 3000, 9000],
    ]);
  });
  it('shows beams along the grid and cuts the ones crossing it', () => {
    expect(e.beams.map((b) => [b.id, b.s0, b.s1, b.z, b.depth])).toEqual([['along', 1000, 7000, 3000, 500]]);
    expect(e.cuts.map((b) => [b.id, b.s0, b.s1])).toEqual([['across', 3850, 4150]]);
  });
  it('cuts slabs whose edge lies on the grid', () => {
    expect(e.slabs.map((s) => [s.id, s.s0, s.s1, s.z, s.t])).toEqual([['s', 1000, 7000, 3000, 150]]);
  });
});
