import { describe, expect, it } from 'vitest';
import { emptyModel } from '../model/types';
import { addZone, underSunk } from './zones';

const sq = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe('underSunk', () => {
  it('flags beams and slabs wholly inside a wash/toilet zone that are sunk too little', () => {
    let m = emptyModel();
    m.beams = [
      { id: 'in', story: 'Story1', x1: 0, y1: 0, x2: 2000, y2: 0, section: 'B', sink: 150 },
      { id: 'ok', story: 'Story1', x1: 0, y1: 2000, x2: 2000, y2: 2000, section: 'B', sink: 300 },
      { id: 'out', story: 'Story1', x1: 0, y1: 0, x2: 5000, y2: 0, section: 'B' },
    ];
    m.slabs = [
      { id: 's', story: 'Story1', pts: sq(0, 0, 2000, 2000), section: 'S' },
      { id: 'd', story: 'Story1', pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], section: 'S', duct: true },
    ];
    m = addZone(m, 'Story1', 'wc', sq(0, 0, 2000, 2000));
    m = addZone(m, 'Story1', 'wash', sq(0, 0, 2000, 2000));
    m = addZone(m, 'Story1', 'room', sq(-10000, -10000, 20000, 20000));
    expect([...underSunk(m, 'Story1')]).toEqual([['in', 300], ['s', 300]]);
    expect(underSunk(m, 'Story2').size).toBe(0);
  });

  it('follows an L-shaped zone: elements in its notch are outside', () => {
    let m = emptyModel();
    m.beams = [
      { id: 'edge', story: 'Story1', x1: 0, y1: 0, x2: 4000, y2: 0, section: 'B' },
      { id: 'notch', story: 'Story1', x1: 2000, y1: 3000, x2: 4000, y2: 3000, section: 'B' },
    ];
    m.slabs = [
      { id: 'leg', story: 'Story1', pts: sq(0, 2000, 2000, 2000), section: 'S', sink: 100 },
      { id: 'corner', story: 'Story1', pts: sq(2000, 2000, 2000, 2000), section: 'S' },
    ];
    m = addZone(m, 'Story1', 'wash', [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 }]);
    expect([...underSunk(m, 'Story1')]).toEqual([['edge', 150], ['leg', 150]]);
  });
});
