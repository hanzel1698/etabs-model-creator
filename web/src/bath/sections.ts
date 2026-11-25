// Bathroom section check: section cuts, sinks, ducts and upstands. All app-only; none of it is pushed to ETABS.
import { create } from 'zustand';
import { uid, type Model, type Pt, type SectionCut } from '../model/types';

/** The section shown in the Section view (and drawn bold on the plan). */
export const useBath = create<{ active: string | null; setActive: (id: string | null) => void }>((set) => ({
  active: null,
  setActive: (active) => set({ active }),
}));

/** A-A, B-B … Z-Z, then AA-AA. */
export function nextSectionLabel(m: Model): string {
  const used = new Set((m.sectionLines ?? []).map((s) => s.label));
  for (let i = 0; ; i++) {
    const l = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
    if (!used.has(`${l}-${l}`)) return `${l}-${l}`;
  }
}

export function addSection(m: Model, story: string, a: Pt, b: Pt): { m: Model; id: string } {
  const s: SectionCut = { id: uid(), story, label: nextSectionLabel(m), a, b };
  return { m: { ...m, sectionLines: [...(m.sectionLines ?? []), s] }, id: s.id };
}

export const patchSection = (m: Model, id: string, p: Partial<SectionCut>): Model => ({ ...m, sectionLines: (m.sectionLines ?? []).map((s) => (s.id === id ? { ...s, ...p } : s)) });
export const removeSection = (m: Model, id: string): Model => ({ ...m, sectionLines: (m.sectionLines ?? []).filter((s) => s.id !== id) });

/** Sink in mm, down-positive; 0 clears it. */
export const setBeamSink = (m: Model, ids: string[], sink: number): Model => ({ ...m, beams: m.beams.map((b) => (ids.includes(b.id) ? { ...b, sink: sink || undefined } : b)) });
export const setSlabSink = (m: Model, ids: string[], sink: number): Model => ({ ...m, slabs: m.slabs.map((s) => (ids.includes(s.id) ? { ...s, sink: sink || undefined } : s)) });
export const setDuct = (m: Model, ids: string[], duct: boolean): Model => ({ ...m, slabs: m.slabs.map((s) => (ids.includes(s.id) ? { ...s, duct: duct || undefined } : s)) });

export function addUpstand(m: Model, beamId: string, t0: number, t1: number, depth: number): Model {
  const [a, b] = [Math.max(0, Math.min(t0, t1)), Math.min(1, Math.max(t0, t1))];
  return { ...m, upstands: [...(m.upstands ?? []), { id: uid(), beamId, t0: a, t1: b, depth }] };
}
export const removeUpstands = (m: Model, beamId: string): Model => ({ ...m, upstands: (m.upstands ?? []).filter((u) => u.beamId !== beamId) });
