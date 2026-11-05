import { memo } from 'react';
import type { Flight, Landing, Span } from '../model/types';
import { fmt } from '../model/geom';
import { frame, landingRect, rectPts } from '../stair/stair';
import { readableAngle, textTransform } from './viewport';

const NS = { vectorEffect: 'non-scaling-stroke' } as const;
const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

/** Flights (treads, UP arrow), landings and design spans on the plan, in world (mm) coordinates. */
export const StairLayer = memo(function StairLayer({ flights, landings, spans, sel, viewRot, ts }: { flights: Flight[]; landings: Landing[]; spans: Span[]; sel: Set<string>; viewRot: number; ts: number }) {
  const fs = 160 * ts;
  const label = (x: number, y: number, text: string, fill = 'var(--text)', ang = 0) => (
    <text transform={textTransform(x, y, viewRot, readableAngle(ang, viewRot))} fontSize={fs} textAnchor="middle" dominantBaseline="central" fill={fill} className="halo nosel">
      {text}
    </text>
  );
  return (
    <g className="stair">
      {landings.map((l) => {
        const r = landingRect(l),
          s = sel.has(l.id);
        return (
          <g key={l.id}>
            <polygon points={pts(rectPts(r))} fill={s ? 'var(--selFill)' : 'var(--landing)'} stroke={s ? 'var(--sel)' : 'var(--landingEdge)'} strokeWidth={s ? 2 : 1.2} style={NS} />
            {label((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, `${l.name}  +${fmt(l.z)}`)}
          </g>
        );
      })}
      {flights.map((f) => {
        const F = frame(f),
          s = sel.has(f.id);
        const at = (q: number, c: number) => ({ x: F.O[0] + F.u[0] * q + F.v[0] * c, y: F.O[1] + F.u[1] * q + F.v[1] * c });
        const a = at(Math.min(150, F.L * 0.1), F.w / 2),
          b = at(F.L * 0.9, F.w / 2);
        const head = 180,
          back = { x: -F.u[0] * head, y: -F.u[1] * head },
          side = { x: F.v[0] * head * 0.45, y: F.v[1] * head * 0.45 };
        const ang = (Math.atan2(F.u[1], F.u[0]) * 180) / Math.PI;
        const mid = at(F.L / 2, F.w * 0.72);
        return (
          <g key={f.id}>
            <polygon points={pts(rectPts(F.r))} fill={s ? 'var(--selFill)' : 'var(--flight)'} stroke={s ? 'var(--sel)' : 'var(--flightEdge)'} strokeWidth={s ? 2 : 1.2} style={NS} />
            {Array.from({ length: Math.max(0, f.n - 2) }, (_, i) => {
              const p = at((i + 1) * f.T, 0),
                q = at((i + 1) * f.T, F.w);
              return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--flightEdge)" strokeWidth={0.6} style={NS} />;
            })}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text)" strokeWidth={1.4} style={NS} />
            <polygon points={pts([b, { x: b.x + back.x + side.x, y: b.y + back.y + side.y }, { x: b.x + back.x - side.x, y: b.y + back.y - side.y }])} fill="var(--text)" />
            {label(at(0, F.w * 0.25).x, at(0, F.w * 0.25).y, 'UP')}
            {label(mid.x, mid.y, `${f.name}  ${f.n}R  +${fmt(f.z0)}→+${fmt(f.z0 + F.H)}`, 'var(--text)', ang)}
          </g>
        );
      })}
      {spans.map((sp) => {
        const L = Math.hypot(sp.x2 - sp.x1, sp.y2 - sp.y1) || 1,
          nx = (-(sp.y2 - sp.y1) / L) * (sp.width / 2),
          ny = ((sp.x2 - sp.x1) / L) * (sp.width / 2),
          s = sel.has(sp.id),
          c = s ? 'var(--sel)' : 'var(--span)';
        const ang = (Math.atan2(sp.y2 - sp.y1, sp.x2 - sp.x1) * 180) / Math.PI;
        return (
          <g key={sp.id}>
            <polygon points={pts([{ x: sp.x1 + nx, y: sp.y1 + ny }, { x: sp.x2 + nx, y: sp.y2 + ny }, { x: sp.x2 - nx, y: sp.y2 - ny }, { x: sp.x1 - nx, y: sp.y1 - ny }])} fill={c} fillOpacity={0.07} />
            <line x1={sp.x1} y1={sp.y1} x2={sp.x2} y2={sp.y2} stroke={c} strokeWidth={2} strokeDasharray="8 4" style={NS} />
            {[
              [sp.x1, sp.y1],
              [sp.x2, sp.y2],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={70} fill={c} />
            ))}
            {label(sp.x1 + (sp.x2 - sp.x1) * 0.3 + nx * 0.6, sp.y1 + (sp.y2 - sp.y1) * 0.3 + ny * 0.6, `${sp.name}  ${fmt(L)}`, c, ang)}
          </g>
        );
      })}
    </g>
  );
});
