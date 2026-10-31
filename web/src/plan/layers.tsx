import { memo, useEffect, useMemo } from 'react';
import { useApp, sectionColor, colorKey, type ColorBy } from '../model/store';
import { columnOn, levelTag, type Beam, type Column, type FrameLoad, type FrameSection, type Grid, type Model, type Slab } from '../model/types';
import { angleDeg, fmt, polyArea } from '../model/geom';
import { gridDimensions } from '../model/ops';
import { describeJointLoad, shortFrameLoad } from '../model/loads';
import { columnOutline } from './snap';
import { readableAngle, textTransform } from './viewport';
import { useUnderlay, sheetFor, ensurePageRendered } from '../underlay/store';

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
    // the cropped view names the story in a fixed screen banner (PlanView), not in world space
    if (!u.setupMode) return null;
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

const keyColor = (k: string | null, def: string) => (k === null ? def : sectionColor(k));

/** Key of the colours in use: one swatch per section / pattern set / load value among `items`. */
export function ColorLegend({ items, colorBy, pattern }: { items: Parameters<typeof colorKey>[0][]; colorBy: ColorBy; pattern: string }) {
  const keys = useMemo(() => [...new Set(items.map((x) => colorKey(x, colorBy, pattern)).filter((k): k is string => k !== null))].sort(), [items, colorBy, pattern]);
  if (colorBy === 'none') return null;
  return (
    <div className="color-legend nosel" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      {keys.length ? keys.map((k) => (
        <div key={k}>
          <span className="swatch" style={{ background: sectionColor(k) }} />
          {k}
        </div>
      )) : <div className="muted">{colorBy === 'section' ? 'Nothing shown' : colorBy === 'pattern' ? 'No loads assigned' : `No ${pattern} loads`}</div>}
    </div>
  );
}

export const SlabLayer = memo(function SlabLayer({ slabs, sel, ghost, colorBy, pattern = '' }: { slabs: Slab[]; sel: Set<string>; ghost?: boolean; colorBy: ColorBy; pattern?: string }) {
  return (
    <g className="slabs" opacity={ghost ? 0.25 : 1}>
      {slabs.map((s) => {
        const picked = sel.has(s.id);
        const k = picked ? null : colorKey(s, colorBy, pattern);
        const c = k === null ? null : sectionColor(k);
        return (
          <polygon
            key={s.id}
            points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={picked ? 'var(--selFill)' : c ?? 'var(--slab)'}
            fillOpacity={c ? 0.18 : undefined}
            stroke={picked ? 'var(--sel)' : c ?? 'var(--slabEdge)'}
            strokeOpacity={c ? 0.7 : undefined}
            strokeWidth={1}
            style={NS}
          />
        );
      })}
    </g>
  );
});

export const BeamLayer = memo(function BeamLayer({ beams, sel, ghost, colorBy, pattern = '' }: { beams: Beam[]; sel: Set<string>; ghost?: boolean; colorBy: ColorBy; pattern?: string }) {
  return (
    <g className="beams" opacity={ghost ? 0.3 : 1}>
      {beams.map((b) => (
        <line
          key={b.id}
          x1={b.x1}
          y1={b.y1}
          x2={b.x2}
          y2={b.y2}
          stroke={sel.has(b.id) ? 'var(--sel)' : ghost ? 'var(--ghost)' : keyColor(colorKey(b, colorBy, pattern), 'var(--beam)')}
          strokeWidth={sel.has(b.id) ? 3.5 : 2.2}
          strokeLinecap="round"
          style={NS}
        />
      ))}
    </g>
  );
});

export const ColumnLayer = memo(function ColumnLayer({ cols, secs, sel, ghost, colorBy, pattern = '' }: { cols: Column[]; secs: Map<string, FrameSection>; sel: Set<string>; ghost?: boolean; colorBy: ColorBy; pattern?: string }) {
  return (
    <g className="columns" opacity={ghost ? 0.3 : 1}>
      {cols.map((c) => {
        const sec = secs.get(c.section);
        const s = sel.has(c.id);
        const fill = s ? 'var(--sel)' : ghost ? 'var(--ghost)' : keyColor(colorKey(c, colorBy, pattern), 'var(--col)');
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
  // elements on a reference plane name it (or their offset) after the section
  const tag = (x: { story: string; dz?: number }) => (x.dz ? ` @ ${levelTag(m, x)}` : '');
  return (
    <g className="labels nosel" fontSize={h}>
      {m.beams.map((b) => {
        if (b.story !== story) return null;
        const a = readableAngle(angleDeg({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }), viewRot);
        return (
          <text key={b.id} transform={textTransform((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, viewRot, a)} dy={-h * 0.45} textAnchor="middle" fill="var(--label)">
            {b.section}
            {tag(b)}
          </text>
        );
      })}
      {m.columns.map((c) => {
        if (!columnOn(m, c, story)) return null;
        const sec = secs.get(c.section);
        const off = Math.max(sec?.t3 || 400, sec?.t2 || 400) / 2 + h * 0.3;
        return (
          <text key={c.id} transform={textTransform(c.x + off, c.y - off, viewRot)} dominantBaseline="hanging" fill="var(--labelCol)">
            {c.section}
            {c.story === story && tag(c)}
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
              {tag(s)}
            </text>
          );
        })}
    </g>
  );
});

// ---------------- loads ----------------

/**
 * Values of the active pattern's loads on a story, in the load colour: under each beam (kN/m; P = point load in kN,
 * with a band over the loaded length when a distributed load covers only part of the beam), beside columns, at slab centroids (kN/m²) and at loaded joints (↓ with components).
 */
export const LoadLayer = memo(function LoadLayer({ m, story, pattern, viewRot, ts }: { m: Model; story: string; pattern: string; viewRot: number; ts: number }) {
  const h = 150 * ts;
  const mine = <L extends { pattern: string }>(ls?: L[]) => (ls ?? []).filter((l) => l.pattern === pattern);
  return (
    <g className="loads nosel" fontSize={h} fill="var(--load)">
      {m.beams.map((b) => {
        const ls = mine(b.loads);
        if (b.story !== story || !ls.length) return null;
        const a = readableAngle(angleDeg({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }), viewRot);
        const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1;
        const at = (t: number) => ({ x: b.x1 + (b.x2 - b.x1) * t, y: b.y1 + (b.y2 - b.y1) * t });
        // unit normal, for the ticks that close off a partly loaded length
        const nx = -(b.y2 - b.y1) / L,
          ny = (b.x2 - b.x1) / L;
        // distributed loads over part of the beam: highlighted over that length and labelled at its middle
        const span = (l: FrameLoad) => [Math.max(0, l.rel ? l.d1 : l.d1 / L), Math.min(1, l.rel ? l.d2 : l.d2 / L)];
        const partial = (l: FrameLoad) => {
          const [t1, t2] = span(l);
          return l.kind === 'dist' && t2 > t1 && (t1 > 1e-3 || t2 < 1 - 1e-3);
        };
        const rest = ls.filter((l) => !partial(l));
        const label = (t: number, txt: string, key: string) => {
          const c = at(t);
          return (
            <text key={key} transform={textTransform(c.x, c.y, viewRot, a)} dy={h * 1.05} textAnchor="middle">
              {txt}
            </text>
          );
        };
        return (
          <g key={b.id}>
            {ls.filter(partial).map((l, i) => {
              const [t1, t2] = span(l);
              const p = at(t1),
                q = at(t2),
                k = h * 0.45;
              return (
                <g key={`d${i}`}>
                  <g stroke="var(--loadSpan)">
                    <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={9} strokeOpacity={0.6} strokeLinecap="butt" style={NS} />
                    {[p, q].map((e, j) => (
                      <line key={j} x1={e.x - nx * k} y1={e.y - ny * k} x2={e.x + nx * k} y2={e.y + ny * k} strokeWidth={1.8} style={NS} />
                    ))}
                  </g>
                  {label((t1 + t2) / 2, shortFrameLoad(l), 't')}
                </g>
              );
            })}
            {rest.length > 0 && label(0.5, rest.map(shortFrameLoad).join(' + '), 'mid')}
            {ls
              .filter((l) => l.kind === 'point')
              .map((l, i) => {
                const { x, y } = at(l.rel ? l.d1 : l.d1 / L);
                return <circle key={i} cx={x} cy={y} r={h * 0.3} />;
              })}
          </g>
        );
      })}
      {m.columns.map((c) => {
        const ls = mine(c.loads);
        if (!ls.length || !columnOn(m, c, story)) return null;
        return (
          <text key={c.id} transform={textTransform(c.x, c.y, viewRot)} dx={-h * 0.6} dy={h * 1.4} textAnchor="end">
            {ls.map(shortFrameLoad).join(' + ')}
          </text>
        );
      })}
      {m.slabs.map((s) => {
        const ls = mine(s.loads);
        if (s.story !== story || !ls.length) return null;
        const c = centroid(s.pts);
        const txt = ls.map((l) => Math.round(l.value * 1000) / 1000).join(' + ');
        return (
          <text key={s.id} transform={textTransform(c.x, c.y, viewRot)} dy={h * 1.3} textAnchor="middle" dominantBaseline="central">
            {txt} kN/m²
          </text>
        );
      })}
      {m.jointLoads.map((j) =>
        j.story !== story || j.pattern !== pattern ? null : (
          <text key={j.id} transform={textTransform(j.x, j.y, viewRot)} dx={h * 0.5} dy={-h * 0.5}>
            ↓ {describeJointLoad(j.f)}
          </text>
        ),
      )}
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
