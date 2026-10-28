import { describe, expect, it } from 'vitest';
import { autoDepth, autoSizeBeams, autoWidth, beamRank, isPeriphery } from './autoBeam';
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

describe('auto beam rules', () => {
  it('depth = span/10 in 100 mm steps, 300..800', () => {
    expect([1000, 2999, 3000, 3001, 4000, 4500, 6500, 7000, 7200, 12000].map(autoDepth)).toEqual([300, 300, 300, 400, 400, 500, 700, 700, 800, 800]);
  });

  it('width bounds by rank around the preferred width', () => {
    expect([autoWidth(1, 230), autoWidth(2, 230), autoWidth(3, 230)]).toEqual([300, 230, 200]);
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

  it('periphery: one side of the span is empty', () => {
    const m = frame();
    expect(isPeriphery(m, beam(m, P(0, 0), P(6000, 0)))).toBe(true);
    expect(isPeriphery(m, beam(m, P(0, 0), P(0, 5000)))).toBe(true);
    expect(isPeriphery(m, beam(m, P(6000, 0), P(6000, 5000)))).toBe(false);
    expect(isPeriphery(m, beam(m, P(3000, 0), P(3000, 5000)))).toBe(false);
  });

  it('sizes beams, creating sections, and deepens GF periphery beams to the plinth', () => {
    let m = frame();
    m = { ...m, foundation: { foundingDepth: 2000, footingThickness: 600, plinthHeight: 600 } };
    const ids = m.beams.map((b) => b.id);
    const { model } = autoSizeBeams(m, ids, 'B300x500');
    const sec = (a: Pt, b: Pt) => beam(model, a, b).section;
    expect(sec(P(0, 0), P(6000, 0))).toBe('B300x600'); // 6 m primary
    expect(sec(P(0, 0), P(0, 5000))).toBe('B300x600'); // 5 m → 500, periphery → plinth 600
    expect(sec(P(6000, 0), P(6000, 5000))).toBe('B300x500'); // interior, existing section reused
    expect(sec(P(3000, 0), P(3000, 5000))).toBe('B250x500');
    expect(sec(P(0, 2500), P(3000, 2500))).toBe('B200x300'); // 3 m tertiary keeps span/10
    // a short primary is still 450 deep
    const short = addBeams(m, [[P(6000, 0), P(6000, 2000)]], ['Story1'], 'B300x500');
    const sb = short.beams.at(-1)!;
    expect(autoSizeBeams(short, [sb.id], 'B300x500').sizes.get(sb.id)!.section).toBe('B300x450');
    expect(model.frameSections.find((s) => s.name === 'B250x500')).toMatchObject({ t2: 250, t3: 500, shape: 'Rectangle', material: '4000Psi' });
    // not the GF story → no plinth rule
    const up = autoSizeBeams({ ...m, stories: [{ name: 'GF', height: 1000, isMaster: true, similarTo: '' }, ...m.stories] }, ids, 'B300x500').model;
    expect(beam(up, P(0, 0), P(0, 5000)).section).toBe('B300x500');
  });
});
