import { useApp, usePreview, drawStories, toast, type ToolName } from '../model/store';
import type { Model, Pt } from '../model/types';
import { addBeams, addColumns, addSlab, findBay, gridSegs, makeGrid, moveIds, nextGridLabel } from '../model/ops';
import { uid } from '../model/types';
import { add, angleDeg, dist, fmt, offsetSeg, parseRelative, polyArea, projectOnSeg, segIntersect, side, sub, distToSeg, lineIntersect } from '../model/geom';
import { snapPoint, cachedIntersections, columnOutline, type Snap, type SnapKind } from './snap';
import { viewport } from './viewport';
import { useUnderlay, saveUnderlayMeta, regionFor, sheetFor, rescaleDxf } from '../underlay/store';
import { openDialog } from '../ui/dialogState';
import { fitAll } from './PlanView';

const SNAP_PX = 12;
const P = () => usePreview.getState();
const A = () => useApp.getState();

const hints: Record<ToolName, string> = {
  select: 'Click or drag a window (L→R: inside, R→L: crossing). Shift adds. Del deletes.',
  grid: 'Click two points to draw a grid line. Or use “Generate grids”.',
  column: 'Click to place a column (snaps to grid intersections). Drag a window to fill all intersections.',
  beam: 'Click start, then end (chained). Type dx,dy or @dist<angle or a length + Enter. Right-click/Esc ends the chain.',
  beamOffset: 'Pick a grid or beam to offset from.',
  slab: 'Click inside a bay bounded by beams (or grids) to create a slab.',
  slabDraw: 'Click polygon corners; Enter or click the first point to close.',
  measure: 'Click points to measure distance (chained). Esc clears.',
  angle: 'Click 3 points: start, vertex, end.',
  area: 'Click polygon corners; Enter closes and shows the area.',
  region: 'DXF setup: click two corners around one story plan.',
  calibrate: 'Calibrate: click the two ends of a line whose real length you know.',
  origin: 'Click the point (e.g. grid A/1) that should become the model origin (0,0). The whole model moves with it.',
};

// tools whose points snap to the underlay, so they must not run on the raw (setup) DXF
const DRAW_TOOLS: ToolName[] = ['grid', 'column', 'beam', 'slabDraw'];

// tool-local state
let regionRect: { a: Pt; b: Pt } | null = null;
let calibPts: Pt[] = [];
let calibStage: 'dist' | 'ref' = 'dist';
let offsetSrc: [Pt, Pt] | null = null;
let offsetFromGrid = false;

export function resetTool() {
  regionRect = null;
  calibPts = [];
  calibStage = 'dist';
  offsetSrc = null;
  P().set({ rubber: [], rubberClosed: false, box: null, measure: null, offsetLine: null, input: '', track: null, hint: hints[A().tool] });
}

export function setTool(t: ToolName) {
  A().setTool(t);
  if (t === 'region' || t === 'calibrate') {
    const u = useUnderlay.getState();
    if (t === 'region' && u.kind !== 'dxf') return toast('Load a DXF underlay first.');
    if (t === 'calibrate' && u.kind === 'none') return toast('Load a DXF or PDF underlay first.');
    if (t === 'region' && !u.setupMode) {
      u.set({ setupMode: true });
      requestAnimationFrame(() => fitAll());
    }
  }
  if (DRAW_TOOLS.includes(t)) leaveSetupView();
  resetTool();
}

/**
 * Drawing on the raw DXF (setup view) stores raw drawing coordinates, which end up as ETABS grid
 * ordinates like 6547680. Switch back to the story-aligned view before drawing.
 */
function leaveSetupView() {
  const u = useUnderlay.getState();
  if (u.kind !== 'dxf') return;
  if (u.setupMode && u.regions.length) {
    u.set({ setupMode: false });
    requestAnimationFrame(() => fitAll());
    toast('Left the whole-DXF setup view so drawing uses story coordinates (reference point = 0,0).');
  } else if (!u.regions.length) {
    toast('No story region yet: points snap to raw DXF coordinates. Define a story region first, or use “Move model to origin” afterwards.');
  }
}

/** Shift the whole model so `o` becomes (0,0), and move the underlay placement with it so it stays aligned. */
export function moveModelToOrigin(o: Pt) {
  if (!o.x && !o.y) return toast('That point is already the origin.');
  if (!confirm(`Move the whole model by (${fmt(-o.x)}, ${fmt(-o.y)}) mm so this point becomes (0,0)?`)) return;
  const st = A();
  st.commit((m) => moveIds(m, [...m.grids, ...m.columns, ...m.beams, ...m.slabs].map((x) => x.id), -o.x, -o.y));
  if (st.colAlign.ref) st.setColAlign({ ref: { x: st.colAlign.ref.x - o.x, y: st.colAlign.ref.y - o.y } });
  const u = useUnderlay.getState();
  if (u.kind === 'dxf' && u.dxf) {
    // A model drawn on the raw drawing sits inside a region's raw box, not around the origin like
    // the story-aligned view, even when the setup view is currently off.
    type Box = { minX: number; minY: number; maxX: number; maxY: number };
    const inBox = (b: Box) => o.x >= b.minX && o.x <= b.maxX && o.y >= b.minY && o.y <= b.maxY;
    const shifted = (r: (typeof u.regions)[number]) => ({ minX: r.rect.minX - r.ref.x, minY: r.rect.minY - r.ref.y, maxX: r.rect.maxX - r.ref.x, maxY: r.rect.maxY - r.ref.y });
    const onRaw = u.setupMode || !u.regions.length || (u.regions.some((r) => inBox(r.rect)) && !u.regions.some((r) => inBox(shifted(r))));
    if (onRaw) {
      // picked on the raw drawing: that raw point becomes the reference point of the region it lies in
      const hit = u.regions.filter((r) => inBox(r.rect));
      const reg = hit.length ? null : regionFor(st.activeStory);
      const regions = hit.length
        ? u.regions.map((r) => (hit.includes(r) ? { ...r, ref: { ...o } } : r))
        : reg
          ? u.regions.map((r) => (r === reg ? { ...r, ref: { ...o } } : r))
          : [...u.regions, { id: uid(), stories: u.regions.length ? [st.activeStory] : st.model.stories.map((s) => s.name), rect: { ...u.dxf.fitBox }, ref: { ...o } }];
      u.set({ regions, setupMode: false });
    } else {
      u.set({ regions: u.regions.map((r) => ({ ...r, ref: { x: r.ref.x + o.x, y: r.ref.y + o.y } })) });
    }
  } else if (u.kind === 'pdf') {
    u.set({ sheets: u.sheets.map((s) => ({ ...s, ref: { x: s.ref.x + o.x / s.s, y: s.ref.y + o.y / s.s } })) });
  }
  saveUnderlayMeta();
  setTool('select');
  requestAnimationFrame(() => fitAll());
  toast('Model moved: the picked point is now (0,0). Push to ETABS to update the grid ordinates.');
}

/**
 * Column position after applying "align to point": on a vertical line (same X) or horizontal line
 * (same Y) through the reference point, with the column centre, or its left/bottom or right/top
 * face, on that line. The other coordinate comes from the cursor.
 */
export function alignedColumnPoint(pt: Pt): Pt {
  const { colAlign: al, model, active, columnAngle } = A();
  if (al.mode === 'off' || !al.ref) return pt;
  const sec = model.frameSections.find((s) => s.name === active.column);
  const r = (columnAngle * Math.PI) / 180;
  const d = sec?.t3 || 400,
    w = sec?.shape === 'Circle' ? d : sec?.t2 || 400;
  const hx = sec?.shape === 'Circle' ? d / 2 : Math.abs(Math.cos(r)) * (d / 2) + Math.abs(Math.sin(r)) * (w / 2);
  const hy = sec?.shape === 'Circle' ? d / 2 : Math.abs(Math.sin(r)) * (d / 2) + Math.abs(Math.cos(r)) * (w / 2);
  const shift = (h: number) => (al.anchor === 'min' ? h : al.anchor === 'max' ? -h : 0);
  return al.mode === 'x' ? { x: al.ref.x + shift(hx), y: pt.y } : { x: pt.x, y: al.ref.y + shift(hy) };
}

const snapKindsFor = (t: ToolName): SnapKind[] | undefined => {
  if (t === 'column' && A().colAlign.picking) return undefined;
  if (t === 'column') return ['intersection', 'column', 'end', 'mid', 'near'];
  return undefined;
};

export function doSnap(screen: Pt): Snap {
  const w = viewport.toWorld(screen);
  const t = A().tool;
  if (t === 'select') return { p: w, kind: 'none' };
  const rub = P().rubber;
  const from = rub.length ? rub[rub.length - 1] : null;
  // region corners and reference point are raw DXF points: never snap them to model elements
  const m = A().model;
  return snapPoint(t === 'region' ? { ...m, grids: [], columns: [], beams: [], slabs: [] } : m, w, SNAP_PX / viewport.k, {
    story: A().activeStory,
    from,
    ortho: A().ortho,
    underlay: A().show.underlay,
    only: snapKindsFor(t),
  });
}

function liveText(from: Pt, to: Pt) {
  return `L=${fmt(dist(from, to))}  ∠${fmt(angleDeg(from, to), 1)}°  dx=${fmt(to.x - from.x)} dy=${fmt(to.y - from.y)}`;
}

export function onMove(screen: Pt) {
  const s = doSnap(screen);
  const t = A().tool;
  const p = P();
  const upd: Partial<ReturnType<typeof P>> = { cursor: s.p, snap: s.kind === 'none' ? null : s };
  if (s.kind !== 'none' && s.kind !== 'near' && s.kind !== 'ortho') upd.track = s.p;
  const last = p.rubber[p.rubber.length - 1];
  if (last && (t === 'beam' || t === 'grid' || t === 'slabDraw' || t === 'area' || t === 'measure' || t === 'angle' || t === 'calibrate')) upd.hint = liveText(last, s.p);
  if (t === 'region' && !regionRect && p.rubber.length === 1) upd.box = { a: p.rubber[0], b: s.p };
  if (t === 'column' && !A().colAlign.picking && A().colAlign.mode !== 'off' && A().colAlign.ref) {
    const q = alignedColumnPoint(s.p);
    upd.cursor = q;
    upd.snap = { p: q, kind: 'align' };
  }
  if (t === 'beamOffset' && offsetSrc) {
    const w = viewport.toWorld(screen); // unsnapped: the side/distance follow the mouse
    upd.cursor = w;
    upd.snap = null;
    const d = side(w, offsetSrc[0], offsetSrc[1]) > 0 ? 1 : -1;
    const typed = parseFloat(p.input);
    const off = !isNaN(typed) ? typed : Math.round(distToSegLine(w, offsetSrc) / 50) * 50;
    upd.offsetLine = offsetSeg(offsetSrc[0], offsetSrc[1], d * off);
    upd.hint = `Offset = ${fmt(off)}  (type a distance + Enter, or click)`;
  }
  p.set(upd);
}

const distToSegLine = (p: Pt, [a, b]: [Pt, Pt]) => Math.abs(side(p, a, b)) / (dist(a, b) || 1);

/** Called with a snapped world point on a primary click. */
export function onClick(pt: Pt) {
  const t = A().tool;
  const p = P();
  const commit = A().commit;
  if (DRAW_TOOLS.includes(t) && useUnderlay.getState().setupMode && useUnderlay.getState().kind === 'dxf')
    return toast('Untick “Show whole DXF (setup)” before drawing: the setup view uses raw DXF coordinates.');
  switch (t) {
    case 'grid': {
      if (!p.rubber.length) return p.set({ rubber: [pt] });
      const a = p.rubber[0];
      if (dist(a, pt) < 1) return;
      commit((m) => {
        const g = makeGrid(a, pt, '');
        g.label = nextGridLabel(m.grids, g.dir);
        return { ...m, grids: [...m.grids, g] };
      });
      return p.set({ rubber: [] });
    }
    case 'column': {
      const al = A().colAlign;
      if (al.picking) {
        A().setColAlign({ ref: pt, picking: false, mode: al.mode === 'off' ? 'x' : al.mode });
        P().set({ hint: 'Reference point set. Columns now line up with it — move along the guide line and click.' });
        return;
      }
      const q = alignedColumnPoint(pt);
      commit((m) => addColumns(m, [q], drawStories(), A().active.column, A().columnAngle));
      return;
    }
    case 'beam': {
      if (!p.rubber.length) return p.set({ rubber: [pt] });
      const a = p.rubber[p.rubber.length - 1];
      commit((m) => addBeams(m, [[a, pt]], drawStories(), A().active.beam));
      return p.set({ rubber: [pt] });
    }
    case 'beamOffset': {
      if (!offsetSrc) return pickOffsetSource(pt);
      if (p.offsetLine) createOffsetBeam(p.offsetLine);
      return;
    }
    case 'slab': {
      const m = A().model;
      const story = A().activeStory;
      const segs: [Pt, Pt][] = m.beams.filter((b) => b.story === story).map((b) => [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }]);
      let bay = findBay(segs, pt);
      if (!bay) bay = findBay(gridSegs(m), pt);
      if (!bay) return toast('No closed bay found here. Use “Draw slab” to draw it.');
      for (const st of drawStories()) commit((mm) => addSlab(mm, bay!, st, A().active.slab));
      return;
    }
    case 'slabDraw':
    case 'area': {
      if (p.rubber.length >= 3 && dist(pt, p.rubber[0]) < SNAP_PX / viewport.k) return finishPolygon();
      return p.set({ rubber: [...p.rubber, pt] });
    }
    case 'measure': {
      const pts = [...p.rubber, pt];
      return p.set({ rubber: pts, measure: { pts, text: measureText(pts) } });
    }
    case 'angle': {
      const pts = [...p.rubber, pt];
      if (pts.length === 3) {
        let a = angleDeg(pts[1], pts[2]) - angleDeg(pts[1], pts[0]);
        a = Math.abs(((a + 540) % 360) - 180);
        return p.set({ rubber: [], measure: { pts, text: `Angle = ${fmt(a, 2)}°` } });
      }
      return p.set({ rubber: pts, measure: null });
    }
    case 'origin':
      return moveModelToOrigin(pt);
    case 'region': {
      if (!regionRect) {
        if (!p.rubber.length) return p.set({ rubber: [pt], hint: 'Click the opposite corner.' });
        regionRect = { a: p.rubber[0], b: pt };
        return p.set({ rubber: [], box: regionRect, hint: 'Click the reference point (e.g. grid A/1) that maps to the model origin.' });
      }
      const rect = regionRect;
      regionRect = null;
      p.set({ box: null });
      openDialog({ kind: 'region', rect, ref: pt });
      return;
    }
    case 'calibrate': {
      const st = A().activeStory;
      const isDxf = useUnderlay.getState().kind === 'dxf';
      const sh = sheetFor(st);
      if (!isDxf && !sh) return toast(`No PDF page assigned to ${st}.`);
      if (calibStage === 'dist') {
        if (calibPts.length === 2) calibPts = []; // a third click starts a new reference line
        calibPts.push(pt);
        p.set({ rubber: calibPts.length === 2 ? [] : [...calibPts], measure: calibPts.length === 2 ? { pts: [...calibPts], text: '' } : null });
        if (calibPts.length === 2) {
          const cur = dist(calibPts[0], calibPts[1]);
          p.set({ hint: `Reference line is ${fmt(cur)} units now. Type its real length in mm and press Enter.` });
          document.getElementById('cmd')?.focus();
        }
        return;
      }
      // ref stage (PDF only): world → PDF point
      if (!sh) return;
      const u = useUnderlay.getState();
      const pdfPt = { x: pt.x / sh.s + sh.ref.x, y: pt.y / sh.s + sh.ref.y };
      u.set({ sheets: u.sheets.map((x) => (x.story === st ? { ...x, ref: pdfPt } : x)) });
      saveUnderlayMeta();
      toast('Reference point set. That point is now the model origin (0,0) for this story.');
      setTool('select');
      return;
    }
  }
}

function measureText(pts: Pt[]) {
  let tot = 0;
  for (let i = 1; i < pts.length; i++) tot += dist(pts[i - 1], pts[i]);
  if (pts.length < 2) return '';
  const a = pts[pts.length - 2],
    b = pts[pts.length - 1];
  return `${pts.length > 2 ? `Total ${fmt(tot)} | ` : ''}L=${fmt(dist(a, b))}  dx=${fmt(b.x - a.x)}  dy=${fmt(b.y - a.y)}  ∠${fmt(angleDeg(a, b), 2)}°`;
}

function pickOffsetSource(pt: Pt) {
  const m = A().model;
  const tol = SNAP_PX / viewport.k;
  let best: [Pt, Pt] | null = null,
    bd = tol,
    isGrid = false;
  for (const b of m.beams) {
    if (b.story !== A().activeStory) continue;
    const a = { x: b.x1, y: b.y1 },
      c = { x: b.x2, y: b.y2 };
    const d = distToSeg(pt, a, c);
    if (d < bd) (bd = d), (best = [a, c]), (isGrid = false);
  }
  for (const g of m.grids) {
    const a = { x: g.x1, y: g.y1 },
      c = { x: g.x2, y: g.y2 };
    const d = distToSeg(pt, a, c);
    if (d < bd) (bd = d), (best = [a, c]), (isGrid = true);
  }
  if (!best) return toast('Pick a grid line or a beam.');
  offsetSrc = best;
  offsetFromGrid = isGrid;
  P().set({ hint: 'Move to the side, type a distance + Enter, or click.' });
}

function createOffsetBeam(line: [Pt, Pt]) {
  let [a, b] = line;
  if (offsetFromGrid) {
    // trim to the first/last crossing grid
    const m = A().model;
    const ts: number[] = [];
    for (const g of m.grids) {
      const x = segIntersect(a, b, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 });
      if (x) ts.push(x.t);
    }
    if (ts.length >= 2) {
      const t0 = Math.min(...ts),
        t1 = Math.max(...ts);
      const d = sub(b, a);
      [a, b] = [add(a, { x: d.x * t0, y: d.y * t0 }), add(a, { x: d.x * t1, y: d.y * t1 })];
    }
  }
  A().commit((m) => addBeams(m, [[a, b]], drawStories(), A().active.beam));
  P().set({ input: '' });
}

export function finishPolygon() {
  const p = P();
  const t = A().tool;
  const pts = p.rubber;
  if (pts.length < 3) return;
  if (t === 'slabDraw') {
    for (const st of drawStories()) A().commit((m) => addSlab(m, pts, st, A().active.slab));
    p.set({ rubber: [] });
  } else if (t === 'area') {
    let per = 0;
    for (let i = 0; i < pts.length; i++) per += dist(pts[i], pts[(i + 1) % pts.length]);
    p.set({ rubber: [], measure: { pts: [...pts, pts[0]], text: `Area = ${fmt(Math.abs(polyArea(pts)) / 1e6, 3)} m²   Perimeter = ${fmt(per)} mm` } });
  }
}

/** Typed command-line input (Enter). */
export function onInput(text: string) {
  const t = A().tool;
  const p = P();
  p.set({ input: '' });
  if (t === 'beamOffset' && offsetSrc) {
    const d = parseFloat(text);
    if (isNaN(d)) return;
    const cur = p.cursor ?? offsetSrc[0];
    const sgn = side(cur, offsetSrc[0], offsetSrc[1]) > 0 ? 1 : -1;
    createOffsetBeam(offsetSeg(offsetSrc[0], offsetSrc[1], sgn * d));
    return;
  }
  if (t === 'calibrate' && calibStage === 'dist' && calibPts.length === 2) {
    const real = parseFloat(text);
    if (!(real > 0)) return toast('Enter a positive distance in mm.');
    const st = A().activeStory;
    const u = useUnderlay.getState();
    const cur = dist(calibPts[0], calibPts[1]);
    if (u.kind === 'dxf') {
      const f = real / cur;
      rescaleDxf(u.dxfScale * f);
      // the drawing grew by f around the origin; shrink the zoom by f so the screen picture stays put
      viewport.k /= f;
      viewport.changed();
      const m = A().model;
      const drawn = m.grids.length + m.columns.length + m.beams.length + m.slabs.length;
      toast(`DXF scale set: 1 drawing unit = ${fmt(u.dxfScale * f, 4)} mm.` + (drawn ? ' Elements already drawn were not rescaled.' : ''));
      calibPts = [];
      setTool('select');
      return;
    }
    u.set({ sheets: u.sheets.map((x) => (x.story === st ? { ...x, s: (x.s * real) / cur } : x)) });
    saveUnderlayMeta();
    calibPts = [];
    calibStage = 'ref';
    p.set({ rubber: [], hint: 'Scale set. Now click the reference point (e.g. grid A/1) → model origin.' });
    return;
  }
  // point tools: relative to last rubber point, else to the tracked snap point
  const last = p.rubber[p.rubber.length - 1] ?? p.track;
  if (!last) return toast('Hover a snap point first to use as the base for typed input.');
  const dir = p.cursor ? angleDeg(last, p.cursor) : 0;
  const rel = parseRelative(text, dir);
  if (!rel) return toast('Use dx,dy  or  @dist<angle  or  a length.');
  onClick(add(last, rel));
}

export function onCancel() {
  const p = P();
  if (p.rubber.length || p.measure || offsetSrc || regionRect || p.box) return resetTool();
  if (A().tool !== 'select') setTool('select');
  else A().setSelection([]);
}

/** Column tool window: fill grid intersections inside the screen box. */
export function fillIntersections(a: Pt, b: Pt) {
  const minX = Math.min(a.x, b.x),
    maxX = Math.max(a.x, b.x),
    minY = Math.min(a.y, b.y),
    maxY = Math.max(a.y, b.y);
  const pts = cachedIntersections(A().model.grids).filter((w) => {
    const s = viewport.toScreen(w);
    return s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
  });
  if (!pts.length) return toast('No grid intersections in the window.');
  A().commit((m) => addColumns(m, pts, drawStories(), A().active.column, A().columnAngle));
  toast(`Placed columns at ${pts.length} intersections.`);
}

// ---------- selection ----------

export function hitTest(m: Model, screen: Pt, story: string): string | null {
  const w = viewport.toWorld(screen);
  const tol = 8 / viewport.k;
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  for (const c of m.columns)
    if (c.story === story) {
      const ol = columnOutline(c, secs.get(c.section));
      if (dist(c, w) < tol || insidePoly(w, ol)) return c.id;
    }
  let best: string | null = null,
    bd = tol;
  for (const b of m.beams)
    if (b.story === story) {
      const d = distToSeg(w, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 });
      if (d < bd) (bd = d), (best = b.id);
    }
  if (best) return best;
  for (const g of m.grids) {
    const d = distToSeg(w, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 });
    if (d < bd) (bd = d), (best = g.id);
  }
  if (best) return best;
  if (A().show.slabs) for (const s of m.slabs) if (s.story === story && insidePoly(w, s.pts)) return s.id;
  return null;
}

function insidePoly(p: Pt, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Window (fully inside) or crossing (touching) selection, tested in screen space so view rotation is respected. */
export function boxSelect(m: Model, a: Pt, b: Pt, story: string, crossing: boolean): string[] {
  const minX = Math.min(a.x, b.x),
    maxX = Math.max(a.x, b.x),
    minY = Math.min(a.y, b.y),
    maxY = Math.max(a.y, b.y);
  const inB = (s: Pt) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const segHits = (p: Pt, q: Pt) => {
    if (inB(p) || inB(q)) return true;
    for (let i = 0; i < 4; i++) if (segIntersect(p, q, corners[i], corners[(i + 1) % 4])) return true;
    return false;
  };
  const test = (pts: Pt[], closed: boolean) => {
    const s = pts.map((p) => viewport.toScreen(p));
    if (!crossing) return s.every(inB);
    const n = closed ? s.length : s.length - 1;
    for (let i = 0; i < n; i++) if (segHits(s[i], s[(i + 1) % s.length])) return true;
    return s.length === 1 && inB(s[0]);
  };
  const ids: string[] = [];
  for (const c of m.columns) if (c.story === story && test([c], false)) ids.push(c.id);
  for (const bm of m.beams) if (bm.story === story && test([{ x: bm.x1, y: bm.y1 }, { x: bm.x2, y: bm.y2 }], false)) ids.push(bm.id);
  for (const s of m.slabs) if (s.story === story && test(s.pts, true)) ids.push(s.id);
  for (const g of m.grids) if (test([{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }], false)) ids.push(g.id);
  return ids;
}

export { projectOnSeg, lineIntersect, regionFor };
