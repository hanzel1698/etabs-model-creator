import { describe, expect, it } from 'vitest';
import { addBeams, addColumns, generateGrids } from '../model/ops';
import { emptyModel, type FrameLoad, type Model, type ShellLoad } from '../model/types';
import { buildDrawings, clipSeg, layout, paginate, storyUnits, suggestOrient } from './sheets';
import { plansPdf } from './pdf';

const udl = (pattern: string, v: number): FrameLoad => ({ pattern, kind: 'dist', force: 'F', dir: 'Gravity', rel: true, d1: 0, d2: 1, v1: v, v2: v });
const sl = (pattern: string, value: number): ShellLoad => ({ pattern, dir: 'Gravity', value });
const bay = (x: number, w: number) => [{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: 5000 }, { x, y: 5000 }];
const noUnderlay = { dxf: null, regions: [], showText: true };

/** Two bays, 3 stories: Story2 and Story3 identical, Story1 different (no loads). */
function model(): Model {
  let m: Model = { ...emptyModel(), loadPatterns: [{ name: 'WALL LOAD', type: 'Dead', selfWeight: 0 }, { name: 'SHADE+CAN', type: 'Dead', selfWeight: 0 }, { name: 'FIN+PAR+FIL', type: 'Dead', selfWeight: 0 }, { name: 'LIVE[<3]', type: 'Live', selfWeight: 0 }] };
  m = { ...m, grids: generateGrids({ xSpacing: [6000, 6000], ySpacing: [5000], x0: 0, y0: 0, xLabelStart: 'A', yLabelStart: '1', extend: 1000 }) };
  const segs: [any, any][] = [[{ x: 0, y: 0 }, { x: 6000, y: 0 }], [{ x: 6000, y: 0 }, { x: 12000, y: 0 }], [{ x: 0, y: 5000 }, { x: 12000, y: 5000 }]];
  m = addBeams(m, segs, ['Story1', 'Story2', 'Story3'], 'B300x500');
  m = addColumns(m, [{ x: 0, y: 0 }, { x: 12000, y: 0 }], ['Story1', 'Story2', 'Story3'], 'C400x400', 0);
  m = { ...m, beams: m.beams.map((b) => (b.story !== 'Story1' && b.y1 === 0 ? { ...b, loads: [udl('WALL LOAD', b.x1 === 0 ? 6.9 : 3.5), ...(b.x1 === 0 ? [udl('SHADE+CAN', 1.5)] : [])] } : b)) };
  const slab = (story: string, x: number, loads?: ShellLoad[]) => ({ id: `${story}${x}`, story, pts: bay(x, 6000), section: 'S150', loads });
  for (const st of ['Story2', 'Story3']) m.slabs.push(slab(st, 0, [sl('LIVE[<3]', 2), sl('FIN+PAR+FIL', 1.5)]), slab(st, 6000, [sl('FIN+PAR+FIL', 1.5), sl('LIVE[<3]', 2)]));
  m.slabs.push(slab('Story1', 0));
  return m;
}

describe('plan sheets', () => {
  it('groups stories that draw the same into one region', () => {
    expect(storyUnits(model(), noUnderlay).map((u) => u.stories)).toEqual([['Story1'], ['Story2', 'Story3']]);
  });

  it('builds framing, one column layout, a plan per loaded line-load pattern and shell loads', () => {
    const ds = buildDrawings(model(), noUnderlay);
    expect(ds.map((d) => `${d.title} | ${d.region}`)).toEqual([
      'FRAMING PLAN | Story1',
      'FRAMING PLAN | Story2 – Story3',
      'COLUMN LAYOUT | ALL STOREYS',
      'WALL LOAD PLAN | Story2 – Story3',
      'SHADE+CAN PLAN | Story2 – Story3',
      'SHELL LOADS PLAN | Story2 – Story3',
    ]);
    const wall = ds[3].legend[0].rows;
    expect(wall.map((r) => r.label[0])).toEqual(['6.9 kN/m', '3.5 kN/m']);
    // same loads in a different order are one group, printed in pattern order
    const shell = ds[5].legend[0].rows;
    expect(shell).toHaveLength(1);
    expect(ds[5].legend[1].rows[0].label).toEqual(['FIN = FIN+PAR+FIL', 'LL = LIVE[<3]']);
    expect(shell[0].label).toEqual(['FIN 1.50', 'LL 2.00']);
    expect(shell[0].sub).toBe('60 m²');
  });

  it('picks the larger plan: scale, legend side and orientation', () => {
    const d = buildDrawings(model(), noUnderlay)[0];
    const L = layout(d, 'L');
    expect(L.S).toBe(50); // 12 m wide plan fits 1:50 on landscape A3
    expect(suggestOrient(d)).toBe('L');
    const tall = { ...d, box: { minX: 0, minY: 0, maxX: 12000, maxY: 40000 } };
    expect(suggestOrient(tall)).toBe('P');
  });

  it('pairs drawings of the same orientation onto A2 pages', () => {
    const pages = paginate([{ item: 1, o: 'L' }, { item: 2, o: 'P' }, { item: 3, o: 'L' }, { item: 4, o: 'L' }]);
    expect(pages).toEqual([{ o: 'L', slots: [1, 3] }, { o: 'P', slots: [2] }, { o: 'L', slots: [4] }]);
  });

  it('clips underlay lines to the plan area', () => {
    const c = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(clipSeg({ x: -5, y: 5 }, { x: 15, y: 5 }, c)).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }]);
    expect(clipSeg({ x: -5, y: 20 }, { x: 15, y: 20 }, c)).toBeNull();
  });

  it('writes an A2 PDF', async () => {
    const ds = buildDrawings(model(), noUnderlay);
    const doc = await plansPdf(ds.map((item) => ({ item, o: suggestOrient(item) })));
    expect(doc.getNumberOfPages()).toBe(3);
  });
});
