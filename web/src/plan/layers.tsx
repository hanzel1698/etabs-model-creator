import { memo, useEffect, useMemo } from 'react';
import { useApp, sectionColor } from '../model/store';
import type { Beam, Column, FrameSection, Grid, Model, Slab } from '../model/types';
import { angleDeg, fmt, polyArea } from '../model/geom';
import { gridDimensions } from '../model/ops';
import { columnOutline } from './snap';
import { readableAngle, textTransform } from './viewport';
import { useUnderlay, regionFor, sheetFor, ensurePageRendered } from '../underlay/store';

const NS = { vectorEffect: 'non-scaling-stroke' } as const;

// ---------------- underlay ----------------

export const UnderlayLayer = memo(function UnderlayLayer({ story, viewRot }: { story: string; viewRot: number }) {
  const u = useUnderlay();
  const invert = useApp((s) => s.invertPdf);
  const sheet = u.kind === 'pdf' ? sheetFor(story) : null;
  useEffect(() => {
    if (sheet) ensurePageRendered(sheet.page);
  }, [sheet?.page, u.pdfBytes]);

  if (u.kind === 'dxf' && u.dxf) {
    // The DXF linework itself is drawn on a canvas (UnderlayCanvas): large architectural DXFs have
    // ~100k segments, which freezes the browser as SVG. Only the light region overlays stay in SVG.
    if (!u.setupMode) {
      // the cropped view: name the story above the top edge of its region (shifted so its reference point is 0,0)
      const reg = regionFor(story);
      if (!reg) return null;
      const w = reg.rect.maxX - reg.rect.minX;
      const fs = Math.max(400, w / 30);
      return (
        <text className="nosel" transform={textTransform((reg.rect.minX + reg.rect.maxX) / 2 - reg.ref.x, reg.rect.maxY - reg.ref.y, viewRot)} dy={-fs * 0.5} fontSize={fs} fontWeight={700} textAnchor="middle" fill="#4aa3ff">
          {story}
        </text>
      );
    }
    return (
      <g className="underlay">
        <g>
          {
            u.regions.map((r) => (
              <g key={r.id}>
                <rect x={r.rect.minX} y={r.rect.minY} width={r.rect.maxX - r.rect.minX} height={r.rect.maxY - r.rect.minY} fill="rgba(80,160,255,.06)" stroke="#4aa3ff" strokeDasharray="6 4" style={NS} />
                <text transform={textTransform(r.rect.minX, r.rect.maxY, viewRot)} dy="1.2em" fontSize={Math.max(300, (r.rect.maxX - r.rect.minX) / 40)} fill="#4aa3ff">
                  {r.stories.join(', ')}
                </text>
                <circle cx={r.ref.x} cy={r.ref.y} r={Math.max(150, (r.rect.maxX - r.rect.minX) / 150)} fill="none" stroke="#ff5a5a" style={NS} />
              </g>
            ))}
        </g>
      </g>
    );
  }
  if (sheet) {
    const r = u.rendered[sheet.page];
    if (!r) return null;
    const s = sheet.s;
    return (
      <g opacity={u.opacity} transform={`matrix(${s} 0 0 ${-s} ${-s * sheet.ref.x} ${s * (r.hPt - sheet.ref.y)})`}>
        <image href={r.url} x={0} y={0} width={r.wPt} height={r.hPt} preserveAspectRatio="none" style={{ filter: invert ? 'invert(1) hue-rotate(180deg)' : undefined }} />
      </g>
    );
  }
  return null;
});

// ---------------- grids ----------------

/** Grid c/c dimension chains (sizes scale with the bubble so they zoom with the plan). */
export const GridDimLayer = memo(function GridDimLayer({ grids, viewRot, bubble }: { grids: Grid[]; viewRot: number; bubble: number }) {
  const dims = useMemo(() => gridDimensions(grids, bubble), [grids, bubble]);
  const h = bubble * 0.32,
    t = bubble * 0.15;
  return (
    <g className="grid-dims nosel">
      {dims.map((d, i) => {
        const angle = d.vertical ? 90 : 0;
        const mx = (d.a.x + d.b.x) / 2,
          my = (d.a.y + d.b.y) / 2;
        return (
          <g key={i}>
            <line x1={d.a.x} y1={d.a.y} x2={d.b.x} y2={d.b.y} stroke="var(--dim)" strokeWidth={1} style={NS} />
            {d.ticks.map((p, j) => (
              <line key={j} x1={p.x - t} y1={p.y - t} x2={p.x + t} y2={p.y + t} stroke="var(--dim)" strokeWidth={1.5} style={NS} />
            ))}
            <text transform={textTransform(mx, my, viewRot, readableAngle(angle, viewRot))} dy={-h * 0.35} fontSize={h} textAnchor="middle" fill="var(--dim)">
              {fmt(d.value)}
            </text>
          </g>
        );
      })}
    </g>
  );
});

export const GridLayer = memo(function GridLayer({ grids, sel, viewRot, showLabels, bubble }: { grids: Grid[]; sel: Set<string>; viewRot: number; showLabels: boolean; bubble: number }) {
  const r = bubble / 2;
  return (
    <g className="grids">
      {grids.map((g) => {
        const s = sel.has(g.id);
        const ends: [number, number, number, number][] = [];
        const dx = g.x2 - g.x1,
          dy = g.y2 - g.y1,
          L = Math.hypot(dx, dy) || 1;
        const ux = dx / L,
          uy = dy / L;
        if (g.bubble !== 'start') ends.push([g.x2 + ux * r, g.y2 + uy * r, g.x2, g.y2]);
        if (g.bubble !== 'end') ends.push([g.x1 - ux * r, g.y1 - uy * r, g.x1, g.y1]);
        return (
          <g key={g.id} className={s ? 'sel' : undefined}>
            <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={s ? 'var(--sel)' : 'var(--grid)'} strokeDasharray="14 5 3 5" strokeWidth={1} style={NS} />
            {showLabels &&
              ends.map(([cx, cy], i) => (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={r} fill="var(--bg)" stroke={s ? 'var(--sel)' : 'var(--grid)'} strokeWidth={1.2} style={NS} />
                  <text transform={textTransform(cx, cy, viewRot)} fontSize={r * 0.95} textAnchor="middle" dominantBaseline="central" fill="var(--gridText)" className="nosel">
                    {g.label}
                  </text>
                </g>
              ))}
          </g>
        );
      })}
    </g>
  );
});

// ---------------- slabs / beams / columns ----------------

export const SlabLayer = memo(function SlabLayer({ slabs, sel, ghost }: { slabs: Slab[]; sel: Set<string>; ghost?: boolean }) {
  return (
    <g className="slabs" opacity={ghost ? 0.25 : 1}>
      {slabs.map((s) => (
        <polygon
          key={s.id}
          points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={sel.has(s.id) ? 'var(--selFill)' : 'var(--slab)'}
          stroke={sel.has(s.id) ? 'var(--sel)' : 'var(--slabEdge)'}
          strokeWidth={1}
          style={NS}
        />
      ))}
    </g>
  );
});

export const BeamLayer = memo(function BeamLayer({ beams, sel, ghost, colorBy }: { beams: Beam[]; sel: Set<string>; ghost?: boolean; colorBy: boolean }) {
  return (
    <g className="beams" opacity={ghost ? 0.3 : 1}>
      {beams.map((b) => (
        <line
          key={b.id}
          x1={b.x1}
          y1={b.y1}
          x2={b.x2}
          y2={b.y2}
          stroke={sel.has(b.id) ? 'var(--sel)' : ghost ? 'var(--ghost)' : colorBy ? sectionColor(b.section) : 'var(--beam)'}
          strokeWidth={sel.has(b.id) ? 3.5 : 2.2}
          strokeLinecap="round"
          style={NS}
        />
      ))}
    </g>
  );
});

export const ColumnLayer = memo(function ColumnLayer({ cols, secs, sel, ghost, colorBy }: { cols: Column[]; secs: Map<string, FrameSection>; sel: Set<string>; ghost?: boolean; colorBy: boolean }) {
  return (
    <g className="columns" opacity={ghost ? 0.3 : 1}>
      {cols.map((c) => {
        const sec = secs.get(c.section);
        const s = sel.has(c.id);
        const fill = s ? 'var(--sel)' : ghost ? 'var(--ghost)' : colorBy ? sectionColor(c.section) : 'var(--col)';
        if (sec?.shape === 'Circle') return <circle key={c.id} cx={c.x} cy={c.y} r={sec.t3 / 2} fill={fill} fillOpacity={0.85} stroke="var(--colEdge)" style={NS} />;
        const ol = columnOutline(c, sec);
        return <polygon key={c.id} points={ol.map((p) => `${p.x},${p.y}`).join(' ')} fill={fill} fillOpacity={0.85} stroke="var(--colEdge)" strokeWidth={1} style={NS} />;
      })}
    </g>
  );
});

// ---------------- labels ----------------

export const LabelLayer = memo(function LabelLayer({ m, story, viewRot, ts, showSlabs }: { m: Model; story: string; viewRot: number; ts: number; showSlabs: boolean }) {
  const h = 160 * ts;
  const secs = useMemo(() => new Map(m.frameSections.map((s) => [s.name, s])), [m.frameSections]);
  return (
    <g className="labels nosel" fontSize={h}>
      {m.beams.map((b) => {
        if (b.story !== story) return null;
        const a = readableAngle(angleDeg({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }), viewRot);
        return (
          <text key={b.id} transform={textTransform((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, viewRot, a)} dy={-h * 0.45} textAnchor="middle" fill="var(--label)">
            {b.section}
          </text>
        );
      })}
      {m.columns.map((c) => {
        if (c.story !== story) return null;
        const sec = secs.get(c.section);
        const off = Math.max(sec?.t3 || 400, sec?.t2 || 400) / 2 + h * 0.3;
        return (
          <text key={c.id} transform={textTransform(c.x + off, c.y - off, viewRot)} dominantBaseline="hanging" fill="var(--labelCol)">
            {c.section}
          </text>
        );
      })}
      {showSlabs &&
        m.slabs.map((s) => {
          if (s.story !== story) return null;
          const c = centroid(s.pts);
          return (
            <text key={s.id} transform={textTransform(c.x, c.y, viewRot)} textAnchor="middle" dominantBaseline="central" fill="var(--labelSlab)">
              {s.section}
            </text>
          );
        })}
    </g>
  );
});

function centroid(pts: { x: number; y: number }[]) {
  const A = polyArea(pts);
  if (Math.abs(A) < 1e-6) return pts[0];
  let cx = 0,
    cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}
