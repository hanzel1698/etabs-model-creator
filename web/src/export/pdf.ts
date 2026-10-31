import type { jsPDF } from 'jspdf';
import { FRAME, LEGEND_W, layout, paginate, rowH, type Drawing, type Layout, type Orient, type Prim } from './sheets';

const PT = 72 / 25.4; // pt per mm (jsPDF font sizes are in pt)
const INK = '#1f2429',
  MUTED = '#5d6670';

/** Centred (or left-aligned) text at paper point x, y; rot in degrees counter-clockwise; lines split on \n. */
function text(doc: jsPDF, s: string, x: number, y: number, size: number, o: { color?: string; rot?: number; bold?: boolean; left?: boolean; right?: boolean } = {}) {
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
  doc.setFontSize(size * PT);
  doc.setTextColor(o.color ?? INK);
  const r = ((o.rot ?? 0) * Math.PI) / 180,
    c = Math.cos(r),
    sn = Math.sin(r);
  const lines = s.split('\n');
  lines.forEach((ln, i) => {
    const w = doc.getTextWidth(ln);
    const dx = o.left ? 0 : o.right ? -w : -w / 2;
    // line i below the first, whole block centred vertically on the point (baseline ~0.35 em under centre)
    const dy = o.left || o.right ? i * size * 1.25 : (i - (lines.length - 1) / 2) * size * 1.25 + size * 0.35;
    doc.text(ln, x + dx * c + dy * sn, y - dx * sn + dy * c, { angle: o.rot ?? 0 });
  });
}

function prim(doc: jsPDF, p: Prim, L: Layout, fx: number, fy: number) {
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
    text(doc, p.s, X(p.p.x) + (p.off?.x ?? 0), Y(p.p.y) - (p.off?.y ?? 0), size, { color: p.color, rot: p.rot, bold: p.bold, left: p.left });
  } else {
    const r = 3,
      x = X(p.p.x) + p.u.x * (r + 0.5),
      y = Y(p.p.y) - p.u.y * (r + 0.5);
    doc.setDrawColor('#4b525b');
    doc.setFillColor('#ffffff');
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([], 0);
    doc.circle(x, y, r, 'FD');
    text(doc, p.s, x, y, 2.6, { color: INK });
  }
}

function legend(doc: jsPDF, d: Drawing, L: Layout, fx: number, fy: number) {
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
      if (r.sub) text(doc, r.sub, x + LEGEND_W - 1, sy + 2.6, 1.8, { color: MUTED, right: true });
      yy += h;
    }
    if (L.legend.side === 'bottom') (x += LEGEND_W + 4), (y = top);
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
  for (const p of d.underlay) prim(doc, p, L, fx, fy);
  for (const p of d.prims) prim(doc, p, L, fx, fy);
  legend(doc, d, L, fx, fy);
  const tx = fx + L.title.x,
    ty = fy + L.title.y;
  text(doc, `${d.title}  ·  ${d.region}`, tx, ty, 4, { bold: true });
  doc.setDrawColor(INK);
  doc.setLineWidth(0.3);
  doc.line(tx - 50, ty + 2.2, tx + 50, ty + 2.2);
  text(doc, `SCALE 1:${L.S}${d.stories.length > 1 && d.region !== 'ALL STOREYS' ? `  ·  STOREYS ${d.stories.join(', ')}` : ''}`, tx, ty + 6.5, 2.2, { color: MUTED });
  if (d.underlay.length) text(doc, 'DXF underlay in grey', fx + 4, fy + 5, 1.9, { color: '#9097a1', left: true });
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
  }
  return doc ?? new jsPDF({ unit: 'mm', format: 'a2' });
}
