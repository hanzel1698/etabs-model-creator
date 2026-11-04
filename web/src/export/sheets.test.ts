import { describe, expect, it } from 'vitest';
import { addBeams, addColumns, generateGrids } from '../model/ops';
import { emptyModel, type FrameLoad, type Model, type ShellLoad } from '../model/types';
import { buildDrawings, clipSeg, clusters, crosses, freeSpot, layout, paginate, placeBeamLabels, storyUnits, suggestOrient } from './sheets';
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

  it('builds framing, a column layout per region, a plan per loaded line-load pattern and shell loads', () => {
    const ds = buildDrawings(model(), noUnderlay);
    expect(ds.map((d) => `${d.title} | ${d.region}`)).toEqual([
      'FRAMING PLAN | Story1',
      'FRAMING PLAN | Story2 – Story3',
      'COLUMN LAYOUT | Story1',
      'COLUMN LAYOUT | Story2 – Story3',
      'WALL LOAD PLAN | Story2 – Story3',
      'SHADE+CAN PLAN | Story2 – Story3',
      'SHELL LOADS PLAN | Story2 – Story3',
    ]);
    const wall = ds[4].legend[0].rows;
    expect(wall.map((r) => r.label[0])).toEqual(['6.9 kN/m', '3.5 kN/m']);
    // same loads in a different order are one group, printed in pattern order
    const shell = ds[6].legend[0].rows;
    expect(shell).toHaveLength(1);
    expect(ds[6].legend[1].rows[0].label).toEqual(['FIN = FIN+PAR+FIL', 'LL = LIVE[<3]']);
    expect(shell[0].label).toEqual(['FIN 1.50', 'LL 2.00']);
    expect(shell[0].sub).toBe('1.5/2');
    // the two adjoining bays with the same loads get one label
    const labels = ds[6].prims.filter((p) => p.t === 'text' && p.fit);
    expect(labels.map((p) => p.t === 'text' && p.s)).toEqual(['1.5/2']);
  });

  it('groups polygons that share an edge, not ones that only touch at a corner or are apart', () => {
    const sq = (x: number, y: number) => [{ x, y }, { x: x + 5000, y }, { x: x + 5000, y: y + 5000 }, { x, y: y + 5000 }];
    const g = clusters([sq(0, 0), sq(5000, 0), sq(10000, 5000), sq(20000, 0)]);
    expect(g.map((c) => c.length)).toEqual([2, 1, 1]);
  });

  it('places a fitted label clear of obstacles, inside its polygon', () => {
    const poly = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }];
    const room = { minX: 15, minY: 8, maxX: 25, maxY: 12 };
    const at = freeSpot([poly], 8, 4, { x: 20, y: 10 }, [room]);
    expect(at.x - 4 >= room.maxX || at.x + 4 <= room.minX || at.y - 2 >= room.maxY || at.y + 2 <= room.minY).toBe(true);
    expect(at.x - 4 >= 0 && at.x + 4 <= 40 && at.y - 2 >= 0 && at.y + 2 <= 20).toBe(true);
    expect(freeSpot([poly], 8, 4, { x: 20, y: 10 }, [])).toEqual({ x: 20, y: 10 });
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
    expect(doc.getNumberOfPages()).toBe(4);
  });
});

describe('terminating columns', () => {
  it('flags a column with nothing above it (not top-story ones) and hatches it green in the framing plan and layout', async () => {
    const { terminatingColumns } = await import('../model/types');
    const { hatch } = await import('./sheets');
    let m = model();
    m = addColumns(m, [{ x: 6000, y: 0 }], ['Story1'], 'C400x400', 0); // stops at Story1
    const t = terminatingColumns(m);
    expect([...t].map((id) => m.columns.find((c) => c.id === id)!.story)).toEqual(['Story1']);
    const lay = buildDrawings(m, noUnderlay).filter((d) => d.title === 'COLUMN LAYOUT');
    const s1 = lay.find((d) => d.stories.includes('Story1'))!;
    expect(s1.prims.some((p) => p.t === 'poly' && p.fill === '#22c55e')).toBe(true);
    const f1 = buildDrawings(m, noUnderlay).find((d) => d.title === 'FRAMING PLAN' && d.stories.includes('Story1'))!;
    expect(f1.prims.some((p) => p.t === 'poly' && p.fill === '#22c55e')).toBe(true);
    expect(f1.legend.some((g) => g.title === 'TERMINATING')).toBe(true);
    expect(s1.legend.some((g) => g.title === 'TERMINATING')).toBe(true);
    expect(lay.filter((d) => !d.stories.includes('Story1')).every((d) => !d.legend.some((g) => g.title === 'TERMINATING'))).toBe(true);
    // 400x400 square with 100 mm step → 45° lines all inside the square
    const sq = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
    const ls = hatch(sq, 100, '#000');
    expect(ls.length).toBe(5); // k = −200…200; the k = 0 one runs corner to corner
    for (const l of ls) if (l.t === 'line') for (const p of [l.a, l.b]) expect(p.x >= -1e-6 && p.x <= 400 + 1e-6 && p.y >= -1e-6 && p.y <= 400 + 1e-6).toBe(true);
  });
});

describe('beam labels', () => {
  it('keeps a long beam label at midspan and moves crowded ones off with non-crossing leaders', () => {
    const lab = (x1: number, x2: number, y: number) => ({ a: { x: x1, y }, b: { x: x2, y }, w: 10, h: 2.8, rot: 0 });
    // a long beam and three 4 mm beams end to end: their labels can't all sit beside them
    const ins = [lab(0, 200, 60), lab(100, 104, 20), lab(104, 108, 20), lab(108, 112, 20)];
    const out = placeBeamLabels(ins, [], { minX: 0, minY: 0, maxX: 300, maxY: 200 });
    expect(out[0].leader).toBeUndefined();
    expect(Math.abs(out[0].p.x - 100)).toBeLessThan(1);
    expect(out.some((r) => r.leader)).toBe(true);
    const ov = (a: (typeof out)[0]['box'], b: (typeof out)[0]['box']) => a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
    out.forEach((r, i) => out.forEach((q, k) => k > i && expect(ov(r.box, q.box)).toBe(false)));
    const ls = out.flatMap((r) => (r.leader ? [r.leader] : []));
    ls.forEach((l, i) => ls.forEach((m, k) => k > i && expect(crosses(l[0], l[1], m[0], m[1])).toBe(false)));
    // a leader runs through no other label
    out.forEach((r) => r.leader && out.forEach((q) => q !== r && expect(clipSeg(r.leader![0], r.leader![1], q.box)).toBeNull()));
  });
});
