import { describe, expect, it } from 'vitest';
import { emptyModel, emptyStairModel, type FrameLoad, type Model, type TypicalRange } from '../model/types';
import { toPayload } from '../etabs/mapping';
import { template } from './stair';
import { allRangeLoads, applyStairLoads, defaultPattern, hasStairLoads, rangeSrc, repeatRows, stairLoadRows } from './push';

const m = template(emptyStairModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
const mine = (x: typeof m) => x.beams.flatMap((b) => (b.loads ?? []).filter((l) => l.src === 'st').map((l) => [b.id, l.pattern, +l.d1.toFixed(1), +l.d2.toFixed(1), +l.v1.toFixed(3)]));

describe('stair load push', () => {
  const rows = stairLoadRows(m);
  it('has rows with both loads, inside the beam', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const L = Math.hypot(r.beam.x2 - r.beam.x1, r.beam.y2 - r.beam.y1);
      expect(r.d1).toBeGreaterThanOrEqual(0);
      expect(r.d2).toBeLessThanOrEqual(L + 1e-6);
      expect(r.d2).toBeGreaterThan(r.d1);
      expect(r.dl).toBeGreaterThan(0);
    }
  });
  it('lands on the same stretch whichever way the beam was drawn', () => {
    const rev = { ...m, beams: m.beams.map((b) => ({ ...b, x1: b.x2, y1: b.y2, x2: b.x1, y2: b.y1 })) };
    const at = (x: typeof m) => stairLoadRows(x).map((r) => {
      const L = Math.hypot(r.beam.x2 - r.beam.x1, r.beam.y2 - r.beam.y1), t = (d: number) => [r.beam.x1 + ((r.beam.x2 - r.beam.x1) * d) / L, r.beam.y1 + ((r.beam.y2 - r.beam.y1) * d) / L].map(Math.round);
      return [t(r.d1), t(r.d2)].sort().join();
    });
    expect(at(rev)).toEqual(at(m));
  });
  it('re-pushing replaces the loads instead of doubling them, and leaves other loads alone', () => {
    const hand: FrameLoad = { pattern: 'SDL', kind: 'dist', force: 'F', dir: 'Gravity', rel: false, d1: 0, d2: 100, v1: 1, v2: 1 };
    const other: FrameLoad = { ...hand, src: 'other' };
    const base = { ...m, beams: m.beams.map((b, i) => (i ? b : { ...b, loads: [hand, other] })) };
    const once = applyStairLoads(base, 'st', rows, 'SDL', 'Live');
    const twice = applyStairLoads(once, 'st', rows, 'SDL', 'Live');
    expect(mine(twice)).toEqual(mine(once));
    expect(mine(once).length).toBe(rows.length * 2);
    expect(twice.beams[0].loads!.slice(0, 2)).toEqual([hand, other]);
    expect(mine(applyStairLoads(once, 'st', [], 'SDL', 'Live'))).toEqual([]);
  });
  it('an override replaces the value and keeps the extent', () => {
    const r0 = rows[0];
    const o = stairLoadRows(m, { [r0.key]: { ll: 9 } })[0];
    expect(o).toMatchObject({ d1: r0.d1, d2: r0.d2, dl: r0.dl, ll: 9, calc: r0.calc });
    const ls = applyStairLoads(m, 'st', [o], 'SDL', 'Live').beams.find((b) => b.id === o.beam.id)!.loads!;
    expect(ls.map((l) => [l.pattern, !!l.set])).toEqual([['SDL', false], ['Live', true]]);
  });
  it('sends pushed loads to ETABS without the src tag', () => {
    const p = toPayload(applyStairLoads(m, 'st', rows, 'SDL', 'Live'), { updateStories: false, pushGrids: false });
    const ls = p.frames.flatMap((f) => f.loads);
    expect(ls.length).toBe(rows.length * 2);
    expect(ls.some((l) => 'src' in l)).toBe(false);
  });
  it('picks patterns: remembered, then Stair-named, then by type', () => {
    const ps = m.loadPatterns;
    expect(defaultPattern(ps, 'dl')).toBe('SDL');
    expect(defaultPattern(ps, 'll')).toBe('Live');
    expect(defaultPattern([...ps, { name: 'Stair Dead', type: 'SuperDead', selfWeight: 0 }], 'dl')).toBe('Stair Dead');
    expect(defaultPattern(ps, 'dl', 'Dead')).toBe('Dead');
  });
});

describe('typical range push', () => {
  const base = emptyModel(); // Story1..3
  const beams = ['Story1', 'Story2', 'Story3'].map((st, i) => ({ id: `b${i + 1}`, story: st, x1: 0, y1: 0, x2: 3000, y2: 0, section: 'B300x500' }));
  const mm: Model = { ...base, beams };
  const row = (b: number, d1: number, d2: number, dl: number) => ({ beam: beams[b], name: `B${b + 1}`, d1, d2, dl, ll: 1 });
  const A: TypicalRange = { id: 'A', from: 'Base', to: 'Story1' },
    Bq: TypicalRange = { id: 'B', from: 'Story1', to: 'Story3' };
  // Base → Story1: its flight arrives on Story1's beam (left). Story1 → Story3, designed on Story2: departs Story1's beam (right), arrives on Story2's (left)
  const pa = repeatRows(mm, [row(0, 0, 1000, 5)], A);
  const pb = repeatRows(mm, [row(0, 2000, 3000, 7), row(1, 0, 1000, 5)], Bq);
  const both = applyStairLoads(applyStairLoads(mm, rangeSrc('st', 'A'), pa.rows, 'SDL', 'Live'), rangeSrc('st', 'B'), pb.rows, 'SDL', 'Live');
  const dl = (m: Model, id: string) => m.beams.find((b) => b.id === id)!.loads!.filter((l) => l.pattern === 'SDL').map((l) => [l.d1, l.d2, l.v1]);
  it('a floor beam carries the arriving and the departing flight, each once', () => {
    expect(pb.misses).toEqual([]);
    expect(dl(both, 'b1')).toEqual([[0, 1000, 5], [2000, 3000, 7]]);
    expect(dl(both, 'b2')).toEqual([[2000, 3000, 7], [0, 1000, 5]]);
    expect(dl(both, 'b3')).toEqual([[0, 1000, 5]]);
  });
  it('re-pushing one range leaves the other alone; the stair id clears both', () => {
    const again = applyStairLoads(both, rangeSrc('st', 'B'), [], 'SDL', 'Live');
    expect(dl(again, 'b1')).toEqual([[0, 1000, 5]]);
    expect(hasStairLoads(applyStairLoads(both, 'st', [], '', ''), 'st')).toBe(false);
  });
  it('maps onto a beam drawn the other way and reports a missing one', () => {
    const rev: Model = { ...mm, beams: [beams[0], { ...beams[1], x1: 3000, x2: 0 }] };
    const p = repeatRows(rev, [row(0, 2000, 3000, 7)], Bq);
    expect(p.rows.map((r) => [r.beam.id, r.d1, r.d2])).toEqual([['b1', 2000, 3000], ['b2', 0, 1000]]);
    expect(repeatRows({ ...mm, beams: [beams[0]] }, [row(0, 0, 1, 1)], Bq).misses).toEqual(['B1 on Story2']);
  });
});

describe('allRangeLoads', () => {
  it('lists every copy a push of each range makes, by beam', () => {
    const beams = ['Story1', 'Story2', 'Story3'].flatMap((st) => m.beams.filter((b) => b.story === 'Story1').map((b) => ({ ...b, id: b.id + st, story: st })));
    const mm: Model = { ...emptyModel(), beams, frameSections: m.frameSections };
    const region = { id: 'st', name: 'STAIR-01', x1: -500, y1: -500, x2: 8000, y2: 8000, flights: m.flights, landings: m.landings, spans: m.spans, params: m.stair };
    const all = allRangeLoads(mm, region);
    const n = (st: string) => beams.filter((b) => b.story === st).reduce((k, b) => k + (all.get(b.id)?.length ?? 0), 0);
    expect(n('Story1')).toBeGreaterThan(0);
    expect([n('Story2'), n('Story3')]).toEqual([n('Story1'), n('Story1')]);
  });
});
