// One EMC story → the Bathroom Section Designer engine's PlanModel, so its section cut and catch checks run on the plan already drawn here.
import { columnOn, type Model, type SectionCut } from '../model/types';
import { facesForModel } from './engine/faces';
import { pointInPolygon } from './engine/planGeom';
import type { Beam as PBeam, Column as PColumn, ColumnType, GridLine, PanelAssignment, PlanModel, Pt, SectionLine, SlabType, UpstandType } from './engine/types';

const TOL = 1;

/** Distinct values (within TOL), ascending. */
function distinct(vs: number[]): number[] {
  const out: number[] = [];
  for (const v of [...vs].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
  return out;
}

export interface StoryPlan {
  plan: PlanModel;
  /** EMC plan coordinates − origin = engine coordinates (the engine's first grid line sits at 0). */
  origin: Pt;
}

export function toPlanModel(m: Model, story: string): StoryPlan {
  const fs = new Map(m.frameSections.map((s) => [s.name, s]));
  const ss = new Map(m.slabSections.map((s) => [s.name, s]));
  const cols = m.columns.filter((c) => columnOn(m, c, story));
  const beams = m.beams.filter((b) => b.story === story);
  const slabs = m.slabs.filter((s) => s.story === story);

  // the engine puts columns on grid intersections only, so the grid is built from the column positions
  const xs = distinct(cols.map((c) => c.x));
  const ys = distinct(cols.map((c) => c.y));
  const origin = { x: xs[0] ?? 0, y: ys[0] ?? 0 };
  const label = (dir: 'X' | 'Y', v: number) => m.grids.find((g) => g.dir === dir && Math.abs((dir === 'X' ? g.x1 : g.y1) - v) <= TOL)?.label ?? '';
  const lines = (vs: number[], ax: 'x' | 'y'): GridLine[] => vs.map((v, i) => ({ id: `${ax}${i}`, label: label(ax === 'x' ? 'X' : 'Y', v), spacingFromPrev: i ? v - vs[i - 1] : 0 }));
  const lineAt = (vs: number[], v: number, ax: string) => `${ax}${vs.findIndex((w) => Math.abs(w - v) <= TOL)}`;

  const columnTypes: ColumnType[] = [];
  const columns: PColumn[] = cols.map((c) => {
    const s = fs.get(c.section);
    const d = s?.t3 || 400,
      w = s?.shape === 'Circle' ? d : s?.t2 || 400;
    // EMC: t3 runs along local 2, which is global X at angle 0
    // shortcut: only 0/90° columns; a skewed column is drawn unrotated. Upgrade if skewed framing appears.
    const rotated = Math.abs(Math.cos((c.angle * Math.PI) / 180)) < 0.5;
    let t = columnTypes.find((x) => x.width === d && x.depth === w);
    if (!t) columnTypes.push((t = { id: `ct${columnTypes.length}`, label: c.section, width: d, depth: w }));
    return { id: c.id, typeId: t.id, gx: lineAt(xs, c.x, 'x'), gy: lineAt(ys, c.y, 'y'), rotated };
  });

  const beamTypes: PlanModel['beamTypes'] = [];
  const onCol = (x: number, y: number) => cols.some((c) => Math.hypot(c.x - x, c.y - y) <= TOL);
  const pBeams: PBeam[] = beams.map((b) => {
    const s = fs.get(b.section);
    const w = s?.t2 || 230,
      d = s?.t3 || 450;
    let t = beamTypes.find((x) => x.width === w && x.depth === d);
    if (!t) beamTypes.push((t = { id: `bt${beamTypes.length}`, label: b.section, width: w, depth: d }));
    return {
      id: b.id,
      typeId: t.id,
      start: { kind: 'point', x: b.x1 - origin.x, y: b.y1 - origin.y },
      end: { kind: 'point', x: b.x2 - origin.x, y: b.y2 - origin.y },
      kind: onCol(b.x1, b.y1) && onCol(b.x2, b.y2) ? 'primary' : 'secondary',
      topLevel: b.sink || undefined,
    };
  });

  const ids = new Set(beams.map((b) => b.id));
  const ups = (m.upstands ?? []).filter((u) => ids.has(u.beamId));
  const upstandTypes: UpstandType[] = distinct(ups.map((u) => u.depth)).map((d, i) => ({ id: `ut${i}`, label: `U${i + 1}`, depth: d }));
  const upstands = ups.map((u) => ({ id: u.id, beamId: u.beamId, t0: u.t0, t1: u.t1, typeId: upstandTypes.find((t) => Math.abs(t.depth - u.depth) <= TOL)!.id }));

  const plan: PlanModel = {
    grid: { x: lines(xs, 'x'), y: lines(ys, 'y') },
    columnTypes,
    columns,
    beamTypes,
    beams: pBeams,
    upstandTypes,
    upstands,
    slabTypes: [],
    panelAssignments: [],
    sectionLines: [],
    defaultSlabTypeId: '',
  };

  // panels come from the beam network; each takes the EMC slab its centroid falls in, or is an opening if none
  const local = slabs.map((s) => ({ s, poly: s.pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y })) }));
  const slabTypes: SlabType[] = [];
  const panelAssignments: PanelAssignment[] = facesForModel(plan).map((f, i) => {
    const hit = local.find(({ poly }) => pointInPolygon(f.centroid, poly))?.s;
    let typeId: string | null = null;
    if (hit && !hit.duct) {
      const th = ss.get(hit.section)?.thickness || 125,
        sink = hit.sink ?? 0;
      let t = slabTypes.find((x) => x.thickness === th && x.sink === sink);
      if (!t) slabTypes.push((t = { id: `st${slabTypes.length}`, label: hit.section + (sink ? ` ↓${sink}` : ''), thickness: th, sink }));
      typeId = t.id;
    }
    return { id: `pa${i}`, seed: f.centroid, slabTypeId: typeId };
  });
  return { plan: { ...plan, slabTypes, panelAssignments }, origin };
}

/** The engine's section line for an EMC section cut, in engine coordinates. */
export const toSectionLine = (c: SectionCut, origin: Pt): SectionLine => ({
  id: c.id,
  label: c.label,
  a: { x: c.a.x - origin.x, y: c.a.y - origin.y },
  b: { x: c.b.x - origin.x, y: c.b.y - origin.y },
  reversed: c.reversed,
});
