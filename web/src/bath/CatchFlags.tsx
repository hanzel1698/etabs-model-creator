// Plan flags for beam ends and slab sides nothing catches (BSD's plan-wide catch check), in screen pixels so they keep their size at any zoom.
import { useMemo, useSyncExternalStore } from 'react';
import { useApp } from '../model/store';
import type { Model, Pt } from '../model/types';
import { viewport } from '../plan/viewport';
import { checkBearing, type EndBearing } from './engine/bearing';
import { checkSlabBearing, type SlabSide } from './engine/slabBearing';
import { toPlanModel } from './toPlan';

/** How far back along the beam the arrowhead lands, so it hits beam rather than support. */
const FLAG_TIP_INSET = 24;
/** Length of the leader from that arrowhead out to the text box. */
const FLAG_LEADER = 42;
const FLAG_LINE_H = 13;
const FLAG_PAD_X = 7;
/** Rough advance width of the 10px label face, enough to size a box around it. */
const FLAG_CHAR_W = 5.9;
/** How far inside the slab's true edge its uncaught-side mark sits. */
const SLAB_MARK_INSET = 5;

interface Placement {
  tip: Pt;
  tail: Pt;
  box: Pt;
  headAngle: number;
}

/** Leader out a fixed length along `out`, box hung off its end by its own boundary. */
function leaderFrom(tip: Pt, out: Pt, width: number, height: number): Placement {
  const length = Math.hypot(out.x, out.y);
  const unit = length < 1e-6 ? { x: 1, y: 0 } : { x: out.x / length, y: out.y / length };
  const tail = { x: tip.x + unit.x * FLAG_LEADER, y: tip.y + unit.y * FLAG_LEADER };
  const toEdgeX = Math.abs(unit.x) < 1e-6 ? Infinity : width / 2 / Math.abs(unit.x);
  const toEdgeY = Math.abs(unit.y) < 1e-6 ? Infinity : height / 2 / Math.abs(unit.y);
  const toEdge = Math.min(toEdgeX, toEdgeY);
  return { tip, tail, box: { x: tail.x + unit.x * toEdge, y: tail.y + unit.y * toEdge }, headAngle: (Math.atan2(-unit.y, -unit.x) * 180) / Math.PI };
}

/** Beam-end callout: arrowhead just in from the end, box pushed sideways away from the drawing's middle. */
function flagPlacement(at: Pt, ahead: Pt, centre: Pt, width: number, height: number): Placement {
  const span = Math.hypot(ahead.x - at.x, ahead.y - at.y);
  const dir = span < 1e-6 ? { x: 1, y: 0 } : { x: (ahead.x - at.x) / span, y: (ahead.y - at.y) / span };
  const tip = { x: at.x + dir.x * FLAG_TIP_INSET, y: at.y + dir.y * FLAG_TIP_INSET };
  const normal = { x: -dir.y, y: dir.x };
  const side = (tip.x - centre.x) * normal.x + (tip.y - centre.y) * normal.y >= 0 ? 1 : -1;
  return leaderFrom(tip, { x: normal.x * side, y: normal.y * side }, width, height);
}

/** Slab-side mark: the side moved onto the slab's own edge and a little in; the callout hangs into the panel. */
function slabMark(a: Pt, b: Pt, into: Pt, inset: number, width: number, height: number) {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const along = span < 1e-6 ? { x: 1, y: 0 } : { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
  const reach = Math.hypot(into.x, into.y);
  const inward = reach < 1e-6 ? { x: -along.y, y: along.x } : { x: into.x / reach, y: into.y / reach };
  const off = inset + SLAB_MARK_INSET;
  const shift = (p: Pt) => ({ x: p.x + inward.x * off, y: p.y + inward.y * off });
  const from = shift(a),
    to = shift(b);
  return { from, to, placement: leaderFrom({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, inward, width, height) };
}

function Callout({ p, lines }: { p: Placement; lines: string[] }) {
  const width = Math.max(...lines.map((l) => l.length)) * FLAG_CHAR_W + FLAG_PAD_X * 2;
  const height = lines.length * FLAG_LINE_H + 8;
  return (
    <>
      <line x1={p.tip.x} y1={p.tip.y} x2={p.tail.x} y2={p.tail.y} />
      <path className="head" transform={`translate(${p.tip.x},${p.tip.y}) rotate(${p.headAngle.toFixed(1)})`} d="M 0,0 L -8,-3.6 L -8,3.6 Z" />
      <rect x={p.box.x - width / 2} y={p.box.y - height / 2} width={width} height={height} rx={3} />
      {lines.map((line, i) => (
        <text key={line} className={i === 0 ? 'flag-title' : undefined} x={p.box.x} y={p.box.y - height / 2 + 4 + FLAG_LINE_H * (i + 0.5)}>
          {line}
        </text>
      ))}
    </>
  );
}

const boxSize = (lines: string[]) => [Math.max(...lines.map((l) => l.length)) * FLAG_CHAR_W + FLAG_PAD_X * 2, lines.length * FLAG_LINE_H + 8] as const;

/** Failing beam ends and slab sides of one story, in EMC plan coordinates. */
export function catchFindings(m: Model, story: string) {
  const { plan, origin } = toPlanModel(m, story);
  const back = (p: Pt) => ({ x: p.x + origin.x, y: p.y + origin.y });
  const ends = checkBearing(plan).flatMap((b) => b.ends.filter((e) => !e.pass).map((e) => ({ label: b.label, beamId: b.beamId, end: { ...e, at: back(e.at) } as EndBearing })));
  const sides = checkSlabBearing(plan).flatMap((s) => s.sides.filter((x) => !x.pass).map((x) => ({ label: s.label, side: { ...x, a: back(x.a), b: back(x.b), mid: back(x.mid) } as SlabSide })));
  return { ends, sides };
}

export function CatchFlags({ story, offset }: { story: string; offset: Pt | null }) {
  useSyncExternalStore((f) => viewport.subscribe(f), () => viewport.version);
  const m = useApp((s) => s.model);
  const { ends, sides } = useMemo(() => catchFindings(m, story), [m, story]);
  if (!ends.length && !sides.length) return null;
  const ox = offset?.x ?? 0,
    oy = offset?.y ?? 0;
  const S = (p: Pt) => viewport.toScreen({ x: p.x + ox, y: p.y + oy });
  // beam-end callouts swing away from the middle of this story's framing
  const bs = m.beams.filter((b) => b.story === story).flatMap((b) => [b.x1, b.x2]);
  const ys = m.beams.filter((b) => b.story === story).flatMap((b) => [b.y1, b.y2]);
  const centre = S({ x: (Math.min(...bs) + Math.max(...bs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  return (
    <g className="catch-flags nosel" pointerEvents="none">
      {sides.map(({ label, side }, i) => {
        const support = side.upstandLabel ? `${side.beamLabel}+${side.upstandLabel}` : side.beamLabel;
        const lines = [`${label} not caught`, `${support}: ${side.note}`];
        const [w, h] = boxSize(lines);
        const mid = S(side.mid),
          inw = S({ x: side.mid.x + side.inward.x, y: side.mid.y + side.inward.y });
        const { from, to, placement } = slabMark(S(side.a), S(side.b), { x: inw.x - mid.x, y: inw.y - mid.y }, side.inset * viewport.k, w, h);
        return (
          <g key={`s${i}`} className="slab-flag">
            <line className="edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            <Callout p={placement} lines={lines} />
          </g>
        );
      })}
      {ends.map(({ label, beamId, end }) => {
        const lines = [label, end.note];
        const [w, h] = boxSize(lines);
        const p = flagPlacement(S(end.at), S({ x: end.at.x + end.inward.x, y: end.at.y + end.inward.y }), centre, w, h);
        return (
          <g key={`${beamId}-${end.which}`} className="bearing-flag">
            <Callout p={p} lines={lines} />
          </g>
        );
      })}
    </g>
  );
}
