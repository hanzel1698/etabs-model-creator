import { describe, expect, it } from 'vitest';
import { checkModel } from './checks';
import { emptyModel, type Beam, type Column, type Model, type Slab } from './types';

const col = (id: string, x: number, y: number, story = 'Story1'): Column => ({ id, story, x, y, section: 'C400x400', angle: 0 });
const beam = (id: string, x1: number, y1: number, x2: number, y2: number, story = 'Story1'): Beam => ({ id, story, x1, y1, x2, y2, section: 'B300x500' });
const rect = (id: string, x0: number, y0: number, x1: number, y1: number, story = 'Story1'): Slab => ({
  id,
  story,
  section: 'S150',
  pts: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
});
const model = (p: Partial<Model>): Model => ({ ...emptyModel(), ...p });
const kinds = (m: Model) => checkModel(m).map((i) => `${i.kind}:${[...i.ids].sort().join(',')}`);

describe('model check', () => {
  it('passes a clean frame', () => {
    const m = model({
      columns: [col('a', 0, 0), col('b', 6000, 0), col('a2', 0, 0, 'Story2')],
      beams: [beam('1', 0, 0, 6000, 0), beam('2', 6000, 0, 12000, 0), beam('3', 6000, 0, 6000, 5000)],
      slabs: [rect('s1', 0, 0, 6000, 5000), rect('s2', 6000, 0, 12000, 5000), rect('s3', 0, 5000, 3000, 8000)],
    });
    expect(checkModel(m)).toEqual([]);
  });

  it('finds duplicate and overlapping columns', () => {
    const m = model({ columns: [col('a', 0, 0), col('b', 0.4, 0), col('c', 0, 0), col('d', 300, 0), col('e', 400, 1000), col('f', 400, 1400)] });
    expect(kinds(m)).toEqual(['duplicate:a,b,c', 'overlap:a,d']);
  });

  it('finds duplicate, reversed, overlapping and zero-length beams', () => {
    const m = model({ beams: [beam('1', 0, 0, 6000, 0), beam('2', 6000, 0, 0, 0), beam('3', 3000, 0, 9000, 0), beam('4', 0, 100, 6000, 100), beam('5', 50, 50, 50, 50)] });
    expect(kinds(m)).toEqual(['degenerate:5', 'duplicate:1,2', 'overlap:1,3']);
  });

  it('finds duplicate, crossing and contained slabs but not neighbours', () => {
    const tri = { id: 't', story: 'Story1', section: 'S150', pts: [{ x: 20000, y: 0 }, { x: 26000, y: 0 }, { x: 26000, y: 5000 }] };
    const m = model({
      slabs: [rect('a', 0, 0, 6000, 5000), rect('b', 0, 0, 6000, 5000), rect('c', 5000, 3000, 8000, 4500), rect('d', 1000, 1000, 2000, 2000), rect('e', 20000, 0, 26000, 5000), tri, rect('f', 0, 5000, 6000, 6000)],
    });
    const k = kinds(m);
    expect(k).toContain('duplicate:a,b');
    expect(k).toContain('overlap:a,c');
    expect(k).toContain('overlap:a,d');
    expect(k).toContain('overlap:e,t');
    expect(k.some((x) => x.includes('f'))).toBe(false);
    expect(k.filter((x) => x.startsWith('overlap')).length).toBe(3);
  });

  it('flags undefined sections and missing stories', () => {
    const m = model({ columns: [{ ...col('a', 0, 0), section: 'Nope' }, col('b', 9000, 0, 'Gone')] });
    expect(kinds(m)).toEqual(['story:b', 'section:a']);
  });
});
