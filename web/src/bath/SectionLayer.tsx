import type { Beam, SectionCut, Slab } from '../model/types';
import { fmt, polyArea } from '../model/geom';
import { readableAngle, textTransform } from '../plan/viewport';

const NS = { vectorEffect: 'non-scaling-stroke' } as const;

function centroid(pts: { x: number; y: number }[]) {
  const a = polyArea(pts) || 1;
  let x = 0,
    y = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length],
      c = p.x * q.y - q.x * p.y;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  });
  return { x: x / (6 * a), y: y / (6 * a) };
}

/** Bathroom section cuts (with view arrows) and sink / duct tags on the plan, in world (mm) coordinates. */
export function SectionLayer({ cuts, active, beams, slabs, viewRot, ts }: { cuts: SectionCut[]; active: string | null; beams: Beam[]; slabs: Slab[]; viewRot: number; ts: number }) {
  const fs = 150 * ts;
  const text = (x: number, y: number, s: string, fill: string, ang = 0, dy = 0) => (
    <text key={`${x},${y},${s}`} transform={textTransform(x, y, viewRot, readableAngle(ang, viewRot))} dy={dy} fontSize={fs} textAnchor="middle" dominantBaseline="central" fill={fill} className="halo nosel">
      {s}
    </text>
  );
  return (
    <g className="bath-sections" pointerEvents="none">
      {slabs.filter((s) => s.sink || s.duct).map((s) => {
        const c = centroid(s.pts);
        return text(c.x, c.y, s.duct ? 'DUCT' : `↓${fmt(s.sink!)}`, 'var(--accent)', 0, fs * 1.4);
      })}
      {beams.filter((b) => b.sink).map((b) => text((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, `↓${fmt(b.sink!)}`, 'var(--accent)', (Math.atan2(b.y2 - b.y1, b.x2 - b.x1) * 180) / Math.PI, -fs))}
      {cuts.map((c) => {
        const on = c.id === active;
        const dx = c.b.x - c.a.x,
          dy = c.b.y - c.a.y,
          L = Math.hypot(dx, dy) || 1;
        // viewing direction: to the left of a→b, flipped when reversed
        const s = c.reversed ? -1 : 1,
          nx = (-dy / L) * s,
          ny = (dx / L) * s;
        const h = fs * 2.2;
        const tx = dx / L,
          ty = dy / L;
        // shaft along the viewing normal, then a V head at its tip
        const arrow = (p: { x: number; y: number }) => {
          const e = { x: p.x + nx * h, y: p.y + ny * h };
          const back = (k: number) => `${e.x - nx * h * 0.35 + tx * h * 0.2 * k},${e.y - ny * h * 0.35 + ty * h * 0.2 * k}`;
          return `M${p.x},${p.y} L${e.x},${e.y} M${back(1)} L${e.x},${e.y} L${back(-1)}`;
        };
        const tag = c.label.split('-')[0];
        return (
          <g key={c.id} opacity={on || !active ? 1 : 0.45}>
            <line x1={c.a.x} y1={c.a.y} x2={c.b.x} y2={c.b.y} stroke="var(--accent)" strokeWidth={on ? 2.4 : 1.2} strokeDasharray="10 4 2 4" style={NS} />
            <path d={arrow(c.a) + arrow(c.b)} fill="none" stroke="var(--accent)" strokeWidth={on ? 2 : 1.2} style={NS} />
            {text(c.a.x - (dx / L) * fs * 1.2, c.a.y - (dy / L) * fs * 1.2, tag, 'var(--accent)')}
            {text(c.b.x + (dx / L) * fs * 1.2, c.b.y + (dy / L) * fs * 1.2, tag, 'var(--accent)')}
          </g>
        );
      })}
    </g>
  );
}
