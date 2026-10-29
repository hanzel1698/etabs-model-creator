import type { FrameSection, Grid, LoadPattern, Material, SlabSection, Story } from '../model/types';

export const DEFAULT_BRIDGE = 'http://127.0.0.1:8765';

export function bridgeUrl() {
  try {
    return localStorage.getItem('bridgeUrl') || DEFAULT_BRIDGE;
  } catch {
    return DEFAULT_BRIDGE;
  }
}

async function call<T>(path: string, body?: unknown, timeoutMs = 600000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(bridgeUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    return j as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Bridge timed out');
    if (e instanceof TypeError) throw new Error(`Cannot reach the bridge at ${bridgeUrl()}. Is “python bridge.py” running?`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export interface BridgeStatus {
  ok: boolean;
  attached: boolean;
  version?: string;
  model?: string;
  units?: number;
  message?: string;
}

export interface ImportResult {
  baseElevation: number;
  stories: Story[];
  grids: Omit<Grid, 'id'>[];
  materials: Material[];
  frameSections: FrameSection[];
  slabSections: SlabSection[];
  patterns: LoadPattern[];
  /** every frame and area object (not openings), by its ETABS GUID; loads in the push form */
  frames: { name: string; guid: string; section: string; angle: number; pts: P3[]; loads: FrameLoadOut[] }[];
  areas: { name: string; guid: string; section: string; pts: P3[]; loads: AreaLoadOut[] }[];
  warnings: string[];
}

type P3 = { x: number; y: number; z: number };

/** Frame load in ETABS terms (kN, mm): MyType 1 force / 2 moment, Dir code, distances relative or mm. */
export interface FrameLoadOut {
  pattern: string;
  kind: 'dist' | 'point';
  type: 1 | 2;
  dir: number;
  rel: boolean;
  d1: number;
  d2: number;
  v1: number;
  v2: number;
}
/** Uniform area load (kN/mm²). */
export interface AreaLoadOut {
  pattern: string;
  dir: number;
  value: number;
}
/** Joint force (kN, kN·mm, global) at a point found by its coordinates. */
export interface JointLoadOut {
  x: number;
  y: number;
  z: number;
  pattern: string;
  f: number[];
}

export interface PushPayload {
  baseElevation: number;
  stories: Story[];
  updateStories: boolean;
  grids: Omit<Grid, 'id'>[] | null;
  frameSections: FrameSection[]; // app-defined sections to create
  slabSections: SlabSection[];
  frames: { guid: string; kind: 'column' | 'beam'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; section: string; angle: number; story: string; loads: FrameLoadOut[] }[];
  areas: { guid: string; pts: { x: number; y: number; z: number }[]; section: string; story: string; loads: AreaLoadOut[] }[];
  deleteGuids: string[];
  /** restraint for the bottom joints of columns at the base elevation; 'none' leaves joints untouched */
  supports: Supports;
  /** push load patterns and loads */
  loads: boolean;
  /** patterns to create or update in ETABS (ETABS load pattern type codes) */
  patterns: { name: string; type: number; selfWeight: number }[];
  /** every pattern whose loads the app manages (app and imported patterns); loads in others are left alone */
  loadPatterns: string[];
  jointLoads: JointLoadOut[];
  /** joints that carried app loads at the last push and carry none now */
  clearJoints: { x: number; y: number; z: number }[];
}

export type Supports = 'fixed' | 'pinned' | 'none';

export interface PushResult {
  restrained?: number;
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  failed: number;
  log: string[];
  pushedGuids: string[];
  /** objects whose loads were rewritten; joints loaded */
  loads?: { frames: number; areas: number; joints: number; unchanged: number };
}

/** A frame or area object in ETABS that no element of the app owns */
export interface Unowned {
  name: string;
  obj: 'frame' | 'area';
  kind: 'column' | 'beam' | 'brace' | 'slab' | 'wall';
  story: string;
  section: string;
  pts: { x: number; y: number; z: number }[];
}

export interface VerifyResult {
  ok: boolean;
  log: string[];
  unowned: Unowned[];
}

export const bridge = {
  status: () => call<BridgeStatus>('/status', undefined, 15000),
  attach: () => call<BridgeStatus>('/attach', {}, 30000),
  import: () => call<ImportResult>('/import'),
  push: (p: PushPayload) => call<PushResult>('/push', p),
  verify: (p: PushPayload) => call<VerifyResult>('/verify', p),
  /** keepGuids: ids the app owns; the bridge skips any named object that has one of them */
  remove: (b: { frames: string[]; areas: string[]; keepGuids: string[] }) => call<{ deleted: number; log: string[] }>('/delete', b),
};
