import { create } from 'zustand';
import type { Pt } from '../model/types';

export type Dialog =
  | { kind: 'region'; rect: { a: Pt; b: Pt }; ref: Pt }
  | { kind: 'regionStories'; regionId: string }
  | { kind: 'grids' }
  | { kind: 'replicate' }
  | { kind: 'move' }
  | { kind: 'selectBy' }
  | { kind: 'sections' }
  | { kind: 'stories' }
  | { kind: 'refPlanes' }
  | { kind: 'underlay' }
  | { kind: 'etabs' }
  | { kind: 'rotate' }
  | { kind: 'loadPatterns' }
  | { kind: 'frameLoad'; edit?: LoadEdit }
  | { kind: 'shellLoad'; edit?: LoadEdit }
  | { kind: 'jointLoad'; edit?: LoadEdit };

/** An assigned load being edited: its key (see *LoadKey; a joint load's id) and the elements that carry it. */
export type LoadEdit = { key: string; ids: string[] };

export const useDialog = create<{ d: Dialog | null }>(() => ({ d: null }));
export const openDialog = (d: Dialog) => useDialog.setState({ d });
export const closeDialog = () => useDialog.setState({ d: null });

/**
 * The frame load dialog is waiting for a point picked along a selected beam in the plan; it hides
 * meanwhile. `done` gets the position along the beam (0 = start, 1 = end) and the beam length in mm.
 */
export const useFramePick = create<{ done: ((t: number, len: number) => void) | null }>(() => ({ done: null }));

/**
 * The move dialog is waiting for a base point and then a destination picked in the plan; it hides
 * meanwhile. `base` is the first point once clicked; `done` gets the displacement dx, dy in mm.
 */
export const useMovePick = create<{ done: ((dx: number, dy: number) => void) | null; base: Pt | null }>(() => ({ done: null, base: null }));
