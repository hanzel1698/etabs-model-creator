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
  | { kind: 'underlay' }
  | { kind: 'etabs' }
  | { kind: 'rotate' };

export const useDialog = create<{ d: Dialog | null }>(() => ({ d: null }));
export const openDialog = (d: Dialog) => useDialog.setState({ d });
export const closeDialog = () => useDialog.setState({ d: null });
