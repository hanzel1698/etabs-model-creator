import { describe, expect, it } from 'vitest';
import { addBeams, addColumns, anyFilter, autoBeamsOnGrids, findBay, generateGrids, gridDimensions, joinBeams, matchElements, mergeSlabs, nextGridLabel, oppositeLabelStart, panelSize, addSlab, patchIds, replicate, setBeamEnd, slabsUnderBeams, splitSlabsByBeams, storyNodes } from './ops';
import { parseRelative, parseSpacing, polyArea } from './geom';
import { emptyModel, type Model } from './types';
import { toPayload } from '../etabs/mapping';

describe('geom', () => {
  it('parses spacings', () => {
    expect(parseSpacing('3@6000, 4500')).toEqual([6000, 6000, 6000, 4500]);
  });
  it('parses relative input', () => {
    expect(parseRelative('1000,500', 0)).toEqual({ x: 1000, y: 500 });
    const p = parseRelative('@1000<90', 0)!;
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1000);
    expect(parseRelative('2000', 0)).toEqual({ x: 2000, y: 0 });
  });
});

describe('grids, columns, beams', () => {
  const grids = generateGrids({ xSpacing: [6000, 6000], ySpacing: [5000], x0: 0, y0: 0, xLabelStart: 'A', yLabelStart: '1', extend: 1000 });
  it('labels grids', () => {
    expect(grids.map((g) => g.label)).toEqual(['A', 'B', 'C', '1', '2']);
  });
  it('builds beams on grids between columns and skips duplicates', () => {
    let m = { ...emptyModel(), grids };
    const pts = [0, 6000, 12000].flatMap((x) => [0, 5000].map((y) => ({ x, y })));
    m = addColumns(m, pts, ['Story1'], 'C400x400', 0);
    m = addColumns(m, pts, ['Story1'], 'C400x400', 0);
    expect(m.columns.length).toBe(6);
    m = autoBeamsOnGrids(m, 'Story1', 'B300x500');
    expect(m.beams.length).toBe(7); // 3 along X-grids... 2 per Y-grid ×2 + 1 per X-grid ×3
    m = addBeams(m, [[{ x: 6000, y: 0 }, { x: 0, y: 0 }]], ['Story1'], 'B300x500');
    expect(m.beams.length).toBe(7);
  });
});

describe('bay detection', () => {
  it('finds the smallest enclosing bay', () => {
    const segs: [any, any][] = [
      [{ x: 0, y: 0 }, { x: 12000, y: 0 }],
      [{ x: 0, y: 5000 }, { x: 12000, y: 5000 }],
      [{ x: 0, y: 0 }, { x: 0, y: 5000 }],
      [{ x: 6000, y: 0 }, { x: 6000, y: 5000 }],
      [{ x: 12000, y: 0 }, { x: 12000, y: 5000 }],
    ];
    const bay = findBay(segs, { x: 9000, y: 2500 })!;
    expect(bay).not.toBeNull();
    expect(Math.abs(polyArea(bay))).toBeCloseTo(6000 * 5000);
    expect(bay.length).toBe(4);
  });
  it('handles grid lines that overhang', () => {
    const segs: [any, any][] = [
      [{ x: -1000, y: 0 }, { x: 7000, y: 0 }],
      [{ x: -1000, y: 5000 }, { x: 7000, y: 5000 }],
      [{ x: 0, y: -1000 }, { x: 0, y: 6000 }],
      [{ x: 6000, y: -1000 }, { x: 6000, y: 6000 }],
    ];
    const bay = findBay(segs, { x: 3000, y: 2500 })!;
    expect(Math.abs(polyArea(bay))).toBeCloseTo(30e6);
  });
  it('returns null outside', () => {
    expect(findBay([[{ x: 0, y: 0 }, { x: 1, y: 0 }]], { x: 5, y: 5 })).toBeNull();
  });
  it('sizes panels and classifies one-way / two-way', () => {
    const two = panelSize([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }, { x: 0, y: 5000 }]);
    expect(two.lx).toBeCloseTo(5000);
    expect(two.ly).toBeCloseTo(6000);
    expect(two.oneWay).toBe(false);
    // rotated 30°, 3 m x 7 m
    const r = Math.PI / 6,
      rot = (x: number, y: number) => ({ x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) });
    const one = panelSize([rot(0, 0), rot(7000, 0), rot(7000, 3000), rot(0, 3000)]);
    expect(one.lx).toBeCloseTo(3000);
    expect(one.ly).toBeCloseTo(7000);
    expect(one.oneWay).toBe(true);
  });
});

describe('replicate + payload', () => {
  it('copies to stories and maps elevations', () => {
    let m = emptyModel();
    m = addColumns(m, [{ x: 0, y: 0 }], ['Story1'], 'C400x400', 30);
    m = addBeams(m, [[{ x: 0, y: 0 }, { x: 6000, y: 0 }]], ['Story1'], 'B300x500');
    const r = replicate(m, [...m.columns, ...m.beams].map((x) => x.id), { dx: 0, dy: 0, n: 1, stories: ['Story2', 'Story3'] });
    expect(r.created.length).toBe(4);
    const lin = replicate(r.model, [m.beams[0].id], { dx: 0, dy: 5000, n: 3, stories: null });
    expect(lin.created.length).toBe(3);
    const p = toPayload(lin.model, { updateStories: false, pushGrids: false });
    const col3 = p.frames.find((f) => f.kind === 'column' && f.story === 'Story3')!;
    expect(col3.z1).toBe(6000);
    expect(col3.z2).toBe(9000);
    expect(col3.angle).toBe(30);
    const beam1 = p.frames.find((f) => f.kind === 'beam' && f.story === 'Story1')!;
    expect(beam1.z1).toBe(3000);
  });
  it('lists deletions of previously pushed elements', () => {
    const m = { ...emptyModel(), pushedIds: ['gone'] };
    expect(toPayload(m, { updateStories: false, pushGrids: false }).deleteGuids).toEqual(['gone']);
  });
});

describe('grid labels', () => {
  const g = (dir: 'X' | 'Y' | 'G', label: string) => ({ id: label + dir, label, dir, x1: 0, y1: 0, x2: 1, y2: 1, bubble: 'end' as const });
  it('defaults X to letters and Y to numbers', () => {
    expect(nextGridLabel([], 'X')).toBe('A');
    expect(nextGridLabel([], 'Y')).toBe('1');
    expect(nextGridLabel([], 'G')).toBe('G1');
  });
  it('continues whatever scheme the direction uses', () => {
    expect(nextGridLabel([g('X', '1')], 'X')).toBe('2');
    expect(nextGridLabel([g('X', 'A'), g('X', 'B')], 'X')).toBe('C');
    expect(nextGridLabel([g('X', 'Z')], 'X')).toBe('AA');
    expect(nextGridLabel([g('Y', 'a')], 'Y')).toBe('b');
  });
  it('ignores prime/quote suffixes and continues from the highest base', () => {
    expect(nextGridLabel([g('X', '1'), g('X', "1'"), g('X', '1"')], 'X')).toBe('2');
    expect(nextGridLabel([g('X', '1'), g('X', '2'), g('X', "1'")], 'X')).toBe('3');
    expect(nextGridLabel([g('X', 'A'), g('X', "B'")], 'X')).toBe('C');
  });
  it('uses the opposite scheme of the other direction', () => {
    expect(nextGridLabel([g('X', '1'), g('X', '2')], 'Y')).toBe('A');
    expect(nextGridLabel([g('Y', 'A')], 'X')).toBe('1');
    expect(nextGridLabel([g('X', 'A')], 'Y')).toBe('1');
  });
  it('generates sequences from any start', () => {
    const grids = generateGrids({ xSpacing: [1, 1], ySpacing: [1, 1], x0: 0, y0: 0, xLabelStart: '1', yLabelStart: 'A', extend: 0 });
    expect(grids.map((x) => x.label)).toEqual(['1', '2', '3', 'A', 'B', 'C']);
    expect(oppositeLabelStart('1')).toBe('A');
    expect(oppositeLabelStart('C')).toBe('1');
  });
});

describe('select by properties', () => {
  let m = emptyModel();
  m = { ...m, frameSections: [...m.frameSections, { name: 'C600x600', shape: 'Rectangle', t3: 600, t2: 600, material: 'M30', fromEtabs: false }] };
  m = addColumns(m, [{ x: 0, y: 0 }, { x: 6000, y: 0 }], ['Story1', 'Story2'], 'C400x400', 0);
  m = addColumns(m, [{ x: 0, y: 5000 }], ['Story1'], 'C600x600', 0);
  m = addBeams(m, [[{ x: 0, y: 0 }, { x: 6000, y: 0 }]], ['Story1', 'Story2'], 'B300x500');
  it('filters by kind, story and section', () => {
    expect(matchElements(m, { ...anyFilter(), kinds: { column: true, beam: false, slab: false } }).length).toBe(5);
    expect(matchElements(m, { ...anyFilter(), stories: ['Story1'], sections: ['C400x400'] }).length).toBe(2);
    expect(matchElements(m, { ...anyFilter(), kinds: { column: false, beam: true, slab: false }, stories: ['Story2'] }).length).toBe(1);
  });
  it('filters by section properties', () => {
    expect(matchElements(m, { ...anyFilter(), t3: [550, null] }).length).toBe(1); // only C600x600
    expect(matchElements(m, { ...anyFilter(), material: 'M30' }).length).toBe(1);
    expect(matchElements(m, { ...anyFilter(), t2: [null, 350] }).length).toBe(2); // the two B300x500 beams
  });
  it('batch reassigns matched elements', () => {
    const ids = matchElements(m, { ...anyFilter(), sections: ['C400x400'], stories: ['Story2'] });
    const m2 = patchIds(m, ids, { section: 'C600x600' });
    expect(m2.columns.filter((c) => c.section === 'C600x600').length).toBe(3);
  });
});

describe('grid dimensions', () => {
  it('chains c/c distances with an overall dimension', () => {
    const grids = generateGrids({ xSpacing: [6000, 4500], ySpacing: [5000], x0: 0, y0: 0, xLabelStart: 'A', yLabelStart: '1', extend: 1000 });
    expect(grids.every((g) => g.bubble === 'both')).toBe(true);
    const d = gridDimensions(grids, 600);
    const xs = d.filter((x) => !x.vertical).map((x) => x.value);
    const ys = d.filter((x) => x.vertical).map((x) => x.value);
    expect(xs).toEqual([6000, 4500, 10500]);
    expect(ys).toEqual([5000]); // only two Y grids: no overall line
    const top = d.find((x) => !x.vertical)!;
    expect(top.a.y).toBeGreaterThan(6000); // above the grid ends (5000 + 1000 overhang)
  });
});

describe('storyNodes', () => {
  it('merges grid intersections, column centres and beam crossings', () => {
    let m = { ...emptyModel(), grids: generateGrids({ xSpacing: [6000], ySpacing: [5000], x0: 0, y0: 0, xLabelStart: 'A', yLabelStart: '1', extend: 1000 }) };
    m = addColumns(m, [{ x: 0, y: 0 }], ['Story1'], 'C400x400', 0);
    m = addBeams(m, [[{ x: 3000, y: -1000 }, { x: 3000, y: 6000 }], [{ x: -500, y: 2500 }, { x: 7000, y: 2500 }]], ['Story1'], 'B300x500');
    const n = storyNodes(m, 'Story1');
    expect(n).toHaveLength(5);
    expect(n.find((p) => p.x === 0 && p.y === 0)!.from).toEqual(['grid', 'column']);
    expect(n.find((p) => p.from.includes('beam'))).toMatchObject({ x: 3000, y: 2500, id: 'node:3000,2500' });
    expect(storyNodes(m, 'Story2')).toHaveLength(4);
  });
});

describe('setBeamEnd', () => {
  const m = { ...emptyModel(), beams: [{ id: 'b', story: 'Story1', x1: 0, y1: 0, x2: 6000, y2: 0, section: 'B300x500' }] };
  it('moves only the picked end', () => {
    expect(setBeamEnd(m, 'b', 2, { x: 6000, y: 4000 }).beams[0]).toMatchObject({ x1: 0, y1: 0, x2: 6000, y2: 4000 });
    expect(setBeamEnd(m, 'b', 1, { x: 1000, y: 0 }).beams[0]).toMatchObject({ x1: 1000, y1: 0, x2: 6000, y2: 0 });
  });
  it('ignores zero-length results and no-op moves', () => {
    expect(setBeamEnd(m, 'b', 2, { x: 0, y: 0 })).toBe(m);
    expect(setBeamEnd(m, 'b', 2, { x: 6000, y: 0 })).toBe(m);
  });
});

describe('splitting slabs by beams', () => {
  const B = 'B300x500';
  // one 12×10 m slab framed by perimeter beams that overhang it by 500 mm
  const base = () => {
    let m = emptyModel();
    m = addSlab(m, [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 10000 }, { x: 0, y: 10000 }], 'Story1', 'S150');
    return addBeams(m, [
      [{ x: -500, y: 0 }, { x: 12500, y: 0 }],
      [{ x: 12000, y: -500 }, { x: 12000, y: 10500 }],
      [{ x: 12500, y: 10000 }, { x: -500, y: 10000 }],
      [{ x: 0, y: 10500 }, { x: 0, y: -500 }],
    ], ['Story1'], B);
  };
  const areas = (m: Model) => m.slabs.map((s) => Math.round(polyArea(s.pts) / 1e6)).sort((a, b) => a - b);

  it('cuts a slab into the panels a cross of beams makes', () => {
    let m = addBeams(base(), [
      [{ x: 6000, y: 0 }, { x: 6000, y: 10000 }],
      [{ x: 0, y: 4000 }, { x: 12000, y: 4000 }],
    ], ['Story1'], B);
    const r = splitSlabsByBeams(m, [m.slabs[0].id]);
    expect(r.split).toBe(1);
    expect(r.pieces).toBe(4);
    expect(areas(r.model)).toEqual([24, 24, 36, 36]);
    expect(r.model.slabs.every((s) => s.section === 'S150' && s.story === 'Story1' && s.pts.length === 4)).toBe(true);
  });
  it('ignores a beam that stops short, and splits on one that frames into another', () => {
    let m = addBeams(base(), [[{ x: 6000, y: 0 }, { x: 6000, y: 10000 }], [{ x: 0, y: 4000 }, { x: 3000, y: 4000 }]], ['Story1'], B);
    expect(areas(splitSlabsByBeams(m, [m.slabs[0].id]).model)).toEqual([60, 60]);
    m = addBeams(m, [[{ x: 3000, y: 4000 }, { x: 6000, y: 4000 }]], ['Story1'], B);
    expect(areas(splitSlabsByBeams(m, [m.slabs[0].id]).model)).toEqual([24, 36, 60]);
  });
  it('leaves slabs no beam crosses, and slabs on other stories', () => {
    let m = base();
    expect(splitSlabsByBeams(m, [m.slabs[0].id]).model).toBe(m);
    m = addBeams(m, [[{ x: 6000, y: 0 }, { x: 6000, y: 10000 }]], ['Story2'], B);
    expect(splitSlabsByBeams(m, [m.slabs[0].id]).split).toBe(0);
  });
  it('finds the slabs a new beam runs across', () => {
    const m = addBeams(base(), [[{ x: 6000, y: 0 }, { x: 6000, y: 10000 }], [{ x: 20000, y: 0 }, { x: 20000, y: 10000 }]], ['Story1'], B);
    const [inside, outside] = m.beams.slice(-2).map((b) => b.id);
    expect(slabsUnderBeams(m, [inside])).toEqual([m.slabs[0].id]);
    expect(slabsUnderBeams(m, [outside])).toEqual([]);
  });
});

describe('merging slabs', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const ids = (m: Model) => m.slabs.map((s) => s.id);
  const areas = (m: Model) => m.slabs.map((s) => Math.round(polyArea(s.pts) / 1e6)).sort((a, b) => a - b);

  it('joins the four panels of a split slab back into one rectangle', () => {
    let m = emptyModel();
    for (const [x, y] of [[0, 0], [6000, 0], [0, 4000], [6000, 4000]]) m = addSlab(m, rect(x, y, x + 6000, y + 4000), 'Story1', 'S150');
    const r = mergeSlabs(m, ids(m));
    expect(r).toMatchObject({ merged: 1, from: 4 });
    expect(r.model.slabs).toHaveLength(1);
    expect(r.model.slabs[0].pts).toHaveLength(4);
    expect(areas(r.model)).toEqual([96]);
  });
  it('handles a T-junction and keeps the largest slab’s section', () => {
    let m = addSlab(emptyModel(), rect(0, 0, 6000, 8000), 'Story1', 'S200');
    m = addSlab(m, rect(6000, 0, 9000, 4000), 'Story1', 'S150');
    m = addSlab(m, rect(6000, 4000, 9000, 8000), 'Story1', 'S150');
    const r = mergeSlabs(m, ids(m));
    expect(r.merged).toBe(1);
    expect(r.model.slabs[0]).toMatchObject({ section: 'S200' });
    expect(r.model.slabs[0].pts).toHaveLength(4);
  });
  it('makes an L-shape, and leaves apart slabs that touch nothing', () => {
    let m = addSlab(emptyModel(), rect(0, 0, 4000, 4000), 'Story1', 'S150');
    m = addSlab(m, rect(4000, 0, 8000, 4000), 'Story1', 'S150');
    m = addSlab(m, rect(0, 4000, 4000, 8000), 'Story1', 'S150');
    m = addSlab(m, rect(20000, 0, 24000, 4000), 'Story1', 'S150');
    const r = mergeSlabs(m, ids(m));
    expect(r).toMatchObject({ merged: 1, from: 3 });
    expect(r.model.slabs.map((s) => s.pts.length).sort()).toEqual([4, 6]);
  });
  it('refuses a ring (hole), overlaps and slabs on different stories', () => {
    let m = emptyModel();
    for (const [x, y] of [[0, 0], [4000, 0], [8000, 0], [0, 4000], [8000, 4000], [0, 8000], [4000, 8000], [8000, 8000]]) m = addSlab(m, rect(x, y, x + 4000, y + 4000), 'Story1', 'S150');
    expect(mergeSlabs(m, ids(m)).merged).toBe(0);
    m = addSlab(emptyModel(), rect(0, 0, 4000, 4000), 'Story1', 'S150');
    m = addSlab(m, rect(2000, 0, 6000, 4000), 'Story1', 'S150');
    expect(mergeSlabs(m, ids(m)).merged).toBe(0);
    m = addSlab(emptyModel(), rect(0, 0, 4000, 4000), 'Story1', 'S150');
    m = addSlab(m, rect(4000, 0, 8000, 4000), 'Story2', 'S150');
    expect(mergeSlabs(m, ids(m)).model).toBe(m);
  });
});

describe('joining beams', () => {
  const B = 'B300x500';
  const len = (b: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1);

  it('joins a chain of beams on one line end to end', () => {
    const m = addBeams(emptyModel(), [[{ x: 0, y: 0 }, { x: 3000, y: 0 }], [{ x: 6000, y: 0 }, { x: 3000, y: 0 }], [{ x: 6000, y: 0 }, { x: 9000, y: 0 }]], ['Story1'], B);
    const r = joinBeams(m, m.beams.map((b) => b.id));
    expect(r).toMatchObject({ joined: 1, from: 3 });
    expect(r.model.beams).toHaveLength(1);
    expect(len(r.model.beams[0])).toBeCloseTo(9000);
    expect(r.ids).toEqual([r.model.beams[0].id]);
  });
  it('leaves beams that are off-line, apart, or on another story', () => {
    let m = addBeams(emptyModel(), [[{ x: 0, y: 0 }, { x: 3000, y: 0 }], [{ x: 3000, y: 0 }, { x: 3000, y: 3000 }], [{ x: 4000, y: 0 }, { x: 6000, y: 0 }]], ['Story1'], B);
    expect(joinBeams(m, m.beams.map((b) => b.id)).joined).toBe(0);
    m = addBeams(m, [[{ x: 3000, y: 0 }, { x: 4000, y: 0 }]], ['Story2'], B);
    expect(joinBeams(m, m.beams.map((b) => b.id)).model).toBe(m);
  });
});
