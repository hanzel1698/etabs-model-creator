import type { FrameLoad, JointLoad, LoadPattern, Model, Pt, ShellLoad, Vec6 } from './types';
import { uid, withDz } from './types';

const TOL = 1; // mm

/**
 * How an assignment combines with what an element already carries in that pattern, as in ETABS' Assign dialogs:
 * add on top, replace the pattern's loads, or delete them.
 */
export type AssignMode = 'add' | 'replace' | 'delete';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
export const frameLoadKey = (l: FrameLoad) => [l.pattern, l.kind, l.force, l.dir, l.rel, r6(l.d1), r6(l.d2), r6(l.v1), r6(l.v2)].join('|');
export const shellLoadKey = (l: ShellLoad) => [l.pattern, l.dir, r6(l.value)].join('|');
export const jointLoadKey = (l: Pick<JointLoad, 'pattern' | 'f'>) => [l.pattern, ...l.f.map(r6)].join('|');

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

function combine<L extends { pattern: string }>(cur: L[] | undefined, load: L, mode: AssignMode): L[] | undefined {
  const rest = (cur ?? []).filter((l) => mode === 'add' || l.pattern !== load.pattern);
  const out = mode === 'delete' ? rest : [...rest, load];
  return out.length ? out : undefined;
}

const withLoads = <T extends { loads?: unknown[] }>(x: T, loads: T['loads']): T => {
  const { loads: _, ...rest } = x;
  return (loads && loads.length ? { ...rest, loads } : rest) as T;
};

/** Assign a frame load to the columns and beams among `ids`. */
export function assignFrameLoad(m: Model, ids: string[], load: FrameLoad, mode: AssignMode): Model {
  const s = new Set(ids);
  return {
    ...m,
    columns: m.columns.map((c) => (s.has(c.id) ? withLoads(c, combine(c.loads, load, mode)) : c)),
    beams: m.beams.map((b) => (s.has(b.id) ? withLoads(b, combine(b.loads, load, mode)) : b)),
  };
}

/** Assign a shell load to the slabs among `ids`. */
export function assignShellLoad(m: Model, ids: string[], load: ShellLoad, mode: AssignMode): Model {
  const s = new Set(ids);
  return { ...m, slabs: m.slabs.map((sl) => (s.has(sl.id) ? withLoads(sl, combine(sl.loads, load, mode)) : sl)) };
}

const at = (j: JointLoad, story: string, p: Pt, dz = 0) => j.story === story && Math.abs((j.dz ?? 0) - dz) < TOL && Math.abs(j.x - p.x) < TOL && Math.abs(j.y - p.y) < TOL;

/** Assign a joint load at plan points of a story (on each of `stories`), `dz` mm off its level. */
export function assignJointLoad(m: Model, stories: string[], pts: Pt[], load: { pattern: string; f: Vec6 }, mode: AssignMode, dz = 0): Model {
  let jl = m.jointLoads;
  for (const story of stories)
    for (const p of pts) {
      const old = jl.find((j) => at(j, story, p, dz) && j.pattern === load.pattern);
      if (old && mode !== 'add') jl = jl.filter((j) => j !== old);
      if (mode === 'delete') continue;
      if (old && mode === 'add') {
        // added on top of a load in the same pattern by summing, so a joint has one load per pattern (as in ETABS)
        jl = jl.map((j) => (j === old ? { ...j, f: j.f.map((v, i) => v + load.f[i]) as Vec6 } : j));
        continue;
      }
      jl = [...jl, withDz({ id: uid(), story, x: p.x, y: p.y, pattern: load.pattern, f: [...load.f] as Vec6 }, dz)];
    }
  return jl === m.jointLoads ? m : { ...m, jointLoads: jl };
}

export const jointLoadsAt = (m: Model, story: string, p: Pt, dz = 0) => m.jointLoads.filter((j) => at(j, story, p, dz));

/** Remove the load with the given key (see *LoadKey) from the elements in `ids`, and joint loads by id. */
export function removeLoad(m: Model, ids: string[], key: string): Model {
  const s = new Set(ids);
  const fr = <T extends { id: string; loads?: FrameLoad[] }>(x: T) => (s.has(x.id) && x.loads ? withLoads(x, x.loads.filter((l) => frameLoadKey(l) !== key)) : x);
  return {
    ...m,
    columns: m.columns.map(fr),
    beams: m.beams.map(fr),
    slabs: m.slabs.map((x) => (s.has(x.id) && x.loads ? withLoads(x, x.loads.filter((l) => shellLoadKey(l) !== key)) : x)),
    jointLoads: m.jointLoads.filter((j) => !s.has(j.id)),
  };
}

// ---------- patterns ----------

export function addPattern(m: Model, p: LoadPattern): Model {
  if (!p.name.trim() || m.loadPatterns.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) return m;
  return { ...m, loadPatterns: [...m.loadPatterns, p] };
}

export function updatePattern(m: Model, name: string, patch: Partial<Omit<LoadPattern, 'name'>>): Model {
  return { ...m, loadPatterns: m.loadPatterns.map((p) => (p.name === name ? { ...p, ...patch } : p)) };
}

/** Rename a pattern and every load that uses it. A name already taken is refused. */
export function renamePattern(m: Model, from: string, to: string): Model {
  to = to.trim();
  if (!to || from === to || !m.loadPatterns.some((p) => p.name === from)) return m;
  if (m.loadPatterns.some((p) => p.name.toLowerCase() === to.toLowerCase() && p.name !== from)) return m;
  const mv = <L extends { pattern: string }>(l: L): L => (l.pattern === from ? { ...l, pattern: to } : l);
  const el = <T extends { loads?: { pattern: string }[] }>(x: T): T => (x.loads?.some((l) => l.pattern === from) ? { ...x, loads: x.loads.map(mv) } : x);
  return {
    ...m,
    loadPatterns: m.loadPatterns.map((p) => (p.name === from ? { ...p, name: to } : p)),
    columns: m.columns.map(el),
    beams: m.beams.map(el),
    slabs: m.slabs.map(el),
    jointLoads: m.jointLoads.map(mv),
  };
}

/** Delete a pattern and every load in it. */
export function deletePattern(m: Model, name: string): Model {
  const keep = <L extends { pattern: string }>(l: L) => l.pattern !== name;
  const el = <T extends { loads?: { pattern: string }[] }>(x: T): T => (x.loads?.some((l) => !keep(l)) ? withLoads(x, x.loads.filter(keep) as T['loads']) : x);
  return {
    ...m,
    loadPatterns: m.loadPatterns.filter((p) => p.name !== name),
    columns: m.columns.map(el),
    beams: m.beams.map(el),
    slabs: m.slabs.map(el),
    jointLoads: m.jointLoads.filter(keep),
  };
}

/** How many loads (element assignments and joint loads) use a pattern. */
export function patternUse(m: Model, name: string): number {
  const n = (x: { loads?: { pattern: string }[] }) => x.loads?.filter((l) => l.pattern === name).length ?? 0;
  return [...m.columns, ...m.beams, ...m.slabs].reduce((s, x) => s + n(x), 0) + m.jointLoads.filter((j) => j.pattern === name).length;
}

// ---------- carrying loads through edits that replace elements ----------

/**
 * Loads for an element made from several: the shared loads when every piece carries the same set, otherwise none
 * (`mixed` is then true so the caller can warn).
 */
export function mergedLoads<L>(pieces: { loads?: L[] }[], key: (l: L) => string): { loads: L[] | undefined; mixed: boolean } {
  const sets = pieces.map((p) => (p.loads ?? []).map(key));
  if (sets.every((s) => sameSet(s, sets[0]))) return { loads: pieces[0].loads?.length ? pieces[0].loads : undefined, mixed: false };
  return { loads: undefined, mixed: true };
}

/** Joint loads at the old tops of moved columns, carried by (dx,dy) and to their new story and level offset. */
export function moveJointLoads(m: Model, moved: { story: string; dz?: number; from: Pt; to: Pt; toStory: string; toDz?: number }[]): JointLoad[] {
  if (!moved.length || !m.jointLoads.length) return m.jointLoads;
  return m.jointLoads.map((j) => {
    const mv = moved.find((c) => at(j, c.story, c.from, c.dz));
    return mv ? withDz({ ...j, story: mv.toStory, x: mv.to.x, y: mv.to.y }, mv.toDz ?? 0) : j;
  });
}

// ---------- display ----------

const n = (v: number) => String(Math.round(v * 1000) / 1000);
export const DIR_LABEL: Record<string, string> = { Gravity: 'Gravity', X: 'Global X', Y: 'Global Y', Z: 'Global Z', '1': 'Local 1', '2': 'Local 2', '3': 'Local 3', PX: 'Projected X', PY: 'Projected Y', PZ: 'Projected Z', PGravity: 'Projected gravity' };

export function describeFrameLoad(l: FrameLoad): string {
  const u = l.kind === 'dist' ? (l.force === 'F' ? 'kN/m' : 'kN·m/m') : l.force === 'F' ? 'kN' : 'kN·m';
  const d = (v: number) => (l.rel ? n(v) : `${n(v / 1000)} m`);
  if (l.kind === 'point') return `point ${n(l.v1)} ${u} @ ${d(l.d1)} · ${DIR_LABEL[l.dir]}`;
  const full = l.rel && l.d1 === 0 && l.d2 === 1;
  const val = l.v1 === l.v2 ? `${n(l.v1)} ${u}` : `${n(l.v1)}→${n(l.v2)} ${u}`;
  return `${val}${full ? '' : ` from ${d(l.d1)} to ${d(l.d2)}`} · ${DIR_LABEL[l.dir]}`;
}

export const describeShellLoad = (l: ShellLoad) => `${n(l.value)} kN/m² · ${DIR_LABEL[l.dir]}`;

export function describeJointLoad(f: Vec6): string {
  const names = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'];
  const parts = f.map((v, i) => (v ? `${names[i]} ${n(v)}` : '')).filter(Boolean);
  return parts.length ? parts.join(', ') : '0';
}

/** Short label for the plan: the value of a frame/shell load, or the main joint component. */
export function shortFrameLoad(l: FrameLoad): string {
  if (l.kind === 'point') return `P${n(l.v1)}`;
  return l.v1 === l.v2 ? n(l.v1) : `${n(l.v1)}→${n(l.v2)}`;
}
