import { describe, expect, it } from 'vitest';
import { autoDepth, autoSizeBeams, autoWidth, beamRank, explainAutoSize, isPeriphery } from './autoBeam';
import { addBeams, addColumns } from './ops';
import { emptyModel, type Model, type Pt } from './types';

const P = (x: number, y: number): Pt => ({ x, y });
const beam = (m: Model, a: Pt, b: Pt) => m.beams.find((x) => x.x1 === a.x && x.y1 === a.y && x.x2 === b.x && x.y2 === b.y)!;

// 2 x 1 bays, 6 m x 5 m, columns at the grid corners
function frame(): Model {
  let m = emptyModel();
  m = addColumns(m, [P(0, 0), P(6000, 0), P(12000, 0), P(0, 5000), P(6000, 5000), P(12000, 5000)], ['Story1'], 'C400x400', 0);
  m = addBeams(
    m,
    [
      [P(0, 0), P(6000, 0)],
      [P(6000, 0), P(12000, 0)],
      [P(0, 5000), P(6000, 5000)],
      [P(6000, 5000), P(12000, 5000)],
      [P(0, 0), P(0, 5000)],
      [P(6000, 0), P(6000, 5000)],
      [P(12000, 0), P(12000, 5000)],
      // secondary: mid-span of the 6 m girders, split at nothing
      [P(3000, 0), P(3000, 5000)],
      // tertiary: between the secondary at x=3000 and the column line x=0
      [P(0, 2500), P(3000, 2500)],
      [P(1500, 2500), P(1500, 5000)],
    ],
    ['Story1'],
    'B300x500',
  );
  return m;
}

const withSections = (m: Model, ...dims: [number, number][]): Model => ({
  ...m,
  frameSections: [...m.frameSections, ...dims.map(([t2, t3]) => ({ name: `B${t2}x${t3}`, shape: 'Rectangle' as const, t2, t3, material: '4000Psi', fromEtabs: false }))],
});

describe('auto beam rules', () => {
  it('depth = span/10 in 100 mm steps, 400..800, 300 only up to 1.5 m', () => {
    expect([1000, 1500, 1501, 2999, 3000, 3001, 4000, 4500, 6500, 7000, 7200, 12000].map(autoDepth)).toEqual([300, 300, 400, 400, 400, 400, 400, 500, 700, 700, 800, 800]);
  });

  it('width bounds by rank around the preferred width', () => {
    expect([autoWidth(1, 200), autoWidth(2, 200), autoWidth(3, 200)]).toEqual([300, 250, 200]);
    expect([autoWidth(1, 230), autoWidth(2, 230), autoWidth(3, 230)]).toEqual([300, 250, 200]);
    expect([autoWidth(1, 350), autoWidth(2, 350), autoWidth(3, 350)]).toEqual([350, 250, 200]);
  });

  it('ranks beams by what carries them', () => {
    const m = frame();
    expect(beamRank(m, beam(m, P(0, 0), P(6000, 0)))).toBe(1);
    expect(beamRank(m, beam(m, P(3000, 0), P(3000, 5000)))).toBe(2);
    // on a primary and a secondary: one level below the weaker support
    expect(beamRank(m, beam(m, P(0, 2500), P(3000, 2500)))).toBe(3);
    expect(beamRank(m, beam(m, P(1500, 2500), P(1500, 5000)))).toBe(3);
  });

  it('beams carried by secondaries are tertiary, and a girder split at the junction still carries', () => {
    let m = emptyModel();
    m = addColumns(m, [P(0, 0), P(8000, 0), P(0, 8000), P(8000, 8000)], ['Story1'], 'C400x400', 0);
    m = addBeams(
      m,
      [
        [P(0, 0), P(8000, 0)],
        [P(0, 8000), P(8000, 8000)],
        // girder split at x=4000
        [P(0, 0), P(0, 4000)],
        [P(0, 4000), P(0, 8000)],
        [P(8000, 0), P(8000, 8000)],
        // secondaries
        [P(4000, 0), P(4000, 8000)],
        [P(6000, 0), P(6000, 8000)],
        [P(0, 4000), P(8000, 4000)], // one end on the split girder line (no column there)
        // tertiary between the two secondaries
        [P(4000, 6000), P(6000, 6000)],
        // an end on a column wins
        [P(8000, 8000), P(6000, 6000)],
      ],
      ['Story1'],
      'B300x500',
    );
    expect(beamRank(m, beam(m, P(4000, 0), P(4000, 8000)))).toBe(2);
    expect(beamRank(m, beam(m, P(0, 4000), P(8000, 4000)))).toBe(2);
    expect(beamRank(m, beam(m, P(4000, 6000), P(6000, 6000)))).toBe(3);
    expect(beamRank(m, beam(m, P(8000, 8000), P(6000, 6000)))).toBe(1);
  });

  it('an L corner carries: a beam on the tip of a cantilever is ranked, a floating one is unsupported', () => {
    let m = emptyModel();
    m = addColumns(m, [P(0, 0)], ['Story1'], 'C400x400', 0);
    m = addBeams(
      m,
      [
        [P(0, 0), P(3000, 0)], // cantilever off the column
        [P(0, 0), P(0, 2000)],
        [P(0, 840), P(3000, 840)], // on the primary at x=0, and on the tip beam at x=3000
        [P(3000, 0), P(3000, 840)], // L corners at both ends: on the cantilever, and the beam above
        [P(10000, 0), P(10000, 840)], // floating
      ],
      ['Story1'],
      'B300x500',
    );
    m = addColumns(m, [P(10000, -300)], ['Story1'], 'C400x400', 0);
    m = withSections(m, [200, 300]);
    // each rests on the other at the corner, so each is one level below the other's secondary rank
    expect(beamRank(m, beam(m, P(0, 840), P(3000, 840)))).toBe(3);
    expect(beamRank(m, beam(m, P(3000, 0), P(3000, 840)))).toBe(3);
    const tip = explainAutoSize(m, beam(m, P(3000, 0), P(3000, 840)), 'B300x500');
    expect(tip).toContain('at (3000, 0) by primary beam B300x500 (ending there too)');
    const fl = beam(m, P(10000, 0), P(10000, 840));
    const { sizes } = autoSizeBeams(m, [fl.id], 'B200x300');
    expect(sizes.get(fl.id)).toMatchObject({ rank: 0, width: 200, depth: 300, section: 'B200x300' });
    const why = explainAutoSize(m, fl, 'B200x300');
    expect(why).toContain('Rank unsupported: no column or beam carries either end');
    expect(why).toContain('nothing at (10000, 0) (column C400x400 at (10000, -300) is 100 mm short of it)');
    expect(why).toContain('nothing at (10000, 840) (nothing within 500 mm on Story1)');
    expect(why).toContain("Width 200: unsupported beams take the active section's width");
    expect(why).not.toContain('primary minimum');
  });

  it('periphery: one side of the span is empty', () => {
    const m = frame();
    expect(isPeriphery(m, beam(m, P(0, 0), P(6000, 0)))).toBe(true);
    expect(isPeriphery(m, beam(m, P(0, 0), P(0, 5000)))).toBe(true);
    expect(isPeriphery(m, beam(m, P(6000, 0), P(6000, 5000)))).toBe(false);
    expect(isPeriphery(m, beam(m, P(3000, 0), P(3000, 5000)))).toBe(false);
  });

  it('sizes beams from the listed sections and deepens GF periphery beams to the plinth', () => {
    let m = withSections(frame(), [200, 300], [200, 400], [250, 500], [300, 450], [300, 600]);
    m = { ...m, foundation: { foundingDepth: 2000, footingThickness: 600, plinthHeight: 600 } };
    const ids = m.beams.map((b) => b.id);
    const { model } = autoSizeBeams(m, ids, 'B300x500');
    const sec = (a: Pt, b: Pt) => beam(model, a, b).section;
    expect(sec(P(0, 0), P(6000, 0))).toBe('B300x600'); // 6 m primary
    expect(sec(P(0, 0), P(0, 5000))).toBe('B300x600'); // 5 m → 500, periphery → plinth 600
    expect(sec(P(6000, 0), P(6000, 5000))).toBe('B300x500'); // interior
    expect(sec(P(3000, 0), P(3000, 5000))).toBe('B250x500'); // secondary is 250 wide, not the 300 preferred width
    expect(sec(P(0, 2500), P(3000, 2500))).toBe('B200x400'); // 3 m tertiary: 200x300 is for spans up to 1.5 m
    // a narrower preferred width: secondaries are still 250 wide
    expect(beam(autoSizeBeams(m, ids, 'B200x300').model, P(3000, 0), P(3000, 5000)).section).toBe('B250x500');
    expect(model.frameSections).toBe(m.frameSections); // nothing created
    // a short primary is still 450 deep
    const short = addBeams(m, [[P(6000, 0), P(6000, 2000)]], ['Story1'], 'B300x500');
    const sb = short.beams.at(-1)!;
    expect(autoSizeBeams(short, [sb.id], 'B300x500').sizes.get(sb.id)!.section).toBe('B300x450');
    // not the GF story → no plinth rule
    const up = autoSizeBeams({ ...m, stories: [{ name: 'GF', height: 1000, isMaster: true, similarTo: '' }, ...m.stories] }, ids, 'B300x500').model;
    expect(beam(up, P(0, 0), P(0, 5000)).section).toBe('B300x500');
  });

  it('takes the smallest bigger listed section, or the active one when none is big enough', () => {
    const m = withSections(frame(), [300, 400], [350, 700]); // with B300x500 from the empty model
    const ids = m.beams.map((b) => b.id);
    const { sizes } = autoSizeBeams(m, ids, 'B300x500');
    const at = (a: Pt, b: Pt) => sizes.get(beam(m, a, b).id)!;
    expect(at(P(3000, 0), P(3000, 5000))).toMatchObject({ width: 250, depth: 500, section: 'B300x500', fits: true });
    expect(at(P(0, 0), P(6000, 0))).toMatchObject({ width: 300, depth: 600, section: 'B350x700', fits: true });
    const small = withSections({ ...m, frameSections: m.frameSections.filter((s) => !s.name.startsWith('B')) }, [300, 400]);
    expect(autoSizeBeams(small, ids, 'B300x400').sizes.get(beam(m, P(0, 0), P(6000, 0)).id)).toMatchObject({ section: 'B300x400', fits: false });
  });

  it('explains each step of the pick', () => {
    const m = withSections(frame(), [200, 400], [250, 500], [300, 700]);
    const why = (a: Pt, b: Pt, base = 'B300x500') => explainAutoSize(m, beam(m, a, b), base);
    const sec = why(P(3000, 0), P(3000, 5000), 'B200x400');
    expect(sec).toContain('Rank secondary: no column at either end; carried at (3000, 0) by primary beam B300x500, at (3000, 5000) by primary beam B300x500');
    expect(sec).toContain('Width 250: secondary beams are always 250 wide.');
    expect(sec).toContain('Depth 500: span 5.00 m / 10 = 500, rounded up to 500.');
    expect(sec).toContain('Section B250x500 (250×500): listed at exactly 250×500. Next that fit: B300x500, B300x700.');
    const pri = why(P(0, 0), P(6000, 0));
    expect(pri).toContain('Rank primary: the end at (0, 0) sits on column C400x400 at (0, 0)');
    expect(pri).toContain('Section B300x700 (300×700): no listed section is exactly 300×600; this is the smallest listed one at least that big');
    const ter = why(P(0, 2500), P(3000, 2500));
    expect(ter).toContain('Rank tertiary');
    expect(ter).toContain('Width 200: tertiary beams are always 200 wide.');
    expect(ter).toContain('Depth 400: span 3.00 m / 10 = 300, rounded up to 300, raised to the 400 minimum');
    expect(why(P(0, 0), P(6000, 0), 'B300x500')).not.toContain('no listed beam section');
  });
});
