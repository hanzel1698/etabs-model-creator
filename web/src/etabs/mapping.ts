import type { Model } from '../model/types';
import { storyElevations } from '../model/types';
import type { ImportResult, PushPayload, Supports } from './bridgeClient';
import { uid } from '../model/types';

/**
 * App model → ETABS push payload (all lengths mm, ETABS units set to kN-mm-C by the bridge).
 * A column on story S spans from the elevation of the story below S up to S.
 */
export function toPayload(m: Model, opts: { updateStories: boolean; pushGrids: boolean; supports?: Supports }): PushPayload {
  const el = storyElevations(m);
  const frames: PushPayload['frames'] = [];
  for (const c of m.columns) {
    const e = el[c.story];
    if (!e) continue;
    frames.push({ guid: c.id, kind: 'column', x1: c.x, y1: c.y, z1: e.bottom, x2: c.x, y2: c.y, z2: e.top, section: c.section, angle: c.angle, story: c.story });
  }
  for (const b of m.beams) {
    const e = el[b.story];
    if (!e) continue;
    frames.push({ guid: b.id, kind: 'beam', x1: b.x1, y1: b.y1, z1: e.top, x2: b.x2, y2: b.y2, z2: e.top, section: b.section, angle: 0, story: b.story });
  }
  const areas: PushPayload['areas'] = [];
  for (const s of m.slabs) {
    const e = el[s.story];
    if (!e) continue;
    areas.push({ guid: s.id, pts: s.pts.map((p) => ({ x: p.x, y: p.y, z: e.top })), section: s.section, story: s.story });
  }
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
  };
}

/** Merge ETABS import into the model. Existing elements are kept; sections/materials/stories/grids are replaced as chosen. */
export function applyImport(m: Model, r: ImportResult, what: { stories: boolean; grids: boolean; sections: boolean }): Model {
  let out = { ...m };
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
