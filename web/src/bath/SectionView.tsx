/**
 * The generated section.
 *
 * Drawn in (d, level) space: d along the section line, level down-positive from
 * the datum. Screen y also runs down, so no flip is needed.
 *
 * Bays are metres and slab thicknesses are millimetres, so the level axis has
 * its own exaggeration factor. It only scales the drawing — every reported
 * number comes from the checks, untouched.
 */

import { useMemo, useRef } from 'react';
import type { BeamCheck } from './engine/checks';
import { levelTags, sectionGeometry } from './engine/levels';
import type { PlanModel, SectionRun } from './engine/types';
import { useSize } from './useSize';

const PAD = { top: 46, right: 40, bottom: 40, left: 86 };
const GRID_BUBBLE_R = 10;
/** Clearance between the grid line/bubble and the section drawing itself. */
const GRID_LINE_GAP = 10;

/**
 * A conventional break symbol: a single zigzag jog across an otherwise
 * straight line, drawn across a member wherever it is shown cut short of its
 * true extent — an overshoot end on a column, or a mid-span cut on a beam or
 * slab — so the drawing reads as "keeps going" rather than "ends here".
 */
function BreakLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const amp = Math.max(2, Math.min(6, len * 0.12));
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const points = [
    [x1, y1],
    [x1 + dx * 0.35, y1 + dy * 0.35],
    [mx - nx * amp, my - ny * amp],
    [mx + nx * amp, my + ny * amp],
    [x1 + dx * 0.65, y1 + dy * 0.65],
    [x2, y2],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
  return <polyline className="section-break-line" points={points} />;
}

/**
 * Marks a beam-slab junction that is not drawn as a break: the concrete is
 * monolithic there, so a plain dotted line stands in for the "keeps going"
 * cue instead of the zigzag break symbol, which would wrongly suggest the
 * member is shown cut short.
 */
function InterfaceLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line className="section-interface-line" x1={x1} y1={y1} x2={x2} y2={y2} />;
}

interface Props {
  model: PlanModel;
  run: SectionRun;
  checks: BeamCheck[];
  exaggeration: number;
  /** Right-click on a beam in the section; the plan follows, both being one model. */
  onEditBeamSink: (id: string, at: { clientX: number; clientY: number }) => void;
}

export function SectionView({ model, run: fullRun, checks, exaggeration, onEditBeamSink }: Props) {
  // grid lines the adapter made from column positions with no EMC grid behind them carry no label
  const run = useMemo(() => ({ ...fullRun, gridCrossings: fullRun.gridCrossings.filter((g) => g.label) }), [fullRun]);
  const hostRef = useRef<HTMLDivElement>(null);
  const size = useSize(hostRef);

  const geometry = useMemo(() => sectionGeometry(model, run, checks), [model, run, checks]);
  const tags = useMemo(() => levelTags(geometry), [geometry]);

  const width = size.width;
  const height = size.height;
  const availW = Math.max(width - PAD.left - PAD.right, 1);
  const availH = Math.max(height - PAD.top - PAD.bottom, 1);

  // A little headroom above and below so upstands and soffits are not clipped.
  const levelSpan = Math.max(geometry.maxLevel - geometry.minLevel, 1) * 1.25;
  const baseScale = Math.min(availW / Math.max(geometry.length, 1), availH / levelSpan);
  const sx = baseScale;
  const sy = Math.min(baseScale * exaggeration, availH / levelSpan);

  const originY = PAD.top + availH / 2 - ((geometry.minLevel + geometry.maxLevel) / 2) * sy;
  const toX = (d: number) => PAD.left + d * sx;
  const toY = (level: number) => originY + level * sy;

  // Grid lines only need to span the drawing itself, with a small gap for the
  // bubble — not the full canvas height.
  const gridLineTop = toY(geometry.minLevel) - GRID_LINE_GAP;
  const gridLineBottom = toY(geometry.maxLevel) + GRID_LINE_GAP;
  const gridBubbleY = gridLineTop - GRID_BUBBLE_R - 4;

  if (run.items.length === 0) {
    return (
      <div className="canvas-host section-host" ref={hostRef}>
        <p className="empty-note">
          {run.warnings[0] ?? 'Nothing to cut here: the section line crosses no beams or slabs on this story.'}
        </p>
      </div>
    );
  }

  return (
    <div className="canvas-host section-host" ref={hostRef}>
      {/* Right-click is a command here, as on the plan, so the browser menu
          stays out of the way whether or not it landed on a beam. */}
      <svg
        className="section-svg"
        width={width}
        height={height}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Datum. */}
        <g className="datum">
          <line x1={PAD.left - 60} y1={toY(0)} x2={width - PAD.right} y2={toY(0)} />
          <text x={PAD.left - 66} y={toY(0) - 5}>
            0.000 SLAB TOP
          </text>
        </g>

        {/* Level tags for each distinct sink. */}
        <g className="level-tags">
          {tags
            .filter((level) => level !== 0)
            .map((level) => (
              <g key={level}>
                <line x1={PAD.left - 46} y1={toY(level)} x2={width - PAD.right} y2={toY(level)} />
                <text x={PAD.left - 52} y={toY(level) - 4}>
                  &#9660; {level}
                </text>
              </g>
            ))}
        </g>

        {/* Grid lines the section line crosses, carried over from the plan. */}
        <g className="section-grid-lines">
          {run.gridCrossings.map((crossing) => {
            const x = toX(crossing.d);
            return (
              <line
                key={`${crossing.axis}-${crossing.lineId}`}
                x1={x}
                y1={gridLineTop}
                x2={x}
                y2={gridLineBottom}
              />
            );
          })}
        </g>

        <g className="section-elements">
          {geometry.elements.map((element) => {
            const x = toX(element.d0);
            const w = Math.max((element.d1 - element.d0) * sx, 1);
            const y = toY(element.top);
            const h = Math.max((element.bottom - element.top) * sy, 1);
            const cls = [
              `sec-${element.kind}`,
              element.sunken ? 'sec--sunken' : '',
              element.longitudinal ? 'sec--longitudinal' : '',
              element.kind === 'beam' && !element.pass ? 'sec--fail' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const beamId = element.beamId;
            return (
              <g
                key={element.key}
                className={beamId ? `${cls} sec--editable` : cls}
                onContextMenu={
                  beamId
                    ? (e) => {
                        e.preventDefault();
                        onEditBeamSink(beamId, e);
                      }
                    : undefined
                }
              >
                <rect x={x} y={y} width={w} height={h} />
                {element.kind === 'column' ? (
                  <>
                    <BreakLine x1={x} y1={y} x2={x + w} y2={y} />
                    <BreakLine x1={x} y1={y + h} x2={x + w} y2={y + h} />
                  </>
                ) : (
                  <>
                    {element.d0Cut && <InterfaceLine x1={x} y1={y} x2={x} y2={y + h} />}
                    {element.d1Cut && <InterfaceLine x1={x + w} y1={y} x2={x + w} y2={y + h} />}
                  </>
                )}
                {element.kind !== 'column' && w > 26 && (
                  <text x={x + w / 2} y={y + h / 2}>
                    {element.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Mark the beams that fail to catch, at whichever face is at fault:
            below, where the soffit falls short of the slab soffit, and above,
            where the beam has been sunk past the slab top. Both can be wrong on
            the one beam, so each is drawn on its own. */}
        <g className="fail-marks">
          {checks
            .filter((check) => !check.pass)
            .map((check) => {
              const x = toX((check.d0 + check.d1) / 2);
              const topShort =
                check.requiredTopLevel !== null && check.requiredTopLevel < check.topLevel;
              return (
                <g key={`${check.beamId}-${check.d0}`}>
                  {check.requiredSoffitLevel > check.soffitLevel && (
                    <>
                      <line
                        x1={x}
                        y1={toY(check.soffitLevel)}
                        x2={x}
                        y2={toY(check.requiredSoffitLevel)}
                      />
                      <text x={x} y={toY(check.requiredSoffitLevel) + 14}>
                        needs {Math.round(check.requiredDepth)}
                      </text>
                    </>
                  )}
                  {topShort && (
                    <>
                      <line
                        x1={x}
                        y1={toY(check.topLevel)}
                        x2={x}
                        y2={toY(check.requiredTopLevel!)}
                      />
                      <text x={x} y={toY(check.requiredTopLevel!) - 7}>
                        top {check.requiredTopLevel}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
        </g>

        {/* Bubbles for the grid lines above, always on top. */}
        <g className="section-grid-bubbles">
          {run.gridCrossings.map((crossing) => {
            const x = toX(crossing.d);
            return (
              <g key={`${crossing.axis}-${crossing.lineId}`}>
                <circle cx={x} cy={gridBubbleY} r={GRID_BUBBLE_R} />
                <text x={x} y={gridBubbleY}>
                  {crossing.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="scale-readout">
        {exaggeration === 1 ? 'true scale' : `levels exaggerated ${exaggeration}×`}
      </div>
    </div>
  );
}
