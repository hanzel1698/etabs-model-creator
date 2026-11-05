import { describe, expect, it } from 'vitest';
import { emptyStairModel as emptyModel, type StairModel as Model } from '../model/types';
import { analyze, autoSpans, beamLoads, beamName, flightGrips, kSlab, renumber, reshapeFlight, reshapeLanding, spanKey, ssBeam, suggestWaist, tauC, template, withWaist } from './stair';

describe('stair statics and IS 456 tables', () => {
  it('simply supported UDL and partial load', () => {
    const r = ssBeam([{ a: 0, b: 4, w: 10 }], 4);
    expect(r.RA).toBeCloseTo(20);
    expect(r.M).toBeCloseTo(20);
    const r2 = ssBeam([{ a: 0, b: 1, w: 6 }], 4);
    expect(r2.RA).toBeCloseTo(5.25);
    expect(r2.RB).toBeCloseTo(0.75);
  });
  it('reads tables', () => {
    expect(tauC(0.5, 25)).toBeCloseTo(0.49);
    expect(kSlab(200)).toBeCloseTo(1.2);
  });
});

describe('flight grips', () => {
  const f = { id: 'f', name: 'F1', x: 0, y: 0, dir: '-x' as const, n: 5, T: 250, R: 150, t: 150, width: 1000, z0: 0 };
  it('top end adds whole treads, bottom stays put', () => {
    const g = reshapeFlight(f, 'b1', { x: -200, y: 0 }); // going 1200 from x=1000 rounds to 5 treads
    expect(g).toMatchObject({ n: 6, x: -250, y: 0, z0: 0 });
  });
  it('bottom end keeps the top level and position', () => {
    const g = reshapeFlight(f, 'b0', { x: 1240, y: 500 });
    expect(g).toMatchObject({ n: 6, x: 0, z0: -150 });
    expect(flightGrips(g).b1).toEqual(flightGrips(f).b1);
  });
  it('side changes the width only', () => {
    expect(reshapeFlight(f, 'a0', { x: 500, y: -200 })).toMatchObject({ n: 5, x: 0, y: -200, width: 1200 });
    expect(reshapeFlight(f, 'a1', { x: 500, y: 100 }).width).toBe(300);
  });
});

describe('landing side grips', () => {
  const l = { id: 'l', name: 'L1', x: 0, y: 0, w: 2000, h: 1200, t: 150, z: 0 };
  it('moves only the dragged side', () => {
    expect(reshapeLanding(l, 1, { x: 2600.4, y: 9999 })).toMatchObject({ x: 0, y: 0, w: 2600, h: 1200 });
    expect(reshapeLanding(l, 3, { x: -500, y: 300 })).toMatchObject({ x: -500, y: 0, w: 2500, h: 1200 });
    expect(reshapeLanding(l, 0, { x: 0, y: 1500 })).toMatchObject({ x: 0, y: 1200, w: 2000, h: 300 }); // dragged past the far side
  });
});

describe('templates', () => {
  it('dog-legged stair: two auto spans, each supported by beams at matching levels', () => {
    const m = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    expect(m.flights.length).toBe(2);
    expect(m.landings.length).toBe(1);
    expect(m.spans.length).toBe(2);
    for (const sp of m.spans) {
      const A = analyze(m, sp)!;
      expect(A.sup.every((s) => s.beam && !s.mismatch)).toBe(true);
    }
    const { warn } = beamLoads(m);
    expect(warn).toEqual([]);
  });
  it('a landing stacked above in plan, on a higher story, is not part of the span', () => {
    const m = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const sp = m.spans[0],
      before = analyze(m, sp)!.segs.map((s) => [s.a, s.b]),
      l = m.landings[0];
    const up = { ...m, landings: [...m.landings, { ...l, id: 'up', name: 'Lup', x: -5000, y: -5000, w: 20000, h: 20000, z: l.z + 10000 }] };
    expect(analyze(up, sp)!.segs.map((s) => [s.a, s.b])).toEqual(before);
  });
  it('quarter-turn without a beam past the landing: the first flight rests on the second span', () => {
    const t = template(emptyModel(), 'L', 'Story1', 'B300x500', 'C400x400');
    const m = autoSpans({ ...t, beams: t.beams.filter((b) => !(b.x1 === b.x2 && b.x1 > 0)) });
    const [s1, s2] = m.spans;
    // IS 456 cl 33.1(b): S1 ends half the landing width past F1's top step, not at the landing's far edge
    const f1 = m.flights[0];
    expect(s1.x2).toBe(Math.round(f1.x + (f1.n - 1) * f1.T + Math.min(f1.width / 2, 1000)));
    const A1 = analyze(m, s1)!,
      A2 = analyze(m, s2)!;
    expect(A1.sup[1].span).toBe(s2);
    expect(A2.tr.map((x) => x.from)).toEqual([s1]);
    // what S2 takes to its beams = its own slab load + S1's end reaction
    const own = A2.segs.reduce((a, g) => a + g.dl * (g.b - g.a), 0) * s2.width;
    expect((A2.D.RA + A2.D.RB) * s2.width).toBeCloseTo(own + A1.D.RB * s1.width);
    expect(beamLoads(m).warn).toEqual([]);
  });
});

describe('span numbering', () => {
  it('S<n> follows the flight it covers, whatever the list order or old names', () => {
    const t = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const m = { ...t, spans: [...t.spans].reverse().map((s, i) => ({ ...s, name: `S${i + 7}` })) };
    const sp = renumber(m.spans, 'S', (s) => spanKey(m, s));
    const lowest = [...m.flights].sort((a, b) => a.z0 - b.z0)[0];
    expect(sp.map((s) => s.name).sort()).toEqual(['S1', 'S2']);
    expect(analyze(m, sp.find((s) => s.name === 'S1')!)!.segs.some((g) => g.it === lowest)).toBe(true);
  });
});

describe('waist suggestion', () => {
  it('thin waist fails deflection; the suggested waist (≥ L/20) passes', () => {
    const t = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const m = { ...t, flights: t.flights.map((f) => ({ ...f, t: 80 })) };
    const sp = m.spans[0];
    expect(analyze(m, sp)!.des.defl).toBe(false);
    const s = suggestWaist(m)!;
    const ok = (t: number) => m.spans.every((x) => { const d = analyze(withWaist(m, t), x)!.des; return d.flex && d.shear && d.shearMax && d.defl; });
    expect(ok(s.t)).toBe(true);
    expect(ok(s.t - 10)).toBe(false);
  });
});

describe('beam names', () => {
  it('B1, B2, … from the lowest beam up, whatever the list order', () => {
    const m = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const shuffled = { ...m, beams: [...m.beams].reverse() };
    const names = (x: typeof m) => new Map(x.beams.map((b) => [b, beamName(x, b)]));
    expect(names(shuffled)).toEqual(names(m));
    const z = (b: (typeof m.beams)[number]) => b.dz ?? 0;
    const byName = [...m.beams].sort((a, b) => +beamName(m, a).slice(1) - +beamName(m, b).slice(1));
    expect(byName.map(z)).toEqual([...byName.map(z)].sort((a, b) => a - b));
  });
});

describe('beam loads', () => {
  it('lists beams in name order, whatever the list order', () => {
    const m = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const shuffled = { ...m, beams: [...m.beams].reverse() };
    const names = [...beamLoads(shuffled).out.keys()].map((b) => beamName(shuffled, b));
    expect(names).toEqual(names.map((_, i) => `B${i + 1}`));
  });
  it('measures loads from the left end, whichever way the beam was drawn', () => {
    const m = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const rev = { ...m, beams: m.beams.map((b) => ({ ...b, x1: b.x2, y1: b.y2, x2: b.x1, y2: b.y1 })) };
    const ab = (x: Model) => [...beamLoads(x).out.values()].map((rs) => rs.map((r) => [r.a, r.b]));
    expect(ab(rev)).toEqual(ab(m));
  });
});
