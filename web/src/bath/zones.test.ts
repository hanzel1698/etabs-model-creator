import { describe, expect, it } from 'vitest';
import { emptyModel, type Model } from '../model/types';
import { assignZone, mergeZones, removeZone, underSunk, upgradeZones, zoneActions, zoneName } from './zones';

const sq = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

/** Three 3 m panels in a row (s1, s2, s3) on Story1. */
function bays(): Model {
  const m = emptyModel();
  m.slabs = [
    { id: 's1', story: 'Story1', pts: sq(0, 0, 3000, 3000), section: 'S', sink: 300 },
    { id: 's2', story: 'Story1', pts: sq(3000, 0, 3000, 3000), section: 'S' },
    { id: 's3', story: 'Story1', pts: sq(6000, 0, 3000, 3000), section: 'S' },
  ];
  return m;
}

const names = (m: Model) => m.bathZones!.map((z) => [zoneName(z), z.slabIds]);

describe('areas from panels', () => {
  it('makes each assigned panel an area of its own; merging makes them one; a panel moves to its newest area', () => {
    let m = assignZone(bays(), 'Story1', 'wc', ['s1', 's2']);
    m = assignZone(m, 'Story1', 'wash', ['s3']);
    expect(names(m)).toEqual([['WC-01', ['s1']], ['WC-02', ['s2']], ['WASH-01', ['s3']]]);
    m = mergeZones(m, 'Story1', 'wc', ['s1', 's2']);
    expect(names(m)).toEqual([['WC-01', ['s1', 's2']], ['WASH-01', ['s3']]]);
    expect(mergeZones(m, 'Story1', 'wc', ['s1'])).toBe(m); // one area: nothing to merge
    m = assignZone(m, 'Story1', 'wash', ['s2']);
    expect(names(m)).toEqual([['WC-01', ['s1']], ['WASH-01', ['s3']], ['WASH-02', ['s2']]]);
    expect(assignZone(m, 'Story2', 'wc', ['s1'])).toBe(m); // panels of another story are not taken
  });

  it('offers merging only for a kind the selection spans twice', () => {
    const m = assignZone(bays(), 'Story1', 'wc', ['s1', 's2']);
    const labels = (ids: string[]) => zoneActions(m, 'Story1', ids).map((a) => a.label);
    expect(labels(['s1', 's2'])).toContain('Merge 2 WC areas');
    expect(labels(['s1', 's3']).some((l) => l.startsWith('Merge'))).toBe(false);
    expect(labels(['nope'])).toEqual([]);
  });

  it('flags its panels sunk too little, and beams sunk too little between or across its panels but not along its outer edge', () => {
    const m = bays();
    m.slabs[2].duct = true;
    m.beams = [
      { id: 'edge', story: 'Story1', x1: 0, y1: 0, x2: 9000, y2: 0, section: 'B' },
      { id: 'between', story: 'Story1', x1: 3000, y1: 0, x2: 3000, y2: 3000, section: 'B' },
      { id: 'across', story: 'Story1', x1: 1500, y1: 0, x2: 1500, y2: 3000, section: 'B' },
      { id: 'sunk', story: 'Story1', x1: 1000, y1: 0, x2: 1000, y2: 3000, section: 'B', sink: 100 },
      { id: 'deep', story: 'Story1', x1: 2000, y1: 0, x2: 2000, y2: 3000, section: 'B', sink: 300 },
      { id: 'outerSide', story: 'Story1', x1: 6000, y1: 0, x2: 6000, y2: 3000, section: 'B' },
    ];
    const apart = assignZone(m, 'Story1', 'wc', ['s1', 's2']);
    expect(underSunk(apart, 'Story1').has('between')).toBe(false); // two areas: the beam between them is an edge of each
    const a = mergeZones(apart, 'Story1', 'wc', ['s1', 's2']);
    const b = assignZone(a, 'Story1', 'wash', ['s3']); // a duct panel: exempt
    expect([...underSunk(b, 'Story1')]).toEqual([['s2', 300], ['between', 300], ['across', 300], ['sunk', 300]]);
    expect(underSunk(b, 'Story1', new Set([b.bathZones!.at(-1)!.id])).size).toBe(0); // only the wash area
    expect(underSunk(b, 'Story2').size).toBe(0);
  });
});

describe('bathrooms', () => {
  it('makes the selected panels one bathroom, apart from the areas they are in', () => {
    let m = assignZone(bays(), 'Story1', 'wc', ['s2']);
    m = assignZone(m, 'Story1', 'room', ['s1', 's2']);
    m = assignZone(m, 'Story1', 'room', ['s3']);
    expect(names(m)).toEqual([['WC-01', ['s2']], ['BATH-01', ['s1', 's2']], ['BATH-02', ['s3']]]);
    m = assignZone(m, 'Story1', 'room', ['s2']); // leaves BATH-01, stays in WC-01
    expect(names(m)).toEqual([['WC-01', ['s2']], ['BATH-01', ['s1']], ['BATH-02', ['s3']], ['BATH-03', ['s2']]]);
    m = mergeZones(m, 'Story1', 'room', ['s1', 's2', 's3']);
    expect(names(m)).toEqual([['WC-01', ['s2']], ['BATH-01', ['s1', 's3', 's2']]]);
    m = removeZone(m, m.bathZones![1].id);
    expect(names(assignZone(m, 'Story1', 'room', ['s3']))).toEqual([['WC-01', ['s2']], ['BATH-01', ['s3']]]);
  });

  it('turns bathrooms drawn as outlines by earlier versions into the panels inside them, and numbers unnamed ones', () => {
    const m = bays();
    m.bathZones = [
      { id: 'a', story: 'Story1', kind: 'room', pts: sq(-100, -100, 6200, 3200) },
      { id: 'b', story: 'Story1', kind: 'room', pts: sq(50000, 0, 1000, 1000), name: 'BATH-07' },
      { id: 'c', story: 'Story1', kind: 'wc', slabIds: ['s3'] },
    ];
    const up = upgradeZones(m);
    expect(up.bathZones).toEqual([
      { id: 'a', story: 'Story1', kind: 'room', slabIds: ['s1', 's2'], name: 'BATH-01' },
      { id: 'c', story: 'Story1', kind: 'wc', slabIds: ['s3'], name: 'WC-01' },
    ]); // 'b' holds no panel
    expect(upgradeZones(up)).toBe(up);
  });
});
