import { create } from 'zustand';
import RBush from 'rbush';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { Pt } from '../model/types';
import { parseDxf, readInsUnits, unitScaleFromInsunits, type DxfData } from './dxf';
import { toast } from '../model/store';
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
  const s = useUnderlay.getState();
  await idbSet('underlayMeta', metaOf(s));
  if (s.kind === 'dxf' && s.fileName) {
    // remembered per file name, so loading the drawing again after removing it keeps its units
    const scales = ((await idbGet('dxfScales')) as Record<string, number> | undefined) ?? {};
    if (scales[s.fileName] !== s.dxfScale) await idbSet('dxfScales', { ...scales, [s.fileName]: s.dxfScale });
  }
}

function parseDxfWith(text: string, scale: number, hiddenLayers: string[]) {
  const dxf = parseDxf(text, scale);
  dxf.layers.forEach((l) => (l.visible = !hiddenLayers.includes(l.name)));
  return dxf;
}

export async function loadDxfFile(file: File) {
  const text = await file.text();
  const prev = useUnderlay.getState();
  if (prev.kind === 'dxf' && prev.fileName === file.name) {
    // same drawing again (e.g. an updated revision): keep its units, regions and layer settings
    prev.set({ dxf: parseDxfWith(text, prev.dxfScale, prev.hiddenLayers), dxfText: text });
    await idbSet('underlayFile', text);
    await saveUnderlayMeta();
    toast(`Reloaded ${file.name}, keeping its scale and story regions.`);
    return;
  }
  const known = ((await idbGet('dxfScales')) as Record<string, number> | undefined)?.[file.name];
  const units = readInsUnits(text);
  let scale = known ?? unitScaleFromInsunits(units);
  let dxf = parseDxf(text, scale);
  if (known) toast(`Using the units last set for ${file.name} (×${known}). Change them in Underlay → Setup if needed.`);
  // Many architectural DXFs are drawn in mm but carry a wrong $INSUNITS (often inches).
  // If the bulk of the drawing (fitBox) is over 500 m after scaling but a plausible 3–500 m when read as mm,
  // the header is wrong, so fall back to mm.
  const fb = dxf.fitBox;
  const size = Math.max(fb.maxX - fb.minX, fb.maxY - fb.minY);
  if (!known && scale > 1 && size > 5e5 && size / scale >= 3e3 && size / scale <= 5e5) {
    scale = 1;
    dxf = parseDxf(text, 1);
    toast(`The DXF says its units are ${units === 1 ? 'inches' : 'code ' + units}, but that makes the plan ${(size / 1000).toFixed(0)} m across, so mm is used. Change it in Underlay → Setup if needed.`);
  }
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
  s.set({ dxfScale: scale, dxf: parseDxfWith(s.dxfText, scale, s.hiddenLayers), regions });
  saveUnderlayMeta();
}

/** Apply the underlay settings saved in a project, if the loaded underlay is the same file. */
export function applySavedMeta(m: Partial<UnderlayMeta>) {
  const s = useUnderlay.getState();
  if (!m.fileName || s.fileName !== m.fileName) return;
  const scale = m.dxfScale ?? s.dxfScale;
  const hidden = m.hiddenLayers ?? s.hiddenLayers;
  const dxf = s.kind === 'dxf' && s.dxfText ? parseDxfWith(s.dxfText, scale, hidden) : s.dxf;
  s.set({
    dxf,
    dxfScale: scale,
    hiddenLayers: hidden,
    regions: m.regions ?? s.regions,
    sheets: m.sheets ?? s.sheets,
    opacity: m.opacity ?? s.opacity,
    showText: m.showText ?? s.showText,
  });
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
    useUnderlay.getState().set({ ...meta, dxf: parseDxfWith(file, meta.dxfScale, meta.hiddenLayers), dxfText: file });
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
