import { describe, expect, it } from 'vitest';
import { useApp } from '../model/store';
import { alignedColumnPoint } from './tools';

describe('column align to point', () => {
  const set = (p: object) => useApp.getState().setColAlign(p as any);
  it('keeps X on a vertical line through the point', () => {
    useApp.setState({ columnAngle: 0, active: { column: 'C400x400', beam: 'B300x500', slab: 'S150' } });
    set({ mode: 'x', anchor: 'center', ref: { x: 1000, y: 0 }, picking: false });
    expect(alignedColumnPoint({ x: 1234, y: 5678 })).toEqual({ x: 1000, y: 5678 });
  });
  it('puts the left/right face on the line', () => {
    set({ anchor: 'min' });
    expect(alignedColumnPoint({ x: 0, y: 50 })).toEqual({ x: 1200, y: 50 }); // 400 wide → centre 200 right of the line
    set({ anchor: 'max' });
    expect(alignedColumnPoint({ x: 0, y: 50 })).toEqual({ x: 800, y: 50 });
  });
  it('keeps Y on a horizontal line, using the rotated extent', () => {
    useApp.setState({ columnAngle: 90, active: { column: 'B300x500', beam: 'B300x500', slab: 'S150' } }); // 500 deep x 300 wide
    set({ mode: 'y', anchor: 'min', ref: { x: 0, y: 2000 } });
    const q = alignedColumnPoint({ x: 10, y: 0 });
    expect(q.x).toBe(10);
    expect(q.y).toBeCloseTo(2250); // rotated 90°: depth 500 now along Y → half = 250
  });
  it('does nothing when off or without a point', () => {
    set({ mode: 'off' });
    expect(alignedColumnPoint({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});
