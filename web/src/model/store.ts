import { create } from 'zustand';
import { columnOn, emptyModel, placeAt, type FrameLoad, type Model, type Pt, type ShellLoad, type StairModel } from './types';
import { stairContext } from '../stair/context';
import { applyStairLoads, defaultPattern, stairLoadRows } from '../stair/push';
import { shortFrameLoad, frameLoadUnit } from './loads';
import type { PanelSize } from './ops';
import { defaultLoadFilter, type LoadFilterState } from './loadFilter';
import { firstSection } from '../ui/sectionGroups';

export type ToolName =
  | 'select'
  | 'grid'
  | 'column'
  | 'beam'
  | 'beamOffset'
  | 'slab'
  | 'slabDraw'
  | 'measure'
  | 'angle'
  | 'area'
  | 'panel'
  | 'region'
  | 'calibrate'
  | 'origin'
  | 'stairBox'
  | 'flight'
  | 'landing'
  | 'span';

export interface ColAlign {
  mode: 'off' | 'x' | 'y'; // x: vertical line (column X fixed), y: horizontal line (column Y fixed)
  anchor: 'center' | 'min' | 'max'; // which part of the column sits on the line: centre, left/bottom face, right/top face
  ref: Pt | null;
  picking: boolean; // next click in the column tool sets `ref`
}

export interface ShowFlags {
  sectionLabels: boolean;
  grids: boolean;
  gridLabels: boolean;
  gridDims: boolean;
  ghostBelow: boolean;
  underlay: boolean;
  columns: boolean;
  beams: boolean;
  /** beams running mostly along X / mostly along Y; only matter while `beams` is on */
  beamsX: boolean;
  beamsY: boolean;
  slabs: boolean;
  nodes: boolean;
  /** load values of the active load pattern */
  loads: boolean;
}

interface AppState {
  model: Model;
  past: Model[];
  future: Model[];
  dirty: number; // bumps on every commit (autosave trigger)
  /** Apply an edit. Inside a stair only stair data may change (the building is read-only there) unless `main` is set. */
  commit: (fn: (m: Model) => Model, opts?: { main?: boolean }) => void;
  setModel: (m: Model, resetHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;

  activeStory: string;
  setActiveStory: (s: string) => void;
  /** reference plane (id) the plan shows, under activeStory; only while refPlanesInPlan */
  activePlane: string | null;
  setActivePlane: (id: string, story: string) => void;
  /** the story stepper also steps through reference planes */
  refPlanesInPlan: boolean;
  toggleRefPlanesInPlan: () => void;
  tool: ToolName;
  setTool: (t: ToolName) => void;
  active: { column: string; beam: string; slab: string };
  setActive: (k: 'column' | 'beam' | 'slab', name: string) => void;
  columnAngle: number;
  /** place columns on a vertical (same X) or horizontal (same Y) line through a picked point */
  colAlign: ColAlign;
  setColAlign: (p: Partial<ColAlign>) => void;
  setColumnAngle: (a: number) => void;
  /** load pattern the assign dialogs default to and the views show */
  loadPattern: string;
  setLoadPattern: (p: string) => void;
  /** which loads the 3D wireframe shows (view only) */
  loadFilter: LoadFilterState;
  setLoadFilter: (p: Partial<LoadFilterState>) => void;
  /** the 3D wireframe is showing loads, so the right panel offers their filter */
  loads3d: boolean;
  setLoads3d: (on: boolean) => void;
  ortho: boolean;
  toggleOrtho: () => void;
  /** grids can't be selected, drawn or reshaped */
  gridLock: boolean;
  toggleGridLock: () => void;
  /** beam tool: size new beams from their supports and span instead of using the active beam section as is */
  autoBeam: boolean;
  toggleAutoBeam: () => void;
  /** beam tools: divide slabs a new or moved beam runs across into the panels the beams make */
  autoSplitSlabs: boolean;
  toggleAutoSplitSlabs: () => void;
  show: ShowFlags;
  toggleShow: (k: keyof ShowFlags) => void;
  /** ids of columns, beams and slabs hidden from view (view only, not saved) */
  hidden: string[];
  hideIds: (ids: string[]) => void;
  /** hide every column, beam and slab not in `ids` */
  showOnlyIds: (ids: string[]) => void;
  unhideIds: (ids: string[]) => void;
  showAll: () => void;
  /** view switches, hidden elements, rotation, text and bubble size and View by back to their defaults */
  resetView: () => void;

  selection: string[];
  setSelection: (ids: string[]) => void;
  /** the selection before the last change that replaced or cleared it (view only, not saved) */
  prevSelection: string[];
  /** bring back the previous selection; doing it again swaps back */
  restoreSelection: () => void;

  viewRotation: number; // degrees, view only
  setViewRotation: (r: number) => void;
  panel: 'plan' | '3d' | 'split' | 'elev';
  setPanel: (p: 'plan' | '3d' | 'split' | 'elev') => void;
  /** id of the grid the elevation view looks at */
  elevGrid: string;
  setElevGrid: (id: string) => void;

  /** extra stories that drawing also applies to (besides the active one) */
  alsoStories: string[];
  setAlsoStories: (s: string[]) => void;
  textScale: number;
  /** grid bubble diameter in mm (model units, so it zooms with the plan) */
  gridBubble: number;
  setGridBubble: (v: number) => void;
  setTextScale: (v: number) => void;
  /** what elements are coloured by in the plan and elevation */
  colorBy: ColorBy;
  setColorBy: (c: ColorBy) => void;
  /** patterns View by load values shows; empty = the active pattern */
  viewPatterns: string[];
  setViewPatterns: (p: string[]) => void;
  invertPdf: boolean;
  toggleInvertPdf: () => void;

  toast: string;
  setToast: (t: string) => void;

  /** id of the stair region being designed (stair mode), or null for the building model */
  activeStair: string | null;
  enterStair: (id: string) => void;
  exitStair: () => void;
}

const HISTORY = 200;

type Active = AppState['active'];

/**
 * Active sections that exist in `m`: any that no longer do fall back to the first item of its dropdown,
 * so what the panel shows is what gets drawn. Returns `a` itself when nothing changed.
 */
export function validActive(a: Active, m: Model): Active {
  const fs = new Set(m.frameSections.map((s) => s.name));
  const column = fs.has(a.column) ? a.column : firstSection(m.frameSections, 'Columns') || a.column;
  const beam = fs.has(a.beam) ? a.beam : firstSection(m.frameSections, 'Beams') || a.beam;
  const thinnest = [...m.slabSections].sort((x, y) => x.thickness - y.thickness)[0]?.name;
  const slab = m.slabSections.some((s) => s.name === a.slab) ? a.slab : thinnest ?? a.slab;
  return column === a.column && beam === a.beam && slab === a.slab ? a : { column, beam, slab };
}

function readNum(key: string, fallback: number) {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? '');
    return isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

const VIEW_DEFAULTS = {
  show: { sectionLabels: true, grids: true, gridLabels: true, gridDims: true, ghostBelow: false, underlay: true, columns: true, beams: true, beamsX: true, beamsY: true, slabs: true, nodes: false, loads: false } as ShowFlags,
  hidden: [] as string[],
  viewRotation: 0,
  textScale: 1,
  colorBy: 'none' as ColorBy,
  viewPatterns: [] as string[],
};

export const useApp = create<AppState>((set, get) => ({
  model: emptyModel(),
  past: [],
  future: [],
  dirty: 0,
  commit: (fn, opts) => {
    const prev = get().model;
    const next = fn(prev);
    if (next === prev) return;
    if (get().activeStair && !opts?.main && (Object.keys(next) as (keyof Model)[]).some((k) => k !== 'stairs' && next[k] !== prev[k]))
      return toast('The building model is read-only inside a stair. Use “Back to model” to edit it.');
    set((s) => ({ model: next, past: [...s.past.slice(-HISTORY + 1), prev], future: [], dirty: s.dirty + 1, active: validActive(s.active, next) }));
  },
  setModel: (m, resetHistory = true) =>
    set((s) => ({
      activeStair: m.stairs.some((r) => r.id === s.activeStair) ? s.activeStair : null,
      model: m,
      active: validActive(s.active, m),
      past: resetHistory ? [] : [...s.past, s.model],
      future: [],
      dirty: s.dirty + 1,
      activeStory: m.stories.some((st) => st.name === s.activeStory) ? s.activeStory : m.stories[0]?.name ?? '',
      selection: [],
      hidden: resetHistory ? [] : s.hidden,
    })),
  undo: () => {
    const { past, model, future } = get();
    if (!past.length) return;
    // what is in ETABS doesn't change by undoing, so keep the record of it
    const m = { ...past[past.length - 1], pushedIds: model.pushedIds, pushedJointKeys: model.pushedJointKeys };
    set({ model: m, past: past.slice(0, -1), future: [model, ...future], selection: [], dirty: get().dirty + 1, active: validActive(get().active, m) });
  },
  redo: () => {
    const { past, model, future } = get();
    if (!future.length) return;
    const m = { ...future[0], pushedIds: model.pushedIds, pushedJointKeys: model.pushedJointKeys };
    set({ model: m, past: [...past, model], future: future.slice(1), selection: [], dirty: get().dirty + 1, active: validActive(get().active, m) });
  },

  activeStory: 'Story1',
  setActiveStory: (s) => set({ activeStory: s, activePlane: null, selection: [] }),
  activePlane: null,
  setActivePlane: (id, story) => set({ activeStory: story, activePlane: id, selection: [] }),
  refPlanesInPlan: false,
  toggleRefPlanesInPlan: () => set((s) => ({ refPlanesInPlan: !s.refPlanesInPlan, activePlane: null, selection: [] })),
  tool: 'select',
  setTool: (t) => set({ tool: t }),
  active: { column: 'C400x400', beam: 'B300x500', slab: 'S150' },
  setActive: (k, name) => set((s) => ({ active: { ...s.active, [k]: name } })),
  columnAngle: 0,
  loadPattern: 'Dead',
  setLoadPattern: (p) => set({ loadPattern: p }),
  loadFilter: defaultLoadFilter(),
  setLoadFilter: (p) => set((s) => ({ loadFilter: { ...s.loadFilter, ...p } })),
  loads3d: false,
  setLoads3d: (on) => set({ loads3d: on }),
  colAlign: { mode: 'off', anchor: 'center', ref: null, picking: false },
  setColAlign: (p) => set((s) => ({ colAlign: { ...s.colAlign, ...p } })),
  setColumnAngle: (a) => set({ columnAngle: a }),
  ortho: true,
  toggleOrtho: () => set((s) => ({ ortho: !s.ortho })),
  gridLock: false,
  toggleGridLock: () => set((s) => ({ gridLock: !s.gridLock, selection: noGrids({ ...s, gridLock: true }, s.selection), tool: s.tool === 'grid' && !s.gridLock ? 'select' : s.tool })),
  autoBeam: true,
  toggleAutoBeam: () => set((s) => ({ autoBeam: !s.autoBeam })),
  autoSplitSlabs: false,
  toggleAutoSplitSlabs: () => set((s) => ({ autoSplitSlabs: !s.autoSplitSlabs })),
  show: VIEW_DEFAULTS.show,
  toggleShow: (k) =>
    set((s) => {
      const show = { ...s.show, [k]: !s.show[k] };
      // switching a type off also drops it from the selection, so Delete can't reach what isn't shown
      const off = switchedOff(s.model, show);
      if (!off.length) return { show };
      const gone = new Set(off);
      return { show, selection: s.selection.filter((id) => !gone.has(id)) };
    }),
  hidden: [],
  hideIds: (ids) =>
    set((s) => {
      const el = new Set(elementIds(s.model));
      const add = ids.filter((id) => el.has(id));
      return add.length ? { hidden: [...new Set([...s.hidden, ...add])], selection: s.selection.filter((id) => !add.includes(id)) } : {};
    }),
  showOnlyIds: (ids) =>
    set((s) => {
      const keep = new Set(ids);
      return { hidden: elementIds(s.model).filter((id) => !keep.has(id)) };
    }),
  unhideIds: (ids) =>
    set((s) => {
      const back = new Set(ids);
      return { hidden: s.hidden.filter((id) => !back.has(id)) };
    }),
  showAll: () => set({ hidden: [] }),
  resetView: () => {
    get().setGridBubble(600);
    get().setTextScale(1);
    set({ ...VIEW_DEFAULTS, loadFilter: defaultLoadFilter() });
  },

  selection: [],
  setSelection: (ids) => set((s) => ({ selection: noGrids(s, ids) })),
  prevSelection: [],
  restoreSelection: () =>
    set((s) => {
      // leave out what has been hidden since, like toggleShow/hideIds do
      const off = new Set([...s.hidden, ...switchedOff(s.model, s.show)]);
      const ids = noGrids(s, s.prevSelection.filter((id) => !off.has(id)));
      return ids.length ? { selection: ids } : {};
    }),

  viewRotation: 0,
  setViewRotation: (r) => set({ viewRotation: ((r % 360) + 360) % 360 }),
  panel: 'plan',
  setPanel: (p) => set({ panel: p }),
  elevGrid: '',
  setElevGrid: (id) => set({ elevGrid: id }),

  alsoStories: [],
  setAlsoStories: (s) => set({ alsoStories: s }),
  textScale: readNum('textScale', 1),
  gridBubble: readNum('gridBubble', 600),
  setGridBubble: (v) => {
    const d = Math.min(5000, Math.max(50, v || 600));
    try {
      localStorage.setItem('gridBubble', String(d));
    } catch {}
    set({ gridBubble: d });
  },
  setTextScale: (v) => {
    const t = Math.min(3, Math.max(0.4, v || 1));
    try {
      localStorage.setItem('textScale', String(t));
    } catch {}
    set({ textScale: t });
  },
  colorBy: 'none',
  setColorBy: (colorBy) => set({ colorBy }),
  viewPatterns: [],
  setViewPatterns: (viewPatterns) => set({ viewPatterns }),
  invertPdf: true,
  toggleInvertPdf: () => set((s) => ({ invertPdf: !s.invertPdf })),

  toast: '',
  setToast: (t) => set({ toast: t }),

  activeStair: null,
  enterStair: (id) => {
    const s = get();
    const r = s.model.stairs.find((x) => x.id === id);
    if (!r) return;
    const names = stairContext(s.model, r).stories.map((x) => x.name);
    set({ activeStair: id, selection: [], hidden: [], activePlane: null, tool: 'select', activeStory: names.includes(s.activeStory) ? s.activeStory : names[names.length - 1] ?? s.activeStory });
  },
  exitStair: () => set({ activeStair: null, selection: [], tool: 'select' }),
}));

// remember the last non-empty selection whenever something replaces it, so an accidental click can be undone
useApp.subscribe((s, p) => {
  if (s.selection === p.selection || !p.selection.length) return;
  const now = new Set(s.selection);
  if (p.selection.length === now.size && p.selection.every((id) => now.has(id))) return;
  useApp.setState({ prevSelection: p.selection });
});

/** drop grid ids while grids are locked */
function noGrids(s: { gridLock: boolean; model: Model }, ids: string[]) {
  if (!s.gridLock || !s.model.grids.length) return ids;
  const g = new Set(s.model.grids.map((x) => x.id));
  return ids.filter((id) => !g.has(id));
}
const elementIds = (m: Model) => [...m.columns, ...m.beams, ...m.slabs].map((x) => x.id);

/** Whether the View switches show beam `b`: beams on, and its direction (X when it runs mostly along X) on. */
const beamOn = (b: Model['beams'][number], show: ShowFlags) => show.beams && (Math.abs(b.x2 - b.x1) >= Math.abs(b.y2 - b.y1) ? show.beamsX : show.beamsY);

/** Ids of the columns, beams and slabs the View switches leave out. */
const switchedOff = (m: Model, show: ShowFlags) => [
  ...(['columns', 'slabs'] as const).filter((t) => !show[t]).flatMap((t) => m[t].map((x) => x.id)),
  ...m.beams.filter((b) => !beamOn(b, show)).map((b) => b.id),
];

let stairCache: { m: Model; id: string; v: Model } | null = null;
/** The model the views work on: the building, or inside a stair the building cut to that stair's box (beams clipped for display). */
export function viewModel(s: Pick<AppState, 'model' | 'activeStair'>): Model {
  const r = s.activeStair ? s.model.stairs.find((x) => x.id === s.activeStair) : undefined;
  if (!r) return s.model;
  if (stairCache && stairCache.m === s.model && stairCache.id === r.id) return stairCache.v;
  // the stair's beam loads as a push would put them (replacing what it pushed before), so plan and 3D show them
  const rows = stairLoadRows(designModel(s)!, r.overrides);
  const withLoads = applyStairLoads(s.model, r.id, rows, defaultPattern(s.model.loadPatterns, 'dl', r.dlPattern), defaultPattern(s.model.loadPatterns, 'll', r.llPattern));
  stairCache = { m: s.model, id: r.id, v: stairContext(withLoads, r, true) };
  return stairCache.v;
}

let designCache: { m: Model; id: string; v: StairModel } | null = null;
/** The open stair for design: like viewModel but with beams whole, so beam load positions are along the real beams. Null outside a stair. */
export function designModel(s: Pick<AppState, 'model' | 'activeStair'>): StairModel | null {
  const r = s.activeStair ? s.model.stairs.find((x) => x.id === s.activeStair) : undefined;
  if (!r) return null;
  if (designCache && designCache.m === s.model && designCache.id === r.id) return designCache.v;
  designCache = { m: s.model, id: r.id, v: stairContext(s.model, r) };
  return designCache.v;
}

let visCache: { m: Model; show: ShowFlags; hidden: string[]; v: Model } | null = null;
/**
 * The model as shown: columns, beams and slabs that are switched off or hidden are left out.
 * For drawing, picking and snapping only; edits always go to `model`. Same object while nothing changes.
 */
export function visibleModel(s: Pick<AppState, 'model' | 'show' | 'hidden' | 'activeStair'>): Model {
  const c = visCache;
  const m = viewModel(s);
  if (c && c.m === m && c.hidden === s.hidden && c.show.columns === s.show.columns && c.show.beams === s.show.beams && c.show.beamsX === s.show.beamsX && c.show.beamsY === s.show.beamsY && c.show.slabs === s.show.slabs) return c.v;
  const h = new Set(s.hidden);
  const v =
    !h.size && s.show.columns && s.show.beams && s.show.beamsX && s.show.beamsY && s.show.slabs
      ? m
      : {
          ...m,
          columns: s.show.columns ? m.columns.filter((x) => !h.has(x.id)) : [],
          beams: m.beams.filter((x) => beamOn(x, s.show) && !h.has(x.id)),
          slabs: s.show.slabs ? m.slabs.filter((x) => !h.has(x.id)) : [],
        };
  visCache = { m, show: s.show, hidden: s.hidden, v };
  return v;
}

/** The reference plane shown in plan as { story, dz } off that story's level, or null on a story level. */
export function planeLevel(s: Pick<AppState, 'model' | 'activeStory' | 'activePlane' | 'refPlanesInPlan'>): { story: string; dz: number } | null {
  const rp = s.refPlanesInPlan && s.activePlane ? s.model.refPlanes.find((r) => r.id === s.activePlane) : undefined;
  const p = rp && placeAt(s.model, rp.z);
  return p && p.story === s.activeStory ? p : null;
}

let planCache: { v: Model; story: string; dz: number; out: Model } | null = null;
/** visibleModel, cut down to the active reference plane's beams and slabs (and all its story's columns, which pass through it) while one is shown. For the plan only. */
export function planModel(s: AppState): Model {
  const v = visibleModel(s);
  const l = planeLevel(s);
  if (!l) return v;
  if (planCache && planCache.v === v && planCache.story === l.story && planCache.dz === l.dz) return planCache.out;
  const on = (x: { story: string; dz?: number }) => x.story === l.story && Math.abs((x.dz ?? 0) - l.dz) < 1;
  const out = { ...v, columns: v.columns.filter((c) => columnOn(v, c, l.story)), beams: v.beams.filter(on), slabs: v.slabs.filter(on) };
  planCache = { v, story: l.story, dz: l.dz, out };
  return out;
}

/** Level offset new elements are drawn at: the shown reference plane's, else 0. */
export const drawDz = () => planeLevel(useApp.getState())?.dz ?? 0;

/** Stories that new elements are drawn on (only the plane's story while a reference plane is shown). */
export const drawStories = () => {
  const s = useApp.getState();
  if (planeLevel(s)) return [s.activeStory];
  return [s.activeStory, ...s.alsoStories.filter((x) => x !== s.activeStory && s.model.stories.some((st) => st.name === x))];
};

export type ColorBy = 'none' | 'section' | 'pattern' | 'value';
export const COLOR_BY: [ColorBy, string][] = [
  ['none', 'None'],
  ['section', 'Section'],
  ['pattern', 'Assigned load patterns'],
  ['value', 'Load values'],
];

const r3 = (v: number) => String(Math.round(v * 1000) / 1000);
/** What an element is coloured by under `mode` (its section, its patterns, or its loads in `patterns`), or null for the plain colour. */
export function colorKey(x: { section: string; loads?: (FrameLoad | ShellLoad)[] }, mode: ColorBy, patterns: string[]): string | null {
  if (mode === 'section') return x.section;
  const ls = x.loads ?? [];
  if (mode === 'pattern') return ls.length ? [...new Set(ls.map((l) => l.pattern))].sort().join(' + ') : null;
  if (mode !== 'value') return null;
  const mine = ls.filter((l) => patterns.includes(l.pattern));
  // with several patterns each value is named by its pattern
  const tag = (p: string) => (patterns.length > 1 ? `${p} ` : '');
  return mine.length ? mine.map((l) => tag(l.pattern) + ('kind' in l ? `${shortFrameLoad(l)} ${frameLoadUnit(l)}` : `${r3(l.value)} kN/m²`)).join(', ') : null;
}

/** Columns, beams and slabs grouped by their colour key (all stories), keys sorted, the uncoloured group (null) last. */
export function colorGroups(m: Model, mode: ColorBy, patterns: string[]): { key: string | null; ids: string[] }[] {
  const g = new Map<string | null, string[]>();
  for (const x of [...m.columns, ...m.beams, ...m.slabs]) {
    const k = colorKey(x, mode, patterns);
    g.set(k, [...(g.get(k) ?? []), x.id]);
  }
  return [...g].map(([key, ids]) => ({ key, ids })).sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key, undefined, { numeric: true })));
}

export function sectionColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 62%)`;
}

/** Transient, high-frequency state for tool previews (kept apart so the element layers never re-render on mouse move). */
export interface Preview {
  cursor: Pt | null;
  snap: { p: Pt; kind: string; guides?: Pt[] } | null;
  track: Pt | null; // base point for typed relative input
  tracks: Pt[]; // recently hovered snap points the cursor can line up with (temporary alignment guides)
  rubber: Pt[]; // in-progress polyline (world)
  rubberClosed: boolean;
  box: { a: Pt; b: Pt } | null; // selection window (world)
  hint: string;
  input: string; // command line text
  measure: { pts: Pt[]; text: string } | null;
  offsetLine: [Pt, Pt] | null;
  grip: [Pt, Pt] | null; // beam being reshaped: fixed end, dragged end (world)
  panel: PanelSize | null; // Panel Size & Type result, drawn as dimensions inside the panel
  pick: { a: Pt; p: Pt; text: string } | null; // frame load distance pick: beam start, picked point (world)
  mid: { pts: Pt[]; guide: Pt | null; vertical?: boolean } | null; // "Mid between two points": picked points, then their midpoint whose vertical or horizontal line the next click locks to
}

export const usePreview = create<Preview & { set: (p: Partial<Preview>) => void }>((set) => ({
  cursor: null,
  snap: null,
  track: null,
  tracks: [],
  rubber: [],
  rubberClosed: false,
  box: null,
  hint: '',
  input: '',
  measure: null,
  offsetLine: null,
  grip: null,
  panel: null,
  pick: null,
  mid: null,
  set: (p) => set(p),
}));

export const toast = (t: string) => {
  useApp.getState().setToast(t);
  window.clearTimeout((toast as any)._t);
  (toast as any)._t = window.setTimeout(() => useApp.getState().setToast(''), 3500);
};
