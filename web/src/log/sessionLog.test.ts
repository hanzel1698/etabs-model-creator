import { describe, expect, it } from 'vitest';
import { diffModel } from './sessionLog';
import { emptyModel, type Beam } from '../model/types';

const beam = (id: string, x1: number, x2: number, section = 'B300x500'): Beam => ({ id, story: 'Story1', x1, y1: 0, x2, y2: 0, section });

describe('diffModel', () => {
  it('describes an added beam in full', () => {
    const a = emptyModel();
    const b = { ...a, beams: [beam('b1', 0, 6000)] };
    expect(diffModel(a, b)).toEqual(['Added 1 beam: beam B300x500 on Story1 from (0, 0) to (6000, 0), 6.00 m long']);
  });

  it('names a section change and a move', () => {
    const a = { ...emptyModel(), beams: [beam('b1', 0, 6000)] };
    const b = { ...a, beams: [{ ...beam('b1', 0, 6000, 'B300x600'), y1: 500, y2: 500 }] };
    expect(diffModel(a, b)).toEqual(['Changed beam B300x500 on Story1 from (0, 0) to (6000, 0), 6.00 m long: section B300x500 → B300x600, moved by (0, 500)']);
  });

  it('calls one beam replaced by two a split', () => {
    const a = { ...emptyModel(), beams: [beam('b1', 0, 6000)] };
    const b = { ...a, beams: [beam('b2', 0, 3000), beam('b3', 3000, 6000)] };
    expect(diffModel(a, b)[0]).toMatch(/^Split 1 beam: .* → into 2 beams: /);
  });

  it('summarises a common change across many elements', () => {
    const many = Array.from({ length: 6 }, (_, i) => beam('b' + i, 0, 1000 * (i + 1)));
    const a = { ...emptyModel(), beams: many };
    const b = { ...a, beams: many.map((x) => ({ ...x, section: 'B300x600' })) };
    expect(diffModel(a, b)).toEqual(['Changed 6 beams on Story1 (B300x600): section B300x500 → B300x600']);
  });
});
