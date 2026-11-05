import { describe, expect, it } from 'vitest';
import { defaultStairParams, emptyModel, type Model } from '../model/types';
import { applyImport, importElements, toPayload } from './mapping';
import type { ImportResult } from './bridgeClient';

const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** What the bridge would read back from ETABS after pushing `m`. */
function asImport(m: Model): Pick<ImportResult, 'frames' | 'areas'> {
  const p = toPayload(m, { updateStories: false, pushGrids: false });
  return {
    frames: p.frames.map((f, i) => ({ name: String(i), guid: f.guid, section: f.section, angle: f.angle, pts: [{ x: f.x1, y: f.y1, z: f.z1 }, { x: f.x2, y: f.y2, z: f.z2 }], loads: f.loads })),
    areas: p.areas.map((a, i) => ({ name: String(i), guid: a.guid, section: a.section, pts: a.pts, loads: a.loads })),
  };
}

const src: Model = {
  ...emptyModel(),
  columns: [
    { id: g(1), story: 'Story1', x: 0, y: 0, section: 'C400x400', angle: 30 },
    { id: g(2), story: 'Story3', base: 'Story2', x: 6000, y: 0, section: 'C400x400', angle: 0 },
  ],
  beams: [
    {
      id: g(3),
      story: 'Story1',
      x1: 0,
      y1: 0,
      x2: 6000,
      y2: 0,
      section: 'B300x500',
      loads: [
        { pattern: 'SDL', kind: 'dist', force: 'F', dir: 'Gravity', rel: true, d1: 0, d2: 1, v1: 10, v2: 10 },
        { pattern: 'Live', kind: 'point', force: 'M', dir: '2', rel: true, d1: 0.5, d2: 0.5, v1: 4, v2: 4 },
      ],
    },
  ],
  slabs: [{ id: g(4), story: 'Story2', pts: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }], section: 'S150', loads: [{ pattern: 'Live', dir: 'Gravity', value: 2.5 }] }],
};

describe('importElements', () => {
  it('reads pushed elements back as they were, owned by their GUIDs', () => {
    const r = importElements(emptyModel(), asImport(src));
    expect(r.model.columns).toEqual(src.columns);
    expect(r.model.slabs[0]).toEqual(src.slabs[0]);
    const b = r.model.beams[0];
    expect(b.loads!.map((l) => [l.pattern, l.kind, l.force, l.dir, l.v1])).toEqual([['SDL', 'dist', 'F', 'Gravity', 10], ['Live', 'point', 'M', '2', 4]]);
    expect(b.loads![0].v1).toBeCloseTo(10, 9);
    expect(r.model.pushedIds.sort()).toEqual([g(1), g(2), g(3), g(4)]);
    expect(r.skipped).toEqual({});
  });

  it('pushes back the same payload it read', () => {
    const r = importElements(emptyModel(), asImport(src));
    const a = toPayload(src, { updateStories: false, pushGrids: false });
    const b = toPayload(r.model, { updateStories: false, pushGrids: false });
    expect(b.frames.map((f) => f.guid).sort()).toEqual(a.frames.map((f) => f.guid).sort());
    expect(b.deleteGuids).toEqual([]);
    for (const f of a.frames) {
      const h = b.frames.find((x) => x.guid === f.guid)!;
      expect(h.loads.length).toBe(f.loads.length);
      f.loads.forEach((l, i) => expect(h.loads[i].v1).toBeCloseTo(l.v1, 12));
    }
  });

  it('skips what the app already has, braces, walls and loads in unknown patterns; brings beams between levels in with an offset', () => {
    const imp = asImport(src);
    imp.frames.push(
      { name: 'br', guid: g(5), section: 'B300x500', angle: 0, pts: [{ x: 0, y: 0, z: 0 }, { x: 6000, y: 0, z: 3000 }], loads: [] },
      { name: 'mid', guid: g(6), section: 'B300x500', angle: 0, pts: [{ x: 0, y: 0, z: 1500 }, { x: 6000, y: 0, z: 1500 }], loads: [] },
      { name: 'dup', guid: g(7), section: 'B300x500', angle: 0, pts: [{ x: 6000, y: 0, z: 3000 }, { x: 0, y: 0, z: 3000 }], loads: [] },
    );
    imp.areas.push({ name: 'w', guid: g(8), section: 'W200', pts: [{ x: 0, y: 0, z: 0 }, { x: 6000, y: 0, z: 0 }, { x: 6000, y: 0, z: 3000 }, { x: 0, y: 0, z: 3000 }], loads: [] });
    imp.areas[0].loads.push({ pattern: 'Wind', dir: 10, value: 1e-6 });
    const r = importElements(emptyModel(), imp);
    expect(r.skipped).toEqual({ 'braces (the app has none)': 1, 'already in the app': 1, 'walls (the app has none)': 1 });
    expect(r.model.beams.find((b) => b.id === g(6))).toMatchObject({ story: 'Story1', dz: -1500 });
    expect(r.model.slabs[0].loads).toEqual([{ pattern: 'Live', dir: 'Gravity', value: 2.5 }]);
    const again = importElements(r.model, imp);
    expect(again.columns + again.beams + again.slabs).toBe(0);
  });
});

describe('reference planes', () => {
  const m: Model = { ...emptyModel(), refPlanes: [{ id: g(9), name: 'Mezz', z: 4500 }] };

  it('are sent only when replacing them, without their ids', () => {
    expect(toPayload(m, { updateStories: false, pushGrids: false }).refPlanes).toBeNull();
    expect(toPayload(m, { updateStories: false, pushGrids: false, pushRefPlanes: true }).refPlanes).toEqual([{ name: 'Mezz', z: 4500 }]);
  });

  it('are replaced by an import that has some, and kept otherwise', () => {
    const r = { stories: [], grids: [], materials: [], frameSections: [], slabSections: [], patterns: [], baseElevation: 0, warnings: [], frames: [], areas: [] };
    const what = { stories: false, grids: false, sections: false, refPlanes: true };
    const out = applyImport(m, { ...r, refPlanes: [{ name: 'RP1', z: 1500 }] }, what);
    expect(out.refPlanes.map(({ name, z }) => ({ name, z }))).toEqual([{ name: 'RP1', z: 1500 }]);
    expect(applyImport(m, { ...r, refPlanes: [] }, what).refPlanes).toBe(m.refPlanes);
    expect(applyImport(m, { ...r, refPlanes: [{ name: 'RP1', z: 1500 }] }, { ...what, refPlanes: false }).refPlanes).toBe(m.refPlanes);
  });
});

describe('stairs stay out of ETABS', () => {
  it('a model with stair regions pushes the same as one without', () => {
    const p = { ...defaultStairParams() };
    const stairs = [{ id: 'st', name: 'STAIR-01', x1: 0, y1: 0, x2: 3000, y2: 5000, flights: [{ id: 'f', name: 'F1', x: 0, y: 0, dir: '+x' as const, n: 10, T: 300, R: 150, t: 200, width: 1200, z0: 0 }], landings: [], spans: [], params: p }];
    const opts = { updateStories: true, pushGrids: true, pushRefPlanes: true };
    expect(toPayload({ ...src, stairs }, opts)).toEqual(toPayload(src, opts));
  });
  it("a pushed stair load's stair tag is not sent", () => {
    const load = { pattern: 'SDL', kind: 'dist' as const, force: 'F' as const, dir: 'Gravity' as const, rel: false, d1: 500, d2: 2500, v1: 12, v2: 12 };
    const withSrc = { ...src, beams: src.beams.map((b) => ({ ...b, loads: [{ ...load, src: 'st' }] })) };
    const plain = { ...src, beams: src.beams.map((b) => ({ ...b, loads: [load] })) };
    const opts = { updateStories: false, pushGrids: false };
    expect(toPayload(withSrc, opts)).toEqual(toPayload(plain, opts));
  });
});
