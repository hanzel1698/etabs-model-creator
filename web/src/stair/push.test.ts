import { describe, expect, it } from 'vitest';
import { emptyStairModel, type FrameLoad } from '../model/types';
import { toPayload } from '../etabs/mapping';
import { template } from './stair';
import { applyStairLoads, defaultPattern, stairLoadRows } from './push';

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
