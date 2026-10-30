import type { FrameLoad, JointLoad, Model, ShellLoad } from './types';

// ---------- which loads the 3D wireframe shows (view only, not saved) ----------

export type LoadKind = 'uniform' | 'trapezoid' | 'point' | 'slab' | 'joint';
export const LOAD_KINDS: { kind: LoadKind; name: string; title: string }[] = [
  { kind: 'uniform', name: 'Uniform', title: 'Frame loads with one value along their length (full or partial span)' },
  { kind: 'trapezoid', name: 'Trapezoidal', title: 'Frame loads that vary along their length' },
  { kind: 'point', name: 'Point', title: 'Point loads on frames' },
  { kind: 'slab', name: 'Slab', title: 'Uniform loads on slabs' },
  { kind: 'joint', name: 'Joint', title: 'Joint loads' },
];

export const ACTIVE_PATTERN = ''; // pattern pick: follow the active pattern
export const ALL_PATTERNS = '*'; // pattern pick: every pattern

export interface LoadFilterState {
  /** a pattern name, ACTIVE_PATTERN or ALL_PATTERNS */
  pattern: string;
  kinds: LoadKind[];
  /** bounds on each load's peak value; null = open (the range of the loads in view) */
  lo: number | null;
  hi: number | null;
}

export const defaultLoadFilter = (): LoadFilterState => ({ pattern: ACTIVE_PATTERN, kinds: LOAD_KINDS.map((k) => k.kind), lo: null, hi: null });

/** A load's value for the value filter: its largest-magnitude value, signed (a joint load's largest component). */
const peakOf = (vs: number[]) => vs.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0);
export const frameKind = (l: FrameLoad): LoadKind => (l.kind === 'point' ? 'point' : l.v1 === l.v2 ? 'uniform' : 'trapezoid');
const framePeak = (l: FrameLoad) => (l.kind === 'point' ? l.v1 : peakOf([l.v1, l.v2]));

export interface LoadFilter {
  frame: (l: FrameLoad) => boolean;
  slab: (l: ShellLoad) => boolean;
  joint: (j: JointLoad) => boolean;
  /** several patterns shown: tags name each load's pattern */
  named: boolean;
}

/** Peak values of the loads of the picked pattern and kinds, ignoring the value bounds. */
export function loadPeaks(m: Model, f: LoadFilterState, active: string): number[] {
  const inPat = (p: string) => f.pattern === ALL_PATTERNS || p === (f.pattern === ACTIVE_PATTERN ? active : f.pattern);
  const kinds = new Set(f.kinds);
  const out: number[] = [];
  for (const x of [...m.columns, ...m.beams])
    for (const l of x.loads ?? []) if (inPat(l.pattern) && kinds.has(frameKind(l))) out.push(framePeak(l));
  if (kinds.has('slab')) for (const x of m.slabs) for (const l of x.loads ?? []) if (inPat(l.pattern)) out.push(l.value);
  if (kinds.has('joint')) for (const j of m.jointLoads) if (inPat(j.pattern)) out.push(peakOf(j.f));
  return out;
}

export function makeLoadFilter(f: LoadFilterState, active: string): LoadFilter {
  const pat = f.pattern === ACTIVE_PATTERN ? active : f.pattern;
  const kinds = new Set(f.kinds);
  const lo = f.lo ?? -Infinity,
    hi = f.hi ?? Infinity;
  const eps = 1e-9;
  const show = (pattern: string, kind: LoadKind, peak: number) => (pat === ALL_PATTERNS || pattern === pat) && kinds.has(kind) && peak >= lo - eps && peak <= hi + eps;
  return {
    frame: (l) => show(l.pattern, frameKind(l), framePeak(l)),
    slab: (l) => show(l.pattern, 'slab', l.value),
    joint: (j) => show(j.pattern, 'joint', peakOf(j.f)),
    named: pat === ALL_PATTERNS,
  };
}
