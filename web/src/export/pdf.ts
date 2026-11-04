import type { jsPDF } from 'jspdf';
import { DXF_LINE, lineDy } from '../underlay/dxf';
import { FRAME, freeSpot, layout, legendCols, paginate, placeBeamLabels, rowH, type BeamLabelIn, type Box, type Drawing, type Layout, type Orient, type Prim } from './sheets';

const PT = 72 / 25.4; // pt per mm (jsPDF font sizes are in pt)
const INK = '#1f2429',
  MUTED = '#5d6670';

/** Centred (or left-aligned) text at paper point x, y; rot in degrees counter-clockwise; lines split on \n. */
function text(doc: jsPDF, s: string, x: number, y: number, size: number, o: { color?: string; rot?: number; bold?: boolean; left?: boolean; right?: boolean; anchor?: { ha: number; va: number } } = {}) {
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
  doc.setFontSize(size * PT);
  doc.setTextColor(o.color ?? INK);
  const r = ((o.rot ?? 0) * Math.PI) / 180,
    c = Math.cos(r),
    sn = Math.sin(r);
  const lines = s.split('\n');
  lines.forEach((ln, i) => {
    const w = doc.getTextWidth(ln);
    const dx = o.anchor ? -w * o.anchor.ha : o.left ? 0 : o.right ? -w : -w / 2;
    // line i below the first, whole block centred vertically on the point (baseline ~0.35 em under centre)
    const dy = o.anchor ? lineDy({ h: size, va: o.anchor.va }, lines.length, i) : o.left || o.right ? i * size * 1.25 : (i - (lines.length - 1) / 2) * size * 1.25 + size * 0.35;
    doc.text(ln, x + dx * c + dy * sn, y - dx * sn + dy * c, { angle: o.rot ?? 0 });
  });
}

/** Paper-mm bounding box of an anchored (DXF) text prim, as `text` draws it. */
function textBox(doc: jsPDF, p: Extract<Prim, { t: 'text' }>, x: number, y: number, size: number): Box {
  doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
  doc.setFontSize(size * PT);
  const lines = p.s.split('\n');
  const w = Math.max(...lines.map((l) => doc.getTextWidth(l))),
    H = size + (lines.length - 1) * size * DXF_LINE,
    a = p.anchor ?? { ha: 0.5, va: 0.5 };
  const r = ((p.rot ?? 0) * Math.PI) / 180,
    c = Math.cos(r),
    sn = Math.sin(r);
  const pts = [[-w * a.ha, -a.va * H], [w * (1 - a.ha), -a.va * H], [w * (1 - a.ha), (1 - a.va) * H], [-w * a.ha, (1 - a.va) * H]].map(([dx, dy]) => [x + dx * c + dy * sn, y - dx * sn + dy * c]);
  return { minX: Math.min(...pts.map((q) => q[0])), minY: Math.min(...pts.map((q) => q[1])), maxX: Math.max(...pts.map((q) => q[0])), maxY: Math.max(...pts.map((q) => q[1])) };
}

/** Paper centre and radius of a grid bubble. */
function bubbleAt(p: Extract<Prim, { t: 'bubble' }>, X: (x: number) => number, Y: (y: number) => number) {
  const r = 3;
  return { x: X(p.p.x) + p.u.x * (r + 0.5), y: Y(p.p.y) - p.u.y * (r + 0.5), r };
}

/** Draws a prim; obstacles collects drawn DXF texts and fitted labels so fitted labels avoid them; fitted gets the fitted labels alone. */
function prim(doc: jsPDF, p: Prim, L: Layout, fx: number, fy: number, obstacles: Box[] = [], fitted: Box[] = []) {
  const X = (x: number) => fx + L.ox + x / L.S,
    Y = (y: number) => fy + L.oy - y / L.S;
  if (p.t === 'line') {
    doc.setDrawColor(p.color);
    doc.setLineWidth(p.w);
    doc.setLineDashPattern(p.dash ? [5, 1, 0.6, 1] : [], 0);
    doc.line(X(p.a.x), Y(p.a.y), X(p.b.x), Y(p.b.y));
  } else if (p.t === 'poly') {
    const pts = p.pts.map((q) => [X(q.x), Y(q.y)]);
    const deltas = pts.slice(1).map((q, i) => [q[0] - pts[i][0], q[1] - pts[i][1]]);
    if ((p.op ?? 1) > 0) {
      doc.setFillColor(p.fill);
      doc.setGState(new (doc as any).GState({ opacity: p.op ?? 1 }));
      doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true);
      doc.setGState(new (doc as any).GState({ opacity: 1 }));
    }
    if (p.stroke) {
      doc.setDrawColor(p.stroke);
      doc.setLineWidth(0.1);
      doc.setLineDashPattern([], 0);
      doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'S', true);
    }
  } else if (p.t === 'text') {
    const size = p.model ? p.size / L.S : p.size;
    if (size < 0.8) return; // unreadable once printed
    let x = X(p.p.x) + (p.off?.x ?? 0),
      y = Y(p.p.y) - (p.off?.y ?? 0);
    if (p.fit) {
      doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
      doc.setFontSize(size * PT);
      const w = Math.max(...p.s.split('\n').map((l) => doc.getTextWidth(l))) + 1.2,
        h = p.s.split('\n').length * size * 1.25 + 0.6;
      ({ x, y } = freeSpot(p.fit.map((poly) => poly.map((q) => ({ x: X(q.x), y: Y(q.y) }))), w, h, { x, y }, obstacles));
      doc.setFillColor('#ffffff');
      doc.rect(x - w / 2, y - h / 2, w, h, 'F');
      obstacles.push({ minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 });
      fitted.push(obstacles[obstacles.length - 1]);
    } else if (p.anchor) obstacles.push(textBox(doc, p, x, y, size));
    text(doc, p.s, x, y, size, { color: p.color, rot: p.rot, bold: p.bold, left: p.left, anchor: p.anchor });
  } else {
    const { x, y, r } = bubbleAt(p, X, Y);
    doc.setDrawColor('#4b525b');
    doc.setFillColor('#ffffff');
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([], 0);
    doc.circle(x, y, r, 'FD');
    text(doc, p.s, x, y, 2.6, { color: INK });
  }
}

/** Beam labels last, each on a white mask; crowded ones moved off with a leader arrow (see placeBeamLabels). */
function beamLabels(doc: jsPDF, d: Drawing, o: Orient, L: Layout, fx: number, fy: number, fitted: Box[]) {
  const X = (x: number) => fx + L.ox + x / L.S,
    Y = (y: number) => fy + L.oy - y / L.S;
  const ps = d.prims.filter((p): p is Extract<Prim, { t: 'text' }> => p.t === 'text' && !!p.beam);
  if (!ps.length) return;
  const ins: BeamLabelIn[] = ps.map((p) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(p.size * PT);
    return { a: { x: X(p.beam!.a.x), y: Y(p.beam!.a.y) }, b: { x: X(p.beam!.b.x), y: Y(p.beam!.b.y) }, w: doc.getTextWidth(p.s) + 1.2, h: p.size, rot: p.rot ?? 0 };
  });
  // columns and grid bubbles stay clear, as do the legend and title
  const hard: Box[] = d.prims.flatMap((p): Box[] => {
    if (p.t === 'poly' && p.op === undefined) {
      const xs = p.pts.map((q) => X(q.x)), ys = p.pts.map((q) => Y(q.y));
      return [{ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }];
    }
    if (p.t !== 'bubble') return [];
    const { x, y, r } = bubbleAt(p, X, Y);
    return [{ minX: x - r, minY: y - r, maxX: x + r, maxY: y + r }];
  });
  const [W, H] = FRAME[o];
  hard.push(L.legend.side === 'right' ? { minX: fx + L.legend.x - 2, minY: fy, maxX: fx + W, maxY: fy + H } : { minX: fx, minY: fy + L.legend.y - 6, maxX: fx + W, maxY: fy + H });
  hard.push({ minX: fx + L.title.x - 55, minY: fy + L.title.y - 4, maxX: fx + L.title.x + 55, maxY: fy + L.title.y + 8 });
  const area = { minX: fx + 3, minY: fy + 3, maxX: fx + W - 3, maxY: fy + H - 3 };

  placeBeamLabels(ins, [...fitted, ...hard], area).forEach((r, i) => {
    const p = ps[i],
      { w, h } = ins[i],
      a = (r.rot * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    // mask: the label's rectangle turned with it, corner offsets as text() turns them
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([dx, dy]) => [r.p.x + dx * c + dy * s, r.p.y - dx * s + dy * c]);
    doc.setFillColor('#ffffff');
    doc.lines(pts.slice(1).map((q, k) => [q[0] - pts[k][0], q[1] - pts[k][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
    text(doc, p.s, r.p.x, r.p.y, p.size, { color: p.color, rot: r.rot, bold: true });
    if (!r.leader) return;
    const [m, e] = r.leader,
      len = Math.hypot(e.x - m.x, e.y - m.y),
      ux = (e.x - m.x) / len,
      uy = (e.y - m.y) / len,
      bx = m.x + ux * 1.3,
      by = m.y + uy * 1.3;
    doc.setDrawColor(p.color);
    doc.setLineWidth(0.18);
    doc.setLineDashPattern([], 0);
    doc.line(e.x, e.y, bx, by);
    doc.setFillColor(p.color);
    doc.triangle(m.x, m.y, bx - uy * 0.45, by + ux * 0.45, bx + uy * 0.45, by - ux * 0.45, 'F');
  });
}

function legend(doc: jsPDF, d: Drawing, L: Layout, fx: number, fy: number) {
  const cols = legendCols(d);
  let x = fx + L.legend.x,
    y = fy + L.legend.y;
  text(doc, 'LEGEND', x, y, 2.6, { bold: true, left: true });
  y += 7;
  const top = y;
  for (const g of d.legend) {
    text(doc, g.title, x, y, 2.2, { bold: true, left: true });
    let yy = y + 2;
    for (const r of g.rows) {
      const h = rowH(r),
        sy = yy + 1;
      doc.setLineDashPattern([], 0);
      if (r.kind === 'line') {
        doc.setDrawColor(r.color);
        doc.setLineWidth(1);
        doc.line(x, sy + 1.8, x + 7, sy + 1.8);
      } else {
        doc.setFillColor(r.color);
        doc.setDrawColor('#7b828c');
        doc.setLineWidth(0.12);
        if (r.kind === 'rect') doc.rect(x + 2, sy, 3.2, 3.6, 'F');
        else doc.rect(x, sy, 7, h - 1.4, 'FD');
      }
      r.label.forEach((l, i) => text(doc, l, x + 9, sy + 2.6 + i * 2.7, 2, { left: true }));
      if (r.sub) text(doc, r.sub, x + cols.subX, sy + 2.6, 1.8, { color: MUTED, left: true });
      yy += h;
    }
    if (L.legend.side === 'bottom') (x += cols.w + 4), (y = top);
    else y = yy + 4;
  }
}

function drawFrame(doc: jsPDF, d: Drawing, o: Orient, fx: number, fy: number) {
  const [W, H] = FRAME[o];
  const L = layout(d, o);
  doc.setDrawColor(INK);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([], 0);
  doc.rect(fx, fy, W, H, 'S');
  // translucent area fills under the AR so it stays visible; everything else over it
  const fill = (p: Prim) => p.t === 'poly' && p.op !== undefined;
  const obstacles: Box[] = [],
    fitted: Box[] = [];
  for (const p of d.prims.filter(fill)) prim(doc, p, L, fx, fy);
  for (const p of d.underlay) prim(doc, p, L, fx, fy, obstacles);
  for (const p of d.prims.filter((p) => !fill(p) && !(p.t === 'text' && p.beam))) prim(doc, p, L, fx, fy, obstacles, fitted);
  beamLabels(doc, d, o, L, fx, fy, fitted);
  legend(doc, d, L, fx, fy);
  const tx = fx + L.title.x,
    ty = fy + L.title.y;
  text(doc, `${d.title}  ·  ${d.region}`, tx, ty, 4, { bold: true });
  doc.setDrawColor(INK);
  doc.setLineWidth(0.3);
  doc.line(tx - 50, ty + 2.2, tx + 50, ty + 2.2);
  text(doc, `SCALE 1:${L.S}${d.stories.length > 1 ? `  ·  STOREYS ${d.stories.join(', ')}` : ''}`, tx, ty + 6.5, 2.2, { color: MUTED });
  if (d.underlay.length) text(doc, 'DXF underlay', fx + 4, fy + 5, 1.9, { color: '#9097a1', left: true });
}

/**
 * A2 PDF of the drawings: A3 landscape frames go two to an A2 portrait page (stacked), A3 portrait
 * frames two to an A2 landscape page (side by side).
 */
export async function plansPdf(items: { item: Drawing; o: Orient }[]): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  let doc: jsPDF | null = null;
  for (const pg of paginate(items)) {
    const a2 = pg.o === 'L' ? 'p' : 'l';
    if (!doc) doc = new jsPDF({ unit: 'mm', format: 'a2', orientation: a2 });
    else doc.addPage('a2', a2);
    pg.slots.forEach((d, i) => drawFrame(doc!, d, pg.o, 10 + (pg.o === 'P' ? i * 297 : 0), 10 + (pg.o === 'L' ? i * 297 : 0)));
    // cut line between the two A3 halves
    doc.setDrawColor('#b8bcc3');
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([2, 2], 0);
    if (pg.o === 'L') doc.line(0, 297, 420, 297);
    else doc.line(297, 0, 297, 420);
    // A2 trim lines at the two roll-feed edges (parallel to the cut line), so printer feed offset can be trimmed off
    doc.setLineDashPattern([], 0);
    if (pg.o === 'L') { doc.line(0, 0.1, 420, 0.1); doc.line(0, 593.9, 420, 593.9); }
    else { doc.line(0.1, 0, 0.1, 420); doc.line(593.9, 0, 593.9, 420); }
  }
  return doc ?? new jsPDF({ unit: 'mm', format: 'a2' });
}
