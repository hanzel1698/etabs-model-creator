import type { FrameLoad, LoadDir, Model, PatternType, ShellLoad } from '../model/types';
import { columnSpan, storyElevations } from '../model/types';
import type { AreaLoadOut, FrameLoadOut, ImportResult, JointLoadOut, PushPayload, Supports } from './bridgeClient';
import { uid } from '../model/types';

/**
 * App model → ETABS push payload (all lengths mm, ETABS units set to kN-mm-C by the bridge).
 * A column on story S spans from the elevation of the story below S up to S (a joined column from below its base story).
 */
export function toPayload(m: Model, opts: { updateStories: boolean; pushGrids: boolean; supports?: Supports; loads?: boolean }): PushPayload {
  const el = storyElevations(m);
  const pushLoads = opts.loads ?? true;
  const fl = (ls?: FrameLoad[]) => (pushLoads && ls ? ls.map(frameLoadOut) : []);
  const frames: PushPayload['frames'] = [];
  for (const c of m.columns) {
    const e = columnSpan(el, c);
    if (!e) continue;
    frames.push({ guid: c.id, kind: 'column', x1: c.x, y1: c.y, z1: e.bottom, x2: c.x, y2: c.y, z2: e.top, section: c.section, angle: c.angle, story: c.story, loads: fl(c.loads) });
  }
  for (const b of m.beams) {
    const e = el[b.story];
    if (!e) continue;
    frames.push({ guid: b.id, kind: 'beam', x1: b.x1, y1: b.y1, z1: e.top, x2: b.x2, y2: b.y2, z2: e.top, section: b.section, angle: 0, story: b.story, loads: fl(b.loads) });
  }
  const areas: PushPayload['areas'] = [];
  for (const s of m.slabs) {
    const e = el[s.story];
    if (!e) continue;
    areas.push({ guid: s.id, pts: s.pts.map((p) => ({ x: p.x, y: p.y, z: e.top })), section: s.section, story: s.story, loads: pushLoads && s.loads ? s.loads.map(areaLoadOut) : [] });
  }
  const jointLoads: JointLoadOut[] = [];
  for (const j of pushLoads ? m.jointLoads : []) {
    const e = el[j.story];
    if (e) jointLoads.push({ x: j.x, y: j.y, z: e.top, pattern: j.pattern, f: [j.f[0], j.f[1], j.f[2], j.f[3] * 1e3, j.f[4] * 1e3, j.f[5] * 1e3] });
  }
  const loaded = new Set(jointKeys(m));
  const clearJoints = (pushLoads ? m.pushedJointKeys : []).flatMap((k) => {
    const [story, x, y] = k.split('|');
    return loaded.has(k) || !el[story] ? [] : [{ x: +x, y: +y, z: el[story].top }];
  });
  const live = new Set([...frames.map((f) => f.guid), ...areas.map((a) => a.guid)]);
  return {
    baseElevation: m.baseElevation,
    stories: m.stories,
    updateStories: opts.updateStories,
    grids: opts.pushGrids ? m.grids.map(({ id, ...g }) => g) : null,
    frameSections: m.frameSections.filter((s) => !s.fromEtabs),
    slabSections: m.slabSections.filter((s) => !s.fromEtabs),
    frames,
    areas,
    deleteGuids: m.pushedIds.filter((g) => !live.has(g)),
    supports: opts.supports ?? 'none',
    loads: pushLoads,
    patterns: pushLoads ? m.loadPatterns.filter((p) => !p.fromEtabs).map((p) => ({ name: p.name, type: PATTERN_CODE[p.type], selfWeight: p.selfWeight })) : [],
    loadPatterns: m.loadPatterns.map((p) => p.name),
    jointLoads,
    clearJoints,
  };
}

/** ETABS eLoadPatternType codes. */
export const PATTERN_CODE: Record<PatternType, number> = { Dead: 1, SuperDead: 2, Live: 3, ReduceLive: 4, Quake: 5, Wind: 6, Snow: 7, Other: 8, Rooflive: 11, Notional: 12 };
/** ETABS load direction codes (Gravity: a positive value acts down). */
export const DIR_CODE: Record<LoadDir, number> = { '1': 1, '2': 2, '3': 3, X: 4, Y: 5, Z: 6, PX: 7, PY: 8, PZ: 9, Gravity: 10, PGravity: 11 };

/** App frame load (kN, m) → ETABS kN-mm: kN/m → kN/mm, kN·m → kN·mm; kN·m/m is the same in both. */
export function frameLoadOut(l: FrameLoad): FrameLoadOut {
  const k = l.kind === 'dist' ? (l.force === 'F' ? 1e-3 : 1) : l.force === 'F' ? 1 : 1e3;
  return { pattern: l.pattern, kind: l.kind, type: l.force === 'F' ? 1 : 2, dir: DIR_CODE[l.dir], rel: l.rel, d1: l.d1, d2: l.kind === 'dist' ? l.d2 : l.d1, v1: l.v1 * k, v2: (l.kind === 'dist' ? l.v2 : l.v1) * k };
}

/** App shell load (kN/m²) → kN/mm². */
export const areaLoadOut = (l: ShellLoad): AreaLoadOut => ({ pattern: l.pattern, dir: DIR_CODE[l.dir], value: l.value * 1e-6 });

/** `story|x|y` (mm, rounded) of every joint that carries a joint load. */
export const jointKeys = (m: Model) => [...new Set(m.jointLoads.map((j) => `${j.story}|${Math.round(j.x)}|${Math.round(j.y)}`))];

/** Merge ETABS import into the model. Existing elements are kept; sections/materials/stories/grids are replaced as chosen. */
export function applyImport(m: Model, r: ImportResult, what: { stories: boolean; grids: boolean; sections: boolean; patterns?: boolean }): Model {
  let out = { ...m };
  if (what.patterns && r.patterns?.length) {
    // ETABS patterns come in as imported; the app's own keep their settings (they are pushed over ETABS')
    const mine = new Set(m.loadPatterns.map((p) => p.name.toLowerCase()));
    out = { ...out, loadPatterns: [...m.loadPatterns, ...r.patterns.filter((p) => !mine.has(p.name.toLowerCase())).map((p) => ({ ...p, fromEtabs: true }))] };
  }
  if (what.sections) {
    const appOnlyF = m.frameSections.filter((s) => !s.fromEtabs && !r.frameSections.some((x) => x.name === s.name));
    const appOnlyS = m.slabSections.filter((s) => !s.fromEtabs && !r.slabSections.some((x) => x.name === s.name));
    out = { ...out, materials: r.materials, frameSections: [...r.frameSections, ...appOnlyF], slabSections: [...r.slabSections, ...appOnlyS] };
  }
  if (what.stories && r.stories.length) {
    out = { ...out, stories: r.stories, baseElevation: r.baseElevation };
  }
  if (what.grids && r.grids.length) {
    out = { ...out, grids: r.grids.map((g) => ({ ...g, id: uid() })) };
  }
  return out;
}
