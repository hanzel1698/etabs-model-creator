import { describe, expect, it } from 'vitest';
import { emptyModel } from '../model/types';
import { addZone, underSunk } from './zones';

describe('underSunk', () => {
  it('flags beams and slabs wholly inside a wash/toilet zone that are sunk too little', () => {
    let m = emptyModel();
    m.beams = [
      { id: 'in', story: 'Story1', x1: 0, y1: 0, x2: 2000, y2: 0, section: 'B', sink: 150 },
      { id: 'ok', story: 'Story1', x1: 0, y1: 2000, x2: 2000, y2: 2000, section: 'B', sink: 300 },
      { id: 'out', story: 'Story1', x1: 0, y1: 0, x2: 5000, y2: 0, section: 'B' },
    ];
    m.slabs = [
      { id: 's', story: 'Story1', pts: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], section: 'S' },
      { id: 'd', story: 'Story1', pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], section: 'S', duct: true },
    ];
    m = addZone(m, 'Story1', 'wc', { x: 0, y: 0 }, { x: 2000, y: 2000 });
    m = addZone(m, 'Story1', 'wash', { x: 0, y: 0 }, { x: 2000, y: 2000 });
    m = addZone(m, 'Story1', 'room', { x: -10000, y: -10000 }, { x: 10000, y: 10000 });
    expect([...underSunk(m, 'Story1')]).toEqual([['in', 300], ['s', 300]]);
    expect(underSunk(m, 'Story2').size).toBe(0);
  });
});
