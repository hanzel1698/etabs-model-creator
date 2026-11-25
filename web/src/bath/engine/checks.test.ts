import { describe, expect, it } from 'vitest';
import { checkRun, summarise } from './checks';
import { exampleModel } from './defaults';
import type { PlanModel, SectionRun } from './types';

/**
 * A hand-built run: slab | beam | slab. Avoids going through the cutter so the
 * arithmetic is tested on its own.
 */
function run(leftSlab: string, beamId: string, rightSlab: string): SectionRun {
  return {
    length: 3000,
    warnings: [],
    gridCrossings: [],
    items: [
      { kind: 'slab', d0: 0, d1: 1000, slabTypeId: leftSlab, panelId: 'p1' },
      { kind: 'beam', d0: 1000, d1: 1300, beamId, trueWidth: 300, cutWidth: 300, skew: 90 },
      { kind: 'slab', d0: 1300, d1: 3000, slabTypeId: rightSlab, panelId: 'p2' },
    ],
  };
}

/** The same run, with the beam cut along its length instead of across it. */
function runAlong(beamId: string): SectionRun {
  const base = run('st-TS1', beamId, 'st-TS2');
  return {
    ...base,
    items: base.items.map((item) =>
      item.kind === 'beam' ? { ...item, longitudinal: true, cutWidth: 300, skew: 0 } : item,
    ),
  };
}

/** General slab 150 thick; bathroom sunk 300 so its soffit is at 450. */
function model(overrides: Partial<PlanModel> = {}): PlanModel {
  const base = exampleModel();
  return {
    ...base,
    beams: [
      { id: 'b-600', typeId: 'bt-300x600', kind: 'primary', start: { kind: 'point', x: 0, y: 0 }, end: { kind: 'point', x: 0, y: 1000 } },
      { id: 'b-400', typeId: 'bt-250x400', kind: 'primary', start: { kind: 'point', x: 0, y: 0 }, end: { kind: 'point', x: 0, y: 1000 } },
      { id: 'b-450', typeId: 'bt-250x450', kind: 'primary', start: { kind: 'point', x: 0, y: 0 }, end: { kind: 'point', x: 0, y: 1000 } },
      { id: 'b-flush', typeId: 'bt-flush', kind: 'primary', start: { kind: 'point', x: 0, y: 0 }, end: { kind: 'point', x: 0, y: 1000 } },
      { id: 'b-upstand', typeId: 'bt-300x600', topLevel: -300, kind: 'primary', start: { kind: 'point', x: 0, y: 0 }, end: { kind: 'point', x: 0, y: 1000 } },
    ],
    beamTypes: [...base.beamTypes, { id: 'bt-flush', label: 'B-250x150', width: 250, depth: 150 }],
    ...overrides,
  };
}

describe('checkRun — the worked case from the plan', () => {
  it('passes a 600 deep beam against a 300 sink with 150 to spare', () => {
    const checks = checkRun(model(), run('st-TS1', 'b-600', 'st-TS2'));
    expect(checks).toHaveLength(1);

    const check = checks[0]!;
    expect(check.soffitLevel).toBe(600);
    expect(check.pass).toBe(true);

    const sunken = check.sides.find((s) => s.slabLabel === 'TS2')!;
    expect(sunken.slabSoffit).toBe(450);
    expect(sunken.margin).toBe(150);
    expect(sunken.projection).toBe(150);
    expect(check.requiredDepth).toBe(450);
    expect(check.governingSide).toBe('right');
  });

  it('fails a 400 deep beam by 50 and asks for 450', () => {
    const checks = checkRun(model(), run('st-TS1', 'b-400', 'st-TS2'));
    const check = checks[0]!;
    expect(check.pass).toBe(false);

    const sunken = check.sides.find((s) => s.slabLabel === 'TS2')!;
    expect(sunken.margin).toBe(-50);
    expect(sunken.pass).toBe(false);
    expect(check.requiredDepth).toBe(450);
    expect(check.governingSide).toBe('right');
  });

  it('treats a margin of exactly zero as a pass', () => {
    const checks = checkRun(model(), run('st-TS1', 'b-450', 'st-TS2'));
    const check = checks[0]!;
    expect(check.sides.find((s) => s.slabLabel === 'TS2')!.margin).toBe(0);
    expect(check.pass).toBe(true);
  });

  it('still passes the general side when the sunken side fails', () => {
    const check = checkRun(model(), run('st-TS1', 'b-400', 'st-TS2'))[0]!;
    expect(check.sides.find((s) => s.slabLabel === 'TS1')!.pass).toBe(true);
    expect(check.sides.find((s) => s.slabLabel === 'TS2')!.pass).toBe(false);
    expect(check.pass).toBe(false);
  });
});

describe('beam types fall out of the same formula', () => {
  it('fails a flush beam against any sink without a special case', () => {
    const check = checkRun(model(), run('st-TS1', 'b-flush', 'st-TS2'))[0]!;
    expect(check.soffitLevel).toBe(150);
    expect(check.pass).toBe(false);
    expect(check.sides.find((s) => s.slabLabel === 'TS2')!.margin).toBe(-300);
  });

  it('passes a flush beam where both sides are the general slab', () => {
    const check = checkRun(model(), run('st-TS1', 'b-flush', 'st-TS1'))[0]!;
    expect(check.pass).toBe(true);
  });

  it('carries an upstand up whole, depth intact', () => {
    const check = checkRun(model(), run('st-TS1', 'b-upstand', 'st-TS2'))[0]!;
    expect(check.topLevel).toBe(-300);
    // The 600 deep section moved up with the top rather than stretching down
    // to the datum, so the soffit lands 300 short of the sunken slab.
    expect(check.soffitLevel).toBe(300);
    expect(check.depth).toBe(600);
    expect(check.pass).toBe(false);
    // Reaching the sunken soffit from that top would take a 750 deep section.
    expect(check.requiredDepth).toBe(750);
  });

  /**
   * The case that drove sink onto the beam: one type at two levels, each judged
   * on where its own section actually sits. Sunken slab both sides, so the sink
   * is the whole story — stranding a flush slab is the case below.
   */
  it('sinks a beam whole, so the deeper soffit is what gets checked', () => {
    const m = model();
    m.beams = m.beams.map((b) => (b.id === 'b-400' ? { ...b, topLevel: 300 } : b));
    const check = checkRun(m, run('st-TS2', 'b-400', 'st-TS2'))[0]!;
    expect(check.topLevel).toBe(300);
    // Still a 400 deep beam — sinking it did not shorten it to 100.
    expect(check.depth).toBe(400);
    expect(check.soffitLevel).toBe(700);
    // Flush it failed the 450 sunken soffit by 50; dropped 300 it clears it.
    expect(check.pass).toBe(true);
    expect(check.requiredDepth).toBe(150);
  });
});

/**
 * Both faces are checked on both sides, always. The soffit alone passes a beam
 * that has been sunk out from under the slab on its other side.
 */
describe('the top face', () => {
  /** b-400 dropped 300: catches the sunken slab, drops below the flush one. */
  function sunkBeam(): PlanModel {
    const m = model();
    m.beams = m.beams.map((b) => (b.id === 'b-400' ? { ...b, topLevel: 300 } : b));
    return m;
  }

  it('fails a beam sunk past the flush slab on its other side', () => {
    const check = checkRun(sunkBeam(), run('st-TS1', 'b-400', 'st-TS2'))[0]!;

    // The sink did what it was meant to on the sunken side.
    const sunken = check.sides.find((s) => s.slabLabel === 'TS2')!;
    expect(sunken.soffitPass).toBe(true);
    expect(sunken.topMargin).toBe(0);
    expect(sunken.pass).toBe(true);

    // But the flush slab now starts 300 above the beam top, with nothing under it.
    const flush = check.sides.find((s) => s.slabLabel === 'TS1')!;
    expect(flush.soffitPass).toBe(true);
    expect(flush.topMargin).toBe(-300);
    expect(flush.topPass).toBe(false);
    expect(flush.pass).toBe(false);

    expect(check.pass).toBe(false);
    expect(check.requiredTopLevel).toBe(0);
    expect(check.governingTopSide).toBe('left');
  });

  it('quotes the depth from the level the top has to come back up to', () => {
    const check = checkRun(sunkBeam(), run('st-TS1', 'b-400', 'st-TS2'))[0]!;
    // Raised to the flush slab top it would need 450 to still reach the sunken
    // soffit — not the 150 left below where it wrongly sits.
    expect(check.requiredTopLevel).toBe(0);
    expect(check.requiredSoffitLevel).toBe(450);
    expect(check.requiredDepth).toBe(450);
  });

  it('reads the same sink either way round', () => {
    const check = checkRun(sunkBeam(), run('st-TS2', 'b-400', 'st-TS1'))[0]!;
    expect(check.pass).toBe(false);
    expect(check.governingTopSide).toBe('right');
    expect(check.requiredDepth).toBe(450);
  });

  it('judges the two faces independently', () => {
    // Flush both sides against the sunken slab: the top is fine, the soffit is not.
    const check = checkRun(model(), run('st-TS2', 'b-400', 'st-TS2'))[0]!;
    expect(check.sides.every((s) => s.topPass)).toBe(true);
    expect(check.sides.every((s) => s.soffitPass)).toBe(false);
    expect(check.pass).toBe(false);
    expect(check.requiredTopLevel).toBe(300);
    // Already low enough for the top, so the depth is still measured from there.
    expect(check.requiredDepth).toBe(450);
  });

  it('passes a top sitting exactly on the slab top', () => {
    expect(
      checkRun(model(), run('st-TS1', 'b-600', 'st-TS2'))[0]!.sides.find(
        (s) => s.slabLabel === 'TS1',
      )!.topMargin,
    ).toBe(0);
    expect(checkRun(model(), run('st-TS1', 'b-600', 'st-TS2'))[0]!.pass).toBe(true);
  });

  it('clears every slab top from an upstand', () => {
    const check = checkRun(model(), run('st-TS1', 'b-upstand', 'st-TS2'))[0]!;
    expect(check.sides.every((s) => s.topPass)).toBe(true);
    expect(check.requiredTopLevel).toBe(0);
    // It fails on the soffit alone, and from a top already above what it needs
    // the depth is measured where the beam actually is.
    expect(check.requiredDepth).toBe(750);
  });

  it('leaves a beam with no slab beside it alone', () => {
    const backToBack: SectionRun = {
      length: 600,
      warnings: [],
      gridCrossings: [],
      items: [
        { kind: 'beam', d0: 0, d1: 300, beamId: 'b-600', trueWidth: 300, cutWidth: 300, skew: 90 },
        { kind: 'beam', d0: 300, d1: 600, beamId: 'b-400', trueWidth: 300, cutWidth: 300, skew: 90 },
      ],
    };
    for (const check of checkRun(sunkBeam(), backToBack)) {
      expect(check.requiredTopLevel).toBeNull();
      expect(check.governingTopSide).toBeNull();
      expect(check.requiredDepth).toBe(0);
      expect(check.pass).toBe(true);
    }
  });
});

describe('upstands', () => {
  /**
   * b-flush is topLevel 0, depth 150 (soffit 150) — flush against a 300 sunken
   * slab it fails outright with nothing raising it. A 300 deep upstand nib
   * covering this exact crossing raises the effective top to -300, clearing
   * every slab top, while the soffit — hanging off the beam's own top, not the
   * nib's — stays exactly where the plain beam alone would put it.
   */
  it('raises the effective top by the upstand depth, leaving the soffit alone', () => {
    const base = run('st-TS1', 'b-flush', 'st-TS2');
    const withUpstand: SectionRun = {
      ...base,
      items: base.items.map((item) => (item.kind === 'beam' ? { ...item, upstandDepth: 300 } : item)),
    };

    const check = checkRun(model(), withUpstand)[0]!;
    expect(check.topLevel).toBe(-300);
    expect(check.soffitLevel).toBe(150);
    expect(check.sides.every((s) => s.topPass)).toBe(true);
  });

  it('behaves exactly like a plain beam when no upstand covers the crossing', () => {
    const plain = checkRun(model(), run('st-TS1', 'b-flush', 'st-TS2'))[0]!;
    const base = run('st-TS1', 'b-flush', 'st-TS2');
    const withZero: SectionRun = {
      ...base,
      items: base.items.map((item) => (item.kind === 'beam' ? { ...item, upstandDepth: 0 } : item)),
    };
    expect(checkRun(model(), withZero)[0]!).toEqual(plain);
  });
});

describe('warnings', () => {
  it('spells out a slab top sitting above the beam top, alongside the failure', () => {
    const m = model();
    m.beams = m.beams.map((b) => (b.id === 'b-600' ? { ...b, topLevel: 100 } : b));
    const check = checkRun(m, run('st-TS1', 'b-600', 'st-TS2'))[0]!;
    expect(check.warnings.some((w) => w.includes('above the beam top'))).toBe(true);
    expect(check.pass).toBe(false);
  });

  it('stays quiet when the beam top is at or above every slab', () => {
    expect(checkRun(model(), run('st-TS1', 'b-600', 'st-TS2'))[0]!.warnings).toEqual([]);
  });
});

describe('run structure', () => {
  it('reports one side only for a beam at the end of the run', () => {
    const single: SectionRun = {
      length: 1300,
      warnings: [],
      gridCrossings: [],
      items: [
        { kind: 'slab', d0: 0, d1: 1000, slabTypeId: 'st-TS2', panelId: 'p1' },
        { kind: 'beam', d0: 1000, d1: 1300, beamId: 'b-400', trueWidth: 300, cutWidth: 300, skew: 90 },
      ],
    };
    const check = checkRun(model(), single)[0]!;
    expect(check.sides).toHaveLength(1);
    expect(check.sides[0]!.side).toBe('left');
  });

  it('steps over a column to reach the slab beyond', () => {
    const withColumn: SectionRun = {
      length: 3000,
      warnings: [],
      gridCrossings: [],
      items: [
        { kind: 'slab', d0: 0, d1: 900, slabTypeId: 'st-TS2', panelId: 'p1' },
        { kind: 'column', d0: 900, d1: 1000, columnId: 'c1' },
        { kind: 'beam', d0: 1000, d1: 1300, beamId: 'b-400', trueWidth: 300, cutWidth: 300, skew: 90 },
      ],
    };
    const check = checkRun(model(), withColumn)[0]!;
    expect(check.sides).toHaveLength(1);
    expect(check.sides[0]!.slabLabel).toBe('TS2');
  });

  it('leaves out a beam the section runs along', () => {
    // b-400 fails the sink when cut across it, so a row appearing here would be
    // a false failure: a long section has no slab either side to catch.
    expect(checkRun(model(), run('st-TS1', 'b-400', 'st-TS2'))).toHaveLength(1);
    expect(checkRun(model(), runAlong('b-400'))).toEqual([]);
  });

  it('does not reach across a duct to the slab beyond it', () => {
    // A duct emits no slab item at all, so the bay between the two beams is a
    // plain gap in the run. The failing sink lies past the far beam, and the
    // near beam must not be judged against it.
    const withDuct: SectionRun = {
      length: 4000,
      warnings: [],
      gridCrossings: [],
      items: [
        { kind: 'beam', d0: 1000, d1: 1300, beamId: 'b-400', trueWidth: 300, cutWidth: 300, skew: 90 },
        // 1300..2700 is the duct — nothing is emitted there.
        { kind: 'beam', d0: 2700, d1: 3000, beamId: 'b-600', trueWidth: 300, cutWidth: 300, skew: 90 },
        { kind: 'slab', d0: 3000, d1: 4000, slabTypeId: 'st-TS2', panelId: 'p2' },
      ],
    };
    const [near, far] = checkRun(model(), withDuct);
    expect(near!.beamId).toBe('b-400');
    expect(near!.sides).toEqual([]);
    expect(near!.pass).toBe(true);
    expect(far!.sides.map((s) => s.side)).toEqual(['right']);
  });

  it('reports no sides for two adjacent beams', () => {
    const backToBack: SectionRun = {
      length: 600,
      warnings: [],
      gridCrossings: [],
      items: [
        { kind: 'beam', d0: 0, d1: 300, beamId: 'b-600', trueWidth: 300, cutWidth: 300, skew: 90 },
        { kind: 'beam', d0: 300, d1: 600, beamId: 'b-400', trueWidth: 300, cutWidth: 300, skew: 90 },
      ],
    };
    const checks = checkRun(model(), backToBack);
    expect(checks.every((c) => c.sides.length === 0)).toBe(true);
    expect(checks.every((c) => c.pass)).toBe(true);
  });
});

describe('summarise', () => {
  it('counts the failures', () => {
    const m = model();
    const checks = [
      ...checkRun(m, run('st-TS1', 'b-600', 'st-TS2')),
      ...checkRun(m, run('st-TS1', 'b-400', 'st-TS2')),
    ];
    expect(summarise(checks)).toEqual({ total: 2, failing: 1 });
  });
});
