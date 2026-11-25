import { describe, expect, it } from 'vitest';
import { emptyModel, type Model } from '../model/types';
import { addArea, addZone, nameBaths, removeZone, underSunk, zoneGroups, zoneName } from './zones';

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

describe('areas from panels', () => {
  it('groups selected panels into one numbered area; a panel moves to the newest area, an emptied area goes', () => {
    let m = addArea(bays(), 'Story1', 'wc', ['s1', 's2']);
    m = addArea(m, 'Story1', 'wash', ['s3']);
    expect(m.bathZones!.map((z) => [zoneName(z), z.slabIds])).toEqual([['WC-01', ['s1', 's2']], ['WASH-01', ['s3']]]);
    m = addArea(m, 'Story1', 'wc', ['s2']);
    expect(m.bathZones!.map((z) => [zoneName(z), z.slabIds])).toEqual([['WC-01', ['s1']], ['WASH-01', ['s3']], ['WC-02', ['s2']]]);
    m = addArea(m, 'Story1', 'wash', ['s1']);
    expect(m.bathZones!.map((z) => zoneName(z))).toEqual(['WASH-01', 'WC-02', 'WASH-02']);
    expect(addArea(m, 'Story2', 'wc', ['s1'])).toBe(m); // panels of another story are not taken
  });

  it('flags its panels sunk too little, and unsunk beams between or across its panels but not along its outer edge', () => {
    const m = bays();
    m.slabs[2].duct = true;
    m.beams = [
      { id: 'edge', story: 'Story1', x1: 0, y1: 0, x2: 9000, y2: 0, section: 'B' },
      { id: 'between', story: 'Story1', x1: 3000, y1: 0, x2: 3000, y2: 3000, section: 'B' },
      { id: 'across', story: 'Story1', x1: 1500, y1: 0, x2: 1500, y2: 3000, section: 'B' },
      { id: 'sunk', story: 'Story1', x1: 1000, y1: 0, x2: 1000, y2: 3000, section: 'B', sink: 100 },
      { id: 'outerSide', story: 'Story1', x1: 6000, y1: 0, x2: 6000, y2: 3000, section: 'B' },
    ];
    const a = addArea(m, 'Story1', 'wc', ['s1', 's2']);
    const b = addArea(a, 'Story1', 'wash', ['s3']); // a duct panel: exempt
    expect([...underSunk(b, 'Story1')]).toEqual([['s2', 300], ['between', 300], ['across', 300]]);
    expect(underSunk(b, 'Story2').size).toBe(0);
  });
});

describe('bathrooms', () => {
  it('numbers bathrooms and lists each area under the smallest bathroom holding it', () => {
    let m = bays();
    m = addZone(m, 'Story1', 'room', sq(-100, -100, 9200, 3200));
    m = addZone(m, 'Story1', 'room', sq(-100, -100, 6200, 3200));
    m = addZone(m, 'Story1', 'room', sq(50000, 0, 1000, 1000));
    m = addArea(m, 'Story1', 'wc', ['s1', 's2']);
    m = addArea(m, 'Story1', 'wash', ['s3']);
    const g = zoneGroups(m, 'Story1').map((x) => [x.room ? zoneName(x.room) : null, x.parts.map(zoneName)]);
    expect(g).toEqual([['BATH-01', ['WASH-01']], ['BATH-02', ['WC-01']], ['BATH-03', []]]);
    m = removeZone(m, m.bathZones![0].id);
    expect(zoneName(addZone(m, 'Story2', 'room', sq(0, 0, 1, 1)).bathZones!.at(-1)!)).toBe('BATH-01');
  });

  it('numbers bathrooms saved without a name on load', () => {
    const m = addZone(addZone(emptyModel(), 'Story1', 'room', sq(0, 0, 1, 1)), 'Story1', 'room', sq(0, 0, 2, 2));
    const old = { ...m, bathZones: m.bathZones!.map((z, i) => (i === 0 ? { ...z, name: undefined } : z)) };
    expect(nameBaths(old).bathZones!.map((z) => z.name)).toEqual(['BATH-01', 'BATH-02']);
    expect(nameBaths(m)).toBe(m);
  });
});
