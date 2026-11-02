import { describe, expect, it } from 'vitest';
import { emptyModel } from './types';
import { makeGrid, setGridEnd } from './ops';

describe('setGridEnd', () => {
  it('extends a grid along its own line, ignoring sideways drag', () => {
    const g = makeGrid({ x: 0, y: 0 }, { x: 0, y: 5000 }, 'A');
    const m = setGridEnd({ ...emptyModel(), grids: [g] }, g.id, 2, { x: 300, y: 8000 });
    expect(m.grids[0]).toMatchObject({ dir: 'X', x1: 0, y1: 0, x2: 0, y2: 8000 });
  });
  it('refuses to collapse the grid onto its other end', () => {
    const g = makeGrid({ x: 0, y: 0 }, { x: 5000, y: 0 }, '1');
    const m0 = { ...emptyModel(), grids: [g] };
    expect(setGridEnd(m0, g.id, 1, { x: 5000, y: 200 })).toBe(m0);
  });
});
