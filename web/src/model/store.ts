import { create } from 'zustand';
import { emptyModel, type Model, type Pt } from './types';
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
  | 'region'
  | 'calibrate'
  | 'origin';

export interface ColAlign {
  mode: 'off' | 'x' | 'y'; // x: vertical line (column X fixed), y: horizontal line (column Y fixed)
  anchor: 'center' | 'min' | 'max'; // which part of the column sits on the line: centre, left/bottom face, right/top face
  ref: Pt | null;
  picking: boolean; // next click in the column tool sets `ref`
}

export interface ShowFlags {
  sectionLabels: boolean;
  gridLabels: boolean;
  gridDims: boolean;
  ghostBelow: boolean;
  underlay: boolean;
  columns: boolean;
  beams: boolean;
  slabs: boolean;
  nodes: boolean;
}

interface AppState {
  model: Model;
  past: Model[];
  future: Model[];
  dirty: number; // bumps on every commit (autosave trigger)
  commit: (fn: (m: Model) => Model) => void;
  setModel: (m: Model, resetHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;

  activeStory: string;
  setActiveStory: (s: string) => void;
  tool: ToolName;
  setTool: (t: ToolName) => void;
  active: { column: string; beam: string; slab: string };
  setActive: (k: 'column' | 'beam' | 'slab', name: string) => void;
  columnAngle: number;
  /** place columns on a vertical (same X) or horizontal (same Y) line through a picked point */
  colAlign: ColAlign;
  setColAlign: (p: Partial<ColAlign>) => void;
  setColumnAngle: (a: number) => void;
  ortho: boolean;
  toggleOrtho: () => void;
  /** beam tool: size new beams from their supports and span instead of using the active beam section as is */
  autoBeam: boolean;
  toggleAutoBeam: () => void;
  show: ShowFlags;
  toggleShow: (k: keyof ShowFlags) => void;
  /** ids of columns, beams and slabs hidden from view (view only, not saved) */
  hidden: string[];
  hideIds: (ids: string[]) => void;
  /** hide every column, beam and slab not in `ids` */
  showOnlyIds: (ids: string[]) => void;
  showAll: () => void;

  selection: string[];
  setSelection: (ids: string[]) => void;

  viewRotation: number; // degrees, view only
  setViewRotation: (r: number) => void;
  panel: 'plan' | '3d' | 'split';
  setPanel: (p: 'plan' | '3d' | 'split') => void;

  /** extra stories that drawing also applies to (besides the active one) */
  alsoStories: string[];
  setAlsoStories: (s: string[]) => void;
  textScale: number;
  /** grid bubble diameter in mm (model units, so it zooms with the plan) */
  gridBubble: number;
  setGridBubble: (v: number) => void;
  setTextScale: (v: number) => void;
  colorBySection: boolean;
  toggleColorBySection: () => void;
  invertPdf: boolean;
  toggleInvertPdf: () => void;

  toast: string;
  setToast: (t: string) => void;
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

export const useApp = create<AppState>((set, get) => ({
  model: emptyModel(),
  past: [],
  future: [],
  dirty: 0,
  commit: (fn) => {
    const prev = get().model;
    const next = fn(prev);
    if (next === prev) return;
    set((s) => ({ model: next, past: [...s.past.slice(-HISTORY + 1), prev], future: [], dirty: s.dirty + 1, active: validActive(s.active, next) }));
  },
  setModel: (m, resetHistory = true) =>
    set((s) => ({
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
    const m = past[past.length - 1];
    set({ model: m, past: past.slice(0, -1), future: [model, ...future], selection: [], dirty: get().dirty + 1, active: validActive(get().active, m) });
  },
  redo: () => {
    const { past, model, future } = get();
    if (!future.length) return;
    set({ model: future[0], past: [...past, model], future: future.slice(1), selection: [], dirty: get().dirty + 1, active: validActive(get().active, future[0]) });
  },

  activeStory: 'Story1',
  setActiveStory: (s) => set({ activeStory: s, selection: [] }),
  tool: 'select',
  setTool: (t) => set({ tool: t }),
  active: { column: 'C400x400', beam: 'B300x500', slab: 'S150' },
  setActive: (k, name) => set((s) => ({ active: { ...s.active, [k]: name } })),
  columnAngle: 0,
  colAlign: { mode: 'off', anchor: 'center', ref: null, picking: false },
  setColAlign: (p) => set((s) => ({ colAlign: { ...s.colAlign, ...p } })),
  setColumnAngle: (a) => set({ columnAngle: a }),
  ortho: true,
  toggleOrtho: () => set((s) => ({ ortho: !s.ortho })),
  autoBeam: true,
  toggleAutoBeam: () => set((s) => ({ autoBeam: !s.autoBeam })),
  show: { sectionLabels: true, gridLabels: true, gridDims: true, ghostBelow: false, underlay: true, columns: true, beams: true, slabs: true, nodes: false },
  toggleShow: (k) =>
    set((s) => {
      const show = { ...s.show, [k]: !s.show[k] };
      // switching a type off also drops it from the selection, so Delete can't reach what isn't shown
      const off = (['columns', 'beams', 'slabs'] as const).filter((t) => !show[t]).flatMap((t) => s.model[t].map((x) => x.id));
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
  showAll: () => set({ hidden: [] }),

  selection: [],
  setSelection: (ids) => set({ selection: ids }),

  viewRotation: 0,
  setViewRotation: (r) => set({ viewRotation: ((r % 360) + 360) % 360 }),
  panel: 'plan',
  setPanel: (p) => set({ panel: p }),

  alsoStories: [],
  setAlsoStories: (s) => set({ alsoStories: s }),
  textScale: 1,
  gridBubble: readNum('gridBubble', 600),
  setGridBubble: (v) => {
    const d = Math.min(5000, Math.max(50, v || 600));
    try {
      localStorage.setItem('gridBubble', String(d));
    } catch {}
    set({ gridBubble: d });
  },
  setTextScale: (v) => set({ textScale: v }),
  colorBySection: true,
  toggleColorBySection: () => set((s) => ({ colorBySection: !s.colorBySection })),
  invertPdf: true,
  toggleInvertPdf: () => set((s) => ({ invertPdf: !s.invertPdf })),

  toast: '',
  setToast: (t) => set({ toast: t }),
}));

const elementIds = (m: Model) => [...m.columns, ...m.beams, ...m.slabs].map((x) => x.id);

let visCache: { m: Model; show: ShowFlags; hidden: string[]; v: Model } | null = null;
/**
 * The model as shown: columns, beams and slabs that are switched off or hidden are left out.
 * For drawing, picking and snapping only; edits always go to `model`. Same object while nothing changes.
 */
export function visibleModel(s: Pick<AppState, 'model' | 'show' | 'hidden'>): Model {
  const c = visCache;
  if (c && c.m === s.model && c.hidden === s.hidden && c.show.columns === s.show.columns && c.show.beams === s.show.beams && c.show.slabs === s.show.slabs) return c.v;
  const m = s.model;
  const h = new Set(s.hidden);
  const v =
    !h.size && s.show.columns && s.show.beams && s.show.slabs
      ? m
      : {
          ...m,
          columns: s.show.columns ? m.columns.filter((x) => !h.has(x.id)) : [],
          beams: s.show.beams ? m.beams.filter((x) => !h.has(x.id)) : [],
          slabs: s.show.slabs ? m.slabs.filter((x) => !h.has(x.id)) : [],
        };
  visCache = { m, show: s.show, hidden: s.hidden, v };
  return v;
}

/** Stories that new elements are drawn on. */
export const drawStories = () => {
  const s = useApp.getState();
  return [s.activeStory, ...s.alsoStories.filter((x) => x !== s.activeStory && s.model.stories.some((st) => st.name === x))];
};

export function sectionColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 62%)`;
}

/** Transient, high-frequency state for tool previews (kept apart so the element layers never re-render on mouse move). */
export interface Preview {
  cursor: Pt | null;
  snap: { p: Pt; kind: string } | null;
  track: Pt | null; // base point for typed relative input
  rubber: Pt[]; // in-progress polyline (world)
  rubberClosed: boolean;
  box: { a: Pt; b: Pt } | null; // selection window (world)
  hint: string;
  input: string; // command line text
  measure: { pts: Pt[]; text: string } | null;
  offsetLine: [Pt, Pt] | null;
  grip: [Pt, Pt] | null; // beam being reshaped: fixed end, dragged end (world)
}

export const usePreview = create<Preview & { set: (p: Partial<Preview>) => void }>((set) => ({
  cursor: null,
  snap: null,
  track: null,
  rubber: [],
  rubberClosed: false,
  box: null,
  hint: '',
  input: '',
  measure: null,
  offsetLine: null,
  grip: null,
  set: (p) => set(p),
}));

export const toast = (t: string) => {
  useApp.getState().setToast(t);
  window.clearTimeout((toast as any)._t);
  (toast as any)._t = window.setTimeout(() => useApp.getState().setToast(''), 3500);
};
