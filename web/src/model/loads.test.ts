import { describe, expect, it } from 'vitest';
import { addBeams, addColumns, anyFilter, joinBeams, joinColumns, matchElements, mergeSlabs, moveIds, replicate, splitSlabsByBeams } from './ops';
import { checkModel } from './checks';
import { assignFrameLoad, assignJointLoad, assignShellLoad, deletePattern, frameLoadKey, patternUse, removeLoad, renamePattern, shellLoadKey } from './loads';
import { emptyModel, type FrameLoad, type Model, type ShellLoad } from './types';
import { jointKeys, toPayload } from '../etabs/mapping';

const udl = (pattern: string, v: number): FrameLoad => ({ pattern, kind: 'dist', force: 'F', dir: 'Gravity', rel: true, d1: 0, d2: 1, v1: v, v2: v });
const sdl = (v: number): ShellLoad => ({ pattern: 'SDL', dir: 'Gravity', value: v });
const square = (x: number, w: number) => [
  { x, y: 0 },
  { x: x + w, y: 0 },
  { x: x + w, y: 5000 },
  { x, y: 5000 },
];

function frame(): Model {
  let m = addBeams(emptyModel(), [[{ x: 0, y: 0 }, { x: 6000, y: 0 }]], ['Story1'], 'B300x500');
  m = addColumns(m, [{ x: 0, y: 0 }], ['Story1'], 'C400x400', 0);
  return { ...m, slabs: [{ id: 's1', story: 'Story1', pts: square(0, 6000), section: 'S150' }] };
}

describe('assigning loads', () => {
  it('adds, replaces and deletes by pattern', () => {
    let m = frame();
    const b = m.beams[0].id;
    m = assignFrameLoad(m, [b], udl('SDL', 5), 'add');
    m = assignFrameLoad(m, [b], udl('SDL', 3), 'add');
    m = assignFrameLoad(m, [b], udl('Live', 2), 'add');
    expect(m.beams[0].loads!.map((l) => l.v1)).toEqual([5, 3, 2]);
    m = assignFrameLoad(m, [b], udl('SDL', 7), 'replace');
    expect(m.beams[0].loads!.map((l) => `${l.pattern} ${l.v1}`)).toEqual(['Live 2', 'SDL 7']);
    m = assignFrameLoad(m, [b], udl('SDL', 0), 'delete');
    m = assignFrameLoad(m, [b], udl('Live', 0), 'delete');
    expect(m.beams[0].loads).toBeUndefined();
  });

  it('assigns shell loads only to slabs and frame loads only to frames', () => {
    let m = frame();
    const all = [m.beams[0].id, m.columns[0].id, 's1'];
    m = assignShellLoad(m, all, sdl(1.5), 'replace');
    m = assignFrameLoad(m, all, udl('Live', 4), 'add');
    expect(m.slabs[0].loads).toEqual([sdl(1.5)]);
    expect(m.beams[0].loads).toHaveLength(1);
    expect(m.columns[0].loads).toHaveLength(1);
  });

  it('keeps one joint load per pattern, summing on add', () => {
    let m = frame();
    const p = [{ x: 0, y: 0 }];
    m = assignJointLoad(m, ['Story1', 'Story2'], p, { pattern: 'Dead', f: [0, 0, -10, 0, 0, 0] }, 'add');
    m = assignJointLoad(m, ['Story1'], p, { pattern: 'Dead', f: [1, 0, -5, 0, 0, 0] }, 'add');
    expect(m.jointLoads.find((j) => j.story === 'Story1')!.f).toEqual([1, 0, -15, 0, 0, 0]);
    m = assignJointLoad(m, ['Story1'], p, { pattern: 'Dead', f: [0, 0, -1, 0, 0, 0] }, 'replace');
    expect(m.jointLoads.filter((j) => j.story === 'Story1').map((j) => j.f[2])).toEqual([-1]);
    m = assignJointLoad(m, ['Story1', 'Story2'], p, { pattern: 'Dead', f: [0, 0, 0, 0, 0, 0] }, 'delete');
    expect(m.jointLoads).toEqual([]);
  });

  it('removes one load by key', () => {
    let m = frame();
    const b = m.beams[0].id;
    m = assignFrameLoad(m, [b], udl('SDL', 5), 'add');
    m = assignFrameLoad(m, [b], udl('Live', 2), 'add');
    m = removeLoad(m, [b], frameLoadKey(udl('SDL', 5)));
    expect(m.beams[0].loads!.map((l) => l.pattern)).toEqual(['Live']);
  });
});

describe('patterns', () => {
  it('renames and deletes through every load', () => {
    let m = frame();
    m = assignFrameLoad(m, [m.beams[0].id], udl('SDL', 5), 'add');
    m = assignShellLoad(m, ['s1'], sdl(1.5), 'add');
    m = assignJointLoad(m, ['Story1'], [{ x: 0, y: 0 }], { pattern: 'SDL', f: [0, 0, -1, 0, 0, 0] }, 'add');
    expect(patternUse(m, 'SDL')).toBe(3);
    expect(renamePattern(m, 'SDL', 'live')).toBe(m); // name taken (case-insensitive)
    m = renamePattern(m, 'SDL', 'Finishes');
    expect([m.beams[0].loads![0].pattern, m.slabs[0].loads![0].pattern, m.jointLoads[0].pattern]).toEqual(['Finishes', 'Finishes', 'Finishes']);
    m = deletePattern(m, 'Finishes');
    expect(patternUse(m, 'Finishes')).toBe(0);
    expect(m.beams[0].loads).toBeUndefined();
    expect(m.loadPatterns.map((p) => p.name)).toEqual(['Dead', 'Live']);
  });
});

describe('loads follow edits', () => {
  it('split slabs keep their loads on every panel', () => {
    let m: Model = { ...emptyModel(), slabs: [{ id: 's1', story: 'Story1', pts: square(0, 6000), section: 'S150', loads: [sdl(2)] }] };
    m = addBeams(m, [[{ x: 3000, y: 0 }, { x: 3000, y: 5000 }]], ['Story1'], 'B300x500');
    const r = splitSlabsByBeams(m, ['s1']);
    expect(r.model.slabs).toHaveLength(2);
    expect(r.model.slabs.every((s) => s.loads?.[0].value === 2)).toBe(true);
  });

  it('merged slabs keep shared loads and drop different ones', () => {
    const a = { id: 'a', story: 'Story1', pts: square(0, 3000), section: 'S150', loads: [sdl(2)] };
    const b = { id: 'b', story: 'Story1', pts: square(3000, 3000), section: 'S150', loads: [sdl(2)] };
    const same = mergeSlabs({ ...emptyModel(), slabs: [a, b] }, ['a', 'b']);
    expect(same.mixedLoads).toBe(0);
    expect(same.model.slabs[0].loads).toEqual([sdl(2)]);
    const diff = mergeSlabs({ ...emptyModel(), slabs: [a, { ...b, loads: [sdl(3)] }] }, ['a', 'b']);
    expect(diff.mixedLoads).toBe(1);
    expect(diff.model.slabs[0].loads).toBeUndefined();
  });

  it('joined beams keep uniform full-length loads only', () => {
    let m = addBeams(emptyModel(), [[{ x: 0, y: 0 }, { x: 3000, y: 0 }], [{ x: 3000, y: 0 }, { x: 6000, y: 0 }]], ['Story1'], 'B300x500');
    const ids = m.beams.map((b) => b.id);
    m = assignFrameLoad(m, ids, udl('SDL', 5), 'add');
    const ok = joinBeams(m, ids);
    expect(ok.mixedLoads).toBe(0);
    expect(ok.model.beams[0].loads).toEqual([udl('SDL', 5)]);
    const point: FrameLoad = { ...udl('SDL', 10), kind: 'point', d1: 0.5 };
    const bad = joinBeams(assignFrameLoad(m, ids, point, 'add'), ids);
    expect(bad.mixedLoads).toBe(1);
    expect(bad.model.beams[0].loads).toBeUndefined();
  });

  it('joined columns keep identical loads', () => {
    let m = addColumns(emptyModel(), [{ x: 0, y: 0 }], ['Story1', 'Story2'], 'C400x400', 0);
    m = assignFrameLoad(m, m.columns.map((c) => c.id), udl('Wind', 1), 'add');
    const r = joinColumns(m, m.columns.map((c) => c.id));
    expect(r.model.columns[0].loads).toEqual([udl('Wind', 1)]);
  });

  it('replicated elements carry loads, and joint loads ride on columns', () => {
    let m = frame();
    m = assignFrameLoad(m, [m.beams[0].id, m.columns[0].id], udl('SDL', 5), 'add');
    m = assignShellLoad(m, ['s1'], sdl(1), 'add');
    m = assignJointLoad(m, ['Story1'], [{ x: 0, y: 0 }], { pattern: 'Dead', f: [0, 0, -50, 0, 0, 0] }, 'add');
    const all = [m.beams[0].id, m.columns[0].id, 's1'];
    const r = replicate(m, all, { dx: 0, dy: 0, n: 1, stories: ['Story2'] });
    const up = r.model;
    expect(up.beams.find((b) => b.story === 'Story2')!.loads).toEqual([udl('SDL', 5)]);
    expect(up.columns.find((c) => c.story === 'Story2')!.loads).toEqual([udl('SDL', 5)]);
    expect(up.slabs.find((s) => s.story === 'Story2')!.loads).toEqual([sdl(1)]);
    expect(up.jointLoads.map((j) => j.story).sort()).toEqual(['Story1', 'Story2']);
    const moved = moveIds(m, [m.columns[0].id], 1000, 0);
    expect([moved.jointLoads[0].x, moved.jointLoads[0].y]).toEqual([1000, 0]);
  });
});

describe('load payload', () => {
  it('converts to ETABS kN-mm and direction codes', () => {
    let m = frame();
    m = assignFrameLoad(m, [m.beams[0].id], udl('SDL', 10), 'add');
    m = assignFrameLoad(m, [m.beams[0].id], { pattern: 'Live', kind: 'point', force: 'M', dir: '2', rel: false, d1: 1500, d2: 0, v1: 4, v2: 0 }, 'add');
    m = assignShellLoad(m, ['s1'], sdl(1.5), 'add');
    m = assignJointLoad(m, ['Story2'], [{ x: 0, y: 0 }], { pattern: 'Dead', f: [0, 0, -50, 2, 0, 0] }, 'add');
    const p = toPayload(m, { updateStories: false, pushGrids: false });
    const beam = p.frames.find((f) => f.kind === 'beam')!;
    expect(beam.loads[0]).toMatchObject({ pattern: 'SDL', type: 1, dir: 10, rel: true, d1: 0, d2: 1 });
    expect(beam.loads[0].v1).toBeCloseTo(0.01);
    expect(beam.loads[1]).toMatchObject({ kind: 'point', type: 2, dir: 2, rel: false, d1: 1500, v1: 4000 });
    expect(p.areas[0].loads[0].dir).toBe(10);
    expect(p.areas[0].loads[0].value).toBeCloseTo(1.5e-6);
    expect(p.jointLoads).toEqual([{ x: 0, y: 0, z: 6000, pattern: 'Dead', f: [0, 0, -50, 2000, 0, 0] }]);
    expect(p.patterns.map((x) => `${x.name}:${x.type}:${x.selfWeight}`)).toEqual(['Dead:1:1', 'SDL:2:0', 'Live:3:0']);
  });

  it('clears joints loaded at the last push and not now, and can leave loads out', () => {
    let m = assignJointLoad(frame(), ['Story1'], [{ x: 0, y: 0 }], { pattern: 'Dead', f: [0, 0, -1, 0, 0, 0] }, 'add');
    m = { ...m, pushedJointKeys: [...jointKeys(m), 'Story2|6000|0'] };
    expect(toPayload(m, { updateStories: false, pushGrids: false }).clearJoints).toEqual([{ x: 6000, y: 0, z: 6000 }]);
    const off = toPayload(m, { updateStories: false, pushGrids: false, loads: false });
    expect([off.loads, off.jointLoads.length, off.clearJoints.length, off.frames[0].loads.length]).toEqual([false, 0, 0, 0]);
  });

  it('keys shell loads by value', () => {
    expect(shellLoadKey(sdl(1))).not.toBe(shellLoadKey(sdl(2)));
  });
});

describe('finding loads', () => {
  it('selects by load pattern', () => {
    let m = frame();
    m = assignFrameLoad(m, [m.beams[0].id], udl('SDL', 5), 'add');
    const f = { ...anyFilter(), stories: null };
    expect(matchElements(m, { ...f, load: 'SDL' })).toEqual([m.beams[0].id]);
    expect(matchElements(m, { ...f, load: '-' }).sort()).toEqual([m.columns[0].id, 's1'].sort());
  });

  it('flags joint loads on no joint and loads in missing patterns', () => {
    let m = assignJointLoad(frame(), ['Story1'], [{ x: 3000, y: 2500 }], { pattern: 'Dead', f: [0, 0, -1, 0, 0, 0] }, 'add');
    m = assignFrameLoad(m, [m.beams[0].id], udl('Ghost', 1), 'add');
    const loads = checkModel(m).filter((i) => i.kind === 'load').map((i) => i.text);
    expect(loads).toHaveLength(2);
    expect(loads.some((t) => t.includes('sits on no column'))).toBe(true);
    expect(loads.some((t) => t.includes('“Ghost” is not defined'))).toBe(true);
  });
});
