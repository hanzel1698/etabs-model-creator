import { describe, expect, it } from 'vitest';
import { snapPoint, trackSnap } from './snap';
import { emptyModel, type Model } from '../model/types';

describe('intersection snap', () => {
  it('snaps to the crossing of two beams', () => {
    const m: Model = {
      ...emptyModel(),
      beams: [
        { id: 'a', story: 'Story1', x1: 0, y1: 0, x2: 6000, y2: 6000, section: 'B300x500' },
        { id: 'b', story: 'Story1', x1: 0, y1: 6000, x2: 6000, y2: 0, section: 'B300x500' },
      ],
    };
    const s = snapPoint(m, { x: 3080, y: 2950 }, 200, { story: 'Story1' });
    expect(s.kind).toBe('intersection');
    expect(s.p.x).toBeCloseTo(3000);
    expect(s.p.y).toBeCloseTo(3000);
  });
  it('snaps to a beam crossing a grid line', () => {
    const m: Model = {
      ...emptyModel(),
      grids: [{ id: 'g', label: 'A', dir: 'X', x1: 2500, y1: -1000, x2: 2500, y2: 9000, bubble: 'end' }],
      beams: [{ id: 'a', story: 'Story1', x1: 0, y1: 4000, x2: 6000, y2: 4000, section: 'B300x500' }],
    };
    const s = snapPoint(m, { x: 2550, y: 3920 }, 200, { story: 'Story1' });
    expect(s.kind).toBe('intersection');
    expect(s.p).toEqual({ x: 2500, y: 4000 });
  });
});

describe('tracking snap', () => {
  const t = [{ x: 1000, y: 0 }, { x: 0, y: 2000 }];
  it('locks onto the vertical line through a tracked point', () => {
    expect(trackSnap({ x: 1040, y: 5000 }, t, 100)).toMatchObject({ p: { x: 1000, y: 5000 }, kind: 'track' });
  });
  it('locks onto the crossing of one point X and another point Y', () => {
    const s = trackSnap({ x: 980, y: 2050 }, t, 100)!;
    expect(s.p).toEqual({ x: 1000, y: 2000 });
    expect(s.guides).toHaveLength(2);
  });
  it('gives nothing when nothing lines up', () => {
    expect(trackSnap({ x: 500, y: 500 }, t, 100)).toBeNull();
  });
});
