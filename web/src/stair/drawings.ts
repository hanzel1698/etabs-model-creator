import type { Beam, Flight, Landing, StairModel as Model, Span } from '../model/types';
import { analyze, beamName, beamStart, flightStory, frame, landingRect, landingStory, profile, slabLoads, type BeamLoadRow } from './stair';

// Report drawings as SVG strings: black linework on white "paper", world units mm, z / y up.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const lvl = (z: number) => `${z >= 0 ? '+' : '−'}${(Math.abs(z) / 1000).toFixed(3)}`;

const OBJ = 'stroke="#000" stroke-width="1.6" fill="none"',
  THIN = 'stroke="#000" stroke-width="0.6" fill="none"',
  HID = 'stroke="#000" stroke-width="0.8" fill="none" stroke-dasharray="6 3"',
  CTR = 'stroke="#555" stroke-width="0.6" fill="none" stroke-dasharray="14 3 2 3"',
  SPAN = 'stroke="#c0392b" stroke-width="1" fill="none" stroke-dasharray="14 3 2 3"',
  CUT = 'stroke="#000" stroke-width="1.6" fill="url(#hatch)"',
  DEFS = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#777" stroke-width="0.7"/></pattern>
<pattern id="hatch2" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#1f4e9c" stroke-width="0.7"/></pattern>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#000"/></marker></defs>`;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** A drawing sheet: world box (mm) fitted into W px wide, at most maxH px high, y up. */
class Sheet {
  s: number;
  H: number;
  out: string[] = [];
  constructor(
    public b: Box,
    public W = 760,
    maxH = 460,
    public pad = 70,
  ) {
    const w = b.x1 - b.x0 || 1,
      h = b.y1 - b.y0 || 1;
    this.s = Math.min((W - 2 * pad) / w, (maxH - 2 * pad) / h);
    this.H = h * this.s + 2 * pad;
    // centre horizontally when height governs
    this.ox = (W - w * this.s) / 2;
  }
  ox: number;
  X = (x: number) => this.ox + (x - this.b.x0) * this.s;
  Y = (y: number) => this.pad + (this.b.y1 - y) * this.s;
  add(s: string) {
    this.out.push(s);
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number, st = OBJ, extra = '') {
    return this.add(`<line x1="${this.X(x1).toFixed(1)}" y1="${this.Y(y1).toFixed(1)}" x2="${this.X(x2).toFixed(1)}" y2="${this.Y(y2).toFixed(1)}" ${st} ${extra}/>`);
  }
  poly(pts: number[][], st = OBJ, close = true) {
    const d = pts.map((p) => `${this.X(p[0]).toFixed(1)},${this.Y(p[1]).toFixed(1)}`).join(' ');
    return this.add(close ? `<polygon points="${d}" ${st}/>` : `<polyline points="${d}" ${st}/>`);
  }
  rect(x0: number, y0: number, x1: number, y1: number, st = OBJ) {
    return this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], st);
  }
  /** Text at a world point, offset (dx, dy) px; rot in degrees, screen. */
  text(x: number, y: number, s: string, o: { dx?: number; dy?: number; a?: 'start' | 'middle' | 'end'; size?: number; rot?: number; bold?: boolean; fill?: string } = {}) {
    const px = this.X(x) + (o.dx ?? 0),
      py = this.Y(y) + (o.dy ?? 0);
    return this.add(
      `<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-size="${o.size ?? 11}" text-anchor="${o.a ?? 'middle'}" fill="${o.fill ?? '#000'}" paint-order="stroke" stroke="#fff" stroke-width="3"${o.bold ? ' font-weight="600"' : ''}${o.rot ? ` transform="rotate(${o.rot} ${px.toFixed(1)} ${py.toFixed(1)})"` : ''}>${esc(s)}</text>`,
    );
  }
  /** Aligned dimension between two world points, dimension line `off` px to the left of p1→p2 (screen). */
  dim(x1: number, y1: number, x2: number, y2: number, off: number, label: string) {
    const a = [this.X(x1), this.Y(y1)],
      b = [this.X(x2), this.Y(y2)],
      L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 2) return this;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L],
      n = [u[1], -u[0]],
      P = (p: number[], k: number) => [p[0] + n[0] * k, p[1] + n[1] * k],
      sg = Math.sign(off) || 1,
      A = P(a, off),
      B = P(b, off),
      seg = (p: number[], q: number[], w = 0.6) => `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="#000" stroke-width="${w}"/>`,
      tick = (p: number[]) => seg([p[0] - (u[0] + n[0]) * 4, p[1] - (u[1] + n[1]) * 4], [p[0] + (u[0] + n[0]) * 4, p[1] + (u[1] + n[1]) * 4], 1.2);
    this.add(seg(P(a, sg * 3), P(a, off + sg * 5)) + seg(P(b, sg * 3), P(b, off + sg * 5)) + seg(P(A, 0), P(B, 0)) + tick(A) + tick(B));
    let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    // too short for the label: write it level, beside the dimension line on its outer side
    if (L < label.length * 6) {
      const o = P(m, sg * 8),
        side = Math.abs(n[0]) > 0.5 ? (n[0] * sg < 0 ? 'end' : 'start') : 'middle';
      return this.add(`<text x="${o[0].toFixed(1)}" y="${(o[1] + (side === 'middle' ? (n[1] * sg < 0 ? 0 : 8) : 4)).toFixed(1)}" font-size="10.5" text-anchor="${side}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(label)}</text>`);
    }
    // label just above the dimension line, reading upright
    const
      up = [m[0] + Math.sin((ang * Math.PI) / 180) * 4, m[1] - Math.cos((ang * Math.PI) / 180) * 4];
    return this.add(`<text x="${up[0].toFixed(1)}" y="${up[1].toFixed(1)}" font-size="10.5" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3" transform="rotate(${ang.toFixed(1)} ${up[0].toFixed(1)} ${up[1].toFixed(1)})">${esc(label)}</text>`);
  }
  /** Dimension offset `off` px towards world direction `out` from the measured points. */
  dimOut(p: number[], q: number[], out: number[], off: number, label: string) {
    const dx = this.X(q[0]) - this.X(p[0]),
      dy = this.Y(q[1]) - this.Y(p[1]),
      L = Math.hypot(dx, dy) || 1,
      sg = Math.sign((dy / L) * out[0] + (dx / L) * out[1]) || 1; // screen normal (dy, -dx)/L · (out.x, -out.y)
    return this.dim(p[0], p[1], q[0], q[1], sg * off, label);
  }
  /** Level marker: open triangle on the level line, text to the right. */
  level(x: number, z: number, label = lvl(z), right = true) {
    const px = this.X(x),
      py = this.Y(z),
      d = right ? 1 : -1;
    return this.add(
      `<line x1="${px}" y1="${py}" x2="${px + d * 46}" y2="${py}" stroke="#000" stroke-width="0.6"/><polygon points="${px + d * 10},${py} ${px + d * 4},${py - 7} ${px + d * 16},${py - 7}" fill="none" stroke="#000" stroke-width="0.8"/><text x="${px + d * 18}" y="${py - 9}" font-size="10" text-anchor="${right ? 'start' : 'end'}">${esc(label)}</text>`,
    );
  }
  svg(title: string, scaleNote = true) {
    return `<figure class="dwg"><svg viewBox="0 0 ${this.W} ${this.H.toFixed(0)}" width="${this.W}" style="max-width:100%;height:auto;background:#fff;border:1px solid #bbb" font-family="Arial, Helvetica, sans-serif" xmlns="http://www.w3.org/2000/svg">${DEFS}${this.out.join('')}</svg><figcaption>${esc(title)}${scaleNote ? ' — NTS; dimensions in mm, levels in m' : ' — NTS; dimensions in mm'}</figcaption></figure>`;
  }
}

// ---------- general arrangement plan ----------

const LEGEND = `<div class="info legend"><b>Legend:</b> thick outline — flight / landing slab (landings shaded) · thin lines — tread nosings · arrow — walking line, pointing UP · dashed — beams below the slab · <span style="color:#c0392b">red chain line</span> — design span (one-way strip) with its width · grey chain line — grid.</div>`;

/** One plan, or one per group of stories when flights / landings of a higher story sit over a lower one (they would hide it). */
export function planSvg(m: Model) {
  const items = [...m.flights, ...m.landings],
    story = (it: Flight | Landing) => ('n' in it ? flightStory(m, it) : landingStory(m, it)),
    rect = (it: Flight | Landing) => ('n' in it ? frame(it).r : landingRect(it)),
    hit = (a: Flight | Landing, b: Flight | Landing) => {
      const p = rect(a),
        q = rect(b);
      return Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 1 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 1;
    },
    groups: Set<string>[] = [];
  let cur: (Flight | Landing)[] = [];
  for (const st of m.stories) {
    const mine = items.filter((it) => story(it) === st.name);
    if (!groups.length || mine.some((a) => cur.some((b) => hit(a, b)))) groups.push(new Set()), (cur = []);
    groups[groups.length - 1].add(st.name);
    cur.push(...mine);
  }
  const used = groups.filter((g) => items.some((it) => g.has(story(it))));
  if (used.length < 2) return planSheet(m, () => true, 'Fig. 1 — Stair general arrangement plan') + LEGEND;
  return (
    used
      .map((g, i) => {
        const zs = items.filter((it) => g.has(story(it))).flatMap((it) => ('n' in it ? [it.z0, it.z0 + it.n * it.R] : [it.z]));
        return planSheet(m, (st) => g.has(st), `Fig. 1${'abcdefgh'[i] ?? i + 1} — Stair general arrangement plan, levels ${lvl(Math.min(...zs))} to ${lvl(Math.max(...zs))}`);
      })
      .join('') + LEGEND
  );
}

/** Frame and overall dimensions from the whole stair, so the plans of a split line up; draws only members on stories `show` accepts. */
function planSheet(m: Model, show: (story: string) => boolean, title: string) {
  const pts: number[][] = [];
  for (const fl of m.flights) {
    const r = frame(fl).r;
    pts.push([r.x0, r.y0], [r.x1, r.y1]);
  }
  for (const l of m.landings) {
    const r = landingRect(l);
    pts.push([r.x0, r.y0], [r.x1, r.y1]);
  }
  for (const sp of m.spans) pts.push([sp.x1, sp.y1], [sp.x2, sp.y2]);
  if (!pts.length) return '';
  const bb0 = { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
  const near = (x1: number, y1: number, x2: number, y2: number) => Math.max(x1, x2) > bb0.x0 - 800 && Math.min(x1, x2) < bb0.x1 + 800 && Math.max(y1, y2) > bb0.y0 - 800 && Math.min(y1, y2) < bb0.y1 + 800;
  const beams = m.beams.filter((b) => near(b.x1, b.y1, b.x2, b.y2));
  for (const b of beams) pts.push([b.x1, b.y1], [b.x2, b.y2]);
  const landings = m.landings.filter((l) => show(landingStory(m, l))),
    flights = m.flights.filter((fl) => show(flightStory(m, fl)));
  // margin outside the stair: slab dims 14 px, beam labels 34 px, overall dims 56 px, grid bubbles beyond
  const e = 1400,
    bb = { x0: Math.min(...pts.map((p) => p[0])) - e, y0: Math.min(...pts.map((p) => p[1])) - e, x1: Math.max(...pts.map((p) => p[0])) + e, y1: Math.max(...pts.map((p) => p[1])) + e };
  const S = new Sheet(bb, 820, 640, 50);
  // grids: chain lines with bubbles at the bottom / left
  for (const g of m.grids) {
    let x1 = g.x1,
      y1 = g.y1,
      x2 = g.x2,
      y2 = g.y2;
    if (g.dir === 'X') {
      if (g.x1 < bb.x0 || g.x1 > bb.x1) continue;
      (y1 = bb.y0 + 250), (y2 = bb.y1);
    } else if (g.dir === 'Y') {
      if (g.y1 < bb.y0 || g.y1 > bb.y1) continue;
      (x1 = bb.x0 + 250), (x2 = bb.x1);
    } else if (!near(x1, y1, x2, y2)) continue;
    S.line(x1, y1, x2, y2, CTR);
    S.add(`<circle cx="${S.X(x1).toFixed(1)}" cy="${S.Y(y1).toFixed(1)}" r="10" fill="#fff" stroke="#000" stroke-width="0.8"/>`).text(x1, y1, g.label, { dy: 4, size: 11, bold: true });
  }
  // beams below the slab: hidden outline + centre line
  for (const b of beams) {
    if (!show(b.story)) continue;
    const w = m.frameSections.find((s) => s.name === b.section)?.t2 || 300,
      L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1,
      n = [(-(b.y2 - b.y1) / L) * (w / 2), ((b.x2 - b.x1) / L) * (w / 2)];
    S.poly([[b.x1 + n[0], b.y1 + n[1]], [b.x2 + n[0], b.y2 + n[1]], [b.x2 - n[0], b.y2 - n[1]], [b.x1 - n[0], b.y1 - n[1]]], HID);
    const ang = (Math.atan2(-(b.y2 - b.y1), b.x2 - b.x1) * 180) / Math.PI,
      rot = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
    // on the side away from the stair, 34 px out: clear of the slab edge dimensions (14 px) and inside the overall ones
    const mx = (b.x1 + b.x2) / 2,
      my = (b.y1 + b.y2) / 2,
      side = Math.sign((mx - (bb0.x0 + bb0.x1) / 2) * n[0] + (my - (bb0.y0 + bb0.y1) / 2) * n[1]) || 1,
      k = (side * 34) / (S.X(1) - S.X(0)) / (w / 2);
    S.text(mx + n[0] * k, my + n[1] * k, `${beamName(m, b)} ${b.section}`, { size: 9.5, rot, dy: 3, fill: '#333' });
  }
  for (const l of landings) {
    const r = landingRect(l);
    S.rect(r.x0, r.y0, r.x1, r.y1, 'stroke="#000" stroke-width="1.6" fill="#f3f3f3"');
    // off the centre lines, where spans usually run
    const lx = (r.x0 + r.x1) / 2,
      ly = r.y0 + (r.y1 - r.y0) * 0.22;
    S.text(lx, ly, `${l.name}  LVL ${lvl(l.z)}`, { bold: true, size: 9.5, dy: -2 });
    S.text(lx, ly, `t = ${l.t}`, { size: 9, dy: 10 });
    S.dim(r.x0, r.y0, r.x1, r.y0, -14, `${Math.round(l.w)}`);
    S.dim(r.x1, r.y0, r.x1, r.y1, -14, `${Math.round(l.h)}`);
  }
  for (const fl of flights) {
    const F = frame(fl),
      r = F.r,
      at = (s: number, q: number) => [F.O[0] + F.u[0] * s + F.v[0] * q, F.O[1] + F.u[1] * s + F.v[1] * q];
    S.rect(r.x0, r.y0, r.x1, r.y1, 'stroke="#000" stroke-width="1.6" fill="#fff"');
    for (let i = 1; i < fl.n - 1; i++) {
      const [a, b] = [at(i * fl.T, 0), at(i * fl.T, F.w)];
      S.line(a[0], a[1], b[0], b[1], THIN);
    }
    // walking line with UP arrow
    const p0 = at(fl.T * 0.3, F.w / 2),
      p1 = at(F.L - fl.T * 0.3, F.w / 2);
    S.line(p0[0], p0[1], p1[0], p1[1], 'stroke="#000" stroke-width="0.9"', 'marker-end="url(#arr)"');
    S.add(`<circle cx="${S.X(p0[0]).toFixed(1)}" cy="${S.Y(p0[1]).toFixed(1)}" r="2.5" fill="#000"/>`);
    const ax = F.u[0] !== 0,
      note = `${fl.n}R @ ${fl.R} · ${fl.n - 1}T @ ${fl.T}`;
    if (F.L * (S.X(1) - S.X(0)) >= note.length * 5.5) {
      const rot = ax ? 0 : -90,
        c = at(F.L / 2, F.w * 0.75),
        c2 = at(F.L / 2, F.w * 0.25);
      S.text(c[0], c[1], `${fl.name} UP`, { bold: true, rot, dy: ax ? 4 : 0, dx: ax ? 0 : 4 });
      S.text(c2[0], c2[1], note, { size: 9.5, rot, dy: ax ? 4 : 0, dx: ax ? 0 : 4 });
    } else {
      // short going: three short lines across the width, beside the walking line
      const rot = ax ? -90 : 0,
        // title first in reading order: top line, or leftmost when the text is turned
        cs = [0.2, 0.5, 0.8].map((k) => at(F.L * k, F.w * 0.76)).sort((a, b) => (ax ? S.X(a[0]) - S.X(b[0]) : S.Y(a[1]) - S.Y(b[1])));
      [`${fl.name} UP`, `${fl.n}R @ ${fl.R}`, `${fl.n - 1}T @ ${fl.T}`].forEach((s, i) => S.text(cs[i][0], cs[i][1], s, { bold: !i, size: i ? 9.5 : 11, rot, dy: ax ? 0 : 4, dx: ax ? 4 : 0 }));
    }
    // going along the outer edge; width at the start, unless a landing there (or at the top) already gives it
    const g0 = at(0, 0),
      g1 = at(F.L, 0),
      w0 = at(0, 0),
      w1 = at(0, F.w),
      corner = (l: Landing, p: number[]) => {
        const q = landingRect(l);
        return (Math.abs(p[0] - q.x0) < 1 || Math.abs(p[0] - q.x1) < 1) && (Math.abs(p[1] - q.y0) < 1 || Math.abs(p[1] - q.y1) < 1);
      },
      shown = landings.some((l) => (corner(l, w0) && corner(l, w1)) || (corner(l, at(F.L, 0)) && corner(l, at(F.L, F.w))));
    S.dimOut(g0, g1, [-F.v[0], -F.v[1]], 14, `${Math.round(F.L)} (going)`);
    if (!shown) S.dimOut(w0, w1, [-F.u[0], -F.u[1]], 14, `${Math.round(F.w)}`);
  }
  for (const sp of m.spans) {
    if (!show(sp.story)) continue;
    S.line(sp.x1, sp.y1, sp.x2, sp.y2, SPAN, 'marker-start="url(#arr)" marker-end="url(#arr)"');
    const ang = (Math.atan2(-(sp.y2 - sp.y1), sp.x2 - sp.x1) * 180) / Math.PI,
      rot = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
    S.text(sp.x1 * 0.6 + sp.x2 * 0.4, sp.y1 * 0.6 + sp.y2 * 0.4, `${sp.name} (strip ${sp.width})`, { size: 10, rot, dy: -5, fill: '#c0392b', bold: true });
  }
  // overall dimensions
  S.dim(bb0.x0, bb0.y0, bb0.x1, bb0.y0, -(S.Y(Math.min(...pts.map((p) => p[1]))) - S.Y(bb0.y0) + 56), `${Math.round(bb0.x1 - bb0.x0)}`);
  S.dim(bb0.x0, bb0.y0, bb0.x0, bb0.y1, S.X(bb0.x0) - S.X(Math.min(...pts.map((p) => p[0]))) + 56, `${Math.round(bb0.y1 - bb0.y0)}`);
  // axes
  S.add(`<g transform="translate(${S.W - 60},${S.H - 20})" font-size="10"><line x1="0" y1="0" x2="30" y2="0" stroke="#000" marker-end="url(#arr)"/><line x1="0" y1="0" x2="0" y2="-30" stroke="#000" marker-end="url(#arr)"/><text x="34" y="4">X</text><text x="-3" y="-34">Y</text></g>`);
  return S.svg(title);
}

// ---------- flight elevation ----------

export function flightSvg(fl: Flight, no: number) {
  const F = frame(fl),
    P = profile(fl).map(([s, z]) => [s, fl.z0 + z]),
    ts = (fl.t * Math.hypot(fl.R, fl.T)) / fl.T,
    ext = Math.max(400, fl.T * 1.5);
  const S = new Sheet({ x0: -ext, y0: fl.z0 - ts - 250, x1: F.L + ext, y1: fl.z0 + F.H + 250 }, 760, 430, 70);
  // floor / landing stubs at the bottom and the top
  S.line(-ext, fl.z0, 0, fl.z0, THIN).line(F.L, fl.z0 + F.H, F.L + ext, fl.z0 + F.H, THIN);
  S.poly(P, CUT);
  // nosing line and soffit line labels
  S.line(0, fl.z0 + fl.R, F.L, fl.z0 + F.H, 'stroke="#888" stroke-width="0.6" stroke-dasharray="4 3"');
  const th = Math.atan(fl.R / fl.T),
    deg = (th * 180) / Math.PI;
  // typical step dims on a middle step
  const i = Math.max(1, Math.floor(fl.n / 2) - 1),
    sx = i * fl.T,
    sz = fl.z0 + (i + 1) * fl.R;
  S.dim(sx, sz, sx + fl.T, sz, 22, `T = ${fl.T}`);
  S.dim(sx + fl.T, sz, sx + fl.T, sz + fl.R, 22, `R = ${fl.R}`);
  // waist measured square to the soffit
  const ms = F.L * 0.3,
    soff = [ms, fl.z0 + (ms * fl.R) / fl.T - ts],
    nrm = [-Math.sin(th), Math.cos(th)],
    top = [soff[0] + nrm[0] * fl.t, soff[1] + nrm[1] * fl.t];
  S.dim(soff[0], soff[1], top[0], top[1], 26, `t = ${fl.t}`);
  // overall going and rise
  S.dim(0, fl.z0 - ts, F.L, fl.z0 - ts, -(S.Y(fl.z0 - ts - 250) - S.Y(fl.z0 - ts) - 16), `Going L = (n−1)·T = ${fl.n - 1} × ${fl.T} = ${F.L}`);
  S.dim(F.L + ext * 0.55, fl.z0, F.L + ext * 0.55, fl.z0 + F.H, -10, `H = n·R = ${fl.n} × ${fl.R} = ${F.H}`);
  S.level(-ext * 0.85, fl.z0).level(F.L + ext * 0.1, fl.z0 + F.H);
  S.add(`<text x="${S.X(F.L * 0.62).toFixed(1)}" y="${(S.Y(fl.z0 + F.L * 0.62 * Math.tan(th) - ts) + 24).toFixed(1)}" font-size="10.5" text-anchor="middle" transform="rotate(${(-deg).toFixed(1)} ${S.X(F.L * 0.62).toFixed(1)} ${(S.Y(fl.z0 + F.L * 0.62 * Math.tan(th) - ts) + 24).toFixed(1)})">soffit, θ = atan(R/T) = ${deg.toFixed(1)}°</text>`);
  return S.svg(`Fig. ${no} — Flight ${fl.name}: longitudinal section (elevation along the going, ${fl.dir} up)`);
}

// ---------- dead load derivation ----------

/** One step of a flight, large scale, showing the waist and step volumes making up the dead load per m² of plan. */
function stepSvg(fl: Flight, no: number) {
  const { R, T, t } = fl,
    ts = (t * Math.hypot(R, T)) / T;
  const S = new Sheet({ x0: -T * 0.6, y0: -ts - R * 0.5, x1: 2.6 * T, y1: 3 * R + 60 }, 680, 440, 50);
  // two full steps plus part of the third, as a cut section
  const sol = [
    [-T * 0.4, -ts - (0.4 * T * R) / T],
    [-T * 0.4, -0.4 * R],
    [0, 0],
    [0, R],
    [T, R],
    [T, 2 * R],
    [2 * T, 2 * R],
    [2 * T, 3 * R],
    [2.4 * T, 3 * R],
    [2.4 * T, 2.4 * R - ts],
  ];
  // waist band (parallelogram under the nosing line) and step triangles, shaded apart
  const waist = [
    [-T * 0.4, -0.4 * R - ts],
    [2.4 * T, 2.4 * R - ts],
    [2.4 * T, 2.4 * R],
    [-T * 0.4, -0.4 * R],
  ];
  S.poly(waist, 'stroke="none" fill="url(#hatch)"');
  for (const k of [0, 1, 2]) S.poly(k < 2 ? [[k * T, k * R], [k * T, (k + 1) * R], [(k + 1) * T, (k + 1) * R]] : [[2 * T, 2 * R], [2 * T, 3 * R], [2.4 * T, 3 * R], [2.4 * T, 2.4 * R]], 'stroke="none" fill="url(#hatch2)"');
  S.poly(sol, 'stroke="#000" stroke-width="1.6" fill="none"');
  S.line(-T * 0.4, -0.4 * R, 2.4 * T, 2.4 * R, 'stroke="#000" stroke-width="0.6" stroke-dasharray="5 3"');
  S.line(-T * 0.4, -0.4 * R - ts, -T * 0.4, -0.4 * R, OBJ).line(2.4 * T, 2.4 * R - ts, 2.4 * T, 2.4 * R, OBJ);
  // finish layer on treads
  for (const k of [0, 1]) S.line(k * T, (k + 1) * R + 12, (k + 1) * T, (k + 1) * R + 12, 'stroke="#1a7f37" stroke-width="2.4"');
  S.dim(T, 2 * R, 2 * T, 2 * R, 26, `T = ${T}`);
  S.dim(T, R, T, 2 * R, 22, `R = ${R}`);
  // vertical waist thickness and normal waist
  const xv = 1.5 * T;
  S.dim(xv, xv * (R / T) - ts, xv, xv * (R / T), -16, `tv = t·secθ = ${ts.toFixed(0)}`);
  const th = Math.atan(R / T),
    s0 = [0.25 * T, 0.25 * R - ts],
    s1 = [s0[0] - Math.sin(th) * t, s0[1] + Math.cos(th) * t];
  S.dim(s0[0], s0[1], s1[0], s1[1], 22, `t = ${t}`);
  S.text(0.66 * T, 0.6 * R, '½·R·T', { size: 10, fill: '#1f4e9c', bold: true, dy: 12 });
  S.text(0.9 * T, 0.9 * R - ts / 2, 'waist', { size: 10, bold: true, dy: 4 });
  S.text(0.5 * T, R + 12, 'finish', { size: 9.5, fill: '#1a7f37', dy: -5 });
  return S.svg(`Fig. ${no} — Flight ${fl.name}: step detail for dead load (one tread T repeats along the going)`, false);
}

function landingBlockSvg(t: number, no: number) {
  const S = new Sheet({ x0: -150, y0: -t - 120, x1: 1150, y1: 160 }, 560, 230, 40);
  S.rect(0, -t, 1000, 0, CUT);
  S.line(0, 25, 1000, 25, 'stroke="#1a7f37" stroke-width="3"');
  S.line(-150, -t, 0, -t, THIN).line(1000, -t, 1150, -t, THIN);
  S.dim(0, -t, 1000, -t, -22, '1000 (1 m strip)');
  S.dim(1000, -t, 1000, 0, -16, `t = ${t}`);
  S.text(500, 25, 'floor finish layer', { size: 10, fill: '#1a7f37', dy: -7 });
  S.text(500, -t / 2, 'RCC landing slab', { size: 10.5, bold: true, dy: 4 });
  return S.svg(`Fig. ${no} — Landing slab, t = ${t}: section through a 1 m × 1 m panel`, false);
}

/** Step-by-step dead and live load intensity (kN/m² of plan) for every flight type and landing thickness. */
export function unitWeightsHtml(m: Model, fig: { n: number }) {
  const p = m.stair;
  let h = `<h2>Dead and live load intensities (per m² of plan area)</h2>
<div class="info">Loads on a stair are worked out per square metre of <b>horizontal plan</b> area, because the span, moments and reactions are all measured horizontally (IS 456 cl 33.1). Dead load = self weight of the RCC (unit weight γc = ${p.gc} kN/m³, IS 875 Part 1) + finishes (${p.ff} kN/m²). Live load = ${p.ll} kN/m² (IS 875 Part 2). On a flight the concrete is made of two parts: the inclined <b>waist</b> slab and the triangular <b>steps</b> sitting on it.</div>`;
  const seen = new Set<string>();
  for (const fl of m.flights) {
    const key = `${fl.R}|${fl.T}|${fl.t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const same = m.flights.filter((x) => `${x.R}|${x.T}|${x.t}` === key).map((x) => x.name);
    const L = slabLoads(m, fl),
      hyp = Math.hypot(fl.R, fl.T),
      sec = hyp / fl.T;
    h += `<div class="card"><h4>Flight${same.length > 1 ? 's' : ''} ${esc(same.join(', '))} — R = ${fl.R}, T = ${fl.T}, waist t = ${fl.t}</h4>${stepSvg(fl, fig.n++)}
<div class="calc"><b>Given</b>
  R  = riser                                   = ${fl.R} mm
  T  = tread (horizontal going of one step)    = ${fl.T} mm
  t  = waist, measured square to the soffit    = ${fl.t} mm
  γc = unit weight of reinforced concrete      = ${p.gc} kN/m³
  w_ff = floor finish load                     = ${f(p.ff, 3)} kN/m²
  q  = imposed (live) load                     = ${f(p.ll, 3)} kN/m²
  γf = partial safety factor for loads         = ${p.gf}

<b>1. Slope of the flight</b>
  Formula:  h = √(R² + T²)            (sloping length of one step)
          h = √(${fl.R}² + ${fl.T}²) = √${fl.R * fl.R + fl.T * fl.T} = ${f(hyp, 1)} mm
  Formula:  secθ = h / T
          secθ = ${f(hyp, 1)} / ${fl.T} = ${f(sec, 4)}
  Formula:  θ = tan⁻¹(R / T)
          θ = tan⁻¹(${fl.R} / ${fl.T}) = ${f((Math.atan(fl.R / fl.T) * 180) / Math.PI, 2)}°

<b>2. Waist slab self weight</b> (per m² of horizontal plan)
  Over 1 m of plan the inclined waist is secθ m long, so it weighs as much as a level slab of thickness t_v:
  Formula:  t_v = t × secθ
          t_v = ${fl.t} × ${f(sec, 4)} = ${f(fl.t * sec, 1)} mm
  Formula:  w_w = γc × t_v / 1000
          w_w = ${p.gc} × ${f(fl.t * sec, 1)} / 1000 = <b>${f(L.ws, 3)} kN/m²</b>

<b>3. Steps self weight</b> (per m² of horizontal plan)
  Formula:  A_s = ½ × R × T            (area of one step triangle, Fig. ${fig.n - 1})
          A_s = ½ × ${fl.R} × ${fl.T} = ${f((fl.R * fl.T) / 2, 0)} mm²
  Formula:  t_s = A_s / T = R / 2      (mean thickness of the steps over one tread)
          t_s = ${f((fl.R * fl.T) / 2, 0)} / ${fl.T} = ${f(fl.R / 2, 1)} mm
  Formula:  w_s = γc × t_s / 1000
          w_s = ${p.gc} × ${f(fl.R / 2, 1)} / 1000 = <b>${f(L.st, 3)} kN/m²</b>

<b>4. Floor finish</b> (tread + riser finish and soffit plaster, input)
          w_ff = <b>${f(L.ff, 3)} kN/m²</b>

<b>5. Totals</b>
  Formula:  g = w_w + w_s + w_ff       (dead load, DL)
          g = ${f(L.ws, 3)} + ${f(L.st, 3)} + ${f(L.ff, 3)} = <b>${f(L.dl, 3)} kN/m²</b>
  Formula:  q                          (live load, LL)
          q = <b>${f(L.ll, 3)} kN/m²</b>
  Formula:  w_u = γf × (g + q)         (factored load)
          w_u = ${p.gf} × (${f(L.dl, 3)} + ${f(L.ll, 3)}) = <b>${f(p.gf * (L.dl + L.ll), 3)} kN/m²</b></div></div>`;
  }
  const ts = [...new Set(m.landings.map((l) => l.t))];
  for (const t of ts) {
    const names = m.landings.filter((l) => l.t === t).map((l) => l.name),
      L = slabLoads(m, m.landings.find((l) => l.t === t)!);
    h += `<div class="card"><h4>Landing${names.length > 1 ? 's' : ''} ${esc(names.join(', '))} — t = ${t}</h4>${landingBlockSvg(t, fig.n++)}
<div class="calc"><b>Given</b>
  t  = landing slab thickness                  = ${t} mm
  γc = unit weight of reinforced concrete      = ${p.gc} kN/m³
  w_ff = floor finish load                     = ${f(p.ff, 3)} kN/m²
  q  = imposed (live) load                     = ${f(p.ll, 3)} kN/m²
  γf = partial safety factor for loads         = ${p.gf}

<b>1. Slab self weight</b> — a level slab, 1 m × 1 m × t (Fig. ${fig.n - 1})
  Formula:  w_w = γc × t / 1000
          w_w = ${p.gc} × ${t} / 1000 = <b>${f(L.ws, 3)} kN/m²</b>

<b>2. Floor finish</b> (input)
          w_ff = <b>${f(L.ff, 3)} kN/m²</b>

<b>3. Totals</b>
  Formula:  g = w_w + w_ff             (dead load, DL)
          g = ${f(L.ws, 3)} + ${f(L.ff, 3)} = <b>${f(L.dl, 3)} kN/m²</b>
  Formula:  q                          (live load, LL)
          q = <b>${f(L.ll, 3)} kN/m²</b>
  Formula:  w_u = γf × (g + q)         (factored load)
          w_u = ${p.gf} × (${f(L.dl, 3)} + ${f(L.ll, 3)}) = <b>${f(p.gf * (L.dl + L.ll), 3)} kN/m²</b>
  Where a landing is common to two spans at right angles, each span takes k = 0.5 of these values (IS 456 cl 33.2).</div></div>`;
  }
  // summary table
  h += `<table><tr><th>Element</th><th>t (mm)</th><th>w_w waist / slab (kN/m²)</th><th>w_s steps (kN/m²)</th><th>w_ff finish (kN/m²)</th><th>g = DL (kN/m²)</th><th>q = LL (kN/m²)</th><th>w_u (kN/m²)</th></tr>`;
  // walking order: by base level, a landing before the flight that leaves it
  const z = (it: Flight | Landing) => ('n' in it ? it.z0 : it.z);
  for (const it of [...m.landings, ...m.flights].sort((a, b) => z(a) - z(b))) {
    const L = slabLoads(m, it);
    h += `<tr><td>${esc(it.name)} (${'n' in it ? 'flight' : 'landing'})</td><td>${it.t}</td><td>${f(L.ws)}</td><td>${f(L.st)}</td><td>${f(L.ff)}</td><td>${f(L.dl)}</td><td>${f(L.ll)}</td><td>${f(p.gf * (L.dl + L.ll))}</td></tr>`;
  }
  return h + '</table>';
}

// ---------- span: longitudinal section ----------

export function spanSectionSvg(m: Model, sp: Span, no: number) {
  const A = analyze(m, sp);
  if (!A) return '';
  const u = A.u,
    Lmm = A.L * 1000,
    shapes: { pts: number[][]; name: string }[] = [],
    zs: number[] = [];
  for (const s of A.segs) {
    const it = s.it;
    if ('n' in it) {
      const F = frame(it),
        dot = F.u[0] * u[0] + F.u[1] * u[1];
      if (Math.abs(dot) > 0.7) {
        const d0 = (F.O[0] - sp.x1) * u[0] + (F.O[1] - sp.y1) * u[1];
        shapes.push({ pts: profile(it).map(([q, z]) => [d0 + Math.sign(dot) * q, it.z0 + z]), name: it.name });
        zs.push(it.z0, it.z0 + F.H);
      } else {
        // span runs across the flight: cut square to the going
        const z = it.z0 + F.H / 2,
          ts = (it.t * Math.hypot(it.R, it.T)) / it.T;
        shapes.push({ pts: [[s.a * 1000, z - ts], [s.b * 1000, z - ts], [s.b * 1000, z], [s.a * 1000, z]], name: it.name });
        zs.push(z);
      }
    } else {
      shapes.push({ pts: [[s.a * 1000, it.z - it.t], [s.b * 1000, it.z - it.t], [s.b * 1000, it.z], [s.a * 1000, it.z]], name: it.name });
      zs.push(it.z);
    }
  }
  const sec = (s: (typeof A.sup)[number]) => m.frameSections.find((q) => q.name === s.beam?.section);
  zs.push(...A.sup.map((s) => s.bz ?? s.zs ?? 0), ...A.sup.map((s) => (s.beam ? (s.bz ?? 0) - (sec(s)?.t3 || 450) : (s.zs ?? 0) - 200)));
  const allX = shapes.flatMap((s) => s.pts.map((p) => p[0])),
    x0 = Math.min(0, ...allX) - 700,
    x1 = Math.max(Lmm, ...allX) + 700,
    zLow = Math.min(...zs, ...shapes.flatMap((s) => s.pts.map((p) => p[1]))),
    z1 = Math.max(...zs) + 400;
  const S = new Sheet({ x0, y0: zLow - 150, x1, y1: z1 }, 760, 440, 80);
  for (const sh of shapes) S.poly(sh.pts, CUT);
  // supports
  A.sup.forEach((s, e) => {
    const x = e ? Lmm : 0;
    if (s.beam) {
      const bw = sec(s)?.t2 || 300,
        bd = sec(s)?.t3 || 450,
        bz = s.bz ?? 0;
      S.rect(x - bw / 2, bz - bd, x + bw / 2, bz, 'stroke="#000" stroke-width="1.6" fill="#ddd"');
      S.line(x - bw / 2, bz - bd, x + bw / 2, bz, THIN).line(x + bw / 2, bz - bd, x - bw / 2, bz, THIN);
      S.text(x, bz - bd, `${beamName(m, s.beam)} ${s.beam.section}`, { dy: 14, size: 10, bold: true });
      // beam level outside the span, so it never sits on a landing's level tag
      S.level(x + (e ? bw / 2 : -bw / 2), bz, `TOB ${lvl(bz)}`, !!e);
    } else {
      const z = s.zs ?? 0;
      S.add(`<polygon points="${S.X(x)},${S.Y(z)} ${S.X(x) - 9},${S.Y(z) + 14} ${S.X(x) + 9},${S.Y(z) + 14}" fill="none" stroke="#000"/>`);
      S.text(x, z, s.span ? `rests on ${s.span.name}` : 'no beam (wall?)', { dy: 28, size: 10 });
    }
    S.line(x, zLow, x, z1 - 50, CTR);
    S.text(x, z1 - 50, e ? 'B' : 'A', { dy: -4, bold: true, size: 12 });
  });
  for (const sh of shapes) {
    const xs = sh.pts.map((p) => p[0]),
      top = Math.max(...sh.pts.map((p) => p[1]));
    S.text((Math.min(...xs) + Math.max(...xs)) / 2, top, sh.name, { dy: -10, bold: true });
  }
  for (const s of A.segs) if (!('n' in s.it)) S.level((s.a + s.b) * 500, s.it.z, lvl(s.it.z));
  // segment chain and effective span, below everything
  S.dim(0, zLow, Lmm, zLow, -56, `Effective span L = ${f(A.L, 3)} m (c/c of supports)`);
  for (const s of A.segs) S.dim(s.a * 1000, zLow, s.b * 1000, zLow, -24, `${Math.round((s.b - s.a) * 1000)}`);
  return S.svg(`Fig. ${no} — Span ${sp.name}: section along the design strip (A = start, B = end)`);
}

// ---------- span: plan of other spans bearing on it ----------

/** Plan of where each span resting on `sp` puts its end reaction (hatched), dimensioned from A; '' when none does. */
export function bearingSvg(m: Model, sp: Span, no: number) {
  const A = analyze(m, sp);
  if (!A?.tr.length) return '';
  const strip = (o: Span, s0?: number, s1?: number) => {
    const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1,
      u = [(o.x2 - o.x1) / L, (o.y2 - o.y1) / L],
      h = [-u[1] * (o.width / 2), u[0] * (o.width / 2)],
      p = (s: number) => [o.x1 + u[0] * s, o.y1 + u[1] * s],
      a = p(s0 ?? 0),
      b = p(s1 ?? L);
    return [[a[0] + h[0], a[1] + h[1]], [b[0] + h[0], b[1] + h[1]], [b[0] - h[0], b[1] - h[1]], [a[0] - h[0], a[1] - h[1]]];
  };
  const u = A.u,
    n = [-u[1], u[0]],
    Lmm = A.L * 1000,
    at = (s: number, q = 0) => [sp.x1 + u[0] * s + n[0] * q, sp.y1 + u[1] * s + n[1] * q],
    rot = (v: number[]) => {
      const g = (Math.atan2(-v[1], v[0]) * 180) / Math.PI;
      return g > 90 ? g - 180 : g < -90 ? g + 180 : g;
    },
    pts = [sp, ...A.tr.map((t) => t.from)].flatMap((o) => strip(o)),
    e = 900,
    bb = { x0: Math.min(...pts.map((p) => p[0])) - e, y0: Math.min(...pts.map((p) => p[1])) - e, x1: Math.max(...pts.map((p) => p[0])) + e, y1: Math.max(...pts.map((p) => p[1])) + e };
  const S = new Sheet(bb, 760, 480, 50);
  // the stair slabs round about, for orientation
  for (const it of [...m.flights, ...m.landings]) {
    const r = 'n' in it ? frame(it).r : landingRect(it);
    if (r.x1 < bb.x0 || r.x0 > bb.x1 || r.y1 < bb.y0 || r.y0 > bb.y1) continue;
    S.rect(r.x0, r.y0, r.x1, r.y1, THIN).text(Math.max(r.x0, bb.x0) + 60, Math.min(r.y1, bb.y1) - 60, it.name, { a: 'start', dy: 9, size: 9, fill: '#777' });
  }
  for (const g of m.grids) {
    if (g.dir === 'X' && g.x1 > bb.x0 && g.x1 < bb.x1) S.line(g.x1, bb.y0 + 250, g.x1, bb.y1, CTR);
    else if (g.dir === 'Y' && g.y1 > bb.y0 && g.y1 < bb.y1) S.line(bb.x0 + 250, g.y1, bb.x1, g.y1, CTR);
    else continue;
    const b = g.dir === 'X' ? [g.x1, bb.y0 + 250] : [bb.x0 + 250, g.y1];
    S.add(`<circle cx="${S.X(b[0]).toFixed(1)}" cy="${S.Y(b[1]).toFixed(1)}" r="10" fill="#fff" stroke="#000" stroke-width="0.8"/>`).text(b[0], b[1], g.label, { dy: 4, size: 11, bold: true });
  }
  S.poly(strip(sp), 'stroke="#c0392b" stroke-width="1.2" fill="#c0392b" fill-opacity="0.06"');
  for (const t of A.tr) S.poly(strip(t.from), 'stroke="#000" stroke-width="0.9" fill="#f3f3f3" fill-opacity="0.7" stroke-dasharray="6 3"');
  for (const t of A.tr) S.poly(strip(sp, t.a * 1000, t.b * 1000), 'stroke="#000" stroke-width="1.6" fill="url(#hatch2)"');
  S.line(sp.x1, sp.y1, sp.x2, sp.y2, SPAN);
  S.text(...(at(0) as [number, number]), 'A', { dx: -10 * u[0], dy: 10 * u[1] + 4, bold: true, size: 12 }).text(...(at(Lmm) as [number, number]), 'B', { dx: 10 * u[0], dy: -10 * u[1] + 4, bold: true, size: 12 });
  const free = A.tr.reduce((c, t) => Math.max(c, t.b), 0) * 1000,
    lab = at((free + Lmm) / 2);
  S.text(lab[0], lab[1], `${sp.name} (${sp.story}) · L = ${f(A.L, 3)} m · strip ${sp.width}`, { rot: rot(u), dy: -5, size: 10.5, bold: true, fill: '#c0392b' });
  // dimensions on the side of the strip away from the spans resting on it
  const side = Math.sign(A.tr.reduce((s, t) => s + ((t.from.x1 + t.from.x2) / 2 - sp.x1) * n[0] + ((t.from.y1 + t.from.y2) / 2 - sp.y1) * n[1], 0)) || 1,
    q = (-side * sp.width) / 2,
    out = [-side * n[0], -side * n[1]],
    cuts = [...new Set([0, ...A.tr.flatMap((t) => [t.a * 1000, t.b * 1000]), Lmm].map((v) => Math.round(v)))].sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) S.dimOut(at(cuts[i - 1], q), at(cuts[i], q), out, 14, `${cuts[i] - cuts[i - 1]}`);
  A.tr.forEach((t, i) => {
    const o = t.from,
      c = ((t.a + t.b) / 2) * 1000,
      P = t.end ? [o.x2, o.y2] : [o.x1, o.y1],
      uo = [o.x2 - o.x1, o.y2 - o.y1],
      lo = Math.hypot(uo[0], uo[1]) || 1,
      // labels a quarter strip off the centre lines, clear of the chain line and the bearing dot
      mid = [(o.x1 + o.x2) / 2 - (uo[1] / lo) * (o.width / 4), (o.y1 + o.y2) / 2 + (uo[0] / lo) * (o.width / 4)],
      pc = at(c, q / 2);
    S.line(o.x1, o.y1, o.x2, o.y2, 'stroke="#000" stroke-width="0.8" fill="none" stroke-dasharray="14 3 2 3"');
    S.add(`<circle cx="${S.X(P[0]).toFixed(1)}" cy="${S.Y(P[1]).toFixed(1)}" r="3.5" fill="#000"/>`);
    S.text(mid[0], mid[1], `${o.name} (${o.story}) — end ${t.end ? 'B' : 'A'} rests on ${sp.name}`, { rot: rot(uo), dy: 4, size: 10, bold: true });
    S.text(pc[0], pc[1], `R(${o.name}) ${f(t.dl)} DL + ${f(t.ll)} LL kN/m²`, { rot: rot(u), dy: 4, size: 9.5, bold: true });
    S.dimOut(at(0, q), at(c, q), out, 40 + 24 * i, `${Math.round(c)} = centre of R(${o.name}) from A`);
  });
  return S.svg(`Fig. ${no} — Span ${sp.name}: plan of the spans resting on it; hatched = their end reaction as applied on ${sp.name}, dimensioned from end A`, false);
}

// ---------- span: loading, shear force and bending moment ----------

export function spanLoadSvg(m: Model, sp: Span, no: number) {
  const A = analyze(m, sp);
  if (!A) return '';
  const L = A.L,
    gf = m.stair.gf,
    loads = [...A.segs.map((s) => ({ a: s.a, b: s.b, dl: s.dl, ll: s.ll, n: s.it.name })), ...A.tr.map((t) => ({ a: t.a, b: t.b, dl: t.dl, ll: t.ll, n: `R(${t.from.name})` }))];
  const W = 760,
    pad = 70,
    sx = (W - 2 * pad) / L,
    X = (x: number) => pad + x * sx;
  // statics on factored load
  const N = 200,
    xs = Array.from({ length: N + 1 }, (_, i) => (L * i) / N),
    wu = (s: { dl: number; ll: number }) => gf * (s.dl + s.ll),
    V = xs.map((x) => A.U.RA - loads.reduce((t, s) => t + wu(s) * Math.max(0, Math.min(x, s.b) - s.a), 0)),
    M = xs.map((x) => A.U.RA * x - loads.reduce((t, s) => { const e = Math.min(x, s.b); return e > s.a ? t + wu(s) * (e - s.a) * (x - (s.a + e) / 2) : t; }, 0));
  const qmax = Math.max(...loads.map((s) => s.dl + s.ll), 1e-6),
    qs = 90 / qmax,
    Vm = Math.max(...V.map(Math.abs), 1e-6),
    Mm = Math.max(...M.map(Math.abs), 1e-6);
  let o = '';
  const T = (x: number, y: number, s: string, ex = '') => (o += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="10.5" ${ex.includes('text-anchor') ? '' : 'text-anchor="middle"'} ${ex}>${esc(s)}</text>`);
  // (a) loading: dead hatched, live stacked above
  const yb = 150;
  T(W / 2, 20, '(a) Unfactored loading per m width — Dead (hatched) + Live (blue)', 'font-weight="600"');
  for (const s of loads) {
    const hd = s.dl * qs,
      hl = s.ll * qs;
    o += `<rect x="${X(s.a).toFixed(1)}" y="${(yb - hd).toFixed(1)}" width="${((s.b - s.a) * sx).toFixed(1)}" height="${hd.toFixed(1)}" fill="url(#hatch)" stroke="#000" stroke-width="0.8"/>`;
    o += `<rect x="${X(s.a).toFixed(1)}" y="${(yb - hd - hl).toFixed(1)}" width="${((s.b - s.a) * sx).toFixed(1)}" height="${hl.toFixed(1)}" fill="#dbe7fb" stroke="#1f4e9c" stroke-width="0.8"/>`;
    const cx = X((s.a + s.b) / 2);
    if ((s.b - s.a) * sx > 46) {
      T(cx, yb - hd / 2 + 4, `${f(s.dl)}`, 'font-size="10" font-weight="600" fill="#000" paint-order="stroke" stroke="#fff" stroke-width="3"');
      T(cx, yb - hd - hl / 2 + 4, `${f(s.ll)}`, 'fill="#1f4e9c" font-size="10"');
      T(cx, yb - hd - hl - 6, s.n, 'font-size="9.5"');
    }
  }
  o += `<line x1="${X(0)}" y1="${yb}" x2="${X(L)}" y2="${yb}" stroke="#000" stroke-width="2.2"/>`;
  // pin at A, roller at B
  o += `<polygon points="${X(0)},${yb} ${X(0) - 9},${yb + 15} ${X(0) + 9},${yb + 15}" fill="#fff" stroke="#000"/><line x1="${X(0) - 13}" y1="${yb + 15}" x2="${X(0) + 13}" y2="${yb + 15}" stroke="#000"/>`;
  o += `<polygon points="${X(L)},${yb} ${X(L) - 9},${yb + 12} ${X(L) + 9},${yb + 12}" fill="#fff" stroke="#000"/><circle cx="${X(L) - 5}" cy="${yb + 15}" r="2.5" fill="none" stroke="#000"/><circle cx="${X(L) + 5}" cy="${yb + 15}" r="2.5" fill="none" stroke="#000"/>`;
  for (const [x, R, nm] of [[0, A, 'RA'], [L, A, 'RB']] as const) {
    const k = nm as 'RA' | 'RB';
    o += `<line x1="${X(x)}" y1="${yb + 58}" x2="${X(x)}" y2="${yb + 22}" stroke="#000" stroke-width="1.2" marker-end="url(#arr)"/>`;
    T(X(x), yb + 72, `${nm}: D ${f(R.D[k])} · L ${f(R.LL[k])} · U ${f(R.U[k])} kN/m`, `text-anchor="${x ? 'end' : 'start'}" dx="${x ? 10 : -10}"`);
  }
  // span dim
  const yd = yb + 92;
  o += `<line x1="${X(0)}" y1="${yd}" x2="${X(L)}" y2="${yd}" stroke="#000" stroke-width="0.6"/><line x1="${X(0) - 4}" y1="${yd + 4}" x2="${X(0) + 4}" y2="${yd - 4}" stroke="#000" stroke-width="1.2"/><line x1="${X(L) - 4}" y1="${yd + 4}" x2="${X(L) + 4}" y2="${yd - 4}" stroke="#000" stroke-width="1.2"/>`;
  T(X(L / 2), yd - 4, `L = ${f(L, 3)} m`);
  // (b) SFD and (c) BMD on factored load
  const plot = (vals: number[], y0: number, hmax: number, max: number, fill: string, title: string, unit: string, down: boolean, atX = false) => {
    T(W / 2, y0 - hmax - 14, title, 'font-weight="600"');
    const sc = hmax / max,
      P = xs.map((x, i) => `${X(x).toFixed(1)},${(y0 - (down ? -1 : 1) * vals[i] * sc).toFixed(1)}`);
    o += `<polygon points="${X(0)},${y0} ${P.join(' ')} ${X(L)},${y0}" fill="${fill}" stroke="#000" stroke-width="1"/><line x1="${X(0) - 10}" y1="${y0}" x2="${X(L) + 10}" y2="${y0}" stroke="#000" stroke-width="0.8"/>`;
    if (!atX) return y0;
    const iMax = vals.reduce((b, v, i) => (Math.abs(v) > Math.abs(vals[b]) ? i : b), 0);
    const yy = y0 - (down ? -1 : 1) * vals[iMax] * sc;
    T(X(xs[iMax]), yy + (down ? 14 : -5), `M_u = ${f(vals[iMax])} ${unit} at x = ${f(xs[iMax])} m`, 'font-weight="600"');
    return y0;
  };
  const ySf = yd + 110;
  plot(V, ySf, 55, Vm, '#fde7c8', `(b) Shear force — factored wu = γf(D + L), γf = ${gf}`, 'kN/m', false);
  // end shears beside the curve: above it when positive, below when negative
  const vy = (v: number) => ySf - v * (55 / Vm) + (v >= 0 ? -5 : 14);
  T(X(0) + 4, vy(V[0]), `V_A = +${f(V[0])} kN/m`, 'text-anchor="start" font-weight="600"');
  T(X(L) - 4, vy(V[N]), `V_B = ${f(V[N])} kN/m`, 'text-anchor="end" font-weight="600"');
  const i0 = V.findIndex((v) => v <= 0);
  if (i0 > 0 && i0 < N) T(X(xs[i0]), ySf - 6, `V = 0 at x = ${f(xs[i0])} m`, 'font-size="9.5"');
  const yBm = ySf + 120;
  plot(M, yBm, 70, Mm, '#f8d0d0', '(c) Bending moment — factored (drawn on the tension side)', 'kNm/m', true, true);
  const H = yBm + 100;
  return `<figure class="dwg"><svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%;height:auto;background:#fff;border:1px solid #bbb" font-family="Arial, Helvetica, sans-serif" xmlns="http://www.w3.org/2000/svg">${DEFS}${o}</svg><figcaption>Fig. ${no} — Span ${esc(sp.name)}: simply supported strip — loading, shear force and bending moment diagrams (x from A)</figcaption></figure>`;
}

// ---------- beam: stair line loads ----------

/** Loading diagram of one support beam: the Stair Dead / Live UDLs it gets from each span, placed along it. */
export function beamLoadSvg(m: Model, b: Beam, rows: BeamLoadRow[], no: number) {
  const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 1000;
  if (!rows.length || L < 0.01) return '';
  const W = 760,
    pad = 70,
    sx = (W - 2 * pad) / L,
    X = (x: number) => pad + x * sx,
    qmax = Math.max(...rows.map((r) => r.dl + r.ll), 1e-6),
    qs = 80 / qmax,
    yb = 140,
    S = beamStart(b);
  let o = `<text x="${W / 2}" y="20" font-size="11" font-weight="600" text-anchor="middle">Stair Dead (hatched) + Stair Live (blue), unfactored kN/m — x from the beam start (${f(S.x / 1000)}, ${f(S.y / 1000)})</text>`;
  // overlapping rows stack, as the loads add up on the beam
  const stack: { a: number; b: number; top: number }[] = [];
  for (const r of rows) {
    const a = r.a / 1000,
      e = r.b / 1000,
      base = Math.max(0, ...stack.filter((s) => s.a < e - 1e-6 && s.b > a + 1e-6).map((s) => s.top)),
      hd = r.dl * qs,
      hl = r.ll * qs,
      w = (e - a) * sx;
    o += `<rect x="${X(a).toFixed(1)}" y="${(yb - base - hd).toFixed(1)}" width="${w.toFixed(1)}" height="${hd.toFixed(1)}" fill="url(#hatch)" stroke="#000" stroke-width="0.8"/>`;
    o += `<rect x="${X(a).toFixed(1)}" y="${(yb - base - hd - hl).toFixed(1)}" width="${w.toFixed(1)}" height="${hl.toFixed(1)}" fill="#dbe7fb" stroke="#1f4e9c" stroke-width="0.8"/>`;
    const cx = X((a + e) / 2);
    o += `<text x="${cx.toFixed(1)}" y="${(yb - base - hd / 2 + 4).toFixed(1)}" font-size="10" font-weight="600" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${f(r.dl)}</text>`;
    o += `<text x="${cx.toFixed(1)}" y="${(yb - base - hd - hl / 2 + 4).toFixed(1)}" font-size="10" fill="#1f4e9c" text-anchor="middle">${f(r.ll)}</text>`;
    o += `<text x="${cx.toFixed(1)}" y="${(yb - base - hd - hl - 5).toFixed(1)}" font-size="9.5" text-anchor="middle">from ${esc(r.sp.name)}</text>`;
    // position dims under the beam
    const yd = yb + 34 + 16 * stack.length;
    o += `<line x1="${X(a)}" y1="${yd}" x2="${X(e)}" y2="${yd}" stroke="#000" stroke-width="0.6"/>${[a, e].map((x) => `<line x1="${X(x) - 4}" y1="${yd + 4}" x2="${X(x) + 4}" y2="${yd - 4}" stroke="#000" stroke-width="1.2"/><line x1="${X(x)}" y1="${yb + 4}" x2="${X(x)}" y2="${yd + 4}" stroke="#999" stroke-width="0.4"/>`).join('')}`;
    o += `<text x="${cx.toFixed(1)}" y="${yd - 3}" font-size="9.5" text-anchor="middle">${f(a)} – ${f(e)} m</text>`;
    stack.push({ a, b: e, top: base + hd + hl });
  }
  o += `<line x1="${X(0)}" y1="${yb}" x2="${X(L)}" y2="${yb}" stroke="#000" stroke-width="3"/>`;
  for (const x of [0, L]) o += `<line x1="${X(x)}" y1="${yb - 8}" x2="${X(x)}" y2="${yb + 8}" stroke="#000" stroke-width="1.6"/>`;
  const yL = yb + 50 + 16 * stack.length;
  o += `<line x1="${X(0)}" y1="${yL}" x2="${X(L)}" y2="${yL}" stroke="#000" stroke-width="0.6"/><text x="${X(L / 2)}" y="${yL - 3}" font-size="10.5" text-anchor="middle">beam length ${f(L)} m</text>`;
  const H = yL + 16;
  return `<figure class="dwg"><svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%;height:auto;background:#fff;border:1px solid #bbb" font-family="Arial, Helvetica, sans-serif" xmlns="http://www.w3.org/2000/svg">${DEFS}${o}</svg><figcaption>Fig. ${no} — Beam ${esc(beamName(m, b))} ${esc(b.section)}: stair loading diagram</figcaption></figure>`;
}
