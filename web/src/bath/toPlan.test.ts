import { describe, expect, it } from 'vitest';
import { emptyModel, type Model } from '../model/types';
import { toPlanModel, toSectionLine } from './toPlan';
import { cutSection } from './engine/cut';
import { checkRun } from './engine/checks';

// two 3000 bays along X, off the origin so the shift into engine coordinates is exercised
function bays(rightSink: number, midBeamSink?: number, duct = false): Model {
  const m = emptyModel();
  const xs = [1000, 4000, 7000],
    ys = [2000, 5000];
  m.grids = [
    ...xs.map((x, i) => ({ id: `gx${i}`, label: String(i + 1), dir: 'X' as const, x1: x, y1: 0, x2: x, y2: 9000, bubble: 'start' as const })),
    ...ys.map((y, i) => ({ id: `gy${i}`, label: 'AB'[i], dir: 'Y' as const, x1: 0, y1: y, x2: 9000, y2: y, bubble: 'start' as const })),
  ];
  m.columns = xs.flatMap((x) => ys.map((y) => ({ id: `c${x}-${y}`, story: 'Story1', x, y, section: 'C400x400', angle: 0 })));
  const beam = (id: string, x1: number, y1: number, x2: number, y2: number, sink?: number) => ({ id, story: 'Story1', x1, y1, x2, y2, section: 'B300x500', sink });
  m.beams = [beam('bA', 1000, 2000, 7000, 2000), beam('bB', 1000, 5000, 7000, 5000), beam('b1', 1000, 2000, 1000, 5000), beam('b2', 4000, 2000, 4000, 5000, midBeamSink), beam('b3', 7000, 2000, 7000, 5000)];
  const rect = (x0: number, x1: number) => [{ x: x0, y: 2000 }, { x: x1, y: 2000 }, { x: x1, y: 5000 }, { x: x0, y: 5000 }];
  m.slabs = [
    { id: 'sL', story: 'Story1', pts: rect(1000, 4000), section: 'S150' },
    { id: 'sR', story: 'Story1', pts: rect(4000, 7000), section: 'S150', sink: rightSink, duct: duct || undefined },
  ];
  m.sectionLines = [{ id: 'sec', story: 'Story1', label: 'A-A', a: { x: 0, y: 3500 }, b: { x: 8000, y: 3500 } }];
  return m;
}

const midCheck = (m: Model) => {
  const { plan, origin } = toPlanModel(m, 'Story1');
  const run = cutSection(plan, toSectionLine(m.sectionLines![0], origin));
  return { run, check: checkRun(plan, run).find((c) => c.beamId === 'b2')! };
};

describe('toPlanModel', () => {
  it('a flush 500 beam misses a slab sunk 400 (soffit 550)', () => {
    const { check } = midCheck(bays(400));
    const sunk = check.sides.find((s) => s.sink === 400)!;
    expect(sunk.soffitPass).toBe(false);
    expect(sunk.margin).toBe(-50);
    expect(check.pass).toBe(false);
  });

  it('sinking the beam 400 catches the sunken slab but drops below the flush one', () => {
    const { check } = midCheck(bays(400, 400));
    expect(check.sides.find((s) => s.sink === 400)!.pass).toBe(true);
    expect(check.sides.find((s) => s.sink === 0)!.topPass).toBe(false);
  });

  it('a duct leaves no slab on that side', () => {
    const { run, check } = midCheck(bays(400, undefined, true));
    expect(check.sides.map((s) => s.sink)).toEqual([0]);
    expect(run.items.filter((i) => i.kind === 'slab')).toHaveLength(1);
  });

  it('labels the section grid crossings from the EMC grids', () => {
    const { run } = midCheck(bays(0));
    expect(run.gridCrossings.map((g) => g.label).sort()).toEqual(['1', '2', '3']);
  });
});

describe('catchFindings', () => {
  it('flags the sunk slab sides a flush 500 beam cannot reach, in EMC plan coordinates', async () => {
    const { catchFindings } = await import('./CatchFlags');
    const { sides } = catchFindings(bays(400), 'Story1');
    expect(sides.length).toBeGreaterThan(0);
    for (const { side } of sides) {
      expect(side.mid.x).toBeGreaterThanOrEqual(4000 - 1);
      expect(side.mid.x).toBeLessThanOrEqual(7000 + 1);
    }
    // all flush: nothing to flag
    expect(catchFindings(bays(0), 'Story1').sides).toHaveLength(0);
  });
});
