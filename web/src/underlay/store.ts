import { create } from 'zustand';
import RBush from 'rbush';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { Pt } from '../model/types';
import { parseDxf, unitScaleFromInsunits, type DxfData } from './dxf';
import { pdfPageCount, renderPdfPage, type RenderedPage } from './pdf';

export interface Region {
  id: string;
  stories: string[];
  rect: { minX: number; minY: number; maxX: number; maxY: number }; // raw (scaled) DXF coords
  ref: Pt; // raw DXF point that maps to model origin
}

export interface PdfSheet {
  story: string;
  page: number;
  s: number; // mm per PDF point
  ref: Pt; // PDF point (y-up from page bottom-left) that maps to model origin
}

export interface UnderlayMeta {
  kind: 'none' | 'dxf' | 'pdf';
  fileName: string;
  dxfScale: number;
  regions: Region[];
  sheets: PdfSheet[];
  hiddenLayers: string[];
  opacity: number;
  showText: boolean;
}

interface SegBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  a: Pt;
  b: Pt;
}

interface UState extends UnderlayMeta {
  dxf: DxfData | null;
  dxfText: string;
  pdfBytes: ArrayBuffer | null;
  pdfPages: number;
  rendered: Record<number, RenderedPage>;
  setupMode: boolean; // show the raw DXF (for defining regions)
  version: number;
  set: (p: Partial<UState>) => void;
}

const defaultMeta: UnderlayMeta = {
  kind: 'none',
  fileName: '',
  dxfScale: 1,
  regions: [],
  sheets: [],
  hiddenLayers: [],
  opacity: 0.55,
  showText: true,
};

export const useUnderlay = create<UState>((set) => ({
  ...defaultMeta,
  dxf: null,
  dxfText: '',
  pdfBytes: null,
  pdfPages: 0,
  rendered: {},
  setupMode: false,
  version: 0,
  set: (p) => set((s) => ({ ...p, version: s.version + 1 })),
}));

export const metaOf = (s: UnderlayMeta): UnderlayMeta => ({
  kind: s.kind,
  fileName: s.fileName,
  dxfScale: s.dxfScale,
  regions: s.regions,
  sheets: s.sheets,
  hiddenLayers: s.hiddenLayers,
  opacity: s.opacity,
  showText: s.showText,
});

export async function saveUnderlayMeta() {
  await idbSet('underlayMeta', metaOf(useUnderlay.getState()));
}

export async function loadDxfFile(file: File) {
  const text = await file.text();
  const probe = parseDxf(text, 1);
  const scale = unitScaleFromInsunits(probe.insUnits);
  const dxf = scale === 1 ? probe : parseDxf(text, scale);
  clearPdf();
  useUnderlay.getState().set({ ...defaultMeta, kind: 'dxf', fileName: file.name, dxfScale: scale, dxf, dxfText: text, setupMode: true });
  await idbSet('underlayFile', text);
  await saveUnderlayMeta();
}

export function rescaleDxf(scale: number) {
  const s = useUnderlay.getState();
  if (!s.dxfText) return;
  const f = scale / s.dxfScale;
  const regions = s.regions.map((r) => ({
    ...r,
    rect: { minX: r.rect.minX * f, minY: r.rect.minY * f, maxX: r.rect.maxX * f, maxY: r.rect.maxY * f },
    ref: { x: r.ref.x * f, y: r.ref.y * f },
  }));
  s.set({ dxfScale: scale, dxf: parseDxf(s.dxfText, scale), regions });
  saveUnderlayMeta();
}

function clearPdf() {
  const s = useUnderlay.getState();
  Object.values(s.rendered).forEach((r) => URL.revokeObjectURL(r.url));
  s.set({ pdfBytes: null, pdfPages: 0, rendered: {} });
}

export async function loadPdfFile(file: File, storyNames: string[]) {
  const bytes = await file.arrayBuffer();
  const n = await pdfPageCount(bytes);
  clearPdf();
  // default: page i → story i (bottom-up); assume 1:100
  const sheets: PdfSheet[] = storyNames.slice(0, n).map((story, i) => ({ story, page: i + 1, s: 0.352778 * 100, ref: { x: 0, y: 0 } }));
  useUnderlay.getState().set({ ...defaultMeta, kind: 'pdf', fileName: file.name, pdfBytes: bytes, pdfPages: n, sheets, dxf: null, dxfText: '' });
  await idbSet('underlayFile', bytes);
  await saveUnderlayMeta();
}

export async function ensurePageRendered(page: number) {
  const s = useUnderlay.getState();
  if (!s.pdfBytes || s.rendered[page]) return;
  const r = await renderPdfPage(s.pdfBytes, page);
  const cur = useUnderlay.getState();
  cur.set({ rendered: { ...cur.rendered, [page]: r } });
}

export async function restoreUnderlay() {
  const meta = (await idbGet('underlayMeta')) as UnderlayMeta | undefined;
  const file = await idbGet('underlayFile');
  if (!meta || !file || meta.kind === 'none') return;
  if (meta.kind === 'dxf' && typeof file === 'string') {
    const dxf = parseDxf(file, meta.dxfScale);
    dxf.layers.forEach((l) => (l.visible = !meta.hiddenLayers.includes(l.name)));
    useUnderlay.getState().set({ ...meta, dxf, dxfText: file });
  } else if (meta.kind === 'pdf' && file instanceof ArrayBuffer) {
    const n = await pdfPageCount(file);
    useUnderlay.getState().set({ ...meta, pdfBytes: file, pdfPages: n });
  }
}

export async function removeUnderlay() {
  clearPdf();
  useUnderlay.getState().set({ ...defaultMeta, dxf: null, dxfText: '' });
  await idbDel('underlayFile');
  await idbDel('underlayMeta');
}

// ---------- per-story placement ----------

/** Region for a story, or null (with no regions defined, the whole DXF is shown untransformed). */
export function regionFor(story: string): Region | null {
  return useUnderlay.getState().regions.find((r) => r.stories.includes(story)) ?? null;
}

export function sheetFor(story: string): PdfSheet | null {
  return useUnderlay.getState().sheets.find((s) => s.story === story) ?? null;
}

// ---------- snapping geometry ----------

let cache: { key: string; tree: RBush<SegBox>; pts: Pt[] } | null = null;

/** Underlay segments/points for the story in model coordinates, spatially indexed. */
export function underlayGeom(story: string): { tree: RBush<SegBox>; pts: Pt[] } | null {
  const s = useUnderlay.getState();
  if (s.kind !== 'dxf' || !s.dxf) return null;
  const key = `${story}|${s.version}|${s.setupMode}`;
  if (cache?.key === key) return cache;
  const reg = s.setupMode ? null : regionFor(story);
  if (!s.setupMode && s.regions.length && !reg) return null;
  const off = reg ? reg.ref : { x: 0, y: 0 };
  const inR = (p: Pt) => !reg || (p.x >= reg.rect.minX && p.x <= reg.rect.maxX && p.y >= reg.rect.minY && p.y <= reg.rect.maxY);
  const boxes: SegBox[] = [];
  for (const [a0, b0] of s.dxf.segs) {
    if (!inR(a0) && !inR(b0)) continue;
    const a = { x: a0.x - off.x, y: a0.y - off.y },
      b = { x: b0.x - off.x, y: b0.y - off.y };
    boxes.push({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y), a, b });
  }
  const tree = new RBush<SegBox>();
  tree.load(boxes);
  const pts = s.dxf.points.filter(inR).map((p) => ({ x: p.x - off.x, y: p.y - off.y }));
  cache = { key, tree, pts };
  return cache;
}
