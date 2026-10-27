import type { FrameSection, Grid, Material, SlabSection, Story } from '../model/types';

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
  warnings: string[];
}

export interface PushPayload {
  baseElevation: number;
  stories: Story[];
  updateStories: boolean;
  grids: Omit<Grid, 'id'>[] | null;
  frameSections: FrameSection[]; // app-defined sections to create
  slabSections: SlabSection[];
  frames: { guid: string; kind: 'column' | 'beam'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; section: string; angle: number; story: string }[];
  areas: { guid: string; pts: { x: number; y: number; z: number }[]; section: string; story: string }[];
  deleteGuids: string[];
  /** restraint for the bottom joints of columns at the base elevation; 'none' leaves joints untouched */
  supports: Supports;
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
}

export const bridge = {
  status: () => call<BridgeStatus>('/status', undefined, 15000),
  attach: () => call<BridgeStatus>('/attach', {}, 30000),
  import: () => call<ImportResult>('/import'),
  push: (p: PushPayload) => call<PushResult>('/push', p),
  verify: (p: PushPayload) => call<{ ok: boolean; log: string[] }>('/verify', p),
};
