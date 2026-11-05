import type { Beam, FrameLoad, LoadPattern, Model, StairModel, StairRegion } from '../model/types';
import { beamFlipped, beamLoads, beamName } from './stair';

/** One stretch of beam a stair span bears on: its DL and LL (kN/m, override or calculated) over d1–d2 mm from the beam's (x1, y1). */
export interface PushRow {
  key: string;
  beam: Beam;
  name: string;
  span: string;
  d1: number;
  d2: number;
  dl: number;
  ll: number;
  calc: { dl: number; ll: number };
}

/** Rows of the stair's design model (beams whole), with the region's overrides applied. */
export function stairLoadRows(m: StairModel, ov: StairRegion['overrides'] = {}): PushRow[] {
  const rows: PushRow[] = [];
  for (const [b, rs] of beamLoads(m).out) {
    const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1),
      f = beamFlipped(b);
    for (const r of rs) {
      const key = `${b.id}|${r.sp.id}|${r.e}`,
        o = ov[key] ?? {};
      // engine rows run from the beam's left (bottom) end; frame loads from (x1, y1)
      rows.push({ key, beam: b, name: beamName(m, b), span: r.sp.name, d1: f ? L - r.b : r.a, d2: f ? L - r.a : r.b, dl: o.dl ?? r.dl, ll: o.ll ?? r.ll, calc: { dl: r.dl, ll: r.ll } });
    }
  }
  return rows;
}

/** Replaces every load a stair pushed before (matched by `src`) with these rows, on the given patterns; other loads stay. */
export function applyStairLoads<M extends Model>(m: M, stairId: string, rows: (Pick<PushRow, 'beam' | 'd1' | 'd2' | 'dl' | 'll'> & { calc?: PushRow['calc'] })[], dlPattern: string, llPattern: string): M {
  const add = new Map<string, FrameLoad[]>();
  const load = (pattern: string, r: (typeof rows)[number], k: 'dl' | 'll'): FrameLoad => ({ pattern, kind: 'dist', force: 'F', dir: 'Gravity', rel: false, d1: r.d1, d2: r.d2, v1: r[k], v2: r[k], src: stairId, ...(r.calc && Math.abs(r[k] - r.calc[k]) > 1e-6 ? { set: true as const } : {}) });
  for (const r of rows) {
    const ls = [...(r.dl ? [load(dlPattern, r, 'dl')] : []), ...(r.ll ? [load(llPattern, r, 'll')] : [])];
    if (ls.length) add.set(r.beam.id, [...(add.get(r.beam.id) ?? []), ...ls]);
  }
  let changed = false;
  const beams = m.beams.map((b) => {
    const old = b.loads ?? [],
      keep = old.filter((l) => l.src !== stairId),
      extra = add.get(b.id) ?? [];
    if (keep.length === old.length && !extra.length) return b;
    changed = true;
    const loads = [...keep, ...extra];
    return { ...b, loads: loads.length ? loads : undefined };
  });
  return changed ? { ...m, beams } : m;
}

/** Whether any beam carries loads this stair pushed. */
export const hasStairLoads = (m: Model, stairId: string) => m.beams.some((b) => b.loads?.some((l) => l.src === stairId));

/** Pattern a push defaults to: the one remembered on the stair, else one named "Stair Dead/Live", else the first of the type. */
export function defaultPattern(ps: LoadPattern[], kind: 'dl' | 'll', remembered?: string) {
  if (remembered && ps.some((p) => p.name === remembered)) return remembered;
  const re = kind === 'dl' ? /stair.*dead/i : /stair.*live/i,
    types = kind === 'dl' ? ['SuperDead', 'Dead'] : ['Live', 'ReduceLive'];
  return (ps.find((p) => re.test(p.name)) ?? types.map((t) => ps.find((p) => p.type === t)).find(Boolean) ?? ps[0])?.name ?? '';
}
