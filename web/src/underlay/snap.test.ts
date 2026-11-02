import { describe, expect, it } from 'vitest';
import { useUnderlay, underlayGeom } from './store';
import { snapPoint } from '../plan/snap';
import { emptyModel } from '../model/types';
import type { DxfData } from './dxf';

describe('underlay snapping inside a story region', () => {
  it('snaps to a line that crosses the region with both ends outside it', () => {
    const dxf = { layers: [], texts: [], segs: [[{ x: -5000, y: 1000 }, { x: 15000, y: 1000 }]], points: [], bbox: { minX: -5000, minY: 0, maxX: 15000, maxY: 2000 }, fitBox: { minX: 0, minY: 0, maxX: 10000, maxY: 2000 }, insUnits: 4 } as unknown as DxfData;
    useUnderlay.setState({ kind: 'dxf', dxf, setupMode: false, version: 99, regions: [{ id: 'r', stories: ['Story1'], rect: { minX: 0, minY: 0, maxX: 10000, maxY: 2000 }, ref: { x: 0, y: 0 } }] });
    expect(underlayGeom('Story1')!.tree.all().length).toBe(1);
    const s = snapPoint(emptyModel(), { x: 5000, y: 1030 }, 100, { story: 'Story1', underlay: true });
    expect(s.kind).toBe('near');
    expect(s.p.y).toBeCloseTo(1000);
  });
});
