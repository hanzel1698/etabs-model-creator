// Vector PDF of bathroom sections: each section is a block (drawing at a standard scale, then its catch-check table),
// stacked down the page. All on one A4 if they fit, else one A3, else as many A3s as it takes.
import type { jsPDF } from 'jspdf';
import type { BeamCheck } from './engine/checks';
import { checkRun, summarise } from './engine/checks';
import { cutSection, mirrorRun, shouldMirrorForDisplay } from './engine/cut';
import { levelTags, sectionGeometry, type SectionElement } from './engine/levels';
import type { PlanModel, SectionRun } from './engine/types';
import type { Model, SectionCut } from '../model/types';
import { toPlanModel, toSectionLine } from './toPlan';

const PT = 72 / 25.4; // jsPDF font sizes are in pt
const INK = '#16191d',
  MUTED = '#5b6470',
  RED = '#c0392b',
  GREEN = '#1e6b34';
const M = 10, // frame margin
  PAD = 6, // content inset inside the frame
  GAP = 8, // between section blocks
  COL_MIN = 185, // narrowest column a block's table still fits in
  COL_GAP = 10;
const DRAW_MAX = 55; // tallest a section drawing may get (mm)
const ROW_H = 4.6;
const SCALES = [5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
const PAPERS = [
  { name: 'a4', label: 'A4', W: 297, H: 210 },
  { name: 'a3', label: 'A3', W: 420, H: 297 },
] as const;
const LEGEND =
  'Levels are mm below the general floor slab structural concrete top. The soffit margin is how far the beam soffit reaches past the slab soffit; the top margin is how far the beam top sits above the slab top. Either negative means the beam cannot catch that slab: "top" is the level it must come back up to, "deep" the overall depth it then needs.';

/** Helvetica in jsPDF is WinAnsi only: no arrows. */
const safe = (s: string) => s.replace(/↓\s*/g, 'sunk ').replace(/↑\s*/g, 'raised ').replace(/⇆/g, '');
const signed = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`;

function text(doc: jsPDF, s: string, x: number, y: number, size: number, o: { color?: string; bold?: boolean; align?: 'left' | 'center' | 'right' } = {}) {
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
  doc.setFontSize(size * PT);
  doc.setTextColor(o.color ?? INK);
  doc.text(safe(s), x, y + size * 0.35, { align: o.align ?? 'center' });
}

function wrap(doc: jsPDF, s: string, w: number): string[] {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(2.4 * PT);
  return doc.splitTextToSize(safe(s), w) as string[];
}

const FILL: Record<string, string> = {
  slab: '#e8edf3',
  'slab-sunk': '#dbe9f6',
  beam: '#cfd8e3',
  'beam-sunk': '#b8c7d9',
  'beam-long': '#dfe6ee',
  'beam-fail': '#fadbd6',
  upstand: '#e4d4a8',
  column: '#b9c2ce',
};
const fillOf = (e: SectionElement) =>
  e.kind === 'beam' ? (!e.pass ? FILL['beam-fail'] : e.longitudinal ? FILL['beam-long'] : e.sunken ? FILL['beam-sunk'] : FILL.beam) : e.kind === 'slab' && e.sunken ? FILL['slab-sunk'] : FILL[e.kind];

/** Zigzag break across a member cut short (column ends). */
function breakLine(doc: jsPDF, x1: number, y: number, x2: number) {
  const w = x2 - x1,
    a = Math.max(0.6, Math.min(1.5, w * 0.12)),
    m = (x1 + x2) / 2;
  const pts = [
    [x1, y],
    [x1 + w * 0.35, y],
    [m, y - a],
    [m, y + a],
    [x1 + w * 0.65, y],
    [x2, y],
  ];
  for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
}

/** Label a cut member: across it if it fits, else up it, else (beams only) just under it. */
function memberLabel(doc: jsPDF, e: SectionElement, x: number, y: number, w: number, h: number) {
  const size = 2.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size * PT);
  const tw = doc.getTextWidth(safe(e.label));
  if (tw + 1 <= w && h >= size * 1.1) return text(doc, e.label, x + w / 2, y + h / 2, size);
  if (tw + 1 <= h && w >= size * 1.1) {
    doc.setTextColor(INK);
    return void doc.text(safe(e.label), x + w / 2 + size * 0.35, y + h / 2 + tw / 2, { angle: 90 });
  }
  if (e.kind === 'beam') text(doc, e.label, x + w / 2, y + h + 2.2, size);
}

export interface SectionSheet {
  plan: PlanModel;
  run: SectionRun;
  checks: BeamCheck[];
  label: string;
  story: string;
  exaggeration: number;
}

/** One saved section cut, cut and checked the way the Section view shows it. */
export function sheetFor(model: Model, cut: SectionCut, exaggeration: number): SectionSheet {
  const { plan, origin } = toPlanModel(model, cut.story);
  const line = toSectionLine(cut, origin);
  const r = cutSection(plan, line);
  const run = shouldMirrorForDisplay(line) ? mirrorRun(r) : r;
  return { plan, run, checks: checkRun(plan, run), label: cut.label, story: cut.story, exaggeration };
}

interface Block {
  h: number;
  draw: (x0: number, top: number) => void;
}

/** Lay one section out at content width w; `draw` paints it with its top-left corner at (x0, top). */
function block(doc: jsPDF, { plan, run, checks, label, story, exaggeration }: SectionSheet, w: number): Block {
  const g = sectionGeometry(plan, run, checks);
  const span = Math.max(g.maxLevel - g.minLevel, 1) * 1.25;
  const S = SCALES.find((s) => g.length / s <= w - 26 && span / s <= DRAW_MAX) ?? SCALES[SCALES.length - 1];
  const sx = 1 / S,
    sy = Math.min(exaggeration / S, DRAW_MAX / span);
  const ex = Math.round((sy / sx) * 10) / 10;
  const dh = span * sy;
  const notes = [...run.warnings, ...new Set(checks.flatMap((c) => [...c.warnings, ...c.bearingWarnings]))].map((n) => wrap(doc, n, w));
  const rowsOf = (c: BeamCheck) => (c.endBearing.some((e) => !e.pass) ? 3 : 2);
  const TITLE = 7,
    BUBBLES = 10,
    BELOW = 6,
    VERDICT = 6;
  const tableH = checks.length ? 5 + checks.reduce((n, c) => n + rowsOf(c), 0) * ROW_H : 0;
  const notesH = notes.reduce((n, l) => n + l.length * 3.2 + 1.2, 0);
  const h = TITLE + BUBBLES + dh + BELOW + VERDICT + tableH + notesH;

  const draw = (x0: number, top: number) => {
    const dx0 = x0 + 26,
      dx1 = x0 + w;
    const drawTop = top + TITLE + BUBBLES;
    const x0d = dx0 + (dx1 - dx0 - g.length * sx) / 2;
    const oy = drawTop + dh / 2 - ((g.minLevel + g.maxLevel) / 2) * sy;
    const X = (d: number) => x0d + d * sx,
      Y = (lv: number) => oy + lv * sy;

    text(doc, `SECTION ${label}  ·  ${story}`, x0, top + 2, 3.4, { bold: true, align: 'left' });
    text(doc, `SCALE 1:${S}${ex !== 1 ? `  ·  levels exaggerated ${ex}x` : ''}`, x0 + w, top + 2, 2.4, { color: MUTED, align: 'right' });

    // datum and level tags
    doc.setLineWidth(0.25);
    doc.setDrawColor(INK);
    doc.setLineDashPattern([6, 1.5, 1, 1.5], 0);
    doc.line(x0, Y(0), dx1, Y(0));
    text(doc, '0.000 SLAB TOP', x0, Y(0) - 2, 2.2, { align: 'left', color: MUTED });
    doc.setDrawColor('#9aa4b0');
    doc.setLineDashPattern([1.5, 1.5], 0);
    for (const lv of levelTags(g).filter((l) => l !== 0)) {
      doc.line(x0 + 10, Y(lv), dx1, Y(lv));
      text(doc, lv > 0 ? `-${lv}` : `+${-lv}`, x0 + 10, Y(lv) - 1.6, 2.2, { align: 'left', color: MUTED });
    }

    // grid lines the section crosses (only those with an EMC grid behind them)
    const grids = run.gridCrossings.filter((c) => c.label);
    const gTop = Y(g.minLevel) - 3,
      gBot = Y(g.maxLevel) + 3,
      bubbleY = gTop - 5;
    doc.setDrawColor('#9aa4b0');
    doc.setLineDashPattern([6, 1.5, 1, 1.5], 0);
    for (const c of grids) doc.line(X(c.d), gTop, X(c.d), gBot);

    // members: columns first, then long beams, then cut slabs/beams (sectionGeometry's order)
    doc.setLineDashPattern([], 0);
    for (const e of g.elements) {
      const x = X(e.d0),
        ew = Math.max((e.d1 - e.d0) * sx, 0.2),
        y = Y(e.top),
        eh = Math.max((e.bottom - e.top) * sy, 0.2);
      const fail = e.kind === 'beam' && !e.pass;
      doc.setFillColor(fillOf(e));
      doc.setDrawColor(fail ? RED : INK);
      doc.setLineWidth(fail ? 0.5 : 0.25);
      doc.rect(x, y, ew, eh, 'FD');
      doc.setDrawColor(INK);
      doc.setLineWidth(0.25);
      if (e.kind === 'column') {
        breakLine(doc, x, y, x + ew);
        breakLine(doc, x, y + eh, x + ew);
      } else {
        doc.setLineDashPattern([0.5, 0.5], 0);
        if (e.d0Cut) doc.line(x, y, x, y + eh);
        if (e.d1Cut) doc.line(x + ew, y, x + ew, y + eh);
        doc.setLineDashPattern([], 0);
        memberLabel(doc, e, x, y, ew, eh);
      }
    }

    // failing faces: where the soffit must reach, or the top must come back up to
    doc.setDrawColor(RED);
    doc.setLineWidth(0.35);
    for (const c of checks.filter((c) => !c.pass)) {
      const x = X((c.d0 + c.d1) / 2);
      doc.setLineDashPattern([1.2, 0.8], 0);
      if (c.requiredSoffitLevel > c.soffitLevel) {
        doc.line(x, Y(c.soffitLevel), x, Y(c.requiredSoffitLevel));
        text(doc, `needs ${Math.round(c.requiredDepth)}`, x, Y(c.requiredSoffitLevel) + 3, 2.2, { color: RED, bold: true });
      }
      if (c.requiredTopLevel !== null && c.requiredTopLevel < c.topLevel) {
        doc.line(x, Y(c.topLevel), x, Y(c.requiredTopLevel));
        text(doc, `top ${c.requiredTopLevel}`, x + 1, Y(c.requiredTopLevel) - 2.2, 2.2, { color: RED, bold: true, align: 'left' });
      }
    }
    doc.setLineDashPattern([], 0);

    // grid bubbles on top
    doc.setDrawColor(INK);
    doc.setLineWidth(0.3);
    for (const c of grids) {
      doc.setFillColor('#ffffff'); // text colour shares the PDF fill operator, so reset it per bubble
      doc.circle(X(c.d), bubbleY, 2.6, 'FD');
      text(doc, c.label, X(c.d), bubbleY, 2.5, { bold: true });
    }

    // ---------- catch-check table ----------
    let y = drawTop + dh + BELOW + 2;
    const { total, failing } = summarise(checks);
    const uncaught = checks.reduce((n, c) => n + c.endBearing.filter((e) => !e.pass).length, 0);
    text(doc, 'CATCH CHECK', x0, y, 2.8, { bold: true, align: 'left' });
    const verdict = total === 0 ? 'No beams on this section line.' : failing === 0 ? `${total} beam${total === 1 ? '' : 's'} OK` : `${failing} of ${total} fail`;
    text(doc, verdict + (uncaught ? `  ·  ${uncaught} end${uncaught === 1 ? '' : 's'} uncaught` : ''), x0 + 30, y, 2.8, { bold: true, align: 'left', color: failing || uncaught ? RED : GREEN });
    y += VERDICT;

    const cols = [x0, x0 + 62, x0 + 80, x0 + 98, x0 + 116, x0 + 138]; // Beam, Face, Level, Slab, Margin, Needs
    if (total) {
      ['Beam', 'Face', 'Level', 'Slab', 'Margin', 'Needs'].forEach((hd, i) => text(doc, hd, cols[i], y, 2.4, { align: 'left', color: MUTED, bold: true }));
      y += 2;
      doc.setDrawColor('#d7dce3');
      doc.setLineWidth(0.2);
      doc.line(x0, y, x0 + w, y);
      y += 3;
    }
    for (const c of checks) {
      const rows = rowsOf(c);
      const tp = c.sides.find((s) => s.side === c.governingTopSide);
      const sof = c.sides.find((s) => s.side === c.governingSide);
      if (!c.pass) {
        doc.setFillColor('#fdf1ef');
        doc.rect(x0 - 1, y - 2.6, w + 2, rows * ROW_H, 'F');
      }
      text(doc, c.label, cols[0], y, 2.5, { align: 'left', bold: true });
      if (c.sides.length) text(doc, c.sides.map((s) => s.slabLabel).join(' | '), cols[0], y + ROW_H, 2.1, { align: 'left', color: MUTED });
      const face = (yy: number, name: string, level: number, slab: number | undefined, margin: number | undefined, ok: boolean | undefined) => {
        text(doc, name, cols[1], yy, 2.5, { align: 'left' });
        text(doc, String(level), cols[2], yy, 2.5, { align: 'left' });
        text(doc, slab === undefined ? '-' : String(slab), cols[3], yy, 2.5, { align: 'left' });
        text(doc, margin === undefined ? '-' : `${signed(margin)} ${ok ? 'OK' : 'FAIL'}`, cols[4], yy, 2.5, { align: 'left', bold: true, color: margin === undefined ? INK : ok ? GREEN : RED });
      };
      face(y, 'Top', c.topLevel, tp?.slabTop, tp?.topMargin, tp?.topPass);
      face(y + ROW_H, 'Soffit', c.soffitLevel, sof?.slabSoffit, sof?.margin, sof?.soffitPass);
      if (!c.pass) {
        const needs = [c.sides.some((s) => !s.topPass) ? `top ${c.requiredTopLevel}` : '', Math.round(c.requiredDepth) > Math.round(c.depth) ? `${Math.round(c.requiredDepth)} deep` : ''].filter(Boolean).join(', ');
        text(doc, needs, cols[5], y, 2.5, { align: 'left', color: RED, bold: true });
      }
      const bad = c.endBearing.filter((e) => !e.pass);
      if (bad.length) {
        text(doc, 'Ends', cols[1], y + 2 * ROW_H, 2.5, { align: 'left' });
        const note = bad.map((e) => `${e.which === 'start' ? 'first end' : 'far end'}: ${e.note}${e.supports.length ? ` (on ${e.supports.map((s) => s.label).join(' + ')})` : ''}`).join('  ·  ');
        text(doc, note, cols[2], y + 2 * ROW_H, 2.3, { align: 'left', color: RED });
      }
      y += rows * ROW_H;
      doc.setDrawColor('#e8ecf1');
      doc.setLineWidth(0.15);
      doc.line(x0, y - 2.6, x0 + w, y - 2.6);
    }

    // this section's warnings
    y += 1;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(2.4 * PT);
    doc.setTextColor('#8a5a10');
    for (const lines of notes) {
      doc.text(lines, x0, y + 0.8);
      y += lines.length * 3.2 + 1.2;
    }
  };
  return { h, draw };
}

/** Greedy top-to-bottom fill: indices of blocks per column. */
function pack(heights: number[], avail: number): number[][] {
  const pages: number[][] = [];
  let used = Infinity;
  heights.forEach((h, i) => {
    const need = h + (used === 0 ? 0 : GAP);
    if (used === Infinity || used + need > avail) {
      // shortcut: a block taller than a whole page gets its own page and runs past the frame; upgrade if sections with ~40+ beams show up
      pages.push([i]);
      used = h;
    } else {
      pages[pages.length - 1].push(i);
      used += need;
    }
  });
  return pages;
}

/** All sections on one A4 if they fit, else one A3, else as many A3 pages as needed (landscape). */
export async function sectionsPdf(sheets: SectionSheet[]): Promise<{ doc: jsPDF; paper: string; pages: number }> {
  const { jsPDF } = await import('jspdf');
  for (const p of PAPERS) {
    const doc = new jsPDF({ unit: 'mm', format: p.name, orientation: 'l' });
    const x0 = M + PAD,
      full = p.W - 2 * (M + PAD);
    const ncol = Math.max(1, Math.floor((full + COL_GAP) / (COL_MIN + COL_GAP))),
      w = (full - (ncol - 1) * COL_GAP) / ncol;
    const blocks = sheets.map((s) => block(doc, s, w));
    const legend = wrap(doc, LEGEND, full);
    const legendH = legend.length * 3.2;
    const avail = p.H - 2 * (M + PAD) - legendH - 4;
    // columns filled top to bottom, left to right; ncol columns make a page
    const columns = pack(
      blocks.map((b) => b.h),
      avail,
    );
    const pages = Math.ceil(columns.length / ncol);
    if (pages > 1 && p !== PAPERS[PAPERS.length - 1]) continue;
    for (let n = 0; n < pages; n++) {
      if (n) doc.addPage(p.name, 'l');
      doc.setDrawColor(INK);
      doc.setLineWidth(0.5);
      doc.setLineDashPattern([], 0);
      doc.rect(M, M, p.W - 2 * M, p.H - 2 * M, 'S');
      columns.slice(n * ncol, (n + 1) * ncol).forEach((idx, c) => {
        const cx = x0 + c * (w + COL_GAP);
        if (c) {
          doc.setDrawColor('#c9d0d8');
          doc.setLineWidth(0.2);
          doc.line(cx - COL_GAP / 2, M + PAD, cx - COL_GAP / 2, M + PAD + avail);
        }
        let y = M + PAD;
        idx.forEach((i, k) => {
          if (k) {
            doc.setDrawColor('#c9d0d8');
            doc.setLineWidth(0.2);
            doc.line(cx, y - GAP / 2, cx + w, y - GAP / 2);
          }
          blocks[i].draw(cx, y);
          y += blocks[i].h + GAP;
        });
      });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(2.4 * PT);
      doc.setTextColor(MUTED);
      doc.text(legend, x0, p.H - M - PAD - legendH + 2.4);
      text(doc, `Bathroom sections  ·  sheet ${n + 1} of ${pages}`, p.W - M - PAD, p.H - M - 3, 2.2, { color: MUTED, align: 'right' });
    }
    return { doc, paper: p.label, pages };
  }
  throw new Error('unreachable');
}

/** One section, through the same packing. */
export async function sectionPdf(sheet: SectionSheet): Promise<jsPDF> {
  return (await sectionsPdf([sheet])).doc;
}
