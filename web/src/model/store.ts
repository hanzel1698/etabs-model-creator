import { create } from 'zustand';
import { emptyModel, type Model, type Pt } from './types';

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
  slabs: boolean;
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
  show: ShowFlags;
  toggleShow: (k: keyof ShowFlags) => void;

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
    set((s) => ({ model: next, past: [...s.past.slice(-HISTORY + 1), prev], future: [], dirty: s.dirty + 1 }));
  },
  setModel: (m, resetHistory = true) =>
    set((s) => ({
      model: m,
      past: resetHistory ? [] : [...s.past, s.model],
      future: [],
      dirty: s.dirty + 1,
      activeStory: m.stories.some((st) => st.name === s.activeStory) ? s.activeStory : m.stories[0]?.name ?? '',
      selection: [],
    })),
  undo: () => {
    const { past, model, future } = get();
    if (!past.length) return;
    set({ model: past[past.length - 1], past: past.slice(0, -1), future: [model, ...future], selection: [], dirty: get().dirty + 1 });
  },
  redo: () => {
    const { past, model, future } = get();
    if (!future.length) return;
    set({ model: future[0], past: [...past, model], future: future.slice(1), selection: [], dirty: get().dirty + 1 });
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
  ortho: false,
  toggleOrtho: () => set((s) => ({ ortho: !s.ortho })),
  show: { sectionLabels: true, gridLabels: true, gridDims: true, ghostBelow: true, underlay: true, slabs: true },
  toggleShow: (k) => set((s) => ({ show: { ...s.show, [k]: !s.show[k] } })),

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
  set: (p) => set(p),
}));

export const toast = (t: string) => {
  useApp.getState().setToast(t);
  window.clearTimeout((toast as any)._t);
  (toast as any)._t = window.setTimeout(() => useApp.getState().setToast(''), 3500);
};
