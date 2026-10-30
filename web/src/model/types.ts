// All lengths are millimetres. Plan axes: X right, Y up (same as ETABS global).

export type Pt = { x: number; y: number };

export interface Story {
  name: string;
  height: number; // height of this story (from the story below up to this one)
  isMaster: boolean;
  similarTo: string; // '' or name of master story
}

export interface Grid {
  id: string;
  label: string;
  dir: 'X' | 'Y' | 'G'; // X grid = line of constant x; Y grid = constant y; G = general
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bubble: 'start' | 'end' | 'both';
}

/** Horizontal reference plane at elevation `z` (ETABS Grid Definitions - Reference Planes); used to draw between story levels in ETABS. */
export interface RefPlane {
  id: string;
  name: string;
  z: number;
}

export interface Column {
  id: string; // also the GUID written to ETABS
  story: string; // spans from story below to this story
  /** lowest story of a joined column that spans several stories (from below `base` up to `story`); absent = `story` */
  base?: string;
  /** top sits `dz` mm off its story's level (on a reference plane); the bottom stays on the level below. Absent = 0 */
  dz?: number;
  x: number;
  y: number;
  section: string;
  angle: number; // degrees, local-2 axis from global X
  loads?: FrameLoad[];
}

export interface Beam {
  id: string;
  story: string;
  dz?: number; // mm off the story level (on a reference plane); absent = 0
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  section: string;
  loads?: FrameLoad[];
}

export interface Slab {
  id: string;
  story: string;
  dz?: number; // mm off the story level (on a reference plane); absent = 0
  pts: Pt[];
  section: string;
  loads?: ShellLoad[];
}

// ---------- loads (values in kN, kN/m, kN/m², kN·m; absolute distances in mm) ----------

export const PATTERN_TYPES = ['Dead', 'SuperDead', 'Live', 'ReduceLive', 'Rooflive', 'Snow', 'Wind', 'Quake', 'Notional', 'Other'] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

export interface LoadPattern {
  name: string;
  type: PatternType;
  selfWeight: number; // self-weight multiplier
  fromEtabs?: boolean;
}

/** Gravity acts down (positive value = downward); X/Y/Z global; 1/2/3 local axes; P* projected. */
export const LOAD_DIRS = ['Gravity', 'X', 'Y', 'Z', '1', '2', '3', 'PX', 'PY', 'PZ', 'PGravity'] as const;
export type LoadDir = (typeof LOAD_DIRS)[number];

export interface FrameLoad {
  pattern: string;
  kind: 'dist' | 'point';
  force: 'F' | 'M'; // force or moment
  dir: LoadDir;
  rel: boolean; // distances relative (0–1) or absolute (mm from the start)
  d1: number;
  d2: number; // dist only
  v1: number; // kN/m (dist) or kN (point); moments kN·m/m or kN·m
  v2: number; // dist only: value at d2
}

export interface ShellLoad {
  pattern: string;
  dir: LoadDir;
  value: number; // kN/m², uniform on the shell (ETABS spreads it to beams through the slab's modelling, not the load)
}

export type Vec6 = [number, number, number, number, number, number];

/** Force at a plan node of a story (joints are derived from columns, beams and grids, not stored). */
export interface JointLoad {
  id: string;
  story: string;
  dz?: number; // mm off the story level, for a joint at the top of an offset column; absent = 0
  x: number;
  y: number;
  pattern: string;
  f: Vec6; // Fx, Fy, Fz (kN), Mx, My, Mz (kN·m), global
}

export type FrameShape = 'Rectangle' | 'Circle' | 'Other';

export interface FrameSection {
  name: string;
  shape: FrameShape;
  t3: number; // depth (rect) / diameter (circle)
  t2: number; // width
  material: string;
  fromEtabs: boolean;
}

export interface SlabSection {
  name: string;
  thickness: number;
  material: string;
  fromEtabs: boolean;
}

export interface Material {
  name: string;
  type: string;
}

export interface Model {
  baseElevation: number;
  stories: Story[]; // bottom → top
  grids: Grid[];
  refPlanes: RefPlane[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  frameSections: FrameSection[];
  slabSections: SlabSection[];
  materials: Material[];
  pushedIds: string[]; // ids that exist in ETABS from previous pushes (for delete sync)
  loadPatterns: LoadPattern[];
  jointLoads: JointLoad[];
  /** `story|x|y` of joints that carried app loads at the last push (so removed joint loads are cleared in ETABS) */
  pushedJointKeys: string[];
  /** inputs the bottom story (footing top → ground floor level) was computed from (height = foundingDepth - footingThickness + plinthHeight) */
  foundation?: { foundingDepth: number; footingThickness: number; plinthHeight: number };
}

export type ElementKind = 'column' | 'beam' | 'slab' | 'grid';
export type ElRef = { kind: ElementKind; id: string };

export const emptyModel = (): Model => ({
  baseElevation: 0,
  stories: [
    { name: 'Story1', height: 3000, isMaster: true, similarTo: '' },
    { name: 'Story2', height: 3000, isMaster: false, similarTo: 'Story1' },
    { name: 'Story3', height: 3000, isMaster: false, similarTo: 'Story1' },
  ],
  grids: [],
  refPlanes: [],
  columns: [],
  beams: [],
  slabs: [],
  frameSections: [
    { name: 'C400x400', shape: 'Rectangle', t3: 400, t2: 400, material: '4000Psi', fromEtabs: false },
    { name: 'B300x500', shape: 'Rectangle', t3: 500, t2: 300, material: '4000Psi', fromEtabs: false },
  ],
  slabSections: [{ name: 'S150', thickness: 150, material: '4000Psi', fromEtabs: false }],
  materials: [{ name: '4000Psi', type: 'Concrete' }],
  pushedIds: [],
  loadPatterns: defaultPatterns(),
  jointLoads: [],
  pushedJointKeys: [],
});

export const defaultPatterns = (): LoadPattern[] => [
  { name: 'Dead', type: 'Dead', selfWeight: 1 },
  { name: 'SDL', type: 'SuperDead', selfWeight: 0 },
  { name: 'Live', type: 'Live', selfWeight: 0 },
];

// Ids double as ETABS GUIDs, so they must be RFC-4122 shaped (randomUUID is missing on plain-http origins).
export const uid = (): string =>
  (crypto as any).randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

export function storyElevations(m: Model): Record<string, { bottom: number; top: number; index: number }> {
  const out: Record<string, { bottom: number; top: number; index: number }> = {};
  let z = m.baseElevation;
  m.stories.forEach((s, i) => {
    out[s.name] = { bottom: z, top: z + s.height, index: i };
    z += s.height;
  });
  return out;
}

/** Stories a column passes through, bottom → top (one story unless it was joined). */
export function columnStories(m: Model, c: Column): string[] {
  if (!c.base || c.base === c.story) return [c.story];
  const names = m.stories.map((s) => s.name);
  const lo = names.indexOf(c.base),
    hi = names.indexOf(c.story);
  return lo < 0 || hi < lo ? [c.story] : names.slice(lo, hi + 1);
}

/** The column stands on `story` (a joined column stands on every story it spans). */
export const columnOn = (m: Model, c: Column, story: string): boolean => c.story === story || (!!c.base && columnStories(m, c).includes(story));

/** Bottom and top elevation of a column, or null if its story is missing. */
export function columnSpan(el: ReturnType<typeof storyElevations>, c: Column): { bottom: number; top: number } | null {
  const top = el[c.story];
  if (!top) return null;
  const bot = c.base && el[c.base] && el[c.base].index <= top.index ? el[c.base] : top;
  return { bottom: bot.bottom, top: top.top + (c.dz ?? 0) };
}

/** The column runs up to or through the level of `x` (a beam or slab, on its story level or a reference plane). */
export function columnReaches(m: Model, c: Column, x: { story: string; dz?: number }): boolean {
  const el = storyElevations(m);
  const span = columnSpan(el, c),
    z = levelZ(el, x);
  return !!span && z !== null && z > span.bottom + LEVEL_TOL && z <= span.top + LEVEL_TOL;
}

/** Elevation of a beam, slab or joint load (its story level plus its offset), or null if its story is missing. */
export const levelZ = (el: ReturnType<typeof storyElevations>, x: { story: string; dz?: number }): number | null => (el[x.story] ? el[x.story].top + (x.dz ?? 0) : null);

/**
 * Story and offset for something at elevation `z`: the story whose level it is (offset 0), else the story it lies in,
 * as ETABS assigns it (above the level below, up to this level), with a negative offset. Below the first story's level
 * it is the first story; above the top story, the top story with a positive offset. Null with no stories.
 */
export function placeAt(m: Pick<Model, 'baseElevation' | 'stories'>, z: number): { story: string; dz: number } | null {
  let top = m.baseElevation;
  for (const s of m.stories) {
    top += s.height;
    if (z <= top + LEVEL_TOL) return { story: s.name, dz: Math.abs(z - top) <= LEVEL_TOL ? 0 : z - top };
  }
  const last = m.stories[m.stories.length - 1];
  return last ? { story: last.name, dz: z - top } : null;
}

/**
 * Where an element off its story level sits, for labels: the reference plane at that elevation, else its offset
 * ("−1500"). Empty for an element on its story level.
 */
export function levelTag(m: Model, x: { story: string; dz?: number }): string {
  if (!x.dz) return '';
  const z = levelZ(storyElevations(m), x);
  const rp = z === null ? undefined : m.refPlanes.find((r) => Math.abs(r.z - z) <= LEVEL_TOL);
  return rp ? rp.name : `${x.dz > 0 ? '+' : '−'}${Math.round(Math.abs(x.dz))}`;
}

/** Elevations closer than this (mm) are the same level. */
export const LEVEL_TOL = 1;

/** `x` with offset `dz`; an offset of 0 is left out, so on-level elements keep their usual shape. */
export function withDz<T extends object>(x: T, dz: number): T {
  const { dz: _, ...rest } = x as T & { dz?: number };
  return (Math.abs(dz) > 1e-6 ? { ...rest, dz } : rest) as T;
}
